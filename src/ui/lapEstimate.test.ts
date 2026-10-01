import { describe, expect, it } from 'vitest';
import type { TrackData, Vec3 } from '../contracts';
import { makeTrack } from '../game/testKit';
import { generateTrack } from '../world/track/generator';
import { makeTestSampler } from '../world/track/testTerrain';
import { ACCEL, estimateLapTime, LATERAL_ACCEL, MIN_SPEED, TOP_SPEED } from './lapEstimate';

function line(length: number): Vec3[] {
  const pts: Vec3[] = [];
  for (let i = 0; i <= length; i++) pts.push([0, 5, -i]);
  return pts;
}

function circle(radius: number): Vec3[] {
  const n = Math.round(2 * Math.PI * radius);
  return Array.from({ length: n }, (_, i): Vec3 => [radius * Math.cos((i / n) * 2 * Math.PI), 5, radius * Math.sin((i / n) * 2 * Math.PI)]);
}

const track = (path: Vec3[], closed: boolean): TrackData => ({ ...makeTrack(4), path, closed });

describe('estimateLapTime', () => {
  it('on a straight, accelerates from the minimum speed to the top speed and cruises', () => {
    const t = estimateLapTime(track(line(1000), false));
    const rampS = (TOP_SPEED - MIN_SPEED) / ACCEL;
    const rampM = (TOP_SPEED * TOP_SPEED - MIN_SPEED * MIN_SPEED) / (2 * ACCEL);
    const expected = rampS + (1000 - rampM) / TOP_SPEED;
    expect(t).toBeCloseTo(expected, 0);
  });

  it('on a wide circuit is limited by the top speed, on a tight one by cornering', () => {
    const wide = estimateLapTime(track(circle(150), true));
    expect(wide).toBeCloseTo((2 * Math.PI * 150) / TOP_SPEED, 0);
    const r = 20;
    const tight = estimateLapTime(track(circle(r), true));
    expect(tight).toBeCloseTo((2 * Math.PI * r) / Math.sqrt(LATERAL_ACCEL * r), 0);
  });

  it('is slower with a hairpin in the way than on the same length of straight', () => {
    const hairpin: Vec3[] = [...line(300)];
    for (let i = 1; i <= 15; i++) hairpin.push([4 * (1 - Math.cos((i / 15) * Math.PI)) * 1.0, 5, -300 - 6 * Math.sin((i / 15) * Math.PI)]);
    for (let i = 1; i <= 300; i++) hairpin.push([8, 5, -300 + i]);
    const straight = line(Math.round(600 + Math.PI * 6));
    expect(estimateLapTime(track(hairpin, false))).toBeGreaterThan(estimateLapTime(track(straight, false)) + 0.5);
  });

  it('is NaN without a path and positive and sane for generated courses of every style', () => {
    expect(estimateLapTime({ ...makeTrack(3), path: [] })).toBeNaN();
    const sampler = makeTestSampler({ seed: 9, resolution: 512, cellSize: 3 });
    for (const style of ['race', 'freestyle', 'mountain', 'sprint'] as const) {
      const t = generateTrack({ seed: 4, style, gateCount: 12 }, sampler);
      const lap = estimateLapTime(t);
      const avg = t.length / lap;
      expect(avg, style).toBeGreaterThan(MIN_SPEED);
      expect(avg, style).toBeLessThanOrEqual(TOP_SPEED);
    }
  });
});
