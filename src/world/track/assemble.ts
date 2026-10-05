/**
 * Layout -> gates + smooth path. The gates' xz positions come from the layout; everything else is solved here by iterating
 * spline -> gate yaw (tangent) -> gate height (clearance for the tilted opening) -> spline until it settles, then lifting the
 * path where it would scrape the ground (waypoints, or raising the nearest gate) and relaxing gates at curvature peaks.
 *
 * Feature gates (LayoutGate.fixed / group) keep the axis the layout gave them. A feature group is rigid: its gates and control
 * points keep their positions and height differences, its base height is the lowest that gives every member its clearance, and
 * the lift pass raises the whole group, so a split-S or a ladder is never squashed or pulled apart.
 */
import type { TrackGate, Vec3 } from '../../contracts';
import { gateClearance, gateHeightForClearance } from './clearance';
import { DROP_HEIGHT, HURDLE_SILL } from './kindGeometry';
import type { FeatureCtrl, Layout, LayoutCtx } from './layout';
import { nearest2D, siteOk } from './layout';
import { buildSpline, pathCurvature, pathTangent, yawOf, type SplinePath } from './spline';
import { targetTurnRadius, type GateSpec } from './styles';

/** Smallest radius, and shortest arc length, of the pull-in and pull-out arcs around a dive gate (the path is an S-curve through it along its pitched axis). */
const DIVE_R = 11;
const DIVE_ARC = 13;

/**
 * Around a hurdle (HURDLE_BEFORE metres of path before it to HURDLE_AFTER after it) the line flies low by design: the lift pass
 * only keeps it HURDLE_LINE_AGL above the ground there instead of the style's liftAgl, so it never raises a hurdle off its sill.
 */
const HURDLE_LINE_AGL = 0.9;
const HURDLE_BEFORE = 8;
const HURDLE_AFTER = 12;
/** Margins inside the contract's hurdle sill and drop height ranges that the lift pass never crosses. */
const SILL_MARGIN = 0.01;
const DROP_MARGIN = 0.05;
/** Nearest a waypoint added beside a hurdle or drop at its limit may come to another control point, metres. */
const WAY_MIN_GAP = 2.5;

/**
 * [along, up] offsets from a pitched gate of the two control points on its pull-in arc, far one first (the pull-out arc is the
 * point mirror). A dive (pitch < 0) is pulled into from above; a climb (pitch > 0) from below.
 */
function diveArc(pitch: number): [number, number][] {
  const th = Math.max(Math.abs(pitch), 0.05);
  const r = Math.max(DIVE_R, DIVE_ARC / th);
  const up = pitch > 0 ? -1 : 1;
  const at = (phi: number): [number, number] => [r * (Math.sin(phi) - Math.sin(th)), up * r * (Math.cos(phi) - Math.cos(th))];
  return [at(0), at(th / 2)];
}

interface GateState {
  x: number;
  z: number;
  y: number;
  yaw: number;
  pitch: number;
  roll: number;
  spec: GateSpec;
  clear: number;
  /** Extra height added by the lift loop. */
  lift: number;
  /** `lift` when heights() last ran (the lift added since is not in the TrackGate yet). */
  seen: number;
  /** The travel axis is fixed (dive or feature gate): never re-oriented or relaxed. */
  fixed: boolean;
  /** Pulled through along its axis by diveArc control points (a dive gate, or a fixed gate outside any group). */
  arc: boolean;
  /** Feature group index, or -1. */
  group: number;
  dy: number;
  pre: FeatureCtrl[];
  post: FeatureCtrl[];
  x0: number;
  z0: number;
}

interface Group {
  /** Lowest base height that gives every member its clearance (constant: members never move or turn). */
  base: number;
  lift: number;
  seen: number;
}

interface Way {
  x: number;
  y: number;
  z: number;
  /** Gate index this waypoint follows along the path, and its arc-length offset from that gate (only used for ordering). */
  gap: number;
  off: number;
}

const GATE = 0;
const PRE = 1;
const POST = 2;
const WAY = 3;

const NONE: FeatureCtrl[] = [];

export interface Assembled {
  gates: TrackGate[];
  path: Vec3[];
  length: number;
  closed: boolean;
}

class Assembler {
  readonly gs: GateState[];
  readonly tg: TrackGate[];
  readonly groups: Group[] = [];
  ways: Way[] = [];
  sp!: SplinePath;
  private role: number[] = [];
  private ref: number[] = [];
  private gateCtrl: number[] = [];
  /** Layouts with bends re-derive every waypoint's ordering offset from the current spline (bends and lift points interleave). */
  private readonly syncWays: boolean;

  constructor(
    readonly c: LayoutCtx,
    readonly layout: Layout,
  ) {
    this.gs = layout.gates.map((g) => {
      const axis = g.dive ?? g.fixed;
      const group = g.group ?? -1;
      return {
        x: g.x,
        z: g.z,
        y: 0,
        yaw: axis ? axis.yaw : 0,
        pitch: axis ? axis.pitch : 0,
        roll: g.roll,
        spec: g.spec,
        clear: g.clear,
        lift: 0,
        seen: 0,
        fixed: !!axis,
        arc: !!g.dive || (!!g.fixed && group < 0),
        group,
        dy: g.dy ?? 0,
        pre: g.pre ?? NONE,
        post: g.post ?? NONE,
        x0: g.x,
        z0: g.z,
      };
    });
    for (const g of this.gs) {
      while (g.group >= this.groups.length) this.groups.push({ base: -Infinity, lift: 0, seen: 0 });
    }
    this.tg = this.gs.map((g, i) => {
      const t: TrackGate = { index: i, kind: g.spec.kind, pos: [g.x, 0, g.z], yaw: 0, roll: g.roll, pitch: g.pitch, width: g.spec.width, height: g.spec.height };
      const src = layout.gates[i];
      if (src.feature !== undefined) t.feature = src.feature;
      if (src.depth !== undefined) t.depth = src.depth;
      return t;
    });
    this.syncWays = (layout.bends?.length ?? 0) > 0;
    for (const b of layout.bends ?? []) {
      this.ways.push({ x: b.x, y: c.sampler.heightAt(b.x, b.z) + b.agl, z: b.z, gap: b.gap, off: b.order });
    }
  }

  private get n(): number {
    return this.gs.length;
  }

  /** First guess of every gate's yaw from its neighbours, before any spline exists. */
  initOrientation(): void {
    const n = this.n;
    const closed = this.layout.closed;
    for (let i = 0; i < n; i++) {
      const g = this.gs[i];
      if (g.fixed) continue;
      const a = this.gs[closed ? (i + n - 1) % n : Math.max(i - 1, 0)];
      const b = this.gs[closed ? (i + 1) % n : Math.min(i + 1, n - 1)];
      g.yaw = yawOf(b.x - a.x, b.z - a.z);
    }
  }

  /** Recomputes every gate's height so its lowest opening edge is `clear + lift` above the ground, for its current orientation. */
  heights(): void {
    for (const grp of this.groups) {
      grp.base = -Infinity;
      grp.seen = grp.lift;
    }
    for (let i = 0; i < this.n; i++) {
      const g = this.gs[i];
      const t = this.tg[i];
      g.seen = g.lift;
      t.yaw = g.yaw;
      t.pitch = g.pitch;
      if (g.group >= 0) {
        const grp = this.groups[g.group];
        grp.base = Math.max(grp.base, gateHeightForClearance(t, this.c.sampler, g.x, g.z, g.clear) - g.dy);
        continue;
      }
      g.y = gateHeightForClearance(t, this.c.sampler, g.x, g.z, g.clear + g.lift);
      t.pos[0] = g.x;
      t.pos[1] = g.y;
      t.pos[2] = g.z;
    }
    for (let i = 0; i < this.n; i++) {
      const g = this.gs[i];
      if (g.group < 0) continue;
      const t = this.tg[i];
      g.y = this.groupY(g) + g.dy;
      t.pos[0] = g.x;
      t.pos[1] = g.y;
      t.pos[2] = g.z;
    }
  }

  private groupY(g: GateState): number {
    const grp = this.groups[g.group];
    return grp.base + grp.lift;
  }

  build(): void {
    const n = this.n;
    const closed = this.layout.closed;
    const gaps = closed ? n : n - 1;
    const byGap: Way[][] = [];
    for (let i = 0; i < gaps; i++) byGap.push([]);
    for (const w of this.ways) byGap[w.gap].push(w);
    const ctrl: Vec3[] = [];
    this.role.length = 0;
    this.ref.length = 0;
    const push = (p: Vec3, role: number, ref: number): void => {
      ctrl.push(p);
      this.role.push(role);
      this.ref.push(ref);
    };
    for (let i = 0; i < n; i++) {
      const g = this.gs[i];
      if (g.group >= 0) {
        const base = this.groupY(g);
        for (const p of g.pre) push([p.x, base + p.dy, p.z], PRE, i);
        this.gateCtrl[i] = ctrl.length;
        push([g.x, g.y, g.z], GATE, i);
        for (const p of g.post) push([p.x, base + p.dy, p.z], POST, i);
      } else {
        const fx = -Math.sin(g.yaw);
        const fz = -Math.cos(g.yaw);
        const arc = g.arc ? diveArc(g.pitch) : [];
        const put = (o: [number, number], sign: number, role: number): void => push([g.x + fx * o[0] * sign, g.y + o[1] * sign, g.z + fz * o[0] * sign], role, i);
        for (const o of arc) put(o, 1, PRE);
        this.gateCtrl[i] = ctrl.length;
        push([g.x, g.y, g.z], GATE, i);
        for (let k = arc.length - 1; k >= 0; k--) put(arc[k], -1, POST);
      }
      if (i < gaps) {
        byGap[i].sort((a, b) => a.off - b.off);
        for (const w of byGap[i]) push([w.x, w.y, w.z], WAY, this.ways.indexOf(w));
      }
    }
    this.sp = buildSpline(ctrl, closed, 1);
    if (this.syncWays) {
      for (let k = 0; k < ctrl.length; k++) {
        if (this.role[k] !== WAY) continue;
        const w = this.ways[this.ref[k]];
        w.off = this.sp.knotS[k] - this.sp.knotS[this.gateCtrl[w.gap]];
      }
    }
  }

  private gateIndexOnPath(i: number): number {
    return Math.round(this.sp.knotS[this.gateCtrl[i]] / this.sp.spacing) % this.sp.points.length;
  }

  /** Gate yaw = heading of the path tangent at the gate (dive and feature gates keep their fixed axis). */
  orient(): void {
    const t: Vec3 = [0, 0, 0];
    for (let i = 0; i < this.n; i++) {
      const g = this.gs[i];
      if (g.fixed) continue;
      pathTangent(this.sp.points, this.gateIndexOnPath(i), this.layout.closed, t);
      if (Math.hypot(t[0], t[2]) > 0.2) g.yaw = yawOf(t[0], t[2]);
    }
  }

  /** Raises or adds waypoints where the path is closer than `liftAgl` to the ground; returns the number of fixes. */
  liftPass(): number {
    const pts = this.sp.points;
    const need = this.lowLine();
    const ground = this.c.sampler;
    let fixes = 0;
    let i = 0;
    while (i < pts.length) {
      let agl = pts[i][1] - ground.heightAt(pts[i][0], pts[i][2]);
      if (agl >= need(i)) {
        i++;
        continue;
      }
      let worst = i;
      let worstGap = need(i) - agl;
      while (i < pts.length && agl < need(i)) {
        if (need(i) - agl > worstGap) {
          worstGap = need(i) - agl;
          worst = i;
        }
        i++;
        if (i < pts.length) agl = pts[i][1] - ground.heightAt(pts[i][0], pts[i][2]);
      }
      this.fix(worst, worstGap + 0.1);
      fixes++;
    }
    return fixes;
  }

  /** The height the lift pass keeps each path sample above the ground: liftAgl, or HURDLE_LINE_AGL around a hurdle. */
  private lowLine(): (sample: number) => number {
    const lift = this.c.spec.liftAgl;
    if (lift <= HURDLE_LINE_AGL || !this.gs.some((g) => g.spec.kind === 'hurdle')) return () => lift;
    const m = this.sp.points.length;
    const low = new Uint8Array(m);
    const before = Math.ceil(HURDLE_BEFORE / this.sp.spacing);
    const after = Math.ceil(HURDLE_AFTER / this.sp.spacing);
    for (let i = 0; i < this.n; i++) {
      if (this.gs[i].spec.kind !== 'hurdle') continue;
      const at = this.gateIndexOnPath(i);
      for (let o = -before; o <= after; o++) {
        const j = this.layout.closed ? (((at + o) % m) + m) % m : at + o;
        if (j >= 0 && j < m) low[j] = 1;
      }
    }
    return (s) => (low[s] ? HURDLE_LINE_AGL : lift);
  }

  /**
   * How much higher a gate (or its whole group) may still go: a hurdle keeps its sill at most HURDLE_SILL[1] and a drop ring its
   * centre at most DROP_HEIGHT[1] above the ground. Infinity for the other kinds.
   */
  private headroom(g: GateState): number {
    const members = g.group >= 0 ? this.gs.filter((h) => h.group === g.group) : [g];
    const pending = g.group >= 0 ? this.groups[g.group].lift - this.groups[g.group].seen : g.lift - g.seen;
    let room = Infinity;
    for (const h of members) {
      const t = this.tg[this.gs.indexOf(h)];
      if (h.spec.kind === 'hurdle') room = Math.min(room, HURDLE_SILL[1] - SILL_MARGIN - gateClearance(t, this.c.sampler));
      else if (h.spec.kind === 'drop') room = Math.min(room, DROP_HEIGHT[1] - DROP_MARGIN - (t.pos[1] - this.c.sampler.heightAt(t.pos[0], t.pos[2])));
    }
    return Math.max(room - pending, 0);
  }

  private fix(sample: number, deficit: number): void {
    const s = sample * this.sp.spacing;
    const total = this.sp.length;
    let nearest = 0;
    let nearestD = Infinity;
    for (let k = 0; k < this.sp.knotS.length; k++) {
      let d = Math.abs(this.sp.knotS[k] - s);
      if (this.layout.closed) d = Math.min(d, total - d);
      if (d < nearestD) {
        nearestD = d;
        nearest = k;
      }
    }
    if (nearestD <= 6) {
      if (this.role[nearest] === WAY) this.ways[this.ref[nearest]].y += deficit;
      else {
        const g = this.gs[this.ref[nearest]];
        // A hurdle or drop at its limit is raised only as far as it may go; a waypoint lifts the rest of the line where one fits.
        const up = Math.min(deficit, this.headroom(g));
        if (g.group >= 0) this.groups[g.group].lift += up;
        else g.lift += up;
        if (up < deficit && nearestD >= WAY_MIN_GAP && this.betweenGates(s)) this.addWay(sample, s, deficit - up);
      }
      return;
    }
    this.addWay(sample, s, deficit);
  }

  private addWay(sample: number, s: number, deficit: number): void {
    let gap = 0;
    for (let i = 0; i < this.n; i++) if (this.sp.knotS[this.gateCtrl[i]] <= s) gap = i;
    const p = this.sp.points[sample];
    this.ways.push({ x: p[0], y: p[1] + deficit, z: p[2], gap, off: s - this.sp.knotS[this.gateCtrl[gap]] });
  }

  /**
   * True when arc length `s` lies where build() puts waypoints: after a gate and its own control points, before the next gate's
   * (so a new waypoint keeps the control points in order).
   */
  private betweenGates(s: number): boolean {
    const knots = this.sp.knotS;
    const m = knots.length;
    let k = -1;
    for (let j = 0; j < m; j++) if (knots[j] <= s) k = j;
    if (k < 0 || (k === m - 1 && !this.layout.closed)) return false;
    const next = (k + 1) % m;
    return this.role[k] !== PRE && this.role[next] !== POST;
  }

  /** Pulls gates at curvature peaks toward the midpoint of their neighbours (Laplacian smoothing) within site limits. */
  relaxPass(): number {
    if (this.layout.relax === false) return 0;
    const n = this.n;
    const closed = this.layout.closed;
    const kappa = pathCurvature(this.sp.points, closed, 2);
    const limit = 1 / Math.max(targetTurnRadius(this.c.difficulty), 7);
    let moved = 0;
    for (let i = closed ? 0 : 1; i < (closed ? n : n - 1); i++) {
      const g = this.gs[i];
      if (g.fixed) continue;
      const centre = this.gateIndexOnPath(i);
      let peak = 0;
      for (let o = -8; o <= 8; o++) {
        const j = closed ? (centre + o + kappa.length) % kappa.length : Math.min(Math.max(centre + o, 0), kappa.length - 1);
        if (kappa[j] > peak) peak = kappa[j];
      }
      if (peak <= limit) continue;
      const a = this.gs[(i + n - 1) % n];
      const b = this.gs[(i + 1) % n];
      const f = Math.min(0.15 + 0.5 * (peak / limit - 1), 0.4);
      const x = g.x + ((a.x + b.x) / 2 - g.x) * f;
      const z = g.z + ((a.z + b.z) / 2 - g.z) * f;
      if (Math.hypot(x - g.x0, z - g.z0) > 14 || !siteOk(this.c, x, z, false) || nearest2D(this.gs, x, z, i) < 14) continue;
      g.x = x;
      g.z = z;
      moved++;
    }
    return moved;
  }

  result(): Assembled {
    return { gates: this.tg.map((t) => ({ ...t, pos: [t.pos[0], t.pos[1], t.pos[2]] as Vec3 })), path: this.sp.points, length: this.sp.length, closed: this.layout.closed };
  }
}

/** Turns a layout into gates and a 1 m path, or null when the path cannot be kept off the ground. */
export function assemble(c: LayoutCtx, layout: Layout): Assembled | null {
  if (layout.gates.length < (layout.closed ? 3 : 2)) return null;
  const a = new Assembler(c, layout);
  a.initOrientation();
  a.heights();
  for (let it = 0; it < 3; it++) {
    a.build();
    a.orient();
    a.heights();
  }
  let settled = false;
  for (let round = 0; round < 12 && !settled; round++) {
    a.build();
    const fixes = a.liftPass() + a.relaxPass();
    settled = fixes === 0;
    a.orient();
    a.heights();
  }
  a.build();
  a.orient();
  a.heights();
  a.build();
  return a.liftPass() === 0 ? a.result() : null;
}
