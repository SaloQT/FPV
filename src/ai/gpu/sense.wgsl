// Obstacle sensing for the observation (src/ai/sense.ts has the TypeScript copy and the details): range rays against the
// ground and the boxes, and the nearest box on each side. Boxes come from world.wgsl's grid: a box is listed in every cell its
// bounding circle touches, and a ray's hit point or the closest point of a box lies inside the box, so it is in a listed cell.
// Rays walk the cells their ground track crosses, nearest first, and stop once the next cell starts beyond the nearest hit.
//
// Needs: world.wgsl, and SENSE_* / NEAR_* / OBS_RAYS / OBS_NEAR / SENSE_DIRS from envKernel.ts.

const SENSE_FAR : f32 = 1e30;
const NO_BOX : u32 = 0xffffffffu;

// sense.ts slab: clips the entry interval s to where the ray is between a box's faces on one axis.
fn senseSlab(o : f32, u : f32, h : f32, s : vec2f) -> vec2f {
  if (abs(u) < SENSE_PARALLEL) { return select(s, vec2f(1.0, 0.0), abs(o) > h); }
  let a = (-h - o) / u;
  let b = (h - o) / u;
  return vec2f(max(s.x, min(a, b)), min(s.y, max(a, b)));
}

// sense.ts rayBox: where o + t d (t in [0, tMax]) enters box b, or tMax.
fn rayBox(b : Box, o : vec3f, d : vec3f, tMax : f32) -> f32 {
  let r = o - vec3f(b.cx, b.cy, b.cz);
  // Past the bounding sphere (1 cm wider than the box's corners, for f32 rounding)
  let along = -dot(r, d);
  let reach = b.r + 0.01;
  if (along < -reach || along > tMax + reach || dot(r, r) - along * along > reach * reach) { return tMax; }
  var s = vec2f(0.0, tMax);
  s = senseSlab(b.c * r.x - b.s * r.z, b.c * d.x - b.s * d.z, b.hx, s);
  s = senseSlab(r.y, d.y, b.hy, s);
  s = senseSlab(b.s * r.x + b.c * r.z, b.s * d.x + b.c * d.z, b.hz, s);
  return select(tMax, s.x, s.x <= s.y);
}

// sense.ts marchAt: ground sample k along a ray.
fn marchAt(k : u32) -> f32 {
  return SENSE_RANGE * f32(k * (k + SENSE_MARCH)) / f32(2u * SENSE_MARCH * SENSE_MARCH);
}

fn senseGap(o : vec3f, d : vec3f, t : f32) -> f32 {
  let p = o + d * t;
  return p.y - groundHeight(p.x, p.z);
}

// sense.ts groundHit: where o + t d first meets the ground within SENSE_RANGE, or SENSE_RANGE.
fn groundHit(o : vec3f, d : vec3f) -> f32 {
  // Cannot reach the highest ground (the bilinear height never exceeds its corners; 1 cm for rounding)
  if (o.y + min(d.y, 0.0) * SENSE_RANGE > max(T.maxY, T.padTop) + 0.01) { return SENSE_RANGE; }
  var t0 = 0.0;
  var f0 = o.y - groundHeight(o.x, o.z);
  if (f0 <= 0.0) { return 0.0; }
  for (var k = 1u; k <= SENSE_MARCH; k++) {
    var t1 = marchAt(k);
    var f1 = senseGap(o, d, t1);
    if (f1 > 0.0) {
      t0 = t1;
      f0 = f1;
      continue;
    }
    for (var i = 0u; i < SENSE_REFINE; i++) {
      let tm = 0.5 * (t0 + t1);
      let fm = senseGap(o, d, tm);
      if (fm > 0.0) { t0 = tm; f0 = fm; } else { t1 = tm; f1 = fm; }
    }
    return t0 + (t1 - t0) * f0 / (f0 - f1);
  }
  return SENSE_RANGE;
}

// The nearest box hit by o + t d before tMax, or tMax: a 2D DDA over the grid cells under the ray.
fn boxHit(o : vec3f, d : vec3f, tMax : f32) -> f32 {
  var best = tMax;
  if (T.nBox == 0u) { return best; }
  let gx = (o.x - T.gridX0) * (1.0 / GRID_CELL);
  let gz = (o.z - T.gridZ0) * (1.0 / GRID_CELL);
  var ix = i32(floor(gx));
  var iz = i32(floor(gz));
  let sx = select(-1, 1, d.x > 0.0);
  let sz = select(-1, 1, d.z > 0.0);
  // Ray distance to the next cell edge on each axis, and between edges
  var tx = SENSE_FAR;
  var tz = SENSE_FAR;
  var dtx = SENSE_FAR;
  var dtz = SENSE_FAR;
  if (abs(d.x) > SENSE_PARALLEL) {
    dtx = GRID_CELL / abs(d.x);
    tx = select(gx - floor(gx), floor(gx) + 1.0 - gx, d.x > 0.0) * dtx;
  }
  if (abs(d.z) > SENSE_PARALLEL) {
    dtz = GRID_CELL / abs(d.z);
    tz = select(gz - floor(gz), floor(gz) + 1.0 - gz, d.z > 0.0) * dtz;
  }
  // A ray of SENSE_RANGE crosses at most SENSE_RANGE / GRID_CELL + 1 edges per axis
  for (var k = 0u; k < 16u; k++) {
    if (ix >= 0 && iz >= 0 && ix < i32(T.gridNx) && iz < i32(T.gridNz)) {
      let cell = gridCells[T.gridOff + u32(iz) * T.gridNx + u32(ix)];
      for (var j = 0u; j < cell.y; j++) {
        best = rayBox(boxes[T.boxOff + gridItems[cell.x + j]], o, d, best);
      }
    }
    if (min(tx, tz) >= best) { break; }
    if (tx < tz) { ix += sx; tx += dtx; } else { iz += sz; tz += dtz; }
  }
  return best;
}

// sense.ts sideOf: the side of the quad a body-axes direction is on.
fn sideOf(u : vec3f) -> u32 {
  let a = abs(u);
  if (a.x >= a.y && a.x >= a.z) { return select(1u, 0u, u.x >= 0.0); }
  if (a.y >= a.z) { return select(3u, 2u, u.y >= 0.0); }
  return select(5u, 4u, u.z >= 0.0);
}

var<private> nearK : array<f32, NEAR_SIDES>;
var<private> nearD : array<f32, NEAR_SIDES>;
var<private> nearI : array<u32, NEAR_SIDES>;
var<private> nearU : array<vec3f, NEAR_SIDES>;

// sense.ts sense: the rays and the nearest box per side into obsOut at OBS_RAYS and OBS_NEAR. c0..c2 turn world axes into body
// axes. A box listed in several cells comes round more than once, which leaves its side as it was.
fn senseObs(o : u32, p : vec3f, R : Mat3, c0 : vec3f, c1 : vec3f, c2 : vec3f) {
  for (var k = 0u; k < SENSE_RAYS; k++) {
    let b = SENSE_DIRS[k];
    let d = vec3f(dot(R.r0, b), dot(R.r1, b), dot(R.r2, b));
    let t = boxHit(p, d, groundHit(p, d));
    obsOut[o + OBS_RAYS + k] = 1.0 - t / SENSE_RANGE;
  }
  for (var m = 0u; m < NEAR_SIDES; m++) {
    nearK[m] = SENSE_FAR;
    nearI[m] = NO_BOX;
  }
  if (T.nBox > 0u) {
    let inv = 1.0 / GRID_CELL;
    let i0 = max(i32(floor((p.x - NEAR_RANGE - T.gridX0) * inv)), 0);
    let i1 = min(i32(floor((p.x + NEAR_RANGE - T.gridX0) * inv)), i32(T.gridNx) - 1);
    let j0 = max(i32(floor((p.z - NEAR_RANGE - T.gridZ0) * inv)), 0);
    let j1 = min(i32(floor((p.z + NEAR_RANGE - T.gridZ0) * inv)), i32(T.gridNz) - 1);
    for (var j = j0; j <= j1; j++) {
      for (var i = i0; i <= i1; i++) {
        let cell = gridCells[T.gridOff + u32(j) * T.gridNx + u32(i)];
        for (var n = 0u; n < cell.y; n++) {
          let bi = T.boxOff + gridItems[cell.x + n];
          let bx = boxes[bi];
          let r = p - vec3f(bx.cx, bx.cy, bx.cz);
          // Box-local offset of the quad, and from it to the closest point of the box
          let lx = bx.c * r.x - bx.s * r.z;
          let lz = bx.s * r.x + bx.c * r.z;
          let v = vec3f(clamp(lx, -bx.hx, bx.hx) - lx, clamp(r.y, -bx.hy, bx.hy) - r.y, clamp(lz, -bx.hz, bx.hz) - lz);
          let dist = sqrt(dot(v, v));
          if (dist >= NEAR_RANGE) { continue; }
          // Unit vector in world axes (the inverse of the box rotation), then body axes
          let w = vec3f(bx.c * v.x + bx.s * v.z, v.y, -bx.s * v.x + bx.c * v.z) * select(0.0, 1.0 / max(dist, 1e-6), dist > 1e-6);
          let u = vec3f(dot(c0, w), dot(c1, w), dot(c2, w));
          let side = sideOf(u);
          let key = floor(dist * NEAR_TIE_PER_M);
          if (key < nearK[side] || (key == nearK[side] && bi < nearI[side])) {
            nearK[side] = key;
            nearD[side] = dist;
            nearI[side] = bi;
            nearU[side] = u;
          }
        }
      }
    }
  }
  for (var m = 0u; m < NEAR_SIDES; m++) {
    let at = o + OBS_NEAR + m * 4u;
    let seen = nearI[m] != NO_BOX;
    let u = select(vec3f(0.0), nearU[m], seen);
    obsOut[at] = u.x; obsOut[at + 1u] = u.y; obsOut[at + 2u] = u.z;
    obsOut[at + 3u] = select(0.0, 1.0 - nearD[m] / NEAR_RANGE, seen);
  }
}
