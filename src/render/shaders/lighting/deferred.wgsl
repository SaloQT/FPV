// Deferred lighting compute pass: G-buffer + RT results -> pre-exposed HDR radiance. Writes EVERY pixel of `hdr` (sky pixels get 0,
// or the skyView LUT colour when FALLBACK_SKY is defined because no module draws the sky). Physical units in, pre-exposed out.
#include "common/world_bindings.wgsl"
#include "common/atmosphere_sample.wgsl"
#include "common/pbr.wgsl"

@group(2) @binding(0) var gAlbedo : texture_2d<f32>;
@group(2) @binding(1) var gNormal : texture_2d<f32>;
@group(2) @binding(2) var gMisc : texture_2d<f32>;
@group(2) @binding(3) var gDepth : texture_depth_2d;
@group(2) @binding(4) var sunShadowTex : texture_2d<f32>;
@group(2) @binding(5) var giDiffuseTex : texture_2d<f32>;
@group(2) @binding(6) var giSpecularTex : texture_2d<f32>;
@group(2) @binding(7) var hdrOut : texture_storage_2d<rgba16float, write>;

const MAX_HDR : f32 = 60000.0;
const AMBIENT_SAMPLES : u32 = 16u;
const GROUND_ALBEDO : f32 = 0.15;
const HORIZON_EPS : f32 = -0.0145;

// Bilinear read of an r32float texture (textureLoad only) at a screen uv; the RT-resolution textures cover the whole screen.
fn loadBilinear(tex : texture_2d<f32>, uv : vec2f) -> f32 {
  let dims = vec2i(textureDimensions(tex));
  let p = uv * vec2f(dims) - 0.5;
  let base = floor(p);
  let f = p - base;
  let i = vec2i(base);
  let hi = dims - vec2i(1);
  let a = textureLoad(tex, clamp(i, vec2i(0), hi), 0).x;
  let b = textureLoad(tex, clamp(i + vec2i(1, 0), vec2i(0), hi), 0).x;
  let c = textureLoad(tex, clamp(i + vec2i(0, 1), vec2i(0), hi), 0).x;
  let d = textureLoad(tex, clamp(i + vec2i(1, 1), vec2i(0), hi), 0).x;
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

// Radiance (nits, not pre-exposed) of the ground seen from above: a Lambertian bounce of the key lights and the zenith sky.
fn groundRadiance(sunE : vec3f, moonE : vec3f, zenithSky : vec3f) -> vec3f {
  let direct = sunE * max(frame.sunDir.y, 0.0) + moonE * max(frame.moonDir.y, 0.0);
  return GROUND_ALBEDO * (direct * INV_PI + 0.6 * zenithSky);
}

// Sky radiance above the horizon, blending into the estimated ground below it.
fn envRadiance(dir : vec3f, ground : vec3f) -> vec3f {
  return mix(sampleSkyView(dir), ground, 1.0 - smoothstep(-0.08, 0.0, dir.y));
}

// Cosine-weighted mean of the environment around n == Lambert irradiance / pi (used when no GI is available).
fn ambientFallback(n : vec3f, px : vec2i, ground : vec3f) -> vec3f {
  let basis = basisFromNormal(n);
  // Golden-ratio shift per frame so TAA averages the 16-sample noise instead of seeing a frozen screen-space pattern.
  let rot = fract(textureLoad(blueNoise, vec2i(px.x & 127, px.y & 127), 0).x + f32(frame.misc.x & 63u) * 0.6180339887);
  var sum = vec3f(0.0);
  for (var i = 0u; i < AMBIENT_SAMPLES; i++) {
    let u = vec2f((f32(i) + 0.5) / f32(AMBIENT_SAMPLES), fract(f32(i) * 0.7548776662 + rot));
    sum += envRadiance(basis * cosineHemisphere(u), ground);
  }
  return sum / f32(AMBIENT_SAMPLES);
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid : vec3u) {
  let dims = textureDimensions(hdrOut);
  if (gid.x >= dims.x || gid.y >= dims.y) { return; }
  let px = vec2i(gid.xy);
  let uv = (vec2f(gid.xy) + 0.5) * frame.screen.zw;
  let pre = frame.params.y;
  let depth = textureLoad(gDepth, px, 0);
  if (depth <= 0.0) {
#ifdef FALLBACK_SKY
    textureStore(hdrOut, px, vec4f(min(sampleSkyView(viewRayDir(uv)) * pre, vec3f(MAX_HDR)), 1.0));
#else
    textureStore(hdrOut, px, vec4f(0.0, 0.0, 0.0, 1.0));
#endif
    return;
  }

  let alb = textureLoad(gAlbedo, px, 0);
  let nrm = textureLoad(gNormal, px, 0);
  let msc = textureLoad(gMisc, px, 0);
  let n = octDecode(nrm.xy);
  let wet = msc.b;
  let rough = clamp(nrm.z * mix(1.0, 0.4, wet), 0.02, 1.0);
  let metal = saturate1(nrm.w);
  let baseColor = alb.rgb * mix(1.0, 0.6, wet);
  let diffuseColor = baseColor * (1.0 - metal);
  let f0 = mix(vec3f(0.04), baseColor, metal);

  let world = worldFromDepth(uv, depth);
  let toCam = frame.camPos.xyz - world;
  let dist = length(toCam);
  let v = toCam / max(dist, 1e-4);
  let nv = max(dot(n, v), 1e-3);

  let r = atmosRadiusAtHeight(world.y);
  let sunE = frame.sunIrradiance.rgb * frame.sunIrradiance.w * sampleTransmittance(r, frame.sunDir.y);
  let moonUp = select(0.0, 1.0, frame.moonDir.y > HORIZON_EPS);
  let moonE = frame.moonIrradiance.rgb * moonUp * sampleTransmittance(r, frame.moonDir.y);

  let visibility = loadBilinear(sunShadowTex, uv);
  let keyIsMoon = frame.misc.w == 1u;
  let sunVis = select(visibility, 1.0, keyIsMoon);
  let moonVis = select(1.0, visibility, keyIsMoon);
  let direct = directLight(frame.sunDir.xyz, n, v, diffuseColor, f0, rough, msc.g, sunE * sunVis, frame.sunDir.w)
             + directLight(frame.moonDir.xyz, n, v, diffuseColor, f0, rough, msc.g, moonE * moonVis, frame.moonDir.w);

  let zenithSky = sampleSkyView(vec3f(0.0, 1.0, 0.0));
  let ground = groundRadiance(sunE, moonE, zenithSky);
  let gd = textureSampleLevel(giDiffuseTex, linearClamp, uv, 0.0);
  let gs = textureSampleLevel(giSpecularTex, linearClamp, uv, 0.0);
  var ao = alb.a;
  var irradianceOverPi : vec3f;
  if (gd.a > 0.0) {
    irradianceOverPi = gd.rgb;
    ao = ao * gd.a;
  } else {
    irradianceOverPi = ambientFallback(n, px, ground) * pre;
  }
  let reflDir = normalize(mix(reflect(-v, n), n, rough * rough));
  let specRadiance = mix(envRadiance(reflDir, ground) * pre, gs.rgb, saturate1(gs.a));
  let indirect = diffuseColor * irradianceOverPi * ao
               + specRadiance * envBrdfApprox(f0, rough, nv) * specularOcclusion(nv, ao, rough);

  var color = direct * pre + indirect + msc.a * EMISSIVE_MAX_NITS * alb.rgb * pre;
  let ap = sampleAerialPerspective(uv, dist);
  color = color * ap.a + ap.rgb * pre;
  textureStore(hdrOut, px, vec4f(clamp(color, vec3f(0.0), vec3f(MAX_HDR)), 1.0));
}
