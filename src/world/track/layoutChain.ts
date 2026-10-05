/**
 * Chain layouts: the technical, acro and industrial styles and custom recipes. A course is a chain of elements (manoeuvres from
 * features.ts and plain gates) joined by legs of straights and rounded corners, like a turtle drawing. Circuits close by solving
 * the straight lengths so the chain ends where it started (least change from the wanted lengths, two linear equations); the
 * drawing is then checked for crossings in plan and height, rotated and dropped onto the calmest ground that fits, and turned
 * into layout gates (rigid feature groups), corner waypoints and the props the manoeuvres ask for.
 */
import type { GateKind, TrackFeature } from '../../contracts';
import { featureShape, mirrorShape, placeFeature, type FeatureShape, type HairpinPylon } from './features';
import type { Layout, LayoutBend, LayoutCtx, LayoutGate, LayoutProp } from './layout';
import { siteOk } from './layout';
import type { Rng } from './rng';
import { gateSpec, pickKind, type GateSpec } from './styles';

export interface ChainSpec {
  closed: boolean;
  /** Relative weights of the manoeuvres (missing = never). */
  features: Partial<Record<TrackFeature, number>>;
  /** Manoeuvres every track has (one each, before the weighted picks). */
  required: readonly TrackFeature[];
  /** Share of the gates (after start and finish) spent on manoeuvres. */
  featureShare: number;
  /** Kind of a plain gate between manoeuvres. */
  plainKind(rng: Rng): GateKind;
  /** 0..1: few sweeping corners (0) to many tight ones (1). */
  twist: number;
  /** 0..1: plain gates and manoeuvres stay low (0) or climb high (1). */
  elevation: number;
  /** Wanted length of a lap or of the run, metres. */
  length: number;
  /** What hairpins turn around. */
  pylon: HairpinPylon;
}

const TAU = 2 * Math.PI;
/** Drawings tried per layout call, and terrain placements tried per drawing. */
const DRAWINGS = 24;
const PLACEMENTS = 80;
/** Path stretches this far apart along the drawing must keep apart in plan or height (looser inside manoeuvre zones). */
const FAR_ALONG = 30;
const SEP_XZ = 13;
const SEP_Y = 6;
const ZONE_SEP_XZ = 9.5;
const ZONE_SEP_Y = 5.5;
const ZONE_SEP_3D = 5.2;
/** Gates of different elements stand at least this far apart in plan. */
const GATE_SEP = 14;
/** Metres of leg either side of a manoeuvre that count as its zone in the crossing check. */
const ZONE_LEAD = 14;
const SAMPLE = 3;

interface GateElem {
  kind: 'gate';
  spec: GateSpec;
  clear: number;
}

interface FeatureElem {
  kind: 'feature';
  shape: FeatureShape;
}

type Elem = GateElem | FeatureElem;

/** Plain kinds that need a manoeuvre around them: they become one-gate features. */
const SPECIAL: Partial<Record<GateKind, TrackFeature>> = { tunnel: 'tunnel', drop: 'drop', dive: 'dive' };

function plainClear(kind: GateKind, cs: ChainSpec, rng: Rng): number {
  if (kind === 'hurdle') return rng.range(0.45, 0.58);
  if (kind === 'window') return rng.range(0.85, 1.4);
  return rng.range(0.5, 1.3) + cs.elevation * rng.range(0, 7);
}

function weightedPick<T extends string>(weights: Partial<Record<T, number>>, keys: readonly T[], rng: Rng): T | null {
  let sum = 0;
  for (const k of keys) sum += Math.max(weights[k] ?? 0, 0);
  if (sum <= 0) return null;
  let r = rng.next() * sum;
  for (const k of keys) {
    r -= Math.max(weights[k] ?? 0, 0);
    if (r < 0) return k;
  }
  return keys[keys.length - 1];
}

const FEATURE_ORDER: readonly TrackFeature[] = ['split-s', 'power-loop', 'corkscrew', 'ladder', 'dive', 'drop', 'slalom', 'hairpin', 'tunnel', 'window', 'hurdle'];
const MIN_GATES: Record<TrackFeature, number> = { 'split-s': 2, 'power-loop': 2, corkscrew: 3, ladder: 2, dive: 1, drop: 1, slalom: 3, hairpin: 2, tunnel: 1, window: 1, hurdle: 1 };
const MAX_GATES: Record<TrackFeature, number> = { 'split-s': 2, 'power-loop': 2, corkscrew: 4, ladder: 4, dive: 2, drop: 1, slalom: 5, hairpin: 2, tunnel: 2, window: 1, hurdle: 3 };

/** The elements of a course in flying order: start gate, manoeuvres and plain gates mixed, finish gate on a run. */
function planElements(c: LayoutCtx, cs: ChainSpec): Elem[] | null {
  const { rng, difficulty: d } = c;
  const n = c.gateCount;
  const ends = cs.closed ? 1 : 2;
  let budget = n - ends;
  if (budget < 0) return null;
  const raise = (): number => cs.elevation * rng.range(0, 4);
  const shapes: FeatureShape[] = [];
  const counts = new Map<TrackFeature, number>();
  const add = (f: TrackFeature, most: number): boolean => {
    if (most < MIN_GATES[f]) return false;
    const want = rng.int(MIN_GATES[f], Math.min(MAX_GATES[f], most));
    shapes.push(featureShape(f, d, rng, { gates: want, raise: raise() }, cs.pylon));
    counts.set(f, (counts.get(f) ?? 0) + 1);
    return true;
  };
  for (const f of cs.required) {
    if (!add(f, Math.min(budget, MIN_GATES[f] + 1))) return null;
    budget -= shapes[shapes.length - 1].gates.length;
  }
  let featureBudget = Math.max(0, Math.round(budget * cs.featureShare) - 0);
  for (let t = 0; t < 16 && featureBudget > 0; t++) {
    const options: Partial<Record<TrackFeature, number>> = {};
    for (const f of FEATURE_ORDER) {
      const w = cs.features[f] ?? 0;
      if (w > 0 && MIN_GATES[f] <= featureBudget && (counts.get(f) ?? 0) < 3) options[f] = w / (1 + (counts.get(f) ?? 0));
    }
    const f = weightedPick(options, FEATURE_ORDER, rng);
    if (!f) break;
    add(f, featureBudget);
    const used = shapes[shapes.length - 1].gates.length;
    featureBudget -= used;
    budget -= used;
  }
  const middle: Elem[] = shapes.map((shape) => ({ kind: 'feature', shape }));
  for (let k = 0; k < budget; k++) {
    const kind = cs.plainKind(rng);
    const special = SPECIAL[kind];
    if (special) middle.push({ kind: 'feature', shape: featureShape(special, d, rng, { gates: 1, raise: raise() }, cs.pylon) });
    else middle.push({ kind: 'gate', spec: gateSpec(kind, d, rng), clear: plainClear(kind, cs, rng) });
  }
  // Shuffle, then pull manoeuvres apart so two rarely follow each other directly.
  for (let i = middle.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [middle[i], middle[j]] = [middle[j], middle[i]];
  }
  for (let i = 1; i < middle.length; i++) {
    if (middle[i].kind !== 'feature' || middle[i - 1].kind !== 'feature') continue;
    const j = middle.findIndex((e, k) => k > i && e.kind === 'gate');
    if (j > 0) [middle[i], middle[j]] = [middle[j], middle[i]];
  }
  const start: Elem = { kind: 'gate', spec: gateSpec('start', d, rng), clear: rng.range(0.6, 1.2) };
  const out: Elem[] = [start, ...middle];
  if (!cs.closed) out.push({ kind: 'gate', spec: gateSpec('finish', d, rng), clear: rng.range(0.6, 1.2) });
  return out;
}

/** Height above the ground of the line where it enters and leaves an element. */
function entryAgl(e: Elem): number {
  return e.kind === 'gate' ? e.clear + e.spec.height / 2 : e.shape.baseAgl + e.shape.line[0].y;
}

function exitAgl(e: Elem): number {
  return e.kind === 'gate' ? e.clear + e.spec.height / 2 : e.shape.baseAgl + e.shape.line[e.shape.line.length - 1].y;
}

interface Corner {
  radius: number;
  turn: number;
}

/** A leg between two elements: a straight, optionally a corner and a second straight. */
interface Leg {
  corner: Corner | null;
  /** Indices of its straights in the closure unknowns. */
  straights: number[];
}

/** One drawn course in local coordinates (start gate at the origin facing heading 0). */
interface Drawing {
  elems: Elem[];
  mirror: boolean[];
  legs: Leg[];
  lengths: number[];
}

const fwdX = (h: number): number => -Math.sin(h);
const fwdZ = (h: number): number => -Math.cos(h);

/** Least change of `want` (weights 1 / want) with A l = b, keeping l >= min; null when the system has no such solution. */
function solveClosure(ux: number[], uz: number[], want: number[], min: number[], bx: number, bz: number): number[] | null {
  const n = want.length;
  const l = want.slice();
  const fixed = new Array<boolean>(n).fill(false);
  for (let iter = 0; iter <= n; iter++) {
    // Residual with the fixed ones at their minimum.
    let rx = bx;
    let rz = bz;
    let a = 0;
    let b = 0;
    let cc = 0;
    for (let i = 0; i < n; i++) {
      const v = fixed[i] ? min[i] : want[i];
      rx -= ux[i] * v;
      rz -= uz[i] * v;
      if (fixed[i]) continue;
      const w = want[i];
      a += w * ux[i] * ux[i];
      b += w * ux[i] * uz[i];
      cc += w * uz[i] * uz[i];
    }
    const det = a * cc - b * b;
    if (Math.abs(det) < 1e-6 * (a + cc) * (a + cc) || a + cc <= 0) return null;
    const lx = (cc * rx - b * rz) / det;
    const lz = (a * rz - b * rx) / det;
    let worst = -1;
    let worstV = 0;
    for (let i = 0; i < n; i++) {
      if (fixed[i]) {
        l[i] = min[i];
        continue;
      }
      l[i] = want[i] + want[i] * (ux[i] * lx + uz[i] * lz);
      if (l[i] < min[i] && min[i] - l[i] > worstV) {
        worstV = min[i] - l[i];
        worst = i;
      }
    }
    if (worst < 0) return l;
    fixed[worst] = true;
  }
  return null;
}

interface Sample {
  x: number;
  z: number;
  agl: number;
  s: number;
  zone: boolean;
}

interface Placed {
  /** Plain gates: position, heading, element index. Features: entry pose. */
  poses: { x: number; z: number; h: number }[];
  /** Corner arc points per leg: x, z, agl. */
  bends: { leg: number; x: number; z: number; agl: number }[];
  samples: Sample[];
  /** Gate positions with their element index (for the spacing check and the terrain checks). */
  gates: { x: number; z: number; elem: number; kind: GateKind }[];
  length: number;
}

/** Walks the drawing in local coordinates. */
function walk(dr: Drawing, closed: boolean): Placed {
  const { elems, legs, lengths, mirror } = dr;
  let x = 0;
  let z = 0;
  let h = 0;
  let s = 0;
  const poses: Placed['poses'] = [];
  const bends: Placed['bends'] = [];
  const samples: Sample[] = [];
  const gates: Placed['gates'] = [];
  const push = (px: number, pz: number, agl: number, zone: boolean): void => {
    const last = samples[samples.length - 1];
    if (last) s += Math.hypot(px - last.x, pz - last.z);
    samples.push({ x: px, z: pz, agl, s, zone });
  };
  const straight = (len: number, a0: number, a1: number, zoneHead: number, zoneTail: number, legLen: number, legPos: number): void => {
    const n = Math.max(1, Math.round(len / SAMPLE));
    for (let k = 1; k <= n; k++) {
      const t = (len * k) / n;
      const along = legPos + t;
      const agl = a0 + ((a1 - a0) * along) / Math.max(legLen, 1e-6);
      push(x + fwdX(h) * t, z + fwdZ(h) * t, agl, along < zoneHead || legLen - along < zoneTail);
    }
    x += fwdX(h) * len;
    z += fwdZ(h) * len;
  };
  for (let i = 0; i < elems.length; i++) {
    const e = elems[i];
    poses.push({ x, z, h });
    if (e.kind === 'gate') {
      gates.push({ x, z, elem: i, kind: e.spec.kind });
      push(x, z, entryAgl(e), false);
    } else {
      const f = mirror[i] ? mirrorShape(e.shape) : e.shape;
      const sh = Math.sin(h);
      const ch = Math.cos(h);
      for (const p of f.line) push(x - p.a * sh + p.l * ch, z - p.a * ch - p.l * sh, f.baseAgl + p.y, true);
      for (const g of f.gates) gates.push({ x: x - g.a * sh + g.l * ch, z: z - g.a * ch - g.l * sh, elem: i, kind: g.spec.kind });
      const ex = x - f.exit.a * sh + f.exit.l * ch;
      const ez = z - f.exit.a * ch - f.exit.l * sh;
      x = ex;
      z = ez;
      h += f.exit.yaw;
    }
    if (i === elems.length - 1 && !closed) break;
    const next = elems[(i + 1) % elems.length];
    const leg = legs[i];
    const a0 = exitAgl(e);
    const a1 = entryAgl(next);
    const zoneHead = e.kind === 'feature' ? ZONE_LEAD : 0;
    const zoneTail = next.kind === 'feature' ? ZONE_LEAD : 0;
    const l0 = lengths[leg.straights[0]];
    const l1 = leg.straights.length > 1 ? lengths[leg.straights[1]] : 0;
    const arc = leg.corner ? leg.corner.radius * Math.abs(leg.corner.turn) : 0;
    const legLen = l0 + arc + l1;
    straight(l0, a0, a1, zoneHead, zoneTail, legLen, 0);
    if (leg.corner) {
      const { radius: r, turn } = leg.corner;
      const sg = Math.sign(turn);
      // Turn centre on the inside: left of heading h is (-cos h, sin h) in (x, z).
      const cx = x + sg * r * -Math.cos(h);
      const cz = z + sg * r * Math.sin(h);
      const steps = Math.max(2, Math.ceil(Math.abs(turn) / (Math.PI / 7)));
      for (let k = 1; k <= steps; k++) {
        const hk = h + (turn * k) / steps;
        const px = cx - sg * r * -Math.cos(hk);
        const pz = cz - sg * r * Math.sin(hk);
        const along = l0 + (arc * k) / steps;
        const agl = a0 + ((a1 - a0) * along) / Math.max(legLen, 1e-6);
        bends.push({ leg: i, x: px, z: pz, agl });
        push(px, pz, agl, along < zoneHead || legLen - along < zoneTail);
      }
      h += turn;
      x = cx - sg * r * -Math.cos(h);
      z = cz - sg * r * Math.sin(h);
      straight(l1, a0, a1, zoneHead, zoneTail, legLen, l0 + arc);
    }
  }
  return { poses, bends, samples, gates, length: s };
}

/** True when no two stretches far apart along the drawing come too close (in plan, unless far enough apart in height). */
function crossingFree(p: Placed, closed: boolean): boolean {
  const cell = SEP_XZ;
  const grid = new Map<number, number[]>();
  const key = (i: number, j: number): number => (i + 4096) * 8192 + (j + 4096);
  const pts = p.samples;
  for (let k = 0; k < pts.length; k++) {
    const kk = key(Math.floor(pts[k].x / cell), Math.floor(pts[k].z / cell));
    const list = grid.get(kk);
    if (list) list.push(k);
    else grid.set(kk, [k]);
  }
  const total = p.length;
  for (let k = 0; k < pts.length; k++) {
    const a = pts[k];
    const ci = Math.floor(a.x / cell);
    const cj = Math.floor(a.z / cell);
    for (let di = -1; di <= 1; di++) {
      for (let dj = -1; dj <= 1; dj++) {
        const list = grid.get(key(ci + di, cj + dj));
        if (!list) continue;
        for (const m of list) {
          if (m <= k) continue;
          const b = pts[m];
          let apart = b.s - a.s;
          if (closed) apart = Math.min(apart, total - apart);
          if (apart <= FAR_ALONG) continue;
          const dxz = Math.hypot(a.x - b.x, a.z - b.z);
          const dy = Math.abs(a.agl - b.agl);
          if (a.zone || b.zone) {
            if (dxz < ZONE_SEP_XZ && dy < ZONE_SEP_Y && Math.hypot(dxz, dy) < ZONE_SEP_3D) return false;
          } else if (dxz < SEP_XZ && dy < SEP_Y) return false;
        }
      }
    }
  }
  for (let i = 0; i < p.gates.length; i++) {
    for (let j = 0; j < i; j++) {
      const a = p.gates[i];
      const b = p.gates[j];
      if (a.elem === b.elem) continue;
      if (Math.hypot(a.x - b.x, a.z - b.z) < GATE_SEP) return false;
    }
  }
  return true;
}

/** Turns of the corners of a circuit: their sum closes the heading (one full turn) with the manoeuvres' own turns. */
function cornerTurns(rng: Rng, total: number, count: number, twist: number, maxTurn: number): number[] | null {
  const w: number[] = [];
  let sw = 0;
  for (let k = 0; k < count; k++) {
    w.push(rng.range(0.5, 1.5));
    sw += w[k];
  }
  const turns = w.map((v) => (total * v) / sw);
  // Zero-sum zig-zag: chicanes on top of the net turning.
  const zig = twist * rng.range(0.2, 0.7);
  for (let k = 0; k + 1 < count; k += 2) {
    const z = zig * rng.range(0.5, 1);
    turns[k] += z;
    turns[k + 1] -= z;
  }
  for (const t of turns) if (Math.abs(t) > maxTurn) return null;
  return turns;
}

/** One random drawing of the course: corners, mirror choices and straight lengths, closed when the course is a circuit. */
function draw(c: LayoutCtx, cs: ChainSpec, elems: Elem[]): { p: Placed; dr: Drawing } | null {
  const { rng } = c;
  const closed = cs.closed;
  const m = elems.length;
  const legCount = closed ? m : m - 1;
  const dir = rng.sign();
  // Turning manoeuvres (a split-S or hairpin reverses the heading) are mirrored so their net turn heads for most of one loop
  // in `dir` on a circuit and for none on a run: the corners then have little left to do and the drawing rarely crosses itself.
  const target = closed ? dir * TAU * 0.6 : 0;
  let acc = 0;
  const mirror = elems.map((e) => {
    if (e.kind !== 'feature' || Math.abs(e.shape.exit.yaw) <= 0.3) return rng.chance(0.5);
    const y = e.shape.exit.yaw;
    let flip = Math.abs(target - (acc - y)) < Math.abs(target - (acc + y));
    if (rng.chance(0.15)) flip = !flip;
    acc += flip ? -y : y;
    return flip;
  });
  let featureTurn = 0;
  for (let i = 0; i < m; i++) {
    const e = elems[i];
    if (e.kind === 'feature') featureTurn += mirror[i] ? -e.shape.exit.yaw : e.shape.exit.yaw;
  }
  const maxTurn = 1.55 + 0.55 * cs.twist;
  const radius = (): number => (18 - 9 * cs.twist) * rng.range(0.85, 1.15);
  const corners: (Corner | null)[] = new Array(legCount).fill(null);
  if (closed) {
    const need = dir * TAU - featureTurn;
    const base = 3 + Math.round(cs.twist * 3);
    const count = Math.min(legCount, Math.max(base, Math.ceil(Math.abs(need) / (maxTurn * 0.8)), 2));
    const turns = cornerTurns(rng, need, count, cs.twist, maxTurn);
    if (!turns) return null;
    const legsIdx = Array.from({ length: legCount }, (_, k) => k);
    for (let i = legsIdx.length - 1; i > 0; i--) {
      const j = rng.int(0, i);
      [legsIdx[i], legsIdx[j]] = [legsIdx[j], legsIdx[i]];
    }
    const chosen = legsIdx.slice(0, count).sort((a, b) => a - b);
    chosen.forEach((leg, k) => (corners[leg] = { radius: radius(), turn: turns[k] }));
  } else {
    let bias = rng.sign();
    for (let k = 0; k < legCount; k++) {
      if (!rng.chance(0.35 + 0.45 * cs.twist)) continue;
      if (rng.chance(0.25)) bias = -bias;
      corners[k] = { radius: radius(), turn: bias * rng.range(0.35, maxTurn * 0.85) };
    }
  }
  // Straights: one per leg, two when the leg has a corner.
  const legs: Leg[] = [];
  const want: number[] = [];
  const min: number[] = [];
  let fixedLen = 0;
  for (const e of elems) if (e.kind === 'feature') fixedLen += e.shape.length;
  let straights = 0;
  for (let k = 0; k < legCount; k++) {
    const cn = corners[k];
    if (cn) fixedLen += cn.radius * Math.abs(cn.turn);
    straights += cn ? 2 : 1;
  }
  const free = Math.max(cs.length - fixedLen, straights * 8);
  for (let k = 0; k < legCount; k++) {
    const e = elems[k];
    const next = elems[(k + 1) % m];
    const climb = Math.abs(exitAgl(e) - entryAgl(next));
    const legMin = Math.max(14, 2.6 * climb + 6);
    const cn = corners[k];
    const parts = cn ? 2 : 1;
    const ids: number[] = [];
    for (let p = 0; p < parts; p++) {
      ids.push(want.length);
      want.push((free / straights) * rng.range(0.6, 1.4));
      min.push(Math.max(legMin / parts, cn ? 6 : 8));
    }
    legs.push({ corner: cn, straights: ids });
  }
  let lengths = want.map((w, k) => Math.max(w, min[k]));
  if (closed) {
    // Directions of every straight and the displacement of everything else, from a walk with unit straights.
    const ux: number[] = new Array(want.length).fill(0);
    const uz: number[] = new Array(want.length).fill(0);
    const probe = walkDirections(elems, mirror, legs, ux, uz);
    lengths = solveClosure(ux, uz, lengths, min, -probe.x, -probe.z) ?? [];
    if (lengths.length === 0) return null;
    for (let k = 0; k < lengths.length; k++) if (lengths[k] > 4 * Math.max(want[k], min[k]) + 40) return null;
  }
  const dr: Drawing = { elems, mirror, legs, lengths };
  const p = walk(dr, closed);
  if (closed) {
    const last = p.samples[p.samples.length - 1];
    if (Math.hypot(last.x, last.z) > 0.5) return null;
  }
  return crossingFree(p, closed) ? { p, dr } : null;
}

/** Walks the drawing with zero-length straights, recording each straight's direction; returns where the walk ends. */
function walkDirections(elems: Elem[], mirror: boolean[], legs: Leg[], ux: number[], uz: number[]): { x: number; z: number } {
  let x = 0;
  let z = 0;
  let h = 0;
  for (let i = 0; i < elems.length; i++) {
    const e = elems[i];
    if (e.kind === 'feature') {
      const f = mirror[i] ? mirrorShape(e.shape) : e.shape;
      const sh = Math.sin(h);
      const ch = Math.cos(h);
      x += -f.exit.a * sh + f.exit.l * ch;
      z += -f.exit.a * ch - f.exit.l * sh;
      h += f.exit.yaw;
    }
    const leg = legs[i];
    if (!leg) continue;
    ux[leg.straights[0]] = fwdX(h);
    uz[leg.straights[0]] = fwdZ(h);
    if (leg.corner) {
      const { radius: r, turn } = leg.corner;
      const sg = Math.sign(turn);
      const cx = x + sg * r * -Math.cos(h);
      const cz = z + sg * r * Math.sin(h);
      h += turn;
      x = cx - sg * r * -Math.cos(h);
      z = cz - sg * r * Math.sin(h);
      ux[leg.straights[1]] = fwdX(h);
      uz[leg.straights[1]] = fwdZ(h);
    }
  }
  return { x, z };
}

/** Rotates the drawing by `phi` and moves its centroid to (ox, oz): world x, z of a local point. */
function transform(phi: number, ox: number, oz: number, mx: number, mz: number): (x: number, z: number) => [number, number] {
  const c = Math.cos(phi);
  const s = Math.sin(phi);
  return (x, z) => {
    const dx = x - mx;
    const dz = z - mz;
    return [ox + dx * c + dz * s, oz - dx * s + dz * c];
  };
}

/** Best rotation and position of a drawing on the terrain, or null when no tried placement keeps every gate on a good site. */
function placeOnTerrain(c: LayoutCtx, p: Placed, elems: Elem[]): { phi: number; at: (x: number, z: number) => [number, number] } | null {
  const { rng, sampler } = c;
  let mx = 0;
  let mz = 0;
  for (const q of p.samples) {
    mx += q.x;
    mz += q.z;
  }
  mx /= p.samples.length;
  mz /= p.samples.length;
  let reach = 0;
  for (const q of p.samples) reach = Math.max(reach, Math.hypot(q.x - mx, q.z - mz));
  const room = c.spec.corridor * c.extent - reach - 4;
  if (room < 0) return null;
  let best: { phi: number; at: (x: number, z: number) => [number, number] } | null = null;
  let bestCost = Infinity;
  for (let t = 0; t < PLACEMENTS; t++) {
    const phi = rng.range(0, TAU);
    const rr = room * Math.sqrt(rng.next());
    const a = rng.range(0, TAU);
    const at = transform(phi, c.cx + rr * Math.cos(a), c.cz + rr * Math.sin(a), mx, mz);
    let cost = 0;
    let ok = true;
    for (const g of p.gates) {
      const [x, z] = at(g.x, g.z);
      if (!siteOk(c, x, z, g.kind === 'dive' || g.kind === 'drop')) {
        ok = false;
        break;
      }
      cost += sampler.slopeAt(x, z) * 10;
    }
    if (!ok) continue;
    for (let i = 0; i < elems.length && ok; i++) {
      const e = elems[i];
      if (e.kind !== 'feature' || e.shape.flat === undefined) continue;
      let lo = Infinity;
      let hi = -Infinity;
      const pose = p.poses[i];
      for (const q of e.shape.line) {
        const lx = pose.x - q.a * Math.sin(pose.h);
        const lz = pose.z - q.a * Math.cos(pose.h);
        const [x, z] = at(lx, lz);
        const gh = sampler.heightAt(x, z);
        lo = Math.min(lo, gh);
        hi = Math.max(hi, gh);
      }
      if (hi - lo > e.shape.flat) ok = false;
    }
    if (!ok) continue;
    for (let k = 0; k < p.samples.length; k += 3) {
      const [x, z] = at(p.samples[k].x, p.samples[k].z);
      if (sampler.heightAt(x, z) < c.waterFloor) cost += 3;
      cost += Math.max(0, sampler.slopeAt(x, z) - 0.3) * 4;
    }
    cost += rng.range(0, 2);
    if (cost < bestCost) {
      bestCost = cost;
      best = { phi, at };
    }
  }
  return best;
}

/** A chain course for `cs` on this terrain, or null when no drawing fits (the generator then tries another seed). */
export function chainLayout(c: LayoutCtx, cs: ChainSpec): Layout | null {
  const elems = planElements(c, cs);
  if (!elems) return null;
  for (let attempt = 0; attempt < DRAWINGS; attempt++) {
    const drawn = draw(c, cs, elems);
    if (!drawn) continue;
    const spot = placeOnTerrain(c, drawn.p, elems);
    if (!spot) continue;
    return toLayout(cs, drawn.p, drawn.dr, spot);
  }
  return null;
}

function toLayout(cs: ChainSpec, p: Placed, dr: Drawing, spot: { phi: number; at: (x: number, z: number) => [number, number] }): Layout {
  const gates: LayoutGate[] = [];
  const props: LayoutProp[] = [];
  const bends: LayoutBend[] = [];
  const lastGateOfElem: number[] = [];
  let groupBase = 0;
  for (let i = 0; i < dr.elems.length; i++) {
    const e = dr.elems[i];
    const pose = p.poses[i];
    const [x, z] = spot.at(pose.x, pose.z);
    const h = pose.h + spot.phi;
    if (e.kind === 'gate') {
      gates.push({ x, z, spec: e.spec, clear: e.clear, roll: 0 });
    } else {
      const f = dr.mirror[i] ? mirrorShape(e.shape) : e.shape;
      const placed = placeFeature(f, x, z, h, groupBase);
      groupBase += f.groups;
      gates.push(...placed.gates);
      props.push(...placed.props);
    }
    lastGateOfElem[i] = gates.length - 1;
  }
  let order = 0;
  for (const b of p.bends) {
    const [x, z] = spot.at(b.x, b.z);
    bends.push({ gap: lastGateOfElem[b.leg], order: order++, x, z, agl: b.agl });
  }
  return { closed: cs.closed, gates, bends, props, relax: false };
}

/** Wanted length: about `perGate` metres a gate, inside the style's length range. */
function styleLength(c: LayoutCtx, lo: number, hi: number): number {
  return Math.min(Math.max(c.gateCount * c.rng.range(lo, hi), c.spec.minLength * 1.15), c.spec.maxLength * 0.85);
}

/** Technical: a tight circuit of split-S, ladders, tunnels, windows, hurdles and hairpins between plain gates. */
export function technicalLayout(c: LayoutCtx): Layout | null {
  return chainLayout(c, {
    closed: true,
    features: { 'split-s': 2, ladder: 2.5, tunnel: 2, window: 2, hurdle: 2, hairpin: 2.5, slalom: 1 },
    required: ['split-s'],
    featureShare: 0.6,
    plainKind: (rng) => pickKind('technical', c.difficulty, rng),
    twist: 0.55,
    elevation: 0.3,
    length: styleLength(c, 42, 56),
    pylon: c.rng.chance(0.5) ? 'wall' : 'flagpole',
  });
}

/** Acro: an open run of power loops, split-S, corkscrews, drop rings and dives, high above the ground. */
export function acroLayout(c: LayoutCtx): Layout | null {
  return chainLayout(c, {
    closed: false,
    features: { 'power-loop': 2.5, 'split-s': 2, corkscrew: 2, drop: 2, dive: 2.5 },
    required: ['power-loop'],
    featureShare: 0.8,
    plainKind: (rng) => pickKind('acro', c.difficulty, rng),
    twist: 0.45,
    elevation: 0.8,
    length: styleLength(c, 65, 95),
    pylon: 'flagpole',
  });
}

/** Industrial: a circuit through windows and tunnels among containers, towers, pillars, beams, bridges and scaffolds. */
export function industrialLayout(c: LayoutCtx): Layout | null {
  return chainLayout(c, {
    closed: true,
    features: { window: 3, tunnel: 3, hairpin: 1.5, slalom: 1, hurdle: 1, 'split-s': 0.5 },
    required: ['window', 'tunnel'],
    featureShare: 0.45,
    plainKind: (rng) => pickKind('industrial', c.difficulty, rng),
    twist: 0.4,
    elevation: 0.25,
    length: styleLength(c, 48, 62),
    pylon: 'pillar',
  });
}
