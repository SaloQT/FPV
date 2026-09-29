// Deferred lighting compute pass: G-buffer + RT results -> pre-exposed HDR radiance. Writes EVERY pixel of `hdr` (sky pixels get 0,
// or the skyView LUT colour when FALLBACK_SKY is defined because no module draws the sky). Physical units in, pre-exposed out.
#include "common/world_bindings.wgsl"
#include "common/atmosphere_sample.wgsl"
#include "common/pbr.wgsl"
#include "rt/rt_map.wgsl"

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

// Depth- and normal-aware upsample of the RT-resolution signals (sun shadow, GI, specular) to a full-resolution pixel. Every RT texel stands
// for the full-res pixel rtSourcePixel() picks this frame (the RT passes use the same mapping), so its depth and normal are re-read from the
// G-buffer there instead of binding the RT aux textures (this pass is at the 16 sampled-texture limit).
struct RtSample { shadow : f32, diffuse : vec4f, specular : vec4f };

const RT_DEPTH_SIGMA : f32 = 0.02;
const RT_NORMAL_POWER : f32 = 8.0;
const RT_MIN_WEIGHT : f32 = 1e-4;

fn rtLoad(q : vec2i) -> RtSample {
  return RtSample(textureLoad(sunShadowTex, q, 0).x, textureLoad(giDiffuseTex, q, 0), textureLoad(giSpecularTex, q, 0));
}

// Specular is accumulated premultiplied by its confidence so an unconfident (zero) neighbour does not darken a confident one.
fn rtAdd(acc : ptr<function, RtSample>, s : RtSample, w : f32) {
  (*acc).shadow += s.shadow * w;
  (*acc).diffuse += s.diffuse * w;
  (*acc).specular += vec4f(s.specular.rgb * s.specular.a, s.specular.a) * w;
}

fn rtResolve(acc : RtSample, wSum : f32) -> RtSample {
  let inv = 1.0 / wSum;
  return RtSample(acc.shadow * inv, acc.diffuse * inv, vec4f(acc.specular.rgb / max(acc.specular.a, RT_MIN_WEIGHT), acc.specular.a * inv));
}

fn sampleRT(px : vec2i, uv : vec2f, depth : f32, world : vec3f, n : vec3f) -> RtSample {
  let rtDims = vec2i(textureDimensions(giDiffuseTex));
  let fullDims = vec2i(textureDimensions(gDepth));
  if (rtDims.x == fullDims.x && rtDims.y == fullDims.y) { return rtLoad(px); }
  let div = select(4, 2, (fullDims.x + 1) / 2 == rtDims.x);
  let z = frame.params.z / depth;
  let p = uv * vec2f(rtDims) - 0.5;
  let base = vec2i(floor(p));
  let f = p - floor(p);
  let hi = rtDims - vec2i(1);
  var bilateral = RtSample(0.0, vec4f(0.0), vec4f(0.0));
  var bilinear = bilateral;
  var wSum = 0.0;
  for (var k = 0; k < 4; k++) {
    let o = vec2i(k & 1, k >> 1);
    let q = clamp(base + o, vec2i(0), hi);
    let bil = select(1.0 - f.x, f.x, o.x == 1) * select(1.0 - f.y, f.y, o.y == 1);
    let s = rtLoad(q);
    rtAdd(&bilinear, s, bil);
    let src = rtSourcePixel(q, div, fullDims, frame.misc.x);
    let dq = textureLoad(gDepth, src, 0);
    if (dq <= 0.0) { continue; }
    let nq = octDecode(textureLoad(gNormal, src, 0).xy);
    // Distance to this pixel's tangent plane, not the depth difference: on a grazing slope a tap a pixel away is metres deeper yet still coplanar.
    let planeDist = abs(dot(n, worldFromDepth((vec2f(src) + 0.5) * frame.screen.zw, dq) - world));
    let w = bil * exp(-planeDist / (RT_DEPTH_SIGMA * z)) * pow(max(dot(n, nq), 0.0), RT_NORMAL_POWER);
    rtAdd(&bilateral, s, w);
    wSum += w;
  }
  if (wSum > RT_MIN_WEIGHT) { return rtResolve(bilateral, wSum); }
  return rtResolve(bilinear, 1.0);
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

  let rt = sampleRT(px, uv, depth, world, n);
  let visibility = rt.shadow;
  let keyIsMoon = frame.misc.w == 1u;
  let sunVis = select(visibility, 1.0, keyIsMoon);
  let moonVis = select(1.0, visibility, keyIsMoon);
  let direct = directLight(frame.sunDir.xyz, n, v, diffuseColor, f0, rough, msc.g, sunE * sunVis, frame.sunDir.w)
             + directLight(frame.moonDir.xyz, n, v, diffuseColor, f0, rough, msc.g, moonE * moonVis, frame.moonDir.w);

  let zenithSky = sampleSkyView(vec3f(0.0, 1.0, 0.0));
  let ground = groundRadiance(sunE, moonE, zenithSky);
  let gd = rt.diffuse;
  let gs = rt.specular;
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
