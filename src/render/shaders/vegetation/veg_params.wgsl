// Vegetation uniforms shared by every vegetation shader (group 2, binding 0), plus the frustum test used by the compute culls.
// Layout mirrored by packVegParams() in src/render/vegetation/params.ts.
#include "common/world_bindings.wgsl"

struct VegParams {
  wind : vec4f,     // xy = unit wind direction (x, z), z = mean speed (m/s), w = unused
  quad : vec4f,     // xyz = quad position, w = total thrust (N); 0 disables prop wash and trample
  quadVel : vec4f,  // xyz = quad velocity (m/s)
  grass : vec4f,    // x = patch size (m), y = grass distance, z = full-density radius, w = blades per m2
  grass2 : vec4f,   // x = LOD0 max distance, y = LOD1 max distance, z = water level (-1e9 when none), w = slots per patch
  cells : vec4i,    // xy = first cell of the camera-centred patch grid, z = cells per side, w = seed
  caps : vec4u,     // xyz = grass instance capacity of LOD0..2, w = chunk capacity
  tree : vec4f,     // x = LOD distance scale, y = max draw distance (m), z = smallest bounding radius kept (pixels), w = unused
  treeCount : vec4u, // x = instance slots (padding included; also the visible-list stride per LOD), y = number of draws
};

@group(2) @binding(0) var<uniform> vp : VegParams;

const NO_WATER_LEVEL : f32 = -1.0e8;

// Sphere against the five side planes of the (reverse-Z, infinite-far) view frustum; the far plane is at infinity.
fn frustumSphereVisible(c : vec3f, r : f32) -> bool {
  let m = frame.viewProjUnjittered;
  let x = vec4f(m[0].x, m[1].x, m[2].x, m[3].x);
  let y = vec4f(m[0].y, m[1].y, m[2].y, m[3].y);
  let z = vec4f(m[0].z, m[1].z, m[2].z, m[3].z);
  let w = vec4f(m[0].w, m[1].w, m[2].w, m[3].w);
  let p = vec4f(c, 1.0);
  let planes = array<vec4f, 5>(w + x, w - x, w + y, w - y, w - z);
  for (var i = 0; i < 5; i++) {
    let pl = planes[i];
    if (dot(pl, p) < -r * length(pl.xyz)) { return false; }
  }
  return true;
}
