// One thread per instance slot: distance, pixel-size and frustum culling of a bounding sphere, LOD selection, and an append into the
// per-(variant, LOD) visible lists. Counts become indirect instance counts in tree_finalize.wgsl; nothing is read back.
#include "vegetation/veg_params.wgsl"
#include "vegetation/veg_instance.wgsl"

@group(2) @binding(1) var<storage, read> instances : array<Instance>;
@group(2) @binding(2) var<storage, read> variants : array<Variant>;
@group(2) @binding(3) var<storage, read_write> counts : array<atomic<u32>>;
@group(2) @binding(4) var<storage, read_write> visible : array<u32>;

// Slack on the frustum test for wind sway and rock tilt.
const FRUSTUM_SCALE : f32 = 1.08;
const FRUSTUM_PAD : f32 = 0.6;

@compute @workgroup_size(64)
fn cull(@builtin(global_invocation_id) gid : vec3u) {
  let i = gid.x;
  if (i >= vp.treeCount.x) { return; }
  let inst = instances[i];
  if (inst.scale <= 0.0) { return; }
  let v = variants[inst.variant];
  let c = inst.pos + vec3f(0.0, v.bound.x * inst.scale, 0.0);
  let r = v.bound.y * inst.scale;
  let d = distance(c, frame.camPos.xyz);
  if (d > vp.tree.y) { return; }
  let pxPerM = frame.screen.y * 0.5 * frame.proj[1][1];
  if (r * pxPerM < vp.tree.z * d) { return; }
  if (!frustumSphereVisible(c, r * FRUSTUM_SCALE + FRUSTUM_PAD)) { return; }
  let reach = r * vp.tree.x;
  let lod = select(select(2u, 1u, d < v.bound.w * reach), 0u, d < v.bound.z * reach);
  let slot = atomicAdd(&counts[inst.variant * 3u + lod], 1u);
  visible[lod * vp.treeCount.x + v.range.x + slot] = i;
}
