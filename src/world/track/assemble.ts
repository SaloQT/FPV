/**
 * Layout -> gates + smooth path. The gates' xz positions come from the layout; everything else is solved here by iterating
 * spline -> gate yaw (tangent) -> gate height (clearance for the tilted opening) -> spline until it settles, then lifting the
 * path where it would scrape the ground (waypoints, or raising the nearest gate) and relaxing gates at curvature peaks.
 */
import type { TrackGate, Vec3 } from '../../contracts';
import { gateHeightForClearance } from './clearance';
import type { Layout, LayoutCtx } from './layout';
import { nearest2D, siteOk } from './layout';
import { buildSpline, pathCurvature, pathTangent, yawOf, type SplinePath } from './spline';
import { targetTurnRadius, type GateSpec } from './styles';

/** Smallest radius, and shortest arc length, of the pull-in and pull-out arcs around a dive gate (the path is an S-curve through it along its pitched axis). */
const DIVE_R = 11;
const DIVE_ARC = 13;

/** [along, up] offsets from a dive gate of the two control points on its pull-in arc, far one first (the pull-out arc is the point mirror). */
function diveArc(pitch: number): [number, number][] {
  const th = Math.max(Math.abs(pitch), 0.05);
  const r = Math.max(DIVE_R, DIVE_ARC / th);
  const at = (phi: number): [number, number] => [r * (Math.sin(phi) - Math.sin(th)), r * (Math.cos(phi) - Math.cos(th))];
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
  dive: boolean;
  x0: number;
  z0: number;
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

export interface Assembled {
  gates: TrackGate[];
  path: Vec3[];
  length: number;
  closed: boolean;
}

class Assembler {
  readonly gs: GateState[];
  readonly tg: TrackGate[];
  ways: Way[] = [];
  sp!: SplinePath;
  private role: number[] = [];
  private ref: number[] = [];
  private gateCtrl: number[] = [];

  constructor(
    readonly c: LayoutCtx,
    readonly layout: Layout,
  ) {
    this.gs = layout.gates.map((g) => ({
      x: g.x,
      z: g.z,
      y: 0,
      yaw: g.dive ? g.dive.yaw : 0,
      pitch: g.dive ? g.dive.pitch : 0,
      roll: g.roll,
      spec: g.spec,
      clear: g.clear,
      lift: 0,
      dive: !!g.dive,
      x0: g.x,
      z0: g.z,
    }));
    this.tg = this.gs.map((g, i) => ({ index: i, kind: g.spec.kind, pos: [g.x, 0, g.z], yaw: 0, roll: g.roll, pitch: g.pitch, width: g.spec.width, height: g.spec.height }));
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
      if (g.dive) continue;
      const a = this.gs[closed ? (i + n - 1) % n : Math.max(i - 1, 0)];
      const b = this.gs[closed ? (i + 1) % n : Math.min(i + 1, n - 1)];
      g.yaw = yawOf(b.x - a.x, b.z - a.z);
    }
  }

  /** Recomputes every gate's height so its lowest opening edge is `clear + lift` above the ground, for its current orientation. */
  heights(): void {
    for (let i = 0; i < this.n; i++) {
      const g = this.gs[i];
      const t = this.tg[i];
      t.yaw = g.yaw;
      t.pitch = g.pitch;
      g.y = gateHeightForClearance(t, this.c.sampler, g.x, g.z, g.clear + g.lift);
      t.pos[0] = g.x;
      t.pos[1] = g.y;
      t.pos[2] = g.z;
    }
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
      const fx = -Math.sin(g.yaw);
      const fz = -Math.cos(g.yaw);
      const arc = g.dive ? diveArc(g.pitch) : [];
      const put = (o: [number, number], sign: number, role: number): void => push([g.x + fx * o[0] * sign, g.y + o[1] * sign, g.z + fz * o[0] * sign], role, i);
      for (const o of arc) put(o, 1, PRE);
      this.gateCtrl[i] = ctrl.length;
      push([g.x, g.y, g.z], GATE, i);
      for (let k = arc.length - 1; k >= 0; k--) put(arc[k], -1, POST);
      if (i < gaps) {
        byGap[i].sort((a, b) => a.off - b.off);
        for (const w of byGap[i]) push([w.x, w.y, w.z], WAY, this.ways.indexOf(w));
      }
    }
    this.sp = buildSpline(ctrl, closed, 1);
  }

  private gateIndexOnPath(i: number): number {
    return Math.round(this.sp.knotS[this.gateCtrl[i]] / this.sp.spacing) % this.sp.points.length;
  }

  /** Gate yaw = heading of the path tangent at the gate (dive gates keep their fixed axis). */
  orient(): void {
    const t: Vec3 = [0, 0, 0];
    for (let i = 0; i < this.n; i++) {
      const g = this.gs[i];
      if (g.dive) continue;
      pathTangent(this.sp.points, this.gateIndexOnPath(i), this.layout.closed, t);
      if (Math.hypot(t[0], t[2]) > 0.2) g.yaw = yawOf(t[0], t[2]);
    }
  }

  /** Raises or adds waypoints where the path is closer than `liftAgl` to the ground; returns the number of fixes. */
  liftPass(): number {
    const pts = this.sp.points;
    const need = this.c.spec.liftAgl;
    const ground = this.c.sampler;
    let fixes = 0;
    let i = 0;
    while (i < pts.length) {
      let agl = pts[i][1] - ground.heightAt(pts[i][0], pts[i][2]);
      if (agl >= need) {
        i++;
        continue;
      }
      let worst = i;
      let worstAgl = agl;
      while (i < pts.length && agl < need) {
        if (agl < worstAgl) {
          worstAgl = agl;
          worst = i;
        }
        i++;
        if (i < pts.length) agl = pts[i][1] - ground.heightAt(pts[i][0], pts[i][2]);
      }
      this.fix(worst, need - worstAgl + 0.1);
      fixes++;
    }
    return fixes;
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
      else this.gs[this.ref[nearest]].lift += deficit;
      return;
    }
    let gap = 0;
    for (let i = 0; i < this.n; i++) if (this.sp.knotS[this.gateCtrl[i]] <= s) gap = i;
    const p = this.sp.points[sample];
    this.ways.push({ x: p[0], y: p[1] + deficit, z: p[2], gap, off: s - this.sp.knotS[this.gateCtrl[gap]] });
  }

  /** Pulls gates at curvature peaks toward the midpoint of their neighbours (Laplacian smoothing) within site limits. */
  relaxPass(): number {
    const n = this.n;
    const closed = this.layout.closed;
    const kappa = pathCurvature(this.sp.points, closed, 2);
    const limit = 1 / Math.max(targetTurnRadius(this.c.difficulty), 7);
    let moved = 0;
    for (let i = closed ? 0 : 1; i < (closed ? n : n - 1); i++) {
      const g = this.gs[i];
      if (g.dive) continue;
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
