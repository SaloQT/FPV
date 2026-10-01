// Leaf-canopy transmittance of the crown proxy spheres (flagged in word 15 of the packed primitive, see src/render/rt/canopy.ts which this mirrors).
// Light crossing a crown is attenuated by Beer-Lambert extinction integrated along the chord, with a fluffy rim and clump noise, so a crown
// casts a soft, dappled, partially transparent shadow. Included by rt_bvh.wgsl (needs primWord from rt_prims.wgsl).

const CANOPY_EXTINCTION : f32 = 0.24;
const CANOPY_CORE : f32 = 0.6;
const CANOPY_GAP_BASE : f32 = 0.4;
const CANOPY_GAP_SPAN : f32 = 1.2;
const CANOPY_INV_CLUMP : f32 = 1.1111111;
const CANOPY_SAMPLES : u32 = 4u;
const CANOPY_OPAQUE_TAU : f32 = 4.0;
const PRIM_FLAG_CANOPY : u32 = 1u;

fn primIsCanopy(i : u32) -> bool { return (primWord(i, 3u).w & PRIM_FLAG_CANOPY) != 0u; }

fn latticeNoise(c : vec3i) -> f32 { return hash31(bitcast<vec3u>(c)); }

fn valueNoise3(p : vec3f) -> f32 {
  let fl = floor(p);
  let f = p - fl;
  let u = f * f * (3.0 - 2.0 * f);
  let b = vec3i(fl);
  let x00 = mix(latticeNoise(b), latticeNoise(b + vec3i(1, 0, 0)), u.x);
  let x10 = mix(latticeNoise(b + vec3i(0, 1, 0)), latticeNoise(b + vec3i(1, 1, 0)), u.x);
  let x01 = mix(latticeNoise(b + vec3i(0, 0, 1)), latticeNoise(b + vec3i(1, 0, 1)), u.x);
  let x11 = mix(latticeNoise(b + vec3i(0, 1, 1)), latticeNoise(b + vec3i(1, 1, 1)), u.x);
  return mix(mix(x00, x10, u.y), mix(x01, x11, u.y), u.z);
}

// Optical depth of crown sphere `i` along o + t*d (unit d) within [0, tMax].
fn canopyOpticalDepth(i : u32, o : vec3f, d : vec3f, tMax : f32) -> f32 {
  let c = bitcast<vec4f>(primWord(i, 0u)).xyz;
  let r = bitcast<vec4f>(primWord(i, 1u)).w;
  let oc = o - c;
  let b = dot(oc, d);
  let h = b * b - (dot(oc, oc) - r * r);
  if (h <= 0.0) { return 0.0; }
  let s = sqrt(h);
  let t0 = max(-b - s, 0.0);
  let t1 = min(-b + s, tMax);
  if (t1 <= t0) { return 0.0; }
  let ds = (t1 - t0) / f32(CANOPY_SAMPLES);
  var tau = 0.0;
  for (var k = 0u; k < CANOPY_SAMPLES; k++) {
    let p = o + d * (t0 + ds * (f32(k) + 0.5));
    let leaf = 1.0 - smoothstep(CANOPY_CORE, 1.0, length(p - c) / r);
    tau += leaf * (CANOPY_GAP_BASE + CANOPY_GAP_SPAN * valueNoise3(p * CANOPY_INV_CLUMP));
  }
  return tau * ds * CANOPY_EXTINCTION;
}
