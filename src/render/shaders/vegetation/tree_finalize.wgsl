// Copies the visible counts into the instanceCount word of each indexed indirect draw (the other four words are written once by the CPU).
#include "vegetation/veg_params.wgsl"

@group(2) @binding(1) var<storage, read> counts : array<u32>;
@group(2) @binding(2) var<storage, read_write> args : array<u32>;

@compute @workgroup_size(64)
fn finalize(@builtin(local_invocation_index) k : u32) {
  if (k < vp.treeCount.y) { args[k * 5u + 1u] = counts[k]; }
}
