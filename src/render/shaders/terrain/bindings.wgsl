// Group 2 shared by the terrain and water pipelines (created in src/render/terrain/index.ts).
struct Tile {
  grid : vec4f,  // x, y = first vertex in level grid units from the map origin; z, w = quads across (<= 16)
  info : vec4f,  // x = vertex spacing (m), y = clipmap level
};

struct TerrainParams {
  waterLevel : f32,  // metres; -1e9 when the scene has no water
  time : f32,
  debugMode : u32,   // 0 shaded, 1 lod, 2 slope, 3 layer weights, 4 wetness, 5 forest-floor cover, 6 flow
  octaves : u32,     // micro-relief octaves (quality)
  flags : u32,       // bit 0: biplanar detail mapping, bit 1: parallax relief (extreme tier)
  parkRadius : f32,  // metres around the origin kept as mown lawn (the park clears its grass blades there); 0 without a park
  ringHalf : f32,    // half-width of a clipmap level in its own quads (32; 64 at the extreme tier)
  pad2 : u32,
};

@group(2) @binding(0) var<storage, read> tiles : array<Tile>;
@group(2) @binding(1) var<uniform> tp : TerrainParams;
@group(2) @binding(2) var detailA : texture_2d_array<f32>;
@group(2) @binding(3) var detailB : texture_2d_array<f32>;
@group(2) @binding(4) var detailSampler : sampler;
// Forest-floor cover over the terrain maps' uv (src/render/terrain/groundCover.ts): r = canopy cover, g = conifer share.
@group(2) @binding(5) var groundCoverTex : texture_2d<f32>;
// Trunk grid over the same uv (src/render/terrain/trunkGrid.ts): rg = axis inside the cell, b = radius / 2 m, a = 0 empty, 0.5 broadleaf, 1 conifer.
@group(2) @binding(6) var trunkGridTex : texture_2d<f32>;
