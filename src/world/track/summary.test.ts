import { describe, expect, it } from 'vitest';
import type { TrackData, Vec3 } from '../../contracts';
import { generateTrack } from './generator';
import type { TrackStyle } from './styles';
import { describeTrack } from './summary';
import { makeTestSampler } from './testTerrain';

const SLOW = 60000;

const STYLES: TrackStyle[] = ['race', 'freestyle', 'mountain', 'sprint'];
const sampler = makeTestSampler({ seed: 3 });

function line(closed: boolean, path: Vec3[], laps = 1): TrackData {
  return { seed: 0, style: 'sprint', gates: [], obstacles: [], path, closed, length: path.length - 1, start: { pos: path[0], yaw: 0 }, laps };
}

describe('describeTrack', () => {
  it('reports gate count, lap length, total length and a sane speed hint for generated tracks', () => {
    for (const style of STYLES) {
      for (let seed = 1; seed <= 8; seed++) {
        const t = generateTrack({ seed, style }, sampler);
        const s = describeTrack(t);
        expect(s.gates).toBe(t.gates.length);
        expect(s.lengthLapM).toBe(t.length);
        expect(s.lengthM).toBeCloseTo(t.closed ? t.length * t.laps : t.length, 6);
        expect(s.elevationGainM).toBeGreaterThanOrEqual(0);
        expect(s.avgSpeedHintMs).toBeGreaterThanOrEqual(6);
        expect(s.avgSpeedHintMs).toBeLessThanOrEqual(30);
        expect(s.maxCurvature).toBeGreaterThan(0);
        expect(s.maxCurvature).toBeLessThanOrEqual(1 / 6);
      }
    }
  }, SLOW);

  it('counts only the climbs in the elevation gain', () => {
    const hill: Vec3[] = Array.from({ length: 41 }, (_, i) => [i, i <= 20 ? i : 40 - i, 0]);
    expect(describeTrack(line(false, hill)).elevationGainM).toBeCloseTo(20, 9);
    const valley: Vec3[] = Array.from({ length: 41 }, (_, i) => [i, i <= 20 ? 20 - i : i - 20, 0]);
    expect(describeTrack(line(false, valley)).elevationGainM).toBeCloseTo(20, 9);
  });

  it('gives a straight line the top speed and a tight circle a slow one', () => {
    const straight: Vec3[] = Array.from({ length: 200 }, (_, i) => [i, 10, 0]);
    expect(describeTrack(line(false, straight)).avgSpeedHintMs).toBeCloseTo(30, 6);
    const r = 12;
    const n = Math.round(2 * Math.PI * r);
    const circle: Vec3[] = Array.from({ length: n }, (_, k) => [r * Math.cos((2 * Math.PI * k) / n), 10, r * Math.sin((2 * Math.PI * k) / n)]);
    const s = describeTrack(line(true, circle));
    expect(s.avgSpeedHintMs).toBeLessThan(20);
    expect(s.avgSpeedHintMs).toBeGreaterThan(6);
    expect(s.maxCurvature).toBeGreaterThan(0.8 / r);
    expect(s.maxCurvature).toBeLessThan(1.2 / r);
  });

  it('multiplies a closed track by its laps and leaves an open one alone', () => {
    const circle: Vec3[] = Array.from({ length: 100 }, (_, k) => [30 * Math.cos((2 * Math.PI * k) / 100), 5, 30 * Math.sin((2 * Math.PI * k) / 100)]);
    expect(describeTrack(line(true, circle, 3)).lengthM).toBeCloseTo(3 * describeTrack(line(true, circle, 3)).lengthLapM, 9);
    expect(describeTrack(line(false, circle, 3)).lengthM).toBe(describeTrack(line(false, circle, 3)).lengthLapM);
  });
});
