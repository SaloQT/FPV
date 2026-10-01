import { describe, expect, it } from 'vitest';
import type { TrackData, Vec3 } from '../contracts';
import { makeTrack } from '../game/testKit';
import { generateTrack } from '../world/track/generator';
import { makeTestSampler } from '../world/track/testTerrain';
import { TOP_SPEED } from './lapEstimate';
import {
  buildPreview, describePreview, formatLength, GATE_COLORS, headingOnScreen, niceScaleBar, PATH_STEP_M, previewStats, type PreviewBox,
} from './trackPreviewModel';

const BOX: PreviewBox = { width: 400, height: 300, padding: 20 };

function circle(radius: number, n = 360): Vec3[] {
  const pts: Vec3[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push([radius * Math.cos(a), 5 + 3 * Math.sin(a), radius * Math.sin(a)]);
  }
  return pts;
}

function circuit(): TrackData {
  const path = circle(100);
  const gates = [0, 90, 180, 270].map((deg, i) => {
    const a = (deg * Math.PI) / 180;
    return { index: i, kind: i === 0 ? ('start' as const) : ('square' as const), pos: [100 * Math.cos(a), 5, 100 * Math.sin(a)] as Vec3, yaw: 0, roll: 0, pitch: 0, width: 4, height: 4 };
  });
  return { ...makeTrack(4), gates, path, closed: true, length: 2 * Math.PI * 100, laps: 3, start: { pos: [100, 0, 0], yaw: Math.PI / 2 } };
}

describe('headingOnScreen', () => {
  it('points up for north and left for a quarter turn counter-clockwise (west)', () => {
    const [nx, ny] = headingOnScreen(0);
    expect(nx).toBeCloseTo(0, 12);
    expect(ny).toBeCloseTo(-1, 12);
    const [wx, wy] = headingOnScreen(Math.PI / 2);
    expect(wx).toBeCloseTo(-1, 12);
    expect(wy).toBeCloseTo(0, 12);
  });
});

describe('buildPreview', () => {
  it('fits the course inside the padded box with one uniform scale and keeps it centred', () => {
    const m = buildPreview(circuit(), BOX);
    expect(m.scale).toBeCloseTo((300 - 40) / 200, 6);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let i = 0; i < m.path.length; i += 2) {
      x0 = Math.min(x0, m.path[i]);
      x1 = Math.max(x1, m.path[i]);
      y0 = Math.min(y0, m.path[i + 1]);
      y1 = Math.max(y1, m.path[i + 1]);
    }
    expect(x0).toBeGreaterThanOrEqual(BOX.padding - 1e-3);
    expect(x1).toBeLessThanOrEqual(BOX.width - BOX.padding + 1e-3);
    expect(y0).toBeGreaterThanOrEqual(BOX.padding - 1e-3);
    expect(y1).toBeLessThanOrEqual(BOX.height - BOX.padding + 1e-3);
    expect((x0 + x1) / 2).toBeCloseTo(BOX.width / 2, 0);
    expect((y0 + y1) / 2).toBeCloseTo(BOX.height / 2, 0);
  });

  it('puts north at the top: a gate with more negative z is higher on screen', () => {
    const t = circuit();
    const m = buildPreview(t, BOX);
    const north = t.gates.findIndex((g) => g.pos[2] < -50);
    const south = t.gates.findIndex((g) => g.pos[2] > 50);
    expect(m.gates[north].y).toBeLessThan(m.gates[south].y);
  });

  it('thins the path to about one point per step and scales heights to 0..1', () => {
    const m = buildPreview(circuit(), BOX);
    const pts = m.path.length / 2;
    const expected = (2 * Math.PI * 100) / PATH_STEP_M;
    expect(pts).toBeGreaterThan(expected * 0.8);
    expect(pts).toBeLessThan(expected * 1.3);
    expect(Math.min(...m.heights)).toBeCloseTo(0, 6);
    expect(Math.max(...m.heights)).toBeCloseTo(1, 6);
  });

  it('colours gates by kind and gives every opening a drawable width', () => {
    const m = buildPreview(circuit(), BOX);
    expect(m.gates[0].color).toBe(GATE_COLORS.start);
    expect(m.gates[1].color).toBe(GATE_COLORS.square);
    for (const g of m.gates) expect(g.half).toBeGreaterThanOrEqual(3);
  });

  it('places the start marker with the track heading', () => {
    const m = buildPreview(circuit(), BOX);
    expect(m.start.dx).toBeCloseTo(-1, 9);
    expect(m.start.dy).toBeCloseTo(0, 9);
  });

  it('does not blow up on an empty or single-point course', () => {
    const empty = buildPreview({ ...makeTrack(0), path: [], gates: [] }, BOX);
    expect(Number.isFinite(empty.scale)).toBe(true);
    expect(empty.start.x).toBeCloseTo(BOX.width / 2, 6);
    expect(empty.path.length).toBe(0);
  });
});

describe('previewStats', () => {
  it('estimates a lap from the length and a curvature-limited speed, and multiplies by laps on a circuit', () => {
    const s = previewStats(circuit());
    expect(s.lapLengthM).toBeCloseTo(2 * Math.PI * 100, 6);
    expect(s.laps).toBe(3);
    // r = 100 m at 25 m/s^2 lateral allows 50 m/s, so the top speed rules.
    expect(s.lapTimeS).toBeCloseTo((2 * Math.PI * 100) / TOP_SPEED, 0);
    expect(s.totalTimeS).toBeCloseTo(3 * s.lapTimeS, 9);
    expect(s.elevationGainM).toBeGreaterThan(0);
  });

  it('counts one lap on a point-to-point course whatever `laps` says', () => {
    const open = { ...circuit(), closed: false, laps: 5 };
    expect(previewStats(open).laps).toBe(1);
  });

  it('is finite and positive for every generated style', () => {
    const sampler = makeTestSampler({ seed: 5, resolution: 512, cellSize: 3 });
    for (const style of ['race', 'freestyle', 'mountain', 'sprint'] as const) {
      const t = generateTrack({ seed: 3, style, gateCount: 10 }, sampler);
      const s = previewStats(t);
      expect(s.lapTimeS, style).toBeGreaterThan(5);
      expect(s.lapTimeS, style).toBeLessThan(600);
      const m = buildPreview(t, BOX);
      expect(m.gates.length).toBe(t.gates.length);
      for (const g of m.gates) {
        expect(g.x).toBeGreaterThanOrEqual(0);
        expect(g.x).toBeLessThanOrEqual(BOX.width);
        expect(g.y).toBeGreaterThanOrEqual(0);
        expect(g.y).toBeLessThanOrEqual(BOX.height);
      }
    }
  });
});

describe('formatting', () => {
  it('writes metres below a kilometre and kilometres above', () => {
    expect(formatLength(842.4)).toBe('842 m');
    expect(formatLength(1430)).toBe('1.43 km');
    expect(formatLength(NaN)).toBe('-');
  });

  it('summarises the course and the time in two lines', () => {
    expect(describePreview({ gates: 12, laps: 3, lapLengthM: 1430, elevationGainM: 40.4, lapTimeS: 58.4, totalTimeS: 175.2 })).toEqual({
      course: '1.43 km  ·  12 gates  ·  climb 40 m', time: 'est. lap 0:58  ·  3 laps 2:55',
    });
    expect(describePreview({ gates: 8, laps: 1, lapLengthM: 600, elevationGainM: 0, lapTimeS: 30, totalTimeS: 30 })).toEqual({
      course: '600 m  ·  8 gates', time: 'est. lap 0:30',
    });
  });

  it('picks a 1-2-5 scale bar that fits', () => {
    for (const ppm of [0.2, 0.5, 1.3, 4]) {
      const bar = niceScaleBar(ppm, 400);
      expect(bar.px).toBeLessThanOrEqual(400 * 0.25 + 1e-9);
      expect(bar.px).toBeGreaterThan(400 * 0.1);
      const mantissa = bar.meters / Math.pow(10, Math.floor(Math.log10(bar.meters)));
      expect([1, 2, 5]).toContain(Math.round(mantissa * 1e6) / 1e6);
    }
  });
});
