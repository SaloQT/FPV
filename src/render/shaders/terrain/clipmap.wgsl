// Clipmap vertex placement. Tiles (see clipmap.ts) index a shared 17x17 vertex grid; vertices beyond the tile's w x h quads collapse
// onto its border. Level l has spacing s and covers +-32 s around the camera; in its outer 20% vertices morph onto level l+1's grid.
#include "terrain/bindings.wgsl"
#include "terrain/terrain_height.wgsl"

const TILE_VERTS : u32 = 17u;

struct GridVertex {
  xz : vec2f,
  ij : vec2i,     // absolute grid coordinates in level units from the map origin
  spacing : f32,
  level : f32,
  morph : f32,    // 0 = own grid, 1 = fully on the coarser grid
};

fn gridVertex(t : Tile, vid : u32) -> GridVertex {
  let i = min(vid % TILE_VERTS, u32(t.grid.z));
  let j = min(vid / TILE_VERTS, u32(t.grid.w));
  var g : GridVertex;
  g.ij = vec2i(i32(t.grid.x) + i32(i), i32(t.grid.y) + i32(j));
  g.spacing = t.info.x;
  g.level = t.info.y;
  g.xz = frame.terrainOrigin.xy + vec2f(g.ij) * g.spacing;
  let d = max(abs(g.xz.x - frame.camPos.x), abs(g.xz.y - frame.camPos.z));
  let ring = 32.0 * g.spacing;
  g.morph = smoothstep(0.8 * ring, ring - g.spacing, d);
  return g;
}

// Height this vertex would have on level l+1's triangulation (diagonal (0,0)-(1,1) per quad, like the index buffer and the height map).
fn coarseHeight(g : GridVertex) -> f32 {
  let odd = g.ij & vec2i(1);
  if (odd.x == 0 && odd.y == 0) { return terrainHeightMirrored(g.xz); }
  let s = g.spacing;
  var a = vec2f(0.0, -s);
  var b = vec2f(0.0, s);
  if (odd.x == 1 && odd.y == 1) {
    a = vec2f(-s, -s);
    b = vec2f(s, s);
  } else if (odd.x == 1) {
    a = vec2f(-s, 0.0);
    b = vec2f(s, 0.0);
  }
  return 0.5 * (terrainHeightMirrored(g.xz + a) + terrainHeightMirrored(g.xz + b));
}
