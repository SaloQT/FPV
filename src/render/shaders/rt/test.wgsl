// Self-test kernel: traces caller-supplied rays through the heightfield or the proxy BVH and writes (t, primitive slot) per ray, so the
// CPU can compare against TerrainSampler.raycast and a brute-force intersection loop. Rays: [2i] = (origin, tMax), [2i+1] = (dir, 0 terrain | 1 bvh).
#include "rt/rt_terrain.wgsl"
#include "rt/rt_bvh.wgsl"

@group(${GRP}) @binding(3) var<storage, read> rays : array<vec4f>;
@group(${GRP}) @binding(4) var<storage, read_write> results : array<vec4f>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid : vec3u) {
  let i = gid.x;
  if (i >= rp.dims.x) { return; }
  let a = rays[2u * i];
  let b = rays[2u * i + 1u];
  if (b.w == 0.0) {
    results[i] = vec4f(traceTerrain(a.xyz, b.xyz, a.w, rp.cfg.y), -1.0, 0.0, 0.0);
    return;
  }
  let h = traceBvh(a.xyz, b.xyz, a.w, rp.scene.z, false);
  let hit = h.prim != NO_NODE;
  results[i] = vec4f(select(-1.0, h.t, hit), select(-1.0, f32(h.prim), hit), 0.0, 0.0);
}
