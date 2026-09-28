import { describe, expect, it } from 'vitest';
import { addCrosshair, addHorizon, SegmentBatch, type AttitudeView } from './osdHorizon';
import { RecordingContext } from './osdTestKit';

const VIEW: AttitudeView = { cx: 640, cy: 360, width: 1280, height: 720, unit: 0.667, cameraPitch: 0, roll: 0, fovY: 1.6 };

function collect(v: Partial<AttitudeView>): { x0: number; y0: number; x1: number; y1: number }[] {
  const batch = new SegmentBatch();
  const g = new RecordingContext();
  addHorizon(batch, { ...VIEW, ...v });
  batch.stroke(g, 1, 1);
  return g.lines;
}

/** The two long segments of the horizon proper (the ones with no tick), left half first. */
function horizonSegments(lines: ReturnType<typeof collect>, cy: number, tol: number): ReturnType<typeof collect> {
  return lines.filter((l) => Math.abs(l.y0 - cy) < tol && Math.abs(l.y1 - cy) < tol && Math.abs(l.x1 - l.x0) > 50);
}

describe('SegmentBatch', () => {
  it('strokes every segment once per pass, dark pass first', () => {
    const batch = new SegmentBatch();
    const g = new RecordingContext();
    batch.add(0, 0, 10, 0);
    batch.add(0, 5, 10, 5);
    const styles: unknown[] = [];
    const stroke = g.stroke.bind(g);
    g.stroke = () => { styles.push(g.strokeStyle); stroke(); };
    batch.stroke(g, 1, 0.5);
    expect(styles).toEqual(['rgba(0,0,0,0.85)', '#fff']);
    expect(g.lines).toHaveLength(2);
    expect(g.globalAlpha).toBe(1);
  });

  it('draws nothing when empty and can be cleared', () => {
    const batch = new SegmentBatch();
    const g = new RecordingContext();
    batch.stroke(g, 1, 1);
    batch.add(0, 0, 1, 1);
    batch.clear();
    batch.stroke(g, 1, 1);
    expect(g.lines).toHaveLength(0);
  });

  it('ignores segments beyond its capacity instead of overflowing', () => {
    const batch = new SegmentBatch();
    for (let i = 0; i < 100; i++) batch.add(0, 0, 1, 1);
    const g = new RecordingContext();
    batch.stroke(g, 1, 1);
    expect(g.lines.length).toBeLessThanOrEqual(32);
  });
});

describe('crosshair', () => {
  it('is centred on the given point', () => {
    const batch = new SegmentBatch();
    addCrosshair(batch, 100, 50, 1);
    const g = new RecordingContext();
    batch.stroke(g, 1, 1);
    const xs = g.lines.flatMap((l) => [l.x0, l.x1]);
    expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(100, 6);
  });
});

describe('horizon', () => {
  it('sits at the middle of the picture when level and looking at the horizon', () => {
    const segs = horizonSegments(collect({}), 360, 0.01);
    expect(segs).toHaveLength(2);
    expect(segs[0].x0).toBeLessThan(640);
    expect(segs[1].x1).toBeGreaterThan(640);
  });

  it('drops below the centre when the camera looks up', () => {
    const lines = collect({ cameraPitch: 0.3 });
    const off = Math.tan(0.3) * (720 / (2 * Math.tan(0.8)));
    expect(horizonSegments(lines, 360 + off, 0.01)).toHaveLength(2);
  });

  it('rises above the centre when the camera looks down', () => {
    const lines = collect({ cameraPitch: -0.3 });
    const off = Math.tan(-0.3) * (720 / (2 * Math.tan(0.8)));
    expect(off).toBeLessThan(0);
    expect(horizonSegments(lines, 360 + off, 0.01)).toHaveLength(2);
  });

  it('right wing down lifts the right side of the horizon', () => {
    const lines = collect({ roll: 0.4 });
    const right = lines.find((l) => l.x0 > 640 && l.x1 > l.x0 && Math.abs(l.x1 - l.x0) > 50);
    const left = lines.find((l) => l.x1 < 640 && l.x0 < l.x1 && Math.abs(l.x1 - l.x0) > 50);
    expect(right).toBeDefined();
    expect(left).toBeDefined();
    expect(right!.y1).toBeLessThan(360);
    expect(left!.y0).toBeGreaterThan(360);
  });

  it('draws faint rungs above and below only when they fit on the picture', () => {
    const level = collect({}).length;
    const steep = collect({ cameraPitch: 1.2 }).length;
    expect(level).toBeGreaterThan(2);
    expect(steep).toBeLessThan(level);
  });

  it('ladder ticks point towards the horizon', () => {
    const lines = collect({});
    const aboveOuter = lines.filter((l) => l.y0 < 360 - 20 && Math.abs(l.x1 - l.x0) < 1 && l.y1 > l.y0);
    const belowOuter = lines.filter((l) => l.y0 > 360 + 20 && Math.abs(l.x1 - l.x0) < 1 && l.y1 < l.y0);
    expect(aboveOuter.length).toBeGreaterThan(0);
    expect(belowOuter.length).toBeGreaterThan(0);
  });
});
