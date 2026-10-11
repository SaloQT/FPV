struct ParkLightScene { counts : vec4u, data : array<vec4f> }
#ifndef GRP
@group(2) @binding(8) var<storage, read> park : ParkLightScene;
#else
@group(${GRP}) @binding(16) var<storage, read> park : ParkLightScene;
#endif
fn parkRoom(p : vec3f) -> i32 {
  for (var i = 0u; i < park.counts.y; i++) { let at = park.counts.x * 2u + i * 2u;
    if (all(p > park.data[at].xyz) && all(p < park.data[at + 1u].xyz)) { return i32(i); }
  }
  return -1;
}
fn parkLightRange(p : vec3f) -> vec2u {
  if (park.counts.x == 0u || any(abs(p.xz) >= vec2f(1024.0))) { return vec2u(0u); }
  let cell = vec2u((p.xz + 1024.0) / 32.0);
  return bitcast<vec2u>(park.data[park.counts.x * 2u + park.counts.y * 2u + cell.y * 64u + cell.x].xy);
}
fn parkLightIndex(at : u32) -> u32 {
  let base = park.counts.x * 2u + park.counts.y * 2u + 4096u;
  let indices = bitcast<vec4u>(park.data[base + at / 4u]); return indices[at & 3u];
}
fn parkIrradiance(p : vec3f, index : u32) -> vec4f {
  let a = park.data[index * 2u]; let b = park.data[index * 2u + 1u];
  let distance2 = dot(a.xyz - p, a.xyz - p);
  let fade = 1.0 - smoothstep(b.w * b.w * 0.6, b.w * b.w, distance2);
  return vec4f(b.rgb * a.w / max(distance2, 0.25) * fade, sqrt(distance2));
}
