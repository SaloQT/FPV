// Shared helpers of the objects module: G-buffer packing, value noise, small SDFs and screen-space bump mapping.
#include "common/world_bindings.wgsl"

struct GOut {
  @location(0) albedo : vec4f,
  @location(1) normal : vec4f,
  @location(2) misc : vec4f,
  @location(3) motion : vec2f,
};

// Everything a material function decides about a pixel; packG turns it into the four G-buffer targets.
struct Surf {
  albedo : vec3f,
  ao : f32,
  normal : vec3f,
  roughness : f32,
  metalness : f32,
  emissive : f32,
  translucency : f32,
  material : u32,
};

// Total exposure (pre-exposure x exposure ratio) at the camera's full night gain: 2^(maxGainEv + DAY_TOTAL_EV) in post/exposure.ts, kept equal by a test.
const NIGHT_TOTAL_EXPOSURE : f32 = 365.1;

// Display level (after exposure, 1 = clipping) the core of an LED glow may reach for an emissive strength; mirrored in objects/ledGlow.ts.
fn ledDisplay(strength : f32) -> f32 {
  return clamp(strength * 4.0, 0.15, 2.2);
}

// Glow level in pre-exposed units: the physical value while it stays under the cap, which holds the display level near ledDisplay (an uncapped
// halo clips to white, losing the LED colour, and overflows fp16 under the night pre-exposure). The exposure ratio is at most NIGHT_TOTAL_EXPOSURE / pre.
fn glowShown(strength : f32, energy : f32) -> f32 {
  let pre = frame.params.y;
  return min(strength * EMISSIVE_MAX_NITS * 0.35 * energy * pre, ledDisplay(strength) * max(1.0, pre / NIGHT_TOTAL_EXPOSURE));
}

fn uvOfClip(clip : vec4f) -> vec2f {
  let ndc = clip.xy / clip.w;
  return vec2f(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5);
}

fn packG(s : Surf, prevClip : vec4f, currClip : vec4f) -> GOut {
  var o : GOut;
  o.albedo = vec4f(clamp(s.albedo, vec3f(0.0), vec3f(1.0)), saturate1(s.ao));
  o.normal = vec4f(octEncode(s.normal), saturate1(s.roughness), saturate1(s.metalness));
  o.misc = vec4f(f32(s.material) / 255.0, saturate1(s.translucency), 0.0, saturate1(s.emissive));
  let ok = prevClip.w > 1e-4 && currClip.w > 1e-4;
  o.motion = select(vec2f(0.0), uvOfClip(prevClip) - uvOfClip(currClip), ok);
  return o;
}

fn newSurf(albedo : vec3f, n : vec3f, roughness : f32, material : u32) -> Surf {
  return Surf(albedo, 1.0, n, roughness, 0.0, 0.0, 0.0, material);
}

fn vnoise2(p : vec2f) -> f32 {
  let i = floor(p);
  let f = p - i;
  let u = f * f * (3.0 - 2.0 * f);
  let c = bitcast<vec2u>(vec2i(i));
  let a = hash21(c);
  let b = hash21(c + vec2u(1u, 0u));
  let d = hash21(c + vec2u(0u, 1u));
  let e = hash21(c + vec2u(1u, 1u));
  return mix(mix(a, b, u.x), mix(d, e, u.x), u.y);
}

fn vnoise3(p : vec3f) -> f32 {
  let i = floor(p);
  let f = p - i;
  let u = f * f * (3.0 - 2.0 * f);
  let c = bitcast<vec3u>(vec3i(i));
  let a = mix(mix(hash31(c), hash31(c + vec3u(1u, 0u, 0u)), u.x), mix(hash31(c + vec3u(0u, 1u, 0u)), hash31(c + vec3u(1u, 1u, 0u)), u.x), u.y);
  let b = mix(mix(hash31(c + vec3u(0u, 0u, 1u)), hash31(c + vec3u(1u, 0u, 1u)), u.x), mix(hash31(c + vec3u(0u, 1u, 1u)), hash31(c + vec3u(1u, 1u, 1u)), u.x), u.y);
  return mix(a, b, u.z);
}

fn fbm2(p : vec2f) -> f32 {
  return 0.5 * vnoise2(p) + 0.25 * vnoise2(p * 2.03 + 17.0) + 0.125 * vnoise2(p * 4.01 + 41.0) + 0.0625 * vnoise2(p * 8.07 + 73.0);
}

fn fbm3(p : vec3f) -> f32 {
  return 0.5 * vnoise3(p) + 0.25 * vnoise3(p * 2.03 + 17.0) + 0.125 * vnoise3(p * 4.01 + 41.0) + 0.0625 * vnoise3(p * 8.07 + 73.0);
}

// Signed distance to an axis-aligned box of half extents b centred at the origin.
fn sdBox(p : vec2f, b : vec2f) -> f32 {
  let d = abs(p) - b;
  return length(max(d, vec2f(0.0))) + min(max(d.x, d.y), 0.0);
}

// Anti-aliased coverage of a signed distance given the pixel footprint (metres).
fn sdCover(d : f32, footprint : f32) -> f32 {
  return saturate1(0.5 - d / max(footprint, 1e-5));
}

// Gradients of the uv coordinates on the surface, in world space. dp1/dp2 are dpdx/dpdy of the world position and duv1/duv2
// the same for uv; dividing by the determinant makes the result independent of the derivative sign convention.
struct UvGrad {
  gu : vec3f,
  gv : vec3f,
};

fn uvGradients(dp1 : vec3f, dp2 : vec3f, duv1 : vec2f, duv2 : vec2f, n : vec3f) -> UvGrad {
  let c2 = cross(dp2, n);
  let c1 = cross(n, dp1);
  let det = dot(dp1, c2);
  if (abs(det) < 1e-20) { return UvGrad(vec3f(0.0), vec3f(0.0)); }
  let k = 1.0 / det;
  return UvGrad((duv1.x * c2 + duv2.x * c1) * k, (duv1.y * c2 + duv2.y * c1) * k);
}

// Perturbs n for a height field whose uv partial derivatives are hu, hv (metres of height per metre of uv).
fn bumpNormal(n : vec3f, g : UvGrad, hu : f32, hv : f32) -> vec3f {
  return normalize(n - (hu * g.gu + hv * g.gv));
}

// Perturbs n by the world-space gradient of a scalar height field.
fn bumpFromGradient(n : vec3f, grad : vec3f) -> vec3f {
  return normalize(n - (grad - n * dot(grad, n)));
}
