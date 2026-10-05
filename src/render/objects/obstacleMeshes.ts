/**
 * Track obstacle meshes baked in world space: cones, poles, flag poles, walls, rocks, the footing of tree obstacles, and the
 * industrial kinds (containers, pillars, beams, bridges, scaffolds, lattice towers) laid out by world/track/kindGeometry.ts.
 */
import type { TerrainSampler, TrackObstacle, Vec3 } from '../../contracts';
import { supportBase } from '../../world/track/colliders';
import {
  BRIDGE_PARAPET, BRIDGE_PARAPET_THICK, BRIDGE_PIER, SCAFFOLD_TUBE, TOWER_LEG, TOWER_RAIL, beamLayout, bodyBase, bridgeLayout, containerUnits, scaffoldLayout,
  towerLayout, towerTiers, type SupportBase,
} from '../../world/track/kindGeometry';
import { plate } from './extrude';
import { pole } from './gateMeshes';
import { CONTAINER_COLOURS, KIND, STEEL_GALVANISED, STEEL_RED, STEEL_WHITE, STEEL_YELLOW, type ClothFlag } from './materials';
import { MeshBuilder, affineMul, affineRotY, affineTranslate } from './meshBuilder';
import type { Pt } from './polygon';
import { bevelBox, lathe, surface } from './primitives';
import { circleSection, rectSection, sweep } from './sweep';

/** Deterministic 0..1 value from an integer seed. */
export function seeded(n: number): number {
  let h = Math.imul(n | 0, 0x9e3779b1) ^ 0x85ebca6b;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

function valueNoise(x: number, y: number, z: number, seed: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const fx = x - xi, fy = y - yi, fz = z - zi;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy), sz = fz * fz * (3 - 2 * fz);
  const h = (i: number, j: number, k: number): number => seeded(seed * 7919 + (xi + i) * 73856093 + (yi + j) * 19349663 + (zi + k) * 83492791);
  const l = (a: number, c: number, t: number): number => a + (c - a) * t;
  return (
    l(l(l(h(0, 0, 0), h(1, 0, 0), sx), l(h(0, 1, 0), h(1, 1, 0), sx), sy), l(l(h(0, 0, 1), h(1, 0, 1), sx), l(h(0, 1, 1), h(1, 1, 1), sx), sy), sz) * 2 - 1
  );
}

const ground = (b: MeshBuilder, h: number, size: number): void => {
  b.aoFn = (_x, y) => 0.55 + 0.45 * Math.min(1, Math.max(0, (y - h) / size));
};

function cone(b: MeshBuilder, o: TrackObstacle): void {
  const r = o.size[0];
  const h = o.size[1];
  b.kind = KIND.CONE;
  b.a2 = h;
  lathe(b, [[0.74 * r, 0.02], [0.2 * r, h - 0.02], [0.1 * r, h - 0.006], [0.06 * r, h], [0, h]], 18, { polar: true });
  b.a2 = 0;
  b.kind = KIND.CONE;
  b.a3 = 1;
  bevelBox(b, [0, 0.01, 0], [r, 0.01, r], 0.006);
  b.a3 = 0;
}

function wall(b: MeshBuilder, o: TrackObstacle, variant: number): void {
  const [w, h, d] = o.size;
  b.kind = KIND.WALL;
  b.a2 = variant;
  ground(b, o.pos[1], 0.5);
  bevelBox(b, [0, (h - 0.15) / 2, 0], [w / 2, (h + 0.15) / 2, d / 2], 0.012);
  b.a2 = 0;
}

function rock(b: MeshBuilder, o: TrackObstacle, seed: number): void {
  const [w, h, d] = o.size;
  const rx = w * 0.5;
  const ry = h * 0.62;
  const rz = d * 0.5;
  const cy = h * 0.4;
  b.kind = KIND.ROCK;
  b.a2 = seeded(seed);
  ground(b, o.pos[1], h * 0.5);
  surface(
    b,
    (u, v): Vec3 => {
      const th = u * Math.PI * 2;
      const ph = v * Math.PI;
      const dx = Math.sin(ph) * Math.cos(th);
      const dy = Math.cos(ph);
      const dz = Math.sin(ph) * Math.sin(th);
      const k = 0.88 + 0.12 * valueNoise(dx * 1.7, dy * 1.7, dz * 1.7, seed) + 0.05 * valueNoise(dx * 5, dy * 5, dz * 5, seed + 3);
      return [rx * dx * k, Math.max(cy + ry * dy * k, -0.08 * h), rz * dz * k];
    },
    20,
    12,
    { wrapU: true, uvScale: [w * 1.5, h] },
  );
  b.a2 = 0;
}

/**
 * The visible tree is a vegetation-module instance: placement.ts puts a real tree of the best-fitting species on the obstacle's spot, so it
 * has the forest's bark, leaves, LODs and wind. The static mesh only keeps the footing, a stump buried inside that tree's trunk, and two
 * unreferenced vertices at ground and crown height so the mesh bounds still span the obstacle's full extent.
 */
function tree(b: MeshBuilder, o: TrackObstacle): void {
  const r = o.size[0];
  const h = o.size[1];
  b.kind = KIND.TRUNK;
  lathe(b, [[0, -0.1], [r * 0.6, -0.1], [r * 0.5, 0.5], [0, 0.55]], 8, { polar: true });
  b.vertex([0, -0.1, 0], [0, 1, 0]);
  b.vertex([0, h * 0.9, 0], [0, 1, 0]);
}

/** Round tube of radius r between two obstacle-local points. */
function tube(b: MeshBuilder, a: Vec3, c: Vec3, r: number, sides = 8): void {
  const d: Vec3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const up: Vec3 = Math.abs(d[1]) > 0.9 * Math.hypot(d[0], d[1], d[2]) ? [1, 0, 0] : [0, 1, 0];
  sweep(b, [a, c], circleSection(r, sides), { up, capStart: true, capEnd: true });
}

/** Square-section member of side s between two obstacle-local points (tower legs and bracing). */
function member(b: MeshBuilder, a: Vec3, c: Vec3, s: number): void {
  const d: Vec3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const up: Vec3 = Math.abs(d[1]) > 0.9 * Math.hypot(d[0], d[1], d[2]) ? [1, 0, 0] : [0, 1, 0];
  sweep(b, [a, c], rectSection(s, s, s * 0.08), { up, capStart: true, capEnd: true });
}

/** Box from corner (x0, y0, z0) to (x1, y1, z1) in obstacle-local space with a small chamfer. */
function block(b: MeshBuilder, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, e = 0.01): void {
  const h: Vec3 = [Math.abs(x1 - x0) / 2, Math.abs(y1 - y0) / 2, Math.abs(z1 - z0) / 2];
  bevelBox(b, [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], h, Math.min(e, h[0] * 0.5, h[1] * 0.5, h[2] * 0.5));
}

const RIB_PITCH = 0.3;
const RIB_DEPTH = 0.035;

/**
 * Outline points of one container side from a toward c, with trapezoid ribs pressed RIB_DEPTH inward along `inward`. The start
 * point is included and the end is left out (it starts the next side).
 */
function corrugate(out: Pt[], a: Pt, c: Pt, inward: Pt): void {
  const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
  const dir: Pt = [(c[0] - a[0]) / len, (c[1] - a[1]) / len];
  const ribs = Math.floor((len - 0.3) / RIB_PITCH);
  const start = (len - ribs * RIB_PITCH) / 2;
  const at = (t: number, d: number): Pt => [a[0] + dir[0] * t + inward[0] * d, a[1] + dir[1] * t + inward[1] * d];
  out.push(at(0, 0));
  for (let k = 0; k < ribs; k++) {
    const t = start + k * RIB_PITCH;
    out.push(at(t + 0.045, 0), at(t + 0.095, RIB_DEPTH), at(t + 0.205, RIB_DEPTH), at(t + 0.255, 0));
  }
}

/**
 * Shipping container (or a stack of them, CONTAINER_UNIT each): ribbed side and back walls, a flat door end with locking bars, corner
 * posts and top and bottom rails. Each unit gets its own colour from CONTAINER_COLOURS.
 */
function container(b: MeshBuilder, o: TrackObstacle, index: number, base: SupportBase): void {
  const [L, , W] = o.size;
  const { n, height } = containerUnits(o);
  const hx = L / 2;
  const hz = W / 2;
  const i = 0.01;
  ground(b, o.pos[1], 0.6);
  // On a slope the stack sits on a concrete plinth down to the lowest ground under it (the collider's bottom).
  const yb = bodyBase(o, base);
  if (yb < -0.06) {
    b.kind = KIND.CONCRETE;
    b.a2 = 0;
    block(b, -hx + 0.04, yb, -hz + 0.04, hx - 0.04, 0.02, hz - 0.04, 0.02);
  }
  for (let k = 0; k < n; k++) {
    const y0 = k * height;
    const y1 = y0 + height;
    b.kind = KIND.CONTAINER;
    b.a2 = (Math.floor(seeded(index * 3 + 1) * CONTAINER_COLOURS.length) + k * 3) % CONTAINER_COLOURS.length;
    const outline: Pt[] = [];
    corrugate(outline, [-hx + i, -hz + i], [hx - i, -hz + i], [0, 1]);
    // The door end (+x) is flat and set back between the corner posts.
    outline.push([hx - i, -hz + i], [hx - i, -hz + 0.16], [hx - 0.05, -hz + 0.16], [hx - 0.05, hz - 0.16], [hx - i, hz - 0.16]);
    corrugate(outline, [hx - i, hz - i], [-hx + i, hz - i], [0, -1]);
    corrugate(outline, [-hx + i, hz - i], [-hx + i, -hz + i], [1, 0]);
    plate(b, outline, [], y0 + 0.01, y1 - 0.02, { hardAngle: 0.3 });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) block(b, sx * (hx - 0.16), y0, sz * (hz - 0.16), sx * hx, y1, sz * hz, 0.01);
    for (const sz of [-1, 1]) {
      for (const y of [y0, y1 - 0.11]) block(b, -hx + 0.16, y, sz * (hz - 0.005), hx - 0.16, y + 0.11, sz * (hz - 0.12), 0.008);
    }
    for (const sx of [-1, 1]) for (const y of [y0, y1 - 0.11]) block(b, sx * (hx - 0.005), y, -hz + 0.16, sx * (hx - 0.14), y + 0.11, hz - 0.16, 0.008);
    b.kind = KIND.STEEL_PAINT;
    b.a2 = STEEL_GALVANISED;
    for (const z of [-0.9, -0.3, 0.3, 0.9]) tube(b, [hx - 0.03, y0 + 0.12, z * hz], [hx - 0.03, y1 - 0.12, z * hz], 0.017, 6);
  }
  b.a2 = 0;
}

/** Square concrete column with a yellow and black band at the foot, which reaches down to the lowest ground under it. */
function pillar(b: MeshBuilder, o: TrackObstacle, base: SupportBase): void {
  const [w, h, d] = o.size;
  ground(b, o.pos[1], 1);
  b.kind = KIND.HAZARD;
  block(b, -w / 2, Math.min(-0.15, bodyBase(o, base)), -d / 2, w / 2, 1.2, d / 2, 0.02);
  b.kind = KIND.CONCRETE;
  b.a2 = 0;
  block(b, -w / 2, 1.2, -d / 2, w / 2, h, d / 2, 0.025);
}

/** Two yellow posts and a striped beam across their tops. */
function beam(b: MeshBuilder, o: TrackObstacle, base: SupportBase): void {
  const l = beamLayout(o);
  const [sx, , sz] = o.size;
  b.kind = KIND.STEEL_PAINT;
  b.a2 = STEEL_YELLOW;
  for (const s of [-1, 1]) {
    const x = s * l.postX;
    const y = base(x, 0, l.post / 2, l.post / 2);
    ground(b, o.pos[1] + y, 0.8);
    block(b, x - l.post / 2, y, -l.post / 2, x + l.post / 2, l.y0, l.post / 2, 0.015);
  }
  b.aoFn = null;
  b.kind = KIND.HAZARD;
  block(b, -sx / 2, l.y0, -sz / 2, sx / 2, l.top, sz / 2, 0.02);
  b.a2 = 0;
}

/** Concrete bridge: two piers under wider caps, a slab on three girders, and parapets along both edges. */
function bridge(b: MeshBuilder, o: TrackObstacle, base: SupportBase): void {
  const l = bridgeLayout(o);
  const [sx, , sz] = o.size;
  const slab = 0.3;
  b.kind = KIND.CONCRETE;
  for (const s of [-1, 1]) {
    const x = s * l.pierX;
    const y = base(x, 0, BRIDGE_PIER / 2, l.pierZ);
    b.a2 = 2;
    ground(b, o.pos[1] + y, 1.5);
    block(b, x - BRIDGE_PIER / 2 + 0.1, y, -l.pierZ + 0.25, x + BRIDGE_PIER / 2 - 0.1, l.under - 0.4, l.pierZ - 0.25, 0.03);
    b.aoFn = null;
    b.a2 = 0;
    block(b, x - BRIDGE_PIER / 2, l.under - 0.4, -l.pierZ, x + BRIDGE_PIER / 2, l.under, l.pierZ, 0.03);
  }
  b.a2 = 0;
  for (const z of [-sz / 3, 0, sz / 3]) block(b, -sx / 2, l.under, z - 0.22, sx / 2, l.top - slab, z + 0.22, 0.02);
  b.a2 = 1;
  block(b, -sx / 2, l.top - slab, -sz / 2 + BRIDGE_PARAPET_THICK, sx / 2, l.top, sz / 2 - BRIDGE_PARAPET_THICK, 0.02);
  b.a2 = 2;
  for (const s of [-1, 1]) block(b, -sx / 2, l.top - slab, s * (sz / 2 - BRIDGE_PARAPET_THICK), sx / 2, l.top + BRIDGE_PARAPET, s * (sz / 2), 0.03);
  b.a2 = 0;
}

/** Tube-and-plank scaffold: galvanised standards, ledgers and transoms under each plank deck, and guardrails along the top. */
function scaffold(b: MeshBuilder, o: TrackObstacle, base: SupportBase): void {
  const l = scaffoldLayout(o);
  const [sx, sy, sz] = o.size;
  const r = SCAFFOLD_TUBE / 2;
  b.kind = KIND.STEEL_PAINT;
  b.a2 = STEEL_GALVANISED;
  for (const z of [-l.poleZ, l.poleZ]) {
    for (const x of l.poles) {
      const y = base(x, z, r, r);
      tube(b, [x, y, z], [x, sy, z], r);
      b.kind = KIND.GATE_BASE;
      block(b, x - 0.075, y, z - 0.075, x + 0.075, y + 0.012, z + 0.075, 0.004);
      b.kind = KIND.STEEL_PAINT;
    }
  }
  const tubeY = (deck: number): number => deck - 0.04 - r;
  for (const d of l.decks) {
    for (const z of [-l.poleZ, l.poleZ]) tube(b, [-sx / 2, tubeY(d), z], [sx / 2, tubeY(d), z], r);
    for (const x of l.poles) tube(b, [x, tubeY(d) - SCAFFOLD_TUBE * 0.5, -sz / 2], [x, tubeY(d) - SCAFFOLD_TUBE * 0.5, sz / 2], r * 0.9);
  }
  for (const y of l.rails) for (const z of [-l.poleZ, l.poleZ]) tube(b, [-sx / 2, y, z], [sx / 2, y, z], r);
  b.kind = KIND.WALL;
  b.a2 = 0;
  const planks = 4;
  const pw = (sz - 0.04) / planks;
  for (const d of l.decks) {
    for (let k = 0; k < planks; k++) {
      const z0 = -sz / 2 + 0.02 + k * pw;
      block(b, -sx / 2 + 0.01, d - 0.04, z0 + 0.006, sx / 2 - 0.01, d, z0 + pw - 0.006, 0.006);
    }
  }
  b.a2 = 0;
}

/** Lattice tower: four tapering legs in red and white bands, girts and X bracing on every face, a platform with railings and a mast. */
function tower(b: MeshBuilder, o: TrackObstacle, base: SupportBase): void {
  const t = towerLayout(o);
  const [, sy] = o.size;
  const tiers = towerTiers(t);
  const corner = (sx: number, sz: number, y: number): Vec3 => {
    const f = Math.min(1, Math.max(0, y / t.platform));
    return [sx * (t.base[0] + (t.top[0] - t.base[0]) * f), y, sz * (t.base[1] + (t.top[1] - t.base[1]) * f)];
  };
  const corners: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  b.kind = KIND.STEEL_PAINT;
  for (let k = 0; k < tiers; k++) {
    const y0 = (t.platform * k) / tiers;
    const y1 = (t.platform * (k + 1)) / tiers;
    b.a2 = k % 2 === 0 ? STEEL_RED : STEEL_WHITE;
    for (const [sx, sz] of corners) {
      const foot = k === 0 ? base(sx * t.base[0], sz * t.base[1], TOWER_LEG / 2, TOWER_LEG / 2) : y0;
      const a = corner(sx, sz, y0);
      member(b, [a[0], foot, a[2]], corner(sx, sz, y1), TOWER_LEG);
    }
    b.a2 = STEEL_GALVANISED;
    for (let e = 0; e < 4; e++) {
      const [ax, az] = corners[e];
      const [cx, cz] = corners[(e + 1) % 4];
      member(b, corner(ax, az, y1), corner(cx, cz, y1), 0.09);
      member(b, corner(ax, az, y0 + 0.1), corner(cx, cz, y1 - 0.1), 0.06);
      member(b, corner(cx, cz, y0 + 0.1), corner(ax, az, y1 - 0.1), 0.06);
    }
  }
  const [dx, dz] = t.deck;
  const deckTop = t.platform + 0.15;
  b.kind = KIND.STEEL_PAINT;
  b.a2 = STEEL_GALVANISED;
  block(b, -dx, t.platform, -dz, dx, deckTop, dz, 0.02);
  for (const [sx, sz] of corners) tube(b, [sx * (dx - 0.03), deckTop, sz * (dz - 0.03)], [sx * (dx - 0.03), deckTop + TOWER_RAIL, sz * (dz - 0.03)], 0.025);
  for (const y of [deckTop + TOWER_RAIL * 0.5, deckTop + TOWER_RAIL - 0.03]) {
    for (let e = 0; e < 4; e++) {
      const [ax, az] = corners[e];
      const [cx, cz] = corners[(e + 1) % 4];
      tube(b, [ax * (dx - 0.03), y, az * (dz - 0.03)], [cx * (dx - 0.03), y, cz * (dz - 0.03)], 0.022);
    }
  }
  b.a2 = STEEL_RED;
  pole(b, 0, deckTop, sy, 0, 0.07, KIND.STEEL_PAINT);
  b.a2 = 0;
}

/**
 * Adds one obstacle at its world position; cloth flags (flagpole) are appended to `flags`. Pass the terrain so the posts, piers and
 * poles of the composite kinds reach the ground under them (without it they stand at pos.y).
 */
export function buildObstacle(b: MeshBuilder, o: TrackObstacle, index: number, flags: ClothFlag[], sampler?: TerrainSampler): void {
  const yaw = affineRotY(o.yaw);
  b.push(affineMul(affineTranslate(o.pos[0], o.pos[1], o.pos[2]), yaw));
  const saved = b.aoFn;
  const base = supportBase(o, sampler);
  switch (o.kind) {
    case 'container':
      container(b, o, index, base);
      break;
    case 'pillar':
      pillar(b, o, base);
      break;
    case 'beam':
      beam(b, o, base);
      break;
    case 'bridge':
      bridge(b, o, base);
      break;
    case 'scaffold':
      scaffold(b, o, base);
      break;
    case 'tower':
      tower(b, o, base);
      break;
    case 'cone':
      cone(b, o);
      break;
    case 'wall':
      wall(b, o, Math.floor(seeded(index) * 4));
      break;
    case 'rock':
      rock(b, o, index + 11);
      break;
    case 'tree':
      tree(b, o);
      break;
    case 'pole':
      pole(b, 0, 0, o.size[1], 0, o.size[0], KIND.POLE);
      break;
    case 'flagpole':
      pole(b, 0, 0, o.size[1], 0, o.size[0], KIND.FLAGPOLE);
      break;
  }
  b.pop();
  b.aoFn = saved;
  if (o.kind === 'flagpole') {
    flags.push({ pos: [o.pos[0], o.pos[1] + o.size[1] - 0.03, o.pos[2]], width: 0.95, height: 0.6, colour: [0.85, 0.04, 0.03], seed: index });
  }
}
