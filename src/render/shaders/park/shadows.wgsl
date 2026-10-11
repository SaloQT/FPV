#include "rt/rt_prims.wgsl"
// Early-out visibility against the same static and refitted dynamic hierarchy used by GI.
fn parkShadow(o : vec3f, d : vec3f, distance : f32) -> f32 {
  let inv = 1.0 / select(d, vec3f(1e-8), abs(d) < vec3f(1e-8));
  var stack : array<u32, 32>; var sp = 0u;
  if (park.counts.z != 0xffffffffu) { stack[sp] = park.counts.z; sp++; }
  if (park.counts.w != 0xffffffffu) { stack[sp] = park.counts.w; sp++; }
  while (sp > 0u) {
    sp--; let node = stack[sp]; let a = bvhNodes[node * 2u]; let b = bvhNodes[node * 2u + 1u];
    let aa = (bitcast<vec3f>(a.xyz) - o) * inv; let bb = (bitcast<vec3f>(b.xyz) - o) * inv;
    let near = min(aa, bb); let far = max(aa, bb);
    if (max(max(near.x, near.y), max(near.z, 0.0)) > min(min(far.x, far.y), min(far.z, distance))) { continue; }
    if (b.w > 0u) { for (var k = 0u; k < b.w; k++) { if (intersectPrim(a.w + k, o, d, distance) < distance) { return 0.0; } } }
    else if (sp < 31u) { stack[sp] = a.w; stack[sp + 1u] = a.w + 1u; sp += 2u; }
  }
  return 1.0;
}
