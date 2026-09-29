// Per-blade instance record: written by grass_cull.wgsl, read by grass.wgsl.
struct Blade {
  pos : vec3f,
  height : f32,
  halfWidth : f32,
  nrm : u32,    // pack2x16snorm(terrain normal x, z)
  tint : u32,   // pack4x8unorm(sqrt(2 * turf albedo).rgb, head code / 255)
  info : u32,   // yaw 12 bits | species 3 | dryness 8 | random 9
};
