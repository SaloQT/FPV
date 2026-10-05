/**
 * Manoeuvres built from several gates (TrackFeature): split-S, power loop, corkscrew, ladder, dive, drop ring, slalom, hairpin,
 * tunnel, window and hurdles. Each is shaped in its own entry frame (featureShape) and then put on the map at an anchor point and
 * heading (placeFeature). Its gates are `fixed` (their axis comes from the shape) and rigid within a group, and its control points
 * make the path fly the manoeuvre the way a pilot would: half loops, a full loop, a barrel roll, climbs and pull-outs.
 *
 * Entry frame: `a` metres along the entry heading, `l` metres to its right, `y` metres above the feature's base (the assembler
 * solves the base height so every gate gets its clearance). The entry point is (0, 0, line[0].y); `exit` is where the plain course
 * carries on, with its heading relative to the entry heading (yaw convention: positive turns left).
 */
import type { GateKind, ObstacleKind, TrackFeature, TrackGate, Vec3 } from '../../contracts';
import { gateOutline, trackGateFrame } from './gate';
import { DROP_HEIGHT, DROP_PITCH, LADDER_MIN_GAP, TUNNEL_DEPTH, WINDOW_MIN_SILL } from './kindGeometry';
import type { FeatureCtrl, LayoutGate, LayoutProp } from './layout';
import type { Rng } from './rng';
import { MIN_FEATURE_TURN_RADIUS, gateSpec, type GateSpec } from './styles';

const TAU = 2 * Math.PI;

/** What validation and the layout need to know about a manoeuvre. */
export interface FeatureRule {
  /** Gates it uses: fewest, most. */
  gates: readonly [number, number];
  /** Tightest centreline radius inside its zone (MAX_CURVATURE applies outside). */
  minRadius: number;
  /** Its zone: metres of path before its first gate and after its last in which its own rules apply. */
  before: number;
  after: number;
}

export const FEATURE_RULES: Readonly<Record<TrackFeature, FeatureRule>> = {
  'split-s': { gates: [2, 2], minRadius: 4.2, before: 14, after: 26 },
  'power-loop': { gates: [2, 2], minRadius: 4.2, before: 12, after: 38 },
  corkscrew: { gates: [3, 4], minRadius: 6, before: 12, after: 30 },
  ladder: { gates: [2, 4], minRadius: MIN_FEATURE_TURN_RADIUS, before: 12, after: 16 },
  dive: { gates: [1, 2], minRadius: 6, before: 34, after: 32 },
  drop: { gates: [1, 1], minRadius: 3.8, before: 46, after: 22 },
  slalom: { gates: [3, 5], minRadius: 6, before: 12, after: 12 },
  hairpin: { gates: [2, 2], minRadius: 4.4, before: 10, after: 24 },
  tunnel: { gates: [1, 2], minRadius: 6, before: 10, after: 22 },
  window: { gates: [1, 1], minRadius: 6, before: 10, after: 10 },
  hurdle: { gates: [1, 3], minRadius: 6, before: 8, after: 12 },
};

/** Largest ground height difference along a tunnel's line: the sleeve stands on the ground and the line keeps its height through it. */
const TUNNEL_FLAT = 1;
/** Metres a drop ring's wanted clearance stays under DROP_HEIGHT[1], for the ground sloping between its rim and its centre. */
const DROP_SLOPE_ROOM = 1;

/** A point in a feature's entry frame. */
export interface LocalPt {
  a: number;
  l: number;
  y: number;
}

export interface FeatureGateShape extends LocalPt {
  spec: GateSpec;
  /** Yaw relative to the entry heading. */
  yaw: number;
  pitch: number;
  roll: number;
  /** Wanted clearance of the opening's lowest edge (see LayoutGate.clear). */
  clear: number;
  /** Rigid sub-group within the feature: most features are one group; hurdles and slalom flags each stand on their own ground. */
  group: number;
  depth?: number;
  pre: LocalPt[];
  post: LocalPt[];
}

export interface FeatureProp {
  kind: ObstacleKind;
  a: number;
  l: number;
  yaw: number;
  size: Vec3;
  /** Placed instead when this prop does not fit (a hairpin falls back to a flagpole when its pillar or wall cannot stand). */
  alt?: FeatureProp;
}

export interface FeatureShape {
  feature: TrackFeature;
  gates: FeatureGateShape[];
  /** Where the plain course carries on: position and heading relative to the entry. */
  exit: { a: number; l: number; yaw: number };
  /** The flight line from the entry to the exit through every gate and control point (for layout collision checks). */
  line: LocalPt[];
  /** Length of `line`. */
  length: number;
  props: FeatureProp[];
  /** Largest ground height difference (m) the feature tolerates over its footprint (tunnels sit on flat ground). */
  flat?: number;
  /** Height of the base above flat ground that gives every gate its clearance. */
  baseAgl: number;
  /** Groups used (0 .. groups - 1). */
  groups: number;
}

export interface FeatureOptions {
  /** Gates wanted (clamped to the feature's range). */
  gates?: number;
  /** Metres added to every gate's clearance: the whole manoeuvre flies higher. */
  raise?: number;
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const smooth = (t: number): number => t * t * (3 - 2 * t);
/** Unit direction of relative heading `yaw` in (a, l): yaw 0 is +a, positive yaw turns left (toward -l). */
const dirA = (yaw: number): number => Math.cos(yaw);
const dirL = (yaw: number): number => -Math.sin(yaw);

/** Collects a feature's flight sequence (points and gates in order) and turns it into a FeatureShape. */
class Shaper {
  private readonly items: ({ p: LocalPt } | { g: FeatureGateShape })[] = [];
  readonly props: FeatureProp[] = [];

  constructor(readonly feature: TrackFeature) {}

  pt(a: number, l: number, y: number): void {
    this.items.push({ p: { a, l, y } });
  }

  gate(g: Omit<FeatureGateShape, 'pre' | 'post'>): void {
    this.items.push({ g: { ...g, pre: [], post: [] } });
  }

  /** A turn in the horizontal plane at height y from (a, l) heading yaw0 by `turn` (positive left) on radius r; returns the end pose. */
  turn(a: number, l: number, y: number, yaw0: number, r: number, turn: number, step = Math.PI / 6): { a: number; l: number; yaw: number } {
    const s = Math.sign(turn);
    // Left normal of heading h is (-sin h, -cos h) in (a, l); the turn centre lies on the inside.
    const ca = a + s * r * -Math.sin(yaw0);
    const cl = l + s * r * -Math.cos(yaw0);
    const n = Math.max(1, Math.ceil(Math.abs(turn) / step));
    let end = { a, l, yaw: yaw0 };
    for (let k = 1; k <= n; k++) {
      const h = yaw0 + (turn * k) / n;
      end = { a: ca - s * r * -Math.sin(h), l: cl - s * r * -Math.cos(h), yaw: h };
      this.pt(end.a, end.l, y);
    }
    return end;
  }

  finish(exit: FeatureShape['exit'], extra: { flat?: number; lineAgl?: number } = {}): FeatureShape {
    const gates: FeatureGateShape[] = [];
    const line: LocalPt[] = [];
    let pending: LocalPt[] = [];
    for (const it of this.items) {
      if ('g' in it) {
        if (gates.length === 0) it.g.pre = pending;
        else gates[gates.length - 1].post.push(...pending);
        pending = [];
        gates.push(it.g);
        line.push({ a: it.g.a, l: it.g.l, y: it.g.y });
      } else {
        pending.push(it.p);
        line.push(it.p);
      }
    }
    if (gates.length > 0) gates[gates.length - 1].post.push(...pending);
    let length = 0;
    for (let i = 1; i < line.length; i++) length += Math.hypot(line[i].a - line[i - 1].a, line[i].l - line[i - 1].l, line[i].y - line[i - 1].y);
    // Gates whose clearance would leave the line below `lineAgl` over flat ground are raised (a dive's hill starts on the ground).
    const lineAgl = extra.lineAgl ?? 0;
    const lowLine = Math.min(...line.map((p) => p.y));
    let baseAgl = -Infinity;
    for (const g of gates) {
      const low = lowExtent(g);
      g.clear = Math.max(g.clear, lineAgl + g.y - lowLine - low);
      baseAgl = Math.max(baseAgl, g.clear + low - g.y);
    }
    const groups = gates.reduce((m, g) => Math.max(m, g.group + 1), 0);
    return { feature: this.feature, gates, exit, line, length, props: this.props, flat: extra.flat, baseAgl, groups };
  }
}

const probe: TrackGate = { index: 0, kind: 'square', pos: [0, 0, 0], yaw: 0, roll: 0, pitch: 0, width: 1, height: 1 };
const outline: [number, number][] = [];

/** How far the opening's outline reaches below the gate centre for its pitch and roll. */
function lowExtent(g: FeatureGateShape): number {
  probe.kind = g.spec.kind;
  probe.pitch = g.pitch;
  probe.roll = g.roll;
  probe.width = g.spec.width;
  probe.height = g.spec.height;
  const f = trackGateFrame(probe);
  gateOutline(probe, outline);
  let low = 0;
  for (const [u, v] of outline) low = Math.min(low, f.right[1] * u + f.up[1] * v);
  return -low;
}

/** A vertical profile in the (a, y) plane: straights and arcs, sampled every few metres. */
class Profile {
  a = 0;
  y = 0;
  /** Flight angle above the horizontal. */
  th = 0;

  constructor(
    private readonly s: Shaper,
    a: number,
    y: number,
  ) {
    this.a = a;
    this.y = y;
  }

  /** A straight of `len` metres; `end` false leaves out the point at its end (a gate goes there). */
  straight(len: number, step = 4, end = true): void {
    const n = Math.max(1, Math.ceil(len / step));
    const ca = Math.cos(this.th);
    const sy = Math.sin(this.th);
    const a0 = this.a;
    const y0 = this.y;
    for (let k = 1; k <= (end ? n : n - 1); k++) this.s.pt(a0 + (ca * len * k) / n, 0, y0 + (sy * len * k) / n);
    this.a = a0 + ca * len;
    this.y = y0 + sy * len;
  }

  arc(r: number, turn: number, step = 3): void {
    const n = Math.max(2, Math.ceil((Math.abs(turn) * r) / step));
    const s = Math.sign(turn);
    // Centre of the arc lies on the side the flight angle turns toward.
    const ca = this.a - s * r * Math.sin(this.th);
    const cy = this.y + s * r * Math.cos(this.th);
    const th0 = this.th;
    for (let k = 1; k <= n; k++) {
      const th = th0 + (turn * k) / n;
      this.s.pt(ca + s * r * Math.sin(th), 0, cy - s * r * Math.cos(th));
    }
    this.th = th0 + turn;
    this.a = ca + s * r * Math.sin(this.th);
    this.y = cy - s * r * Math.cos(this.th);
  }
}

function plainSpec(kinds: readonly GateKind[], d: number, rng: Rng): GateSpec {
  return gateSpec(rng.pick(kinds), d, rng);
}

/** Half loop down: a high gate, a half loop that drifts a few metres sideways, a low gate facing back, then a turn away. */
function splitS(d: number, rng: Rng, o: FeatureOptions): FeatureShape {
  const s = new Shaper('split-s');
  const r = lerp(6, 4.8, d) * rng.range(0.97, 1.03);
  const side = rng.sign();
  const drift = side * rng.range(3, 5);
  const specA = plainSpec(['square', 'arch', 'hoop'], d, rng);
  const specB = plainSpec(['square', 'arch'], d, rng);
  const away = rng.range(0.6, 1);
  const clearB = rng.range(0.6, 1.4) + (o.raise ?? 0);
  const top = 2 * r;
  s.pt(0, 0, top);
  s.pt(4, 0, top);
  s.gate({ a: 8, l: 0, y: top, spec: specA, yaw: 0, pitch: 0, roll: 0, clear: 0.5, group: 0 });
  const a0 = 11;
  s.pt(a0, 0, top);
  for (let k = 1; k <= 6; k++) {
    const th = (k * Math.PI) / 6;
    s.pt(a0 + r * Math.sin(th), (drift * (1 - Math.cos(th))) / 2, r + r * Math.cos(th));
  }
  const aB = a0 - 5;
  s.gate({ a: aB, l: drift, y: 0, spec: specB, yaw: Math.PI, pitch: 0, roll: 0, clear: clearB, group: 0 });
  s.pt(aB - 3, drift, 0);
  const end = s.turn(aB - 3, drift, 0, Math.PI, 9, side * away);
  const xa = end.a + 4 * dirA(end.yaw);
  const xl = end.l + 4 * dirL(end.yaw);
  s.pt(xa, xl, 0);
  return s.finish({ a: xa, l: xl, yaw: end.yaw });
}

/** 180 degree turn around a pylon or a wall: a gate in, a tight half circle, a gate out on the parallel line. */
function hairpin(d: number, rng: Rng, o: FeatureOptions, pylon: 'pillar' | 'wall' | 'flagpole'): FeatureShape {
  const s = new Shaper('hairpin');
  const r = lerp(6.4, 5, d) * rng.range(0.97, 1.03);
  const side = rng.sign();
  const specA = plainSpec(['square', 'arch'], d, rng);
  const specB = plainSpec(['square', 'arch'], d, rng);
  const clear = rng.range(0.6, 1.3) + (o.raise ?? 0);
  s.pt(0, 0, 0);
  s.pt(3, 0, 0);
  s.gate({ a: 6, l: 0, y: 0, spec: specA, yaw: 0, pitch: 0, roll: 0, clear, group: 0 });
  s.pt(9, 0, 0);
  const end = s.turn(9, 0, 0, 0, r, side * Math.PI);
  s.gate({ a: 5, l: end.l, y: 0, spec: specB, yaw: Math.PI, pitch: 0, roll: 0, clear, group: 0 });
  s.pt(1, end.l, 0);
  const cl = -side * r;
  const flagpole: FeatureProp = { kind: 'flagpole', a: 9, l: cl, yaw: 0, size: [0.02, 3, 0.02] };
  if (pylon === 'pillar' && r >= 5.4) {
    const w = rng.range(1, 1.3);
    s.props.push({ kind: 'pillar', a: 9, l: cl, yaw: 0, size: [w, rng.range(8, 14), w], alt: flagpole });
  } else if (pylon === 'wall') {
    // The wall runs along the axis between the legs and stops 4.6 m inside the half circle.
    const a1 = 9 + Math.max(0, r - 4.9);
    const a0 = -4;
    s.props.push({ kind: 'wall', a: (a0 + a1) / 2, l: cl, yaw: Math.PI / 2, size: [a1 - a0, rng.range(1.4, 2.2), 0.4], alt: flagpole });
  } else {
    s.props.push(flagpole);
  }
  return s.finish({ a: 1, l: end.l, yaw: Math.PI });
}

/** Two to four rungs stacked straight up, flown back and forth: up (or down) one rung per half loop. */
function ladder(d: number, rng: Rng, o: FeatureOptions): FeatureShape {
  const s = new Shaper('ladder');
  const [lo, hi] = FEATURE_RULES.ladder.gates;
  const n = Math.min(Math.max(o.gates ?? rng.int(2, 4), lo), hi);
  const rl = lerp(4.5, 3.9, d) * rng.range(0.98, 1.04);
  const spec = gateSpec('ladder', d, rng);
  const gap = Math.max(2 * rl, spec.height + LADDER_MIN_GAP);
  const climb = rng.chance(0.65);
  const clear = rng.range(0.8, 1.4) + (o.raise ?? 0);
  const ar = 8;
  const run = 3.5;
  const yAt = (k: number): number => (climb ? k : n - 1 - k) * gap;
  const sv = climb ? 1 : -1;
  s.pt(0, 0, yAt(0));
  s.pt(4, 0, yAt(0));
  for (let k = 0; k < n; k++) {
    const y = yAt(k);
    s.gate({ a: ar, l: 0, y, spec, yaw: k % 2 === 0 ? 0 : Math.PI, pitch: 0, roll: 0, clear, group: 0 });
    const dir = k % 2 === 0 ? 1 : -1;
    if (k < n - 1) {
      const ac = ar + dir * run;
      s.pt(ac, 0, y);
      for (let j = 1; j <= 5; j++) {
        const th = (j * Math.PI) / 6;
        s.pt(ac + (dir * gap * Math.sin(th)) / 2, 0, y + (sv * gap) / 2 - (sv * gap * Math.cos(th)) / 2);
      }
      s.pt(ac, 0, y + sv * gap);
    } else {
      s.pt(ar + dir * 5, 0, y);
      s.pt(ar + dir * 10, 0, y);
      return s.finish({ a: ar + dir * 10, l: 0, yaw: dir > 0 ? 0 : Math.PI });
    }
  }
  throw new Error('unreachable');
}

/** A full vertical loop that drifts sideways: through a low gate, up and back over it through an inverted hoop, down beside it. */
function powerLoop(d: number, rng: Rng, o: FeatureOptions): FeatureShape {
  const s = new Shaper('power-loop');
  const r = lerp(5.8, 4.8, d) * rng.range(0.97, 1.03);
  const drift = rng.sign() * rng.range(5.5, 6.5);
  const specA = plainSpec(['square', 'arch'], d, rng);
  const specB = gateSpec('hoop', d, rng);
  const ac = 8 + rng.range(0.6, 1.4);
  const clear = rng.range(0.6, 1.4) + (o.raise ?? 0);
  s.pt(0, 0, 0);
  s.pt(4, 0, 0);
  s.gate({ a: 8, l: 0, y: 0, spec: specA, yaw: 0, pitch: 0, roll: 0, clear, group: 0 });
  for (let k = 1; k <= 11; k++) {
    const th = (k * TAU) / 12;
    const a = ac + r * Math.sin(th);
    const l = drift * smooth(k / 12);
    const y = r * (1 - Math.cos(th));
    if (k === 6) s.gate({ a, l, y, spec: specB, yaw: Math.PI, pitch: 0, roll: Math.PI, clear: 0.5, group: 0 });
    else s.pt(a, l, y);
  }
  s.pt(ac, drift, 0);
  s.pt(ac + 4.5, drift, 0);
  s.pt(ac + 9, drift, 0);
  return s.finish({ a: ac + 9, l: drift, yaw: 0 });
}

/** A barrel roll: one helical turn around the line with gates a quarter turn apart, each rolled so its top faces the axis. */
function corkscrew(d: number, rng: Rng, o: FeatureOptions): FeatureShape {
  const s = new Shaper('corkscrew');
  const [lo, hi] = FEATURE_RULES.corkscrew.gates;
  const n = Math.min(Math.max(o.gates ?? rng.int(3, 4), lo), hi);
  const r = lerp(3.2, 2.6, d);
  const pitchLen = lerp(56, 44, d) * rng.range(0.95, 1.05);
  const c = pitchLen / TAU;
  const spin = rng.sign();
  const spec = plainSpec(['square', 'arch'], d, rng);
  const clear = rng.range(0.8, 1.5) + (o.raise ?? 0);
  const a0 = 8;
  const at = (phi: number): LocalPt => ({ a: a0 + c * (phi + Math.PI / 2), l: spin * r * Math.cos(phi), y: r * Math.sin(phi) });
  s.pt(0, 0, -r);
  s.pt(4, 0, -r);
  for (let k = 0; k <= 8; k++) {
    const phi = -Math.PI / 2 + (k * Math.PI) / 4;
    const p = at(phi);
    if (k % 2 === 0 && k / 2 < n) {
      const roll = Math.atan2(-spin * Math.cos(phi), -Math.sin(phi));
      const yaw = Math.atan2(spin * r * Math.sin(phi), c);
      s.gate({ ...p, spec, yaw, pitch: 0, roll, clear, group: 0 });
    } else s.pt(p.a, p.l, p.y);
  }
  const end = at((3 * Math.PI) / 2);
  s.pt(end.a + 6, 0, -r);
  return s.finish({ a: end.a + 6, l: 0, yaw: 0 });
}

/** Over a hill: a climbing gate pitched up (optional), a crest, a dive gate pitched steeply down, then the pull-out. */
function dive(d: number, rng: Rng, o: FeatureOptions): FeatureShape {
  const s = new Shaper('dive');
  const [lo, hi] = FEATURE_RULES.dive.gates;
  const n = Math.min(Math.max(o.gates ?? (rng.chance(0.6) ? 2 : 1), lo), hi);
  const up = lerp(0.5, 0.75, d) * rng.range(0.95, 1.05);
  const down = lerp(0.8, 1.05, d) * rng.range(0.95, 1.05);
  const rv = 10 * rng.range(1, 1.15);
  const rc = 10 * rng.range(1, 1.1);
  const spec = gateSpec('dive', d, rng);
  const lineAgl = rng.range(1.6, 2.6) + (o.raise ?? 0);
  // The descent ends at the height the climb started from: the climb straight is sized to match.
  let s2 = 9;
  const fall = (rc + rv) * (1 - Math.cos(down));
  const archUp = (rv + rc) * (1 - Math.cos(up));
  let s1 = (fall + s2 * Math.sin(down) - archUp) / Math.sin(up);
  if (s1 < 8) {
    s1 = 8;
    s2 = (archUp + s1 * Math.sin(up) - fall) / Math.sin(down);
  }
  s.pt(0, 0, 0);
  const p = new Profile(s, 0, 0);
  p.straight(3);
  p.arc(rv, up);
  if (n === 2) {
    p.straight(s1 / 2, 4, false);
    s.gate({ a: p.a, l: 0, y: p.y, spec, yaw: 0, pitch: up, roll: 0, clear: 0.5, group: 0 });
    p.straight(s1 / 2);
  } else p.straight(s1);
  p.arc(rc, -(up + down));
  p.straight(s2 / 2, 4, false);
  s.gate({ a: p.a, l: 0, y: p.y, spec: n === 2 ? gateSpec('dive', d, rng) : spec, yaw: 0, pitch: -down, roll: 0, clear: 0.5, group: 0 });
  p.straight(s2 / 2);
  p.arc(rv, down);
  p.straight(6, 3);
  return s.finish({ a: p.a, l: 0, yaw: 0 }, { lineAgl });
}

/** A flat ring flown straight down: climb, tip over into a vertical drop through the ring, pull out below it. */
function drop(d: number, rng: Rng, o: FeatureOptions): FeatureShape {
  const s = new Shaper('drop');
  const r1 = lerp(5, 4.3, d) * rng.range(0.97, 1.03);
  const r2 = lerp(5, 4.3, d) * rng.range(0.97, 1.03);
  const above = 1.5;
  const below = 1.5;
  const spec = gateSpec('drop', d, rng);
  // `ring` is the clearance of the ring's lowest rim point; the centre stands higher over sloping ground, so the top is kept a metre down.
  const ring = Math.min(Math.max(below + r2 + rng.range(2.5, 4) + (o.raise ?? 0), DROP_HEIGHT[0]), DROP_HEIGHT[1] - DROP_SLOPE_ROOM);
  const low = -(below + r2);
  const top = above + r1;
  const climb = 0.6;
  const rr = 9;
  s.pt(0, 0, low);
  const p = new Profile(s, 0, low);
  p.straight(3);
  p.arc(rr, climb);
  p.straight((top - low - 2 * rr * (1 - Math.cos(climb))) / Math.sin(climb), 5);
  p.arc(rr, -climb);
  p.straight(2);
  p.arc(r1, -Math.PI / 2, 2);
  p.straight(above, 4, false);
  s.gate({ a: p.a, l: 0, y: 0, spec, yaw: 0, pitch: DROP_PITCH, roll: 0, clear: ring, group: 0 });
  p.straight(below);
  p.arc(r2, Math.PI / 2, 2);
  p.straight(6, 3);
  return s.finish({ a: p.a, l: 0, yaw: 0 });
}

/** Flags (or gates) alternating either side of a straight; the line weaves through them. */
function slalom(d: number, rng: Rng, o: FeatureOptions): FeatureShape {
  const s = new Shaper('slalom');
  const [lo, hi] = FEATURE_RULES.slalom.gates;
  const n = Math.min(Math.max(o.gates ?? rng.int(3, 5), lo), hi);
  const step = lerp(18, 15, d) * rng.range(0.96, 1.04);
  const amp = Math.min(rng.range(2, 3.2), (step * step) / (8 * Math.PI * Math.PI));
  const side = rng.sign();
  const kind: GateKind = rng.chance(0.7) ? 'flag' : 'square';
  // Lead-in and run-out of most of a step, so the line eases into the weave instead of jinking sideways at the first gate.
  const lead = 0.6 * step + 4;
  s.pt(0, 0, 0);
  let last = 0;
  for (let k = 0; k < n; k++) {
    last = lead + k * step;
    const spec = gateSpec(kind, d, rng);
    s.gate({ a: last, l: side * (k % 2 === 0 ? amp : -amp), y: 0, spec, yaw: 0, pitch: 0, roll: 0, clear: kind === 'flag' ? rng.range(0.4, 0.7) : rng.range(0.5, 1) + (o.raise ?? 0), group: k });
  }
  s.pt(last + lead, 0, 0);
  return s.finish({ a: last + lead, l: 0, yaw: 0 });
}

/** One or two tunnels in a row, flown low and dead straight through their sleeves. */
function tunnel(d: number, rng: Rng, o: FeatureOptions): FeatureShape {
  const s = new Shaper('tunnel');
  const [lo, hi] = FEATURE_RULES.tunnel.gates;
  const n = Math.min(Math.max(o.gates ?? (rng.chance(0.35) ? 2 : 1), lo), hi);
  const spec = gateSpec('tunnel', d, rng);
  const depth = TUNNEL_DEPTH * rng.range(1, 1.5);
  const gap = rng.range(6, 8);
  const clear = rng.range(0.45, 0.6);
  s.pt(0, 0, 0);
  s.pt(4, 0, 0);
  let a = 8;
  for (let k = 0; k < n; k++) {
    s.gate({ a, l: 0, y: 0, spec, yaw: 0, pitch: 0, roll: 0, clear, group: 0, depth });
    s.pt(a + depth / 2, 0, 0);
    s.pt(a + depth, 0, 0);
    if (k < n - 1) {
      s.pt(a + depth + gap / 2, 0, 0);
      a += depth + gap;
    }
  }
  s.pt(a + depth + 4, 0, 0);
  s.pt(a + depth + 8, 0, 0);
  return s.finish({ a: a + depth + 8, l: 0, yaw: 0 }, { flat: TUNNEL_FLAT });
}

/** A window cut in a solid wall, approached and left dead straight. */
function windowGate(d: number, rng: Rng, o: FeatureOptions): FeatureShape {
  const s = new Shaper('window');
  const spec = gateSpec('window', d, rng);
  s.pt(0, 0, 0);
  s.pt(3.5, 0, 0);
  s.gate({ a: 7, l: 0, y: 0, spec, yaw: 0, pitch: 0, roll: 0, clear: WINDOW_MIN_SILL + rng.range(0.05, 0.6) + (o.raise ?? 0), group: 0 });
  s.pt(10.5, 0, 0);
  s.pt(14, 0, 0);
  return s.finish({ a: 14, l: 0, yaw: 0 });
}

/** One to three low, wide hurdles in a row, each standing on its own ground. */
function hurdles(d: number, rng: Rng, o: FeatureOptions): FeatureShape {
  const s = new Shaper('hurdle');
  const [lo, hi] = FEATURE_RULES.hurdle.gates;
  const n = Math.min(Math.max(o.gates ?? rng.int(1, 3), lo), hi);
  const step = rng.range(13, 16);
  const spec = gateSpec('hurdle', d, rng);
  s.pt(0, 0, 0);
  s.pt(2.5, 0, 0);
  let a = 6;
  for (let k = 0; k < n; k++) {
    a = 6 + k * step;
    s.gate({ a, l: 0, y: 0, spec, yaw: 0, pitch: 0, roll: 0, clear: rng.range(0.45, 0.58), group: k });
    s.pt(a + 3.5, 0, 0);
  }
  s.pt(a + 8, 0, 0);
  return s.finish({ a: a + 8, l: 0, yaw: 0 });
}

/** What a hairpin turns around. */
export type HairpinPylon = 'pillar' | 'wall' | 'flagpole';

/** The shape of `feature` in its entry frame. Deterministic in `rng`. */
export function featureShape(feature: TrackFeature, difficulty: number, rng: Rng, o: FeatureOptions = {}, pylon: HairpinPylon = 'flagpole'): FeatureShape {
  const d = Math.min(Math.max(difficulty, 0), 1);
  switch (feature) {
    case 'split-s':
      return splitS(d, rng, o);
    case 'power-loop':
      return powerLoop(d, rng, o);
    case 'corkscrew':
      return corkscrew(d, rng, o);
    case 'ladder':
      return ladder(d, rng, o);
    case 'dive':
      return dive(d, rng, o);
    case 'drop':
      return drop(d, rng, o);
    case 'slalom':
      return slalom(d, rng, o);
    case 'hairpin':
      return hairpin(d, rng, o, pylon);
    case 'tunnel':
      return tunnel(d, rng, o);
    case 'window':
      return windowGate(d, rng, o);
    case 'hurdle':
      return hurdles(d, rng, o);
  }
}

/** Mirror image of a shape across its entry line (left and right swapped): turns, drifts, rolls and yaws change sign. */
export function mirrorShape(f: FeatureShape): FeatureShape {
  // Negated without making -0 out of 0, so a mirrored upright gate keeps roll 0 exactly.
  const neg = (v: number): number => (v === 0 ? 0 : -v);
  const pt = (p: LocalPt): LocalPt => ({ a: p.a, l: neg(p.l), y: p.y });
  const prop = (p: FeatureProp): FeatureProp => {
    const out: FeatureProp = { ...p, l: neg(p.l), yaw: neg(p.yaw) };
    if (p.alt) out.alt = prop(p.alt);
    return out;
  };
  return {
    ...f,
    gates: f.gates.map((g) => ({ ...g, l: neg(g.l), yaw: neg(g.yaw), roll: neg(g.roll), pre: g.pre.map(pt), post: g.post.map(pt) })),
    exit: { a: f.exit.a, l: neg(f.exit.l), yaw: neg(f.exit.yaw) },
    line: f.line.map(pt),
    props: f.props.map(prop),
  };
}

/** World (x, z) of entry-frame point (a, l) for an entry at (x, z) heading `heading`. */
export function localToWorld(x: number, z: number, heading: number, a: number, l: number): [number, number] {
  const s = Math.sin(heading);
  const c = Math.cos(heading);
  return [x - a * s + l * c, z - a * c - l * s];
}

/**
 * Puts a feature on the map: its entry at (x, z) heading `heading`, groups numbered from `groupBase`. Returns the layout gates
 * (fixed axes, rigid groups, control points) and the props it asks for.
 */
export function placeFeature(f: FeatureShape, x: number, z: number, heading: number, groupBase: number): { gates: LayoutGate[]; props: LayoutProp[] } {
  const ctrl = (p: LocalPt): FeatureCtrl => {
    const [wx, wz] = localToWorld(x, z, heading, p.a, p.l);
    return { x: wx, z: wz, dy: p.y };
  };
  const gates: LayoutGate[] = f.gates.map((g) => {
    const [wx, wz] = localToWorld(x, z, heading, g.a, g.l);
    const out: LayoutGate = {
      x: wx,
      z: wz,
      spec: g.spec,
      clear: g.clear,
      roll: g.roll,
      fixed: { yaw: heading + g.yaw, pitch: g.pitch },
      feature: f.feature,
      group: groupBase + g.group,
      dy: g.y,
      pre: g.pre.map(ctrl),
      post: g.post.map(ctrl),
    };
    if (g.depth !== undefined) out.depth = g.depth;
    return out;
  });
  const prop = (p: FeatureProp): LayoutProp => {
    const [wx, wz] = localToWorld(x, z, heading, p.a, p.l);
    const out: LayoutProp = { kind: p.kind, x: wx, z: wz, yaw: heading + p.yaw, size: p.size };
    if (p.alt) out.alt = prop(p.alt);
    return out;
  };
  return { gates, props: f.props.map(prop) };
}

/**
 * One manoeuvre as layout gates: shaped by `rng` and placed with its entry at (x, z) heading `heading`. `raise` adds clearance
 * to every gate (a higher manoeuvre).
 */
export function buildFeature(
  feature: TrackFeature,
  x: number,
  z: number,
  heading: number,
  difficulty: number,
  rng: Rng,
  o: FeatureOptions = {},
  groupBase = 0,
): { gates: LayoutGate[]; props: LayoutProp[]; shape: FeatureShape } {
  const shape = featureShape(feature, difficulty, rng, o);
  return { ...placeFeature(shape, x, z, heading, groupBase), shape };
}
