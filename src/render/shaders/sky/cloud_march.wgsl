// Cloud march (compute, one thread per texel of the reduced-resolution cloud target). Ray-marches the cumulus shell and the cirrus
// slab from the camera, lights every sample (sky/cloud_light.wgsl) and writes  rgb = in-scattered radiance [nits], a = transmittance
// for the sky pass, which composites  colour * a + rgb  (the same convention as the aerial-perspective froxels).
//
// UNIT CHAIN: radiance in nits, not pre-exposed (sky.wgsl applies frame.params.y once). The texture stores nits / CLOUD_STORE_SCALE so
// a cloud lit by the sun head-on (~4e5 nits) stays inside rgba16float; sky.wgsl multiplies it back. Lengths in km, planet-centred; the
// camera is at (0, Rb + frame.sky.z, 0). Aerial perspective: a cloud whose transmittance-weighted mean distance is D metres shows
//   rgb = L_cloud * T_ap(D) + In_ap(D) * (1 - a)
// with (In_ap, T_ap) from the froxels up to 12 km and, beyond that, blended toward the sky-view LUT (haze to the horizon colour,
// e-folding 25 km) with the transmittance fading out. The result is also faded to nothing between 60 and 100 km.
//
// Group 1: 3 output (rgba16float), plus everything sky/cloud_density.wgsl declares.
#include "sky/cloud_frame.wgsl"

@group(1) @binding(3) var outTex : texture_storage_2d<rgba16float, write>;
@group(1) @binding(11) var<storage, read> cloudFrame : CloudFrame;

const CLOUD_MAX_KM : f32 = 100.0;
const CLOUD_FADE_KM : f32 = 60.0;
const CIRRUS_MAX_KM : f32 = 200.0;
const FAR_HAZE_KM : f32 = 25.0;
const EARLY_OUT_T : f32 = 0.02;

struct Layer {
  lum : vec3f,
  a : f32,
  dist : f32,
};

fn emptyLayer() -> Layer {
  var l : Layer;
  l.lum = vec3f(0.0);
  l.a = 1.0;
  l.dist = 0.0;
  return l;
}

fn interleavedGradientNoise(p : vec2f) -> f32 {
  return fract(52.9829189 * fract(dot(p, vec2f(0.06711056, 0.00583715))));
}

fn halton(index : u32, base : u32) -> f32 {
  var f = 1.0;
  var r = 0.0;
  var n = index;
  while (n > 0u) {
    f = f / f32(base);
    r = r + f * f32(n % base);
    n = n / base;
  }
  return r;
}

// Radiance factor of one light at a cumulus sample: light reaching it, multiple-scattering phase sum and the powder term.
fn cumulusLightTerm(l : CloudLight, p : vec3f, r : f32, viewDir : vec3f, sigmaE : f32, lightSteps : i32, datumR : f32) -> vec3f {
  let e = lightAt(l, p, r);
  if (max(e.r, max(e.g, e.b)) < 1e-9) { return vec3f(0.0); }
  let c = dot(viewDir, l.dir);
  let tau = cumulusLightTau(p, l.dir, lightSteps, datumR);
  return e * (cloudInscatter(c, tau) * powderTerm(sigmaE, c));
}

fn marchCumulus(o : vec3f, d : vec3f, jitter : f32, lights : CloudLights, amb : Ambient) -> Layer {
  var res = emptyLayer();
  let datumR = datumRadius();
  var iv = shellInterval(o, d, datumR + ap.cloudB.x, datumR + ap.cloudB.y);
  iv.y = min(iv.y, CLOUD_MAX_KM);
  if (iv.x >= iv.y) { return res; }
  let steps = i32(ap.cloudC.x);
  let lightSteps = i32(ap.cloudD.z);
  let len = iv.y - iv.x;
  let curve = saturate((len - 8.0) / 40.0);
  let invSteps = 1.0 / f32(steps);
  var trans = 1.0;
  var lum = vec3f(0.0);
  var distSum = 0.0;
  var weightSum = 0.0;
  var prevF = 0.0;
  for (var i = 0; i < steps; i++) {
    let s1 = f32(i + 1) * invSteps;
    let f1 = mix(s1, s1 * s1, curve);
    let t = iv.x + len * mix(prevF, f1, jitter);
    let ds = len * (f1 - prevF);
    prevF = f1;
    let p = o + d * t;
    let r = length(p);
    let h = r - datumR;
    let dens = cumulusDensity(layerPlane(p, ap.wind.xy), h, 1.0 - smoothstep(6.0, 25.0, t));
    if (dens <= 0.0) { continue; }
    let sigma = CUMULUS_SIGMA_KM * ap.cloudA.z * dens;
    let stepT = exp(-sigma * ds);
    var scatter = ambientAt(amb, (h - ap.cloudB.x) / (ap.cloudB.y - ap.cloudB.x));
    if (lights.sun.w > 0.0) { scatter += cumulusLightTerm(lights.sun, p, r, d, sigma, lightSteps, datumR); }
    if (lights.moon.w > 0.0) { scatter += cumulusLightTerm(lights.moon, p, r, d, sigma, lightSteps, datumR); }
    let w = trans * (1.0 - stepT);
    lum += w * scatter;
    distSum += w * t;
    weightSum += w;
    trans *= stepT;
    if (trans < EARLY_OUT_T) { break; }
  }
  res.lum = lum;
  res.a = trans;
  res.dist = select(iv.x, distSum / weightSum, weightSum > 1e-5);
  return res;
}

fn marchCirrus(o : vec3f, d : vec3f, jitter : f32, lights : CloudLights, amb : Ambient) -> Layer {
  var res = emptyLayer();
  let datumR = datumRadius();
  var iv = shellInterval(o, d, datumR + ap.cloudB.z, datumR + ap.cloudB.w);
  iv.y = min(iv.y, CIRRUS_MAX_KM);
  if (iv.x >= iv.y) { return res; }
  let steps = clamp(i32(ap.cloudC.x) / 3, 6, 16);
  let len = iv.y - iv.x;
  let curve = saturate((len - 8.0) / 60.0);
  let invSteps = 1.0 / f32(steps);
  let ambient = 0.5 * (amb.top + amb.bottom);
  var trans = 1.0;
  var lum = vec3f(0.0);
  var distSum = 0.0;
  var weightSum = 0.0;
  var prevF = 0.0;
  for (var i = 0; i < steps; i++) {
    let s1 = f32(i + 1) * invSteps;
    let f1 = mix(s1, s1 * s1, curve);
    let t = iv.x + len * mix(prevF, f1, jitter);
    let ds = len * (f1 - prevF);
    prevF = f1;
    let p = o + d * t;
    let r = length(p);
    let dens = cirrusDensity(layerPlane(p, ap.wind.zw), r - datumR);
    if (dens <= 0.0) { continue; }
    let stepT = exp(-CIRRUS_SIGMA_KM * ap.cloudA.z * dens * ds);
    var scatter = ambient;
    if (lights.sun.w > 0.0) { scatter += lightAt(lights.sun, p, r) * cloudPhase(dot(d, lights.sun.dir), 1.0); }
    if (lights.moon.w > 0.0) { scatter += lightAt(lights.moon, p, r) * cloudPhase(dot(d, lights.moon.dir), 1.0); }
    let w = trans * (1.0 - stepT);
    lum += w * scatter;
    distSum += w * t;
    weightSum += w;
    trans *= stepT;
  }
  res.lum = lum;
  res.a = trans;
  res.dist = select(iv.x, distSum / weightSum, weightSum > 1e-5);
  return res;
}

// Applies the aerial perspective of the layer's mean distance and the far fade; returns (rgb, a) ready for  colour * a + rgb.
fn withAerial(layer : Layer, uv : vec2f, dir : vec3f) -> vec4f {
  if (layer.a >= 1.0) { return vec4f(0.0, 0.0, 0.0, 1.0); }
  let metres = layer.dist * 1000.0;
  let near = sampleAerialPerspective(uv, min(metres, AP_MAX_DISTANCE_M));
  let far = 1.0 - exp(-max(metres - AP_MAX_DISTANCE_M, 0.0) / (FAR_HAZE_KM * 1000.0));
  var haze = near.rgb;
  if (far > 0.0) { haze = mix(near.rgb, sampleSkyView(dir), far); }
  let fade = 1.0 - smoothstep(CLOUD_FADE_KM, CLOUD_MAX_KM, layer.dist);
  let a = mix(1.0, layer.a, fade);
  return vec4f((layer.lum * (near.a * (1.0 - far)) + haze * (1.0 - layer.a)) * fade, a);
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid : vec3u) {
  let dims = textureDimensions(outTex);
  if (gid.x >= dims.x || gid.y >= dims.y) { return; }
  let texel = vec2i(gid.xy);
  let o = vec3f(0.0, frame.sky.x + frame.sky.z, 0.0);
  let index = u32(ap.cloudC.y);
  let sub = vec2f(halton(index % 16u + 1u, 2u), halton(index % 16u + 1u, 3u));
  let uv = (vec2f(gid.xy) + sub) / vec2f(dims);
  let dir = viewRayDir(uv);
  if (ap.sky2.z < 0.5 || raySphere(o, dir, frame.sky.x).x > 0.0) {
    textureStore(outTex, texel, vec4f(0.0, 0.0, 0.0, 1.0));
    return;
  }
  let lights = cloudFrame.lights;
  let amb = cloudFrame.ambient;
  let jitter = interleavedGradientNoise(vec2f(gid.xy) + 5.588238 * f32(index % 64u));
  var cum = emptyLayer();
  if (ap.cloudA.x > 0.0) { cum = marchCumulus(o, dir, jitter, lights, amb); }
  var cir = emptyLayer();
  if (ap.cloudA.y > 0.0) { cir = marchCirrus(o, dir, fract(jitter + 0.61803), lights, amb); }
  let c = withAerial(cum, uv, dir);
  let i = withAerial(cir, uv, dir);
  textureStore(outTex, texel, vec4f(min((c.rgb + c.a * i.rgb) / CLOUD_STORE_SCALE, vec3f(FP16_STORE_MAX)), c.a * i.a));
}
