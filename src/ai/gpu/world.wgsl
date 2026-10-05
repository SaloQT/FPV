// Training worlds on the GPU: terrain height field, the start pad (PadGround), gates and obstacle boxes of every track.
// The drone being stepped reads its own track through the private copy `T` (set by the kernel before stepping).
//
// Ground maths mirror src/world/terrain/sampler.ts (triangulated bilinear height, smoothed vertex normals) and
// src/app/padGround.ts (a flat plate PAD_THICKNESS above the terrain inside the rotated pad square).
// Obstacles mirror CollisionWorld's near-box list: every box whose bounding sphere plus PROXY_REACH contains the drone centre,
// in ascending collider order, at most 32. A 2D grid over (x, z) lists, per cell and in ascending order, every box that can
// pass that test anywhere in the cell, so the list is identical to the TypeScript scan.

struct Track {
  hOff : u32, n : u32, ox : f32, oz : f32,
  cell : f32, invCell : f32, padX : f32, padZ : f32,
  padCos : f32, padSin : f32, padTop : f32, padActive : u32,
  gateOff : u32, nGates : u32, closed : u32, boxOff : u32,
  nBox : u32, gridOff : u32, gridNx : u32, gridNz : u32,
  gridX0 : f32, gridZ0 : f32, startX : f32, startY : f32,
  startZ : f32, startYaw : f32, laps : u32, minY : f32,
  maxY : f32, x0 : f32, x1 : f32, z0 : f32,
  z1 : f32, pathOff : u32, pathN : u32, pathLength : f32,
  pathStart : u32, pad1 : u32, pad2 : u32, pad3 : u32,
}

// A gate: opening centre, frame (forward = travel), half sizes, shape (0 rectangle, 0.5 arch, 1 ellipse), arch spring height,
// heading (what a checkpoint spawn faces), the path sample a spawn behind it starts its progress search from.
struct Gate {
  px : f32, py : f32, pz : f32, hw : f32,
  fx : f32, fy : f32, fz : f32, hh : f32,
  rx : f32, ry : f32, rz : f32, shape : f32,
  ux : f32, uy : f32, uz : f32, spring : f32,
  yaw : f32, pathAt : f32, g1 : f32, g2 : f32,
}

// An obstacle box (ObstacleCollider): centre, half extents, cos/sin of its yaw, bounding radius.
struct Box {
  cx : f32, cy : f32, cz : f32, hx : f32,
  hy : f32, hz : f32, c : f32, s : f32,
  r : f32, p0 : f32, p1 : f32, p2 : f32,
}

@group(1) @binding(0) var<storage, read> tracks : array<Track>;
@group(1) @binding(1) var<storage, read> heights : array<f32>;
@group(1) @binding(2) var<storage, read> gates : array<Gate>;
@group(1) @binding(3) var<storage, read> boxes : array<Box>;
// Per grid cell: (first item, item count); items are box indices relative to the track's first box.
@group(1) @binding(4) var<storage, read> gridCells : array<vec2u>;
@group(1) @binding(5) var<storage, read> gridItems : array<u32>;
// Every track's centreline at PATH_STEP_M spacing: x, y, z and the arc length from the track's first sample (pathProgress.ts).
@group(1) @binding(6) var<storage, read> paths : array<vec4f>;

var<private> T : Track;

fn hAt(i : u32, j : u32) -> f32 {
  return heights[T.hOff + j * T.n + i];
}

fn terrainHeight(x : f32, z : f32) -> f32 {
  let last = f32(T.n - 1u);
  let tx = clamp((x - T.ox) * T.invCell, 0.0, last);
  let tz = clamp((z - T.oz) * T.invCell, 0.0, last);
  let i = select(T.n - 2u, u32(floor(tx)), tx < last);
  let j = select(T.n - 2u, u32(floor(tz)), tz < last);
  let fx = tx - f32(i);
  let fz = tz - f32(j);
  let h00 = hAt(i, j);
  if (fx >= fz) {
    let h10 = hAt(i + 1u, j);
    return h00 + (h10 - h00) * fx + (hAt(i + 1u, j + 1u) - h10) * fz;
  }
  let h01 = hAt(i, j + 1u);
  return h00 + (hAt(i + 1u, j + 1u) - h01) * fx + (h01 - h00) * fz;
}

fn vertexNormal(i : u32, j : u32) -> vec3f {
  let last = T.n - 1u;
  let im = select(0u, i - 1u, i > 0u);
  let ip = select(last, i + 1u, i < last);
  let jm = select(0u, j - 1u, j > 0u);
  let jp = select(last, j + 1u, j < last);
  let dx = (hAt(ip, j) - hAt(im, j)) / (f32(ip - im) * T.cell);
  let dz = (hAt(i, jp) - hAt(i, jm)) / (f32(jp - jm) * T.cell);
  let il = 1.0 / sqrt(dx * dx + 1.0 + dz * dz);
  return vec3f(-dx * il, il, -dz * il);
}

fn terrainNormal(x : f32, z : f32) -> vec3f {
  let last = f32(T.n - 1u);
  let tx = clamp((x - T.ox) * T.invCell, 0.0, last);
  let tz = clamp((z - T.oz) * T.invCell, 0.0, last);
  let i = select(T.n - 2u, u32(floor(tx)), tx < last);
  let j = select(T.n - 2u, u32(floor(tz)), tz < last);
  let fx = tx - f32(i);
  let fz = tz - f32(j);
  let n = (1.0 - fx) * (1.0 - fz) * vertexNormal(i, j) + fx * (1.0 - fz) * vertexNormal(i + 1u, j)
    + (1.0 - fx) * fz * vertexNormal(i, j + 1u) + fx * fz * vertexNormal(i + 1u, j + 1u);
  return n / sqrt(dot(n, n));
}

fn onPad(x : f32, z : f32) -> bool {
  if (T.padActive == 0u) { return false; }
  let dx = x - T.padX;
  let dz = z - T.padZ;
  let lx = T.padCos * dx - T.padSin * dz;
  let lz = T.padSin * dx + T.padCos * dz;
  return lx >= -PAD_HALF && lx <= PAD_HALF && lz >= -PAD_HALF && lz <= PAD_HALF;
}

// PadGround.heightAt: what the physics treats as the ground.
fn groundHeight(x : f32, z : f32) -> f32 {
  let h = terrainHeight(x, z);
  if (onPad(x, z)) { return max(T.padTop, h + PAD_THICKNESS); }
  return h;
}

fn groundNormal(x : f32, z : f32) -> vec3f {
  if (onPad(x, z)) { return vec3f(0.0, 1.0, 0.0); }
  return terrainNormal(x, z);
}

var<private> nearBox : array<u32, 32>;

// CollisionWorld.gatherNearBoxes: absolute box indices into `nearBox`, ascending; returns the count.
fn gatherNearBoxes(p : vec3f) -> u32 {
  if (T.nBox == 0u) { return 0u; }
  let gx = floor((p.x - T.gridX0) * (1.0 / GRID_CELL));
  let gz = floor((p.z - T.gridZ0) * (1.0 / GRID_CELL));
  if (gx < 0.0 || gz < 0.0 || gx >= f32(T.gridNx) || gz >= f32(T.gridNz)) { return 0u; }
  let cell = gridCells[T.gridOff + u32(gz) * T.gridNx + u32(gx)];
  var n = 0u;
  for (var k = 0u; k < cell.y && n < 32u; k++) {
    let b = T.boxOff + gridItems[cell.x + k];
    let bx = boxes[b];
    let d = p - vec3f(bx.cx, bx.cy, bx.cz);
    let reach = bx.r + PROXY_REACH;
    if (dot(d, d) < reach * reach) {
      nearBox[n] = b;
      n++;
    }
  }
  return n;
}

// Gate opening test (src/world/track/gate.ts insideOpening).
fn insideOpening(g : Gate, u : f32, v : f32) -> bool {
  if (g.shape > 0.75) { return (u * u) / (g.hw * g.hw) + (v * v) / (g.hh * g.hh) <= 1.0; }
  if (g.shape > 0.25) {
    if (abs(u) > g.hw || v < -g.hh) { return false; }
    if (v <= g.spring) { return true; }
    let dv = v - g.spring;
    return u * u + dv * dv <= g.hw * g.hw;
  }
  return abs(u) <= g.hw && abs(v) <= g.hh;
}

// gatePassed: the segment a -> b crosses the gate plane forwards inside the opening.
fn gatePassed(g : Gate, a : vec3f, b : vec3f) -> bool {
  let c = vec3f(g.px, g.py, g.pz);
  let f = vec3f(g.fx, g.fy, g.fz);
  let d0 = dot(a - c, f);
  let d1 = dot(b - c, f);
  if (!(d0 < 0.0 && d1 >= 0.0)) { return false; }
  let t = d0 / (d0 - d1);
  let h = a + (b - a) * t - c;
  return insideOpening(g, dot(h, vec3f(g.rx, g.ry, g.rz)), dot(h, vec3f(g.ux, g.uy, g.uz)));
}
