import { describe, expect, it } from 'vitest';
import type { TrackData, TrackGate, Vec3 } from '../../contracts';
import { PATH_AHEAD, PATH_MAX_STEP, packPath, pathArc, pathDelta, pathSearch, resamplePath, type PackedPath } from './pathProgress';

function gate(index: number, pos: Vec3, yaw: number, extra: Partial<TrackGate> = {}): TrackGate {
  return { index, kind: 'square', pos, yaw, pitch: 0, roll: 0, width: 3, height: 3, ...extra };
}

function track(path: Vec3[], closed: boolean, gates: TrackGate[], start: Vec3 = path[0]): TrackData {
  return { seed: 1, style: 'race', gates, obstacles: [], path, closed, length: 0, start: { pos: start, yaw: 0 }, laps: closed ? 3 : 1 };
}

function circle(r: number, n: number, y = 10): Vec3[] {
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * 2 * Math.PI;
    return [r * Math.cos(a), y, r * Math.sin(a)] as Vec3;
  });
}

/** Flies `pts` in order and sums the rewarded progress the way the kernel does: search from the last sample, arc, delta. */
function fly(p: PackedPath, pts: Vec3[]): { total: number; steps: number[] } {
  let idx = pathSearch(p, p.startSample, pts[0]);
  let s = pathArc(p, idx, pts[0]);
  let total = 0;
  const steps: number[] = [];
  for (const q of pts.slice(1)) {
    idx = pathSearch(p, idx, q);
    const s1 = pathArc(p, idx, q);
    const d = pathDelta(p, s, s1);
    steps.push(d);
    total += d;
    s = s1;
  }
  return { total, steps };
}

describe('path resampling', () => {
  it('spaces a closed path evenly and does not repeat its first point', () => {
    const pts = resamplePath(circle(50, 37), true);
    const perimeter = 37 * 2 * 50 * Math.sin(Math.PI / 37);
    expect(pts.length).toBe(Math.round(perimeter));
    const gaps = pts.map((p, i) => Math.hypot(...([0, 1, 2].map((k) => pts[(i + 1) % pts.length][k] - p[k]) as [number, number, number])));
    for (const g of gaps) expect(g).toBeGreaterThan(0.95);
    for (const g of gaps) expect(g).toBeLessThan(1.05);
  });

  it('keeps the true end of an open run', () => {
    const pts = resamplePath([[0, 0, 0], [10.5, 0, 0]], false);
    expect(pts.length).toBe(12);
    expect(pts[10][0]).toBeCloseTo(10);
    expect(pts[11][0]).toBeCloseTo(10.5);
  });

  it('gives no path for fewer than two points or zero length', () => {
    expect(resamplePath([], false)).toEqual([]);
    expect(resamplePath([[1, 2, 3]], true)).toEqual([]);
    expect(packPath(track([[1, 1, 1], [1, 1, 1]], false, [gate(0, [1, 1, 1], 0)])).count).toBe(0);
  });
});

describe('packed path', () => {
  it('stores cumulative arc length and the lap length of a circuit', () => {
    const p = packPath(track(circle(80, 200), true, [gate(0, [80, 10, 0], 0)]));
    expect(p.closed).toBe(true);
    for (let i = 1; i < p.count; i++) expect(p.points[i * 4 + 3]).toBeGreaterThan(p.points[(i - 1) * 4 + 3]);
    expect(p.length).toBeCloseTo(2 * Math.PI * 80, 0);
  });

  it('starts a gate spawn on the branch that runs through the gate forwards', () => {
    // Out along +X at 10 m, a half loop up, back along -X at 16 m: the two straights stack 6 m apart. The gate on the way back
    // (travelling -X) sits nearer the way out, which runs through it the wrong way.
    const path: Vec3[] = [];
    for (let x = 0; x <= 60; x += 1) path.push([x, 10, 0]);
    for (let a = 1; a < 30; a++) path.push([60 + 3 * Math.sin((a / 30) * Math.PI), 13 - 3 * Math.cos((a / 30) * Math.PI), 0]);
    for (let x = 60; x >= 0; x -= 1) path.push([x, 16, 0]);
    const g = gate(0, [30, 12.5, 0], Math.PI / 2);
    const p = packPath(track(path, false, [g]));
    const i = p.gateSample[0];
    expect(p.points[i * 4 + 1]).toBeCloseTo(16, 0);
    expect(p.points[i * 4]).toBeCloseTo(30, 0);
  });

  it('starts a pad spawn at the sample nearest the start', () => {
    const p = packPath(track(circle(80, 200), true, [gate(0, [80, 10, 0], 0)], [0, 10, 80]));
    const i = p.startSample;
    expect(Math.hypot(p.points[i * 4], p.points[i * 4 + 2] - 80)).toBeLessThan(1);
  });
});

describe('progress along the path', () => {
  it('sums to the lap length over a lap, through the wrap at sample 0', () => {
    const p = packPath(track(circle(60, 120), true, [gate(0, [60, 10, 0], 0)]));
    // Two laps at 0.4 m per decision, 1.5 m off the line
    const pts: Vec3[] = [];
    const n = Math.round((2 * p.length) / 0.4);
    for (let k = 0; k <= n; k++) {
      const a = 0.3 + (k / n) * 4 * Math.PI;
      pts.push([61.5 * Math.cos(a), 10.5, 61.5 * Math.sin(a)]);
    }
    const { total, steps } = fly(p, pts);
    expect(total).toBeGreaterThan(2 * p.length - 1);
    expect(total).toBeLessThan(2 * p.length + 1);
    for (const d of steps) expect(d).toBeGreaterThan(0);
  });

  it('counts flying backwards as negative progress', () => {
    const p = packPath(track(circle(60, 120), true, [gate(0, [60, 10, 0], 0)], [60 * Math.cos(1), 10, 60 * Math.sin(1)]));
    const pts: Vec3[] = [];
    for (let k = 0; k <= 200; k++) {
      const a = 1 - k * 0.006;
      pts.push([60 * Math.cos(a), 10, 60 * Math.sin(a)]);
    }
    const { total } = fly(p, pts);
    expect(total).toBeCloseTo(-200 * 0.006 * 60, 0);
  });

  it('follows a loop that passes over itself without jumping branches', () => {
    // A power loop in the X-Y plane: in at y=5, round a 6 m radius circle, out at y=5 again, on to x=80
    const path: Vec3[] = [];
    for (let x = 0; x < 40; x++) path.push([x, 5, 0]);
    for (let a = 0; a < 60; a++) {
      const t = (a / 60) * 2 * Math.PI;
      path.push([40 + 6 * Math.sin(t), 11 - 6 * Math.cos(t), 0.05 * a]);
    }
    for (let x = 40; x <= 80; x++) path.push([x, 5, 3]);
    const p = packPath(track(path, false, [gate(0, [20, 5, 0], -Math.PI / 2)]));
    // Fly the centreline itself at 0.4 m steps
    const dense = resamplePath(path, false, 0.4);
    const { total, steps } = fly(p, dense);
    expect(total).toBeGreaterThan(p.length - 1);
    for (const d of steps) expect(Math.abs(d)).toBeLessThan(1);
  });

  it('clamps one decision to PATH_MAX_STEP and stays within the window', () => {
    const path: Vec3[] = Array.from({ length: 200 }, (_, i) => [i, 5, 0] as Vec3);
    const p = packPath(track(path, false, [gate(0, [10, 5, 0], -Math.PI / 2)]));
    const i = pathSearch(p, 0, [150, 5, 0]);
    expect(i).toBe(PATH_AHEAD);
    expect(pathDelta(p, 0, pathArc(p, i, [150, 5, 0]))).toBe(PATH_MAX_STEP);
    expect(pathDelta(p, 30, 0)).toBe(-PATH_MAX_STEP);
  });

  it('projects between samples so progress is smooth', () => {
    const path: Vec3[] = Array.from({ length: 50 }, (_, i) => [i, 5, 0] as Vec3);
    const p = packPath(track(path, false, [gate(0, [10, 5, 0], -Math.PI / 2)]));
    const i = pathSearch(p, 10, [12.3, 6, 0.5]);
    expect(pathArc(p, i, [12.3, 6, 0.5])).toBeCloseTo(12.3, 4);
    // The ends clamp: before the first sample and past the last
    expect(pathArc(p, pathSearch(p, 0, [-3, 5, 0]), [-3, 5, 0])).toBe(0);
    expect(pathArc(p, pathSearch(p, 45, [60, 5, 0]), [60, 5, 0])).toBeCloseTo(49, 4);
  });

  it('rewards the take-off leg of an open run from a pad before the first sample', () => {
    // The run starts at the first gate (x = 10, 5 m up); the pad is on the ground 10 m before it
    const path: Vec3[] = Array.from({ length: 51 }, (_, i) => [10 + i, 5, 0] as Vec3);
    const pad: Vec3 = [0, 0, 0];
    const p = packPath(track(path, false, [gate(0, [10, 5, 0], -Math.PI / 2)], pad));
    const lead = Math.hypot(10, 5);
    expect(p.startSample).toBe(0);
    expect(Math.abs(p.length - (lead + 50))).toBeLessThan(0.1); // the 1 m resampling cuts the corner at the first gate
    const pts: Vec3[] = [];
    for (let k = 0; k <= 40; k++) pts.push([10 * (k / 40), 0.05 + 4.95 * (k / 40), 0]);
    const { total, steps } = fly(p, pts);
    expect(total).toBeGreaterThan(lead - 0.5);
    for (const d of steps) expect(d).toBeGreaterThan(0);
    // Flying away from the first gate costs progress
    expect(fly(p, [[0, 0.05, 0], [-3, 0.05, 0]]).total).toBeLessThan(0);
  });

  it('adds no lead-in to a circuit or to a run that already starts at the pad', () => {
    const run: Vec3[] = Array.from({ length: 51 }, (_, i) => [i, 5, 0] as Vec3);
    expect(packPath(track(run, false, [gate(0, [10, 5, 0], -Math.PI / 2)], [0.5, 5, 0])).length).toBeCloseTo(50, 3);
    expect(packPath(track(circle(80, 200), true, [gate(0, [80, 10, 0], 0)], [0, 0, 0])).length).toBeCloseTo(2 * Math.PI * 80, 0);
  });
});
