/**
 * Dimensions of the gate and obstacle kinds added for the technical, acro and industrial styles. The generator (placement and
 * validation), the meshes, the colliders and the RT proxies all read them from here, so they agree on where the solid parts are.
 *
 * Gate-local coordinates are (u, v, w): u along `right`, v along `up`, w along `forward` (see gate.ts), metres from the opening
 * centre. Obstacle-local coordinates are (x, y, z) with the origin on the ground at `pos`, x along the obstacle's right
 * (cos yaw, 0, -sin yaw) and z toward its back, the same frame as the yaw-only collider boxes.
 */
import type { ObstacleKind, TrackGate, TrackObstacle, Vec3 } from '../../contracts';
import { GATE_TUBE, trackGateFrame, type GateFrame } from './gate';

const T = GATE_TUBE;
const HT = T / 2;

// ───────────── window: an opening cut in a wall panel ─────────────

/** Wall above the top of the opening, metres. */
export const WINDOW_HEAD = 1.0;
/** Wall beyond each side of the opening, metres. */
export const WINDOW_SIDE = 1.6;
/** Thickness of the wall panel, centred on the gate plane. */
export const WINDOW_THICKNESS = 0.25;
/** Lowest allowed opening bottom above the ground (the wall below it is a sill). */
export const WINDOW_MIN_SILL = 0.8;

// ───────────── ladder: stacked rungs flown up or down in turn ─────────────

/** Clear vertical gap between the openings of neighbouring rungs: rung centres are at least `height + LADDER_MIN_GAP` apart. */
export const LADDER_MIN_GAP = 1.2;
/** Rungs whose centres are this close in x/z belong to the same ladder (they share one pair of side rails). */
export const LADDER_SAME_XZ = 0.5;
/** Side of the square side-rail tube. */
export const LADDER_RAIL = 0.08;
/** How far the side rails rise above the top of the highest rung's frame. */
export const LADDER_CAP = 0.3;

// ───────────── tunnel: an entry frame with a sleeve of walls and roof ─────────────

/** Default sleeve length along the travel axis (TrackGate.depth overrides it). */
export const TUNNEL_DEPTH = 6;
/** Thickness of the sleeve walls and roof. */
export const TUNNEL_WALL = 0.2;
/** Smallest tunnel opening width and height. */
export const TUNNEL_MIN_SIZE = 2.4;
/** Lowest allowed opening bottom above the ground (the floor inside is the ground). */
export const TUNNEL_MIN_SILL = 0.4;
/** Margin the racing line keeps from the sleeve's inner faces. */
export const TUNNEL_PATH_MARGIN = 0.3;

// ───────────── hurdle: a wide low opening under a bar ─────────────

export const HURDLE_WIDTH: readonly [number, number] = [4, 6];
export const HURDLE_HEIGHT: readonly [number, number] = [1.2, 1.8];
/** Height range of the opening bottom above the ground. */
export const HURDLE_SILL: readonly [number, number] = [0.3, 0.6];

// ───────────── drop: a horizontal ring flown straight down ─────────────

export const DROP_PITCH = -Math.PI / 2;
/** Ring diameter range (width and height of the ellipse). */
export const DROP_DIAMETER: readonly [number, number] = [2.6, 3.6];
/** Height range of the ring centre above the ground. */
export const DROP_HEIGHT: readonly [number, number] = [4, 12];
/** Length of the horizontal arm from the ring rim (on the `right` side) out to the top of the post. */
export const DROP_ARM = 0.5;

// ───────────── obstacles ─────────────

/** Allowed full extents (min, max) per axis of the new obstacle kinds; see the per-kind constants for the parts inside them. */
export const OBSTACLE_SIZES: Readonly<Record<'tower' | 'container' | 'pillar' | 'beam' | 'bridge' | 'scaffold', { x: readonly [number, number]; y: readonly [number, number]; z: readonly [number, number] }>> = {
  container: { x: [6.1, 6.1], y: [2.6, 5.2], z: [2.44, 2.44] },
  tower: { x: [3, 5], y: [15, 30], z: [3, 5] },
  pillar: { x: [1, 2], y: [8, 20], z: [1, 2] },
  beam: { x: [6, 14], y: [3, 6], z: [0.5, 0.5] },
  bridge: { x: [12, 25], y: [5, 8], z: [4, 6] },
  scaffold: { x: [6, 12], y: [4, 8], z: [2, 2] },
};

/** Height of one shipping container; taller containers obstacles are a stack of round(size y / CONTAINER_UNIT) units. */
export const CONTAINER_UNIT = 2.6;
/** Side of the square posts at each end of a beam. */
export const BEAM_POST = 0.4;
/** Vertical depth of the beam under its top (size y). */
export const BEAM_DEPTH = 0.5;
/** Thickness along the span of a bridge pier (piers take the deck width minus 0.4 m). */
export const BRIDGE_PIER = 1.2;
/** Deck thickness under the deck top (size y). */
export const BRIDGE_DECK = 0.8;
/** Parapet height above the deck top and thickness. */
export const BRIDGE_PARAPET = 1.0;
export const BRIDGE_PARAPET_THICK = 0.2;
/** Scaffold tube diameter and the target height of one lift (deck to deck). */
export const SCAFFOLD_TUBE = 0.048;
export const SCAFFOLD_LIFT = 2;
/** Target bay length between scaffold standards. */
export const SCAFFOLD_BAY = 2.5;
/** Standards stand this far in from the scaffold's footprint edge, so their base plates stay inside it. */
export const SCAFFOLD_INSET = 0.075;
/** Tower platform: height of its deck below the tower top, railing height, leg side. */
export const TOWER_PLATFORM_DROP = 3;
export const TOWER_RAIL = 1.1;
export const TOWER_LEG = 0.2;
/** Width of the tower shaft at the platform as a share of the base. */
export const TOWER_TAPER = 0.5;
/** Fly-under obstacles (beam, bridge): the line keeps this far below the underside and this far (horizontally) from posts and piers. */
export const FLY_UNDER_CLEARANCE = 1.5;
export const FLY_UNDER_SUPPORT_CLEARANCE = 2;

// ───────────── gate helpers ─────────────

/** Kinds whose solid parts are built upright (yaw only); their roll and pitch must be 0. */
export function isUprightKind(kind: TrackGate['kind']): boolean {
  return kind === 'window' || kind === 'tunnel' || kind === 'hurdle' || kind === 'ladder';
}

/** The gate frame, with roll and pitch dropped for the upright kinds (so the solids stay yaw-aligned boxes). */
export function buildFrame(gate: TrackGate): GateFrame {
  return trackGateFrame(isUprightKind(gate.kind) ? { ...gate, roll: 0, pitch: 0 } : gate);
}

export function tunnelDepth(gate: TrackGate): number {
  return gate.depth !== undefined && Number.isFinite(gate.depth) && gate.depth > 0.5 ? gate.depth : TUNNEL_DEPTH;
}

/** Sleeve of a tunnel gate in gate-local terms: inner and outer |u| of the walls, roof underside and top v, and the length. */
export function tunnelSleeve(gate: TrackGate): { inner: number; outer: number; roof: number; roofTop: number; depth: number } {
  const hw = gate.width / 2;
  const hh = gate.height / 2;
  return { inner: hw + T, outer: hw + T + TUNNEL_WALL, roof: hh + T, roofTop: hh + T + TUNNEL_WALL, depth: tunnelDepth(gate) };
}

/** Wall panel of a window gate: half width (|u|) and top (v) of the panel; it reaches down to the ground. */
export function windowWall(gate: TrackGate): { half: number; top: number } {
  return { half: gate.width / 2 + WINDOW_SIDE, top: gate.height / 2 + WINDOW_HEAD };
}

/** How far walls and sleeves sink below the lowest ground sampled under them. */
export const WALL_SINK = 0.1;

/** Gate-local (u, w) points whose lowest ground sets the bottom of a window wall or a tunnel sleeve (the same for mesh and colliders). */
export function wallGroundPoints(gate: TrackGate): [number, number][] {
  if (gate.kind === 'tunnel') {
    const s = tunnelSleeve(gate);
    const pts: [number, number][] = [];
    for (const w of [0, s.depth / 4, s.depth / 2, (3 * s.depth) / 4, s.depth]) pts.push([-s.outer, w], [0, w], [s.outer, w]);
    return pts;
  }
  const half = windowWall(gate).half;
  const hw = gate.width / 2;
  const d = WINDOW_THICKNESS / 2;
  return [[-half, -d], [-half, d], [-hw, 0], [0, -d], [0, d], [hw, 0], [half, -d], [half, d]];
}

/** Gate-local (u, v) of the point the drop ring's support arm leaves the rim, and of the arm's outer end (top of the post). */
export function dropArm(gate: TrackGate): { rim: [number, number]; end: [number, number] } {
  const r = gate.width / 2 + HT;
  return { rim: [r, 0], end: [r + DROP_ARM, 0] };
}

/**
 * Where the two ground legs of a rectangular frame start: the outer frame corners (u = +-(hw + T/2), v = +-(hh + T)) that are lowest
 * in the world. For an upright or rolled gate that is the bottom edge; for a nearly horizontal frame (pitched to +-90 degrees) the
 * second leg goes to the diagonally opposite corner so the frame stands on two far-apart points. Returned in increasing u.
 */
export function frameFeet(gate: TrackGate, f: GateFrame): [number, number][] {
  const hu = gate.width / 2 + HT;
  const hv = gate.height / 2 + T;
  const corners: [number, number][] = [[-hu, -hv], [hu, -hv], [-hu, hv], [hu, hv]];
  return lowestPair(corners, corners.map(([u, v]) => f.right[1] * u + f.up[1] * v));
}

/** The lowest of `pts` (world heights `y`) and the farthest point within 5 cm of the next lowest, in increasing u. */
function lowestPair(pts: [number, number][], y: number[]): [number, number][] {
  let first = 0;
  for (let k = 1; k < pts.length; k++) if (y[k] < y[first] - 1e-9) first = k;
  let low = Infinity;
  for (let k = 0; k < pts.length; k++) if (k !== first) low = Math.min(low, y[k]);
  let second = -1;
  let far = -1;
  for (let k = 0; k < pts.length; k++) {
    if (k === first || y[k] > low + 0.05) continue;
    const d = Math.hypot(pts[k][0] - pts[first][0], pts[k][1] - pts[first][1]);
    if (d > far + 1e-9) {
      far = d;
      second = k;
    }
  }
  const feet = [pts[first], pts[second]];
  return feet[0][0] <= feet[1][0] ? feet : [feet[1], feet[0]];
}

/**
 * Where the two ground legs of an arch start, as gate-local (u, v), in increasing u. Upright, these are the post bottoms
 * (+-r, -hh) with r = hw + T/2. Rolled or pitched, they are the two lowest of the post bottoms, the spring points and the arc at 45
 * and 135 degrees, as frameFeet picks corners: upside down the arch stands on the 45 and 135 degree points of its arc, on its side
 * on both ends of the lower post. These candidates are vertices of the arch's convex outline, so the leg below each one stays
 * clear of the frame and the opening.
 */
export function archFeet(gate: TrackGate, f: GateFrame, vs: number): [number, number][] {
  const r = gate.width / 2 + HT;
  const hh = gate.height / 2;
  if (gate.roll === 0 && gate.pitch === 0) return [[-r, -hh], [r, -hh]];
  const d = r * Math.SQRT1_2;
  const pts: [number, number][] = [[-r, -hh], [r, -hh], [-r, vs], [r, vs], [d, vs + d], [-d, vs + d]];
  return lowestPair(pts, pts.map(([u, v]) => f.right[1] * u + f.up[1] * v));
}

export interface LadderGroup {
  /** Array positions of the rungs, lowest first. */
  rungs: number[];
  /** Array position of the highest rung: the side rails are built in its frame. */
  top: number;
  /** |u| of the rail centre lines in the top rung's frame (outside the widest rung's posts). */
  railU: number;
  /** World y of the rail tops. */
  railTop: number;
}

/** |u| of the side rails for a ladder whose widest rung is `width` wide. */
export const ladderRailU = (width: number): number => width / 2 + T + LADDER_RAIL / 2;

/** Groups the ladder rungs of a gate list: rungs whose centres are within LADDER_SAME_XZ in x/z share one pair of side rails. */
export function ladderGroups(gates: readonly TrackGate[]): LadderGroup[] {
  const groups: number[][] = [];
  gates.forEach((g, i) => {
    if (g.kind !== 'ladder') return;
    const near = groups.find((list) => list.some((j) => Math.hypot(gates[j].pos[0] - g.pos[0], gates[j].pos[2] - g.pos[2]) <= LADDER_SAME_XZ));
    if (near) near.push(i);
    else groups.push([i]);
  });
  return groups.map((rungs) => {
    rungs.sort((a, b) => gates[a].pos[1] - gates[b].pos[1] || a - b);
    const top = rungs[rungs.length - 1];
    const width = Math.max(...rungs.map((i) => gates[i].width));
    return { rungs, top, railU: ladderRailU(width), railTop: gates[top].pos[1] + gates[top].height / 2 + T + LADDER_CAP };
  });
}

// ───────────── obstacle helpers ─────────────

/** True for the obstacle kinds this module lays out from several parts. */
export function isCompositeObstacle(kind: ObstacleKind): boolean {
  return kind === 'tower' || kind === 'container' || kind === 'pillar' || kind === 'beam' || kind === 'bridge' || kind === 'scaffold';
}

/** World position of an obstacle-local point. */
export function obstacleToWorld(o: TrackObstacle, x: number, y: number, z: number): Vec3 {
  const c = Math.cos(o.yaw);
  const s = Math.sin(o.yaw);
  return [o.pos[0] + c * x + s * z, o.pos[1] + y, o.pos[2] - s * x + c * z];
}

/** Base height (obstacle-local y) under a support of half extents hx, hz at (x, z): the lowest ground there, or 0 without terrain. */
export type SupportBase = (x: number, z: number, hx: number, hz: number) => number;

const flatBase: SupportBase = () => 0;

/** A solid part of an obstacle as an obstacle-local box: centre, half extents and what it is made of. */
export interface ObstaclePart {
  c: Vec3;
  h: Vec3;
  /** support: posts, piers, poles and legs; deck: horizontal spans; rail: thin railings; body: everything else. */
  role: 'body' | 'support' | 'deck' | 'rail';
}

const part = (role: ObstaclePart['role'], x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): ObstaclePart => ({
  c: [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2],
  h: [Math.abs(x1 - x0) / 2, Math.abs(y1 - y0) / 2, Math.abs(z1 - z0) / 2],
  role,
});

/** A vertical support from the ground under (x, z) up to y1, half extents hx, hz. */
function support(base: SupportBase, x: number, z: number, hx: number, hz: number, y1: number): ObstaclePart {
  return part('support', x - hx, Math.min(base(x, z, hx, hz), y1 - 0.05), z - hz, x + hx, y1, z + hz);
}

/**
 * Bottom (obstacle-local y) of a container or pillar: the lowest ground under its whole footprint (0 without terrain). The mesh
 * fills the gap below y = 0 with a concrete plinth (container) or a longer hazard band (pillar).
 */
export function bodyBase(o: TrackObstacle, base: SupportBase): number {
  return Math.min(base(0, 0, o.size[0] / 2, o.size[2] / 2), o.size[1] - 0.05);
}

/** Container stack: number of units and the height of each. */
export function containerUnits(o: TrackObstacle): { n: number; height: number } {
  const n = Math.max(1, Math.round(o.size[1] / CONTAINER_UNIT));
  return { n, height: o.size[1] / n };
}

/** Beam on two posts: post centres at x = +-postX, beam from y0 to the top. */
export function beamLayout(o: TrackObstacle): { postX: number; post: number; y0: number; top: number } {
  const post = Math.min(BEAM_POST, o.size[2]);
  return { postX: o.size[0] / 2 - post / 2, post, y0: o.size[1] - BEAM_DEPTH, top: o.size[1] };
}

/** Bridge: pier centres at x = +-pierX, pier half width along z, deck underside and top. */
export function bridgeLayout(o: TrackObstacle): { pierX: number; pierZ: number; under: number; top: number } {
  return { pierX: o.size[0] / 2 - BRIDGE_PIER / 2, pierZ: Math.max(0.5, o.size[2] / 2 - 0.2), under: o.size[1] - BRIDGE_DECK, top: o.size[1] };
}

/** Scaffold: standards (pole x positions, front and back rows at z = +-poleZ), deck tops, and the guardrail heights. */
export function scaffoldLayout(o: TrackObstacle): { poles: number[]; poleZ: number; decks: number[]; rails: number[] } {
  const [len, h, dep] = o.size;
  const r = SCAFFOLD_TUBE / 2;
  const bays = Math.max(2, Math.round(len / SCAFFOLD_BAY));
  const poles: number[] = [];
  for (let i = 0; i <= bays; i++) poles.push(-len / 2 + SCAFFOLD_INSET + ((len - 2 * SCAFFOLD_INSET) * i) / bays);
  const nd = Math.max(1, Math.round((h - 1) / SCAFFOLD_LIFT));
  const decks: number[] = [];
  for (let k = 1; k <= nd; k++) decks.push(((h - 1) * k) / nd);
  return { poles, poleZ: dep / 2 - SCAFFOLD_INSET, decks, rails: [h - 1 + 0.5, h - r] };
}

/** Lattice tower: half extents of the leg square at the base and at the platform, the platform deck height and half size. */
export function towerLayout(o: TrackObstacle): { base: [number, number]; top: [number, number]; platform: number; deck: [number, number] } {
  const bx = o.size[0] / 2 - TOWER_LEG / 2;
  const bz = o.size[2] / 2 - TOWER_LEG / 2;
  return {
    base: [bx, bz],
    top: [bx * TOWER_TAPER, bz * TOWER_TAPER],
    platform: o.size[1] - TOWER_PLATFORM_DROP,
    deck: [o.size[0] * 0.4, o.size[2] * 0.4],
  };
}

/** Tiers of the lattice tower (the mesh's bands, and one girt round each tier top). */
export function towerTiers(t: { platform: number }): number {
  return Math.max(4, Math.round(t.platform / 3.5));
}

/** Half side of the tower's girts (the horizontal members round each tier top). */
const TOWER_GIRT = 0.045;

/**
 * The solid parts of a composite obstacle as obstacle-local boxes (the colliders and RT proxies are built from these). Open
 * structures keep their gaps: a beam or bridge is flown under, a scaffold between its decks, a lattice tower through its faces
 * (legs and girts collide; the thin diagonal bracing does not).
 */
export function obstacleParts(o: TrackObstacle, base: SupportBase = flatBase): ObstaclePart[] {
  const [sx, sy, sz] = o.size;
  const out: ObstaclePart[] = [];
  switch (o.kind) {
    case 'container':
    case 'pillar':
      // From the lowest ground under the footprint, so the downhill side of a container plinth or pillar foot leaves no gap.
      out.push(part('body', -sx / 2, bodyBase(o, base), -sz / 2, sx / 2, sy, sz / 2));
      break;
    case 'beam': {
      const b = beamLayout(o);
      for (const s of [-1, 1]) out.push(support(base, s * b.postX, 0, b.post / 2, b.post / 2, b.y0));
      out.push(part('deck', -sx / 2, b.y0, -sz / 2, sx / 2, b.top, sz / 2));
      break;
    }
    case 'bridge': {
      const b = bridgeLayout(o);
      for (const s of [-1, 1]) {
        // The mesh's pier: a shaft inset 0.1 m along the span and 0.25 m across, under a full-size cap 0.4 m deep.
        const x = s * b.pierX;
        const y = Math.min(base(x, 0, BRIDGE_PIER / 2, b.pierZ), b.under - 0.45);
        out.push(part('support', x - BRIDGE_PIER / 2 + 0.1, y, -b.pierZ + 0.25, x + BRIDGE_PIER / 2 - 0.1, b.under - 0.4, b.pierZ - 0.25));
        out.push(part('support', x - BRIDGE_PIER / 2, b.under - 0.4, -b.pierZ, x + BRIDGE_PIER / 2, b.under, b.pierZ));
      }
      out.push(part('deck', -sx / 2, b.under, -sz / 2, sx / 2, b.top, sz / 2));
      for (const s of [-1, 1]) out.push(part('rail', -sx / 2, b.top, s * (sz / 2 - BRIDGE_PARAPET_THICK), sx / 2, b.top + BRIDGE_PARAPET, s * (sz / 2)));
      break;
    }
    case 'scaffold': {
      const l = scaffoldLayout(o);
      const r = SCAFFOLD_TUBE / 2;
      for (const z of [-l.poleZ, l.poleZ]) for (const x of l.poles) out.push(support(base, x, z, r, r, sy));
      // A deck: planks on top of the ledgers and transoms, all inside one slab.
      for (const y of l.decks) out.push(part('deck', -sx / 2, y - 0.04 - SCAFFOLD_TUBE, -sz / 2, sx / 2, y, sz / 2));
      for (const y of l.rails) for (const z of [-l.poleZ, l.poleZ]) out.push(part('rail', -sx / 2, y - r, z - r, sx / 2, y + r, z + r));
      break;
    }
    case 'tower': {
      const t = towerLayout(o);
      const leg = TOWER_LEG / 2;
      const tiers = towerTiers(t);
      // Leg-square half extents at height y (the mesh's corner()).
      const at = (y: number): [number, number] => {
        const f = Math.min(1, Math.max(0, y / t.platform));
        return [t.base[0] + (t.top[0] - t.base[0]) * f, t.base[1] + (t.top[1] - t.base[1]) * f];
      };
      for (let k = 0; k < tiers; k++) {
        const y0 = (t.platform * k) / tiers;
        const y1 = (t.platform * (k + 1)) / tiers;
        const [ax, az] = at(y0);
        const [cx, cz] = at(y1);
        // Each leg segment leans inward over the tier: one box round the whole lean.
        const mx = (ax + cx) / 2, mz = (az + cz) / 2;
        const hx = (ax - cx) / 2 + leg, hz = (az - cz) / 2 + leg;
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
          out.push(k === 0 ? support(base, sx * mx, sz * mz, hx, hz, y1) : part('support', sx * mx - hx, y0, sz * mz - hz, sx * mx + hx, y1, sz * mz + hz));
        }
        const g = TOWER_GIRT;
        for (const s of [-1, 1]) {
          out.push(part('rail', -cx, y1 - g, s * cz - g, cx, y1 + g, s * cz + g));
          out.push(part('rail', s * cx - g, y1 - g, -cz, s * cx + g, y1 + g, cz));
        }
      }
      const [dx, dz] = t.deck;
      out.push(part('deck', -dx, t.platform, -dz, dx, t.platform + 0.15, dz));
      for (const s of [-1, 1]) {
        out.push(part('rail', -dx, t.platform + 0.15, s * dz - 0.03, dx, t.platform + 0.15 + TOWER_RAIL, s * dz + 0.03));
        out.push(part('rail', s * dx - 0.03, t.platform + 0.15, -dz, s * dx + 0.03, t.platform + 0.15 + TOWER_RAIL, dz));
      }
      out.push(part('support', -0.08, t.platform + 0.15, -0.08, 0.08, sy, 0.08));
      break;
    }
    default:
      break;
  }
  return out;
}

/**
 * Beams and bridges are flown under: the world height of the underside, and the supports (posts or piers) as world x/z centres
 * with their half extents along the obstacle's x and z. The line should pass at least FLY_UNDER_CLEARANCE below the underside and
 * FLY_UNDER_SUPPORT_CLEARANCE from any support. Null for every other kind.
 */
export function flyUnder(o: TrackObstacle): { underside: number; supports: { center: Vec3; half: [number, number] }[] } | null {
  if (o.kind === 'beam') {
    const b = beamLayout(o);
    return { underside: o.pos[1] + b.y0, supports: [-1, 1].map((s) => ({ center: obstacleToWorld(o, s * b.postX, 0, 0), half: [b.post / 2, b.post / 2] as [number, number] })) };
  }
  if (o.kind === 'bridge') {
    const b = bridgeLayout(o);
    return { underside: o.pos[1] + b.under, supports: [-1, 1].map((s) => ({ center: obstacleToWorld(o, s * b.pierX, 0, 0), half: [BRIDGE_PIER / 2, b.pierZ] as [number, number] })) };
  }
  return null;
}

/**
 * Ground discs (world x, z, radius) kept free of plants and rocks for an obstacle. The original kinds keep their single disc
 * (a wall's half diagonal, otherwise max(size x, size z / 2)); the new kinds get discs that cover their footprint, several
 * along the long axis of a long structure so no disc grows past the vegetation's 32 m blocker cell.
 */
export function obstacleKeepOuts(o: TrackObstacle): { x: number; z: number; r: number }[] {
  if (!isCompositeObstacle(o.kind)) {
    return [{ x: o.pos[0], z: o.pos[2], r: o.kind === 'wall' ? 0.5 * Math.hypot(o.size[0], o.size[2]) : Math.max(o.size[0], o.size[2] * 0.5) }];
  }
  const [sx, , sz] = o.size;
  const long = Math.max(sx, sz);
  const short = Math.min(sx, sz);
  const n = Math.max(1, Math.ceil(long / Math.max(2 * short, 4)));
  const seg = long / n;
  const r = 0.5 * Math.hypot(seg, short);
  const out: { x: number; z: number; r: number }[] = [];
  for (let i = 0; i < n; i++) {
    const t = -long / 2 + seg * (i + 0.5);
    const p = sx >= sz ? obstacleToWorld(o, t, 0, 0) : obstacleToWorld(o, 0, 0, t);
    out.push({ x: p[0], z: p[2], r });
  }
  return out;
}

/** Extra keep-out discs along a tunnel gate's sleeve (the gate's own disc covers its entry). */
export function tunnelKeepOuts(gate: TrackGate): { x: number; z: number; r: number }[] {
  const f = buildFrame(gate);
  const s = tunnelSleeve(gate);
  const out: { x: number; z: number; r: number }[] = [];
  const n = Math.max(1, Math.ceil(s.depth / 4));
  for (let i = 1; i <= n; i++) {
    const w = (s.depth * i) / n;
    out.push({ x: gate.pos[0] + f.forward[0] * w, z: gate.pos[2] + f.forward[2] * w, r: Math.hypot(s.outer, s.depth / n / 2) + 1 });
  }
  return out;
}
