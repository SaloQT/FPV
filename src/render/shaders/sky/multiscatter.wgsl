// Multiple-scattering LUT (32x32), Hillaire 2020 section 5.5: one workgroup per texel (x = sun zenith cosine, y = height above the ground),
// 64 threads = 64 Fibonacci directions. Per unit of light illuminance (lux -> nits, so the unit is nits/lux = 1/sr):
//   L2  = mean over the sphere of the second-order in-scattered radiance (isotropic phase 1/4pi, sun single scattering plus the ground bounce)
//   fms = mean over the sphere of the scattering transfer function (fraction of light scattered again)
//   texel = L2 / (1 - fms)      (geometric series over all higher orders)
// The users multiply it by the local scattering coefficient [1/km] and the light illuminance [lux] (see scatterStep in atmos_params.wgsl).
#include "sky/lut_common.wgsl"

@group(1) @binding(3) var outTex : texture_storage_2d<rgba16float, write>;

const DIRS : u32 = 64u;
const STEPS : u32 = 20u;
const GOLDEN_ANGLE : f32 = 2.39996323;

var<workgroup> sharedL : array<vec3f, 64>;
var<workgroup> sharedF : array<vec3f, 64>;

@compute @workgroup_size(64)
fn main(@builtin(workgroup_id) wg : vec3u, @builtin(local_invocation_index) li : u32) {
  let uv = (vec2f(wg.xy) + 0.5) / 32.0;
  let muS = clamp(subUvToUnit(uv.x, 32.0) * 2.0 - 1.0, -1.0, 1.0);
  let rb = frame.sky.x;
  let rt = frame.sky.y;
  let r = max(rb + saturate1(subUvToUnit(uv.y, 32.0)) * (rt - rb), rb + 5e-4);
  let sunDir = vec3f(sqrt(max(1.0 - muS * muS, 0.0)), muS, 0.0);
  let p0 = vec3f(0.0, r, 0.0);

  // Fibonacci sphere, equal solid angle 4 pi / 64 per direction.
  let cz = 1.0 - 2.0 * (f32(li) + 0.5) / f32(DIRS);
  let sz = sqrt(max(1.0 - cz * cz, 0.0));
  let az = f32(li) * GOLDEN_ANGLE;
  let dir = vec3f(sz * cos(az), cz, sz * sin(az));

  let hitG = raySphere(p0, dir, rb);
  let hitsGround = hitG.x > 0.0;
  let hitT = raySphere(p0, dir, rt);
  let tMax = select(hitT.y, hitG.x, hitsGround);

  var lum = vec3f(0.0);
  var transfer = vec3f(0.0);
  var thr = vec3f(1.0);
  var t0 = 0.0;
  for (var i = 0u; i < STEPS; i++) {
    let f = f32(i + 1u) / f32(STEPS);
    let t1 = tMax * f * f;
    let dt = t1 - t0;
    let p = p0 + dir * (0.5 * (t0 + t1));
    let rp = length(p);
    let med = mediumAt(rp - rb);
    let scat = med.scatterR + vec3f(med.scatterM);
    let sunT = sampleTransmittance(rp, dot(p / rp, sunDir)) * planetVisibility(p, sunDir) * (0.25 * INV_PI);
    let stepT = exp(-med.extinction * dt);
    let inv = 1.0 / max(med.extinction, vec3f(1e-9));
    lum += thr * (scat * sunT - scat * sunT * stepT) * inv;
    transfer += thr * (scat - scat * stepT) * inv;
    thr *= stepT;
    t0 = t1;
  }
  if (hitsGround) {
    let pg = p0 + dir * tMax;
    lum += thr * groundRadianceAt(pg, sunDir, vec3f(1.0));
  }
  let w = 1.0 / f32(DIRS);
  sharedL[li] = lum * w;
  sharedF[li] = transfer * w;
  workgroupBarrier();
  var stride = 32u;
  loop {
    if (li < stride) {
      sharedL[li] += sharedL[li + stride];
      sharedF[li] += sharedF[li + stride];
    }
    workgroupBarrier();
    if (stride == 1u) { break; }
    stride = stride >> 1u;
  }
  if (li == 0u) {
    let l2 = sharedL[0];
    let fms = sharedF[0];
    textureStore(outTex, vec2i(wg.xy), vec4f(l2 / max(vec3f(1.0) - fms, vec3f(1e-3)), 1.0));
  }
}
