// Group 2 shared by the terrain and water pipelines (created in src/render/terrain/index.ts).
struct Tile {
  grid : vec4f,  // x, y = first vertex in level grid units from the map origin; z, w = quads across (<= 16)
  info : vec4f,  // x = vertex spacing (m), y = clipmap level
};

struct TerrainParams {
  waterLevel : f32,  // metres; -1e9 when the scene has no water
  time : f32,
  debugMode : u32,   // 0 shaded, 1 lod, 2 slope, 3 layer weights, 4 wetness
  octaves : u32,     // micro-relief octaves (quality)
  flags : u32,       // bit 0: biplanar detail mapping
  pad0 : u32,
  pad1 : u32,
  pad2 : u32,
};

@group(2) @binding(0) var<storage, read> tiles : array<Tile>;
@group(2) @binding(1) var<uniform> tp : TerrainParams;
@group(2) @binding(2) var detailA : texture_2d_array<f32>;
@group(2) @binding(3) var detailB : texture_2d_array<f32>;
@group(2) @binding(4) var detailSampler : sampler;
