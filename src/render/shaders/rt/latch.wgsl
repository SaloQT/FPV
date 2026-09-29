// Remembers this frame's pre-exposure for the next frame's history/probe rescale (0 = no history yet).
#include "rt/rt_common.wgsl"

@group(${GRP}) @binding(1) var<storage, read_write> prevPre : array<f32>;

@compute @workgroup_size(1)
fn main() {
  prevPre[0] = frame.params.y;
}
