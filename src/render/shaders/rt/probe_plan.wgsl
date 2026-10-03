// One invocation per physical probe texel: append traced probes or carry the old SH value.
// The trace pass reads only the previous set, so carry and trace output texels have disjoint owners.
#include "rt/rt_common.wgsl"

@group(${GRP}) @binding(3) var probeR : texture_3d<f32>;
@group(${GRP}) @binding(4) var probeG : texture_3d<f32>;
@group(${GRP}) @binding(5) var probeB : texture_3d<f32>;
@group(${GRP}) @binding(6) var newR : texture_storage_3d<rgba16float, write>;
@group(${GRP}) @binding(7) var newG : texture_storage_3d<rgba16float, write>;
@group(${GRP}) @binding(8) var newB : texture_storage_3d<rgba16float, write>;
@group(${GRP}) @binding(9) var<storage, read> prevPre : array<f32>;
@group(${GRP}) @binding(12) var<storage, read_write> activeIds : array<u32>;
struct ProbeDispatch { x : atomic<u32>, y : u32, z : u32, pad : u32 }
@group(${GRP}) @binding(13) var<storage, read_write> dispatch : ProbeDispatch;

fn posmod3(a : vec3i, m : vec3i) -> vec3i { return ((a % m) + m) % m; }

@compute @workgroup_size(4, 4, 4)
fn main(@builtin(global_invocation_id) gid : vec3u) {
  if (any(gid >= rp.probeDim.xyz)) { return; }
  let dim = vec3i(rp.probeDim.xyz);
  let cell = vec3i(gid);
  let lattice = rp.probeLo.xyz + posmod3(cell - rp.probeLo.xyz, dim);
  let prevLo = rp.probePrev.xyz;
  let inPrev = all(lattice >= prevLo) && all(lattice < prevLo + dim);
  let fresh = rp.probePrev.w == 1 || !inPrev;
  let id = u32(cell.x + dim.x * (cell.y + dim.y * cell.z));
  let doTrace = fresh || (id % max(rp.dbg.z, 1u)) == rp.dbg.w;
  if (doTrace) {
    // Capacity is the complete grid; each valid cell can append exactly once.
    let slot = atomicAdd(&dispatch.x, 1u);
    activeIds[slot] = id;
    return;
  }
  let pp = prevPre[0];
  let ratio = select(1.0, frame.params.y / pp, pp > 0.0);
  let oldR = fp16Safe(textureLoad(probeR, cell, 0));
  let oldG = fp16Safe(textureLoad(probeG, cell, 0));
  let oldB = fp16Safe(textureLoad(probeB, cell, 0));
  textureStore(newR, cell, fp16Safe(oldR * ratio));
  textureStore(newG, cell, fp16Safe(oldG * ratio));
  textureStore(newB, cell, fp16Safe(oldB * ratio));
}
