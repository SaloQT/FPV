// 3D value noise for procedural bark; integer-hashed so it is stable under any camera or instance transform.
#include "vegetation/veg_params.wgsl"

fn vnoise3(p : vec3f) -> f32 {
  let i = floor(p);
  let f = p - i;
  let u = f * f * (3.0 - 2.0 * f);
  let b = bitcast<vec3u>(vec3i(i));
  let x00 = mix(hash31(b), hash31(b + vec3u(1u, 0u, 0u)), u.x);
  let x10 = mix(hash31(b + vec3u(0u, 1u, 0u)), hash31(b + vec3u(1u, 1u, 0u)), u.x);
  let x01 = mix(hash31(b + vec3u(0u, 0u, 1u)), hash31(b + vec3u(1u, 0u, 1u)), u.x);
  let x11 = mix(hash31(b + vec3u(0u, 1u, 1u)), hash31(b + vec3u(1u, 1u, 1u)), u.x);
  return mix(mix(x00, x10, u.y), mix(x01, x11, u.y), u.z);
}
