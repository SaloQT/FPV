#include "common/math.wgsl"
#include "common/frame.wgsl"

// Group 1: world resources owned by the Renderer (see WorldBindings in src/render/contracts.ts).
@group(1) @binding(0)  var linearClamp : sampler;
@group(1) @binding(1)  var linearRepeat : sampler;
@group(1) @binding(2)  var terrainHeight : texture_2d<f32>;
@group(1) @binding(3)  var terrainMaxPyr : texture_2d<f32>;
@group(1) @binding(4)  var terrainNormalTex : texture_2d<f32>;
@group(1) @binding(5)  var terrainMapsTex : texture_2d<f32>;
@group(1) @binding(6)  var transmittanceLUT : texture_2d<f32>;
@group(1) @binding(7)  var multiScatterLUT : texture_2d<f32>;
@group(1) @binding(8)  var skyViewLUT : texture_2d<f32>;
@group(1) @binding(9)  var aerialPerspective : texture_3d<f32>;
@group(1) @binding(10) var blueNoise : texture_2d<f32>;

// World (x,z) -> continuous texel coordinates in the terrain grids.
fn terrainTexel(xz : vec2f) -> vec2f {
  return (xz - frame.terrainOrigin.xy) / frame.terrain.y;
}
fn terrainInside(xz : vec2f) -> bool {
  let t = terrainTexel(xz);
  return all(t >= vec2f(0.0)) && all(t <= vec2f(frame.terrain.x - 1.0));
}

fn terrainLoad(ij : vec2i) -> f32 {
  let n = i32(frame.terrain.x);
  return textureLoad(terrainHeight, clamp(ij, vec2i(0), vec2i(n - 1)), 0).x;
}

// Bilinear height matching the CPU TerrainSampler (triangulated cells: diagonal from (i,j) to (i+1,j+1)).
fn terrainHeightAt(xz : vec2f) -> f32 {
  let t = clamp(terrainTexel(xz), vec2f(0.0), vec2f(frame.terrain.x - 1.001));
  let i = vec2i(floor(t));
  let f = t - vec2f(i);
  let h00 = terrainLoad(i);
  let h10 = terrainLoad(i + vec2i(1, 0));
  let h01 = terrainLoad(i + vec2i(0, 1));
  let h11 = terrainLoad(i + vec2i(1, 1));
  // Two triangles split along the (0,0)-(1,1) diagonal.
  if (f.x >= f.y) { return h00 + (h10 - h00) * f.x + (h11 - h10) * f.y; }
  return h00 + (h11 - h01) * f.x + (h01 - h00) * f.y;
}

fn terrainNormalAt(xz : vec2f) -> vec3f {
  let uv = (terrainTexel(xz) + 0.5) / frame.terrain.x;
  let c = textureSampleLevel(terrainNormalTex, linearClamp, uv, 0.0);
  return normalize(c.xyz * 2.0 - 1.0);
}

// x = soil, y = flow, z = deposit, w = wetness
fn terrainMapsAt(xz : vec2f) -> vec4f {
  let uv = (terrainTexel(xz) + 0.5) / frame.terrain.x;
  return textureSampleLevel(terrainMapsTex, linearClamp, uv, 0.0);
}
