// Single-thread kernels that turn the culling counters into indirect arguments, so nothing is ever read back to the CPU.
#include "vegetation/veg_params.wgsl"

// 0 chunk count, 1..3 instances per LOD, 4 visible patches
@group(2) @binding(1) var<storage, read_write> counters : array<u32, 8>;
@group(2) @binding(2) var<storage, read_write> dispatchArgs : array<u32, 4>;
@group(2) @binding(3) var<storage, read_write> drawArgs : array<u32, 12>;

const DISPATCH_ROW : u32 = 4096u;

// Strip vertex counts of the three blade LODs: 2 * (segments + 1) minus one when the last row collapses to a tip vertex.
const LOD_VERTICES = array<u32, 3>(15u, 7u, 4u);

@compute @workgroup_size(1)
fn fin_dispatch() {
  let n = min(counters[0], vp.caps.w);
  dispatchArgs[0] = min(n, DISPATCH_ROW);
  dispatchArgs[1] = (n + DISPATCH_ROW - 1u) / DISPATCH_ROW;
  dispatchArgs[2] = 1u;
}

@compute @workgroup_size(1)
fn fin_draw() {
  for (var lod = 0u; lod < 3u; lod++) {
    drawArgs[lod * 4u] = LOD_VERTICES[lod];
    drawArgs[lod * 4u + 1u] = min(counters[1u + lod], vp.caps[lod]);
    drawArgs[lod * 4u + 2u] = 0u;
    drawArgs[lod * 4u + 3u] = 0u;
  }
}
