import { beforeAll, describe, expect, it } from 'vitest';
import type { TerrainSampler, TrackData, Vec3 } from '../../contracts';
import { generateTrack } from './generator';
import { PathIndex, distanceToPath, nearestPathIndex } from './pathIndex';
import { Rng } from './rng';
import type { TrackStyle } from './styles';
import { makeTestSampler } from './testTerrain';

const STYLES: TrackStyle[] = ['race', 'freestyle', 'mountain', 'sprint'];
const tracks: TrackData[] = [];

beforeAll(() => {
  const sampler: TerrainSampler = makeTestSampler({ seed: 3 });
  for (const style of STYLES) for (let seed = 1; seed <= 3; seed++) tracks.push(generateTrack({ seed, style }, sampler));
}, 60000);

const dist3 = (a: Vec3, x: number, y: number, z: number): number => Math.hypot(a[0] - x, a[1] - y, a[2] - z);

function bruteNearest(path: Vec3[], p: Vec3): number {
  let best = 0;
  for (let i = 1; i < path.length; i++) if (dist3(path[i], p[0], p[1], p[2]) < dist3(path[best], p[0], p[1], p[2])) best = i;
  return best;
}

function segDist(a: Vec3, b: Vec3, p: Vec3): number {
  const e: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const l2 = e[0] * e[0] + e[1] * e[1] + e[2] * e[2];
  const t = l2 > 0 ? Math.min(Math.max(((p[0] - a[0]) * e[0] + (p[1] - a[1]) * e[1] + (p[2] - a[2]) * e[2]) / l2, 0), 1) : 0;
  return Math.hypot(a[0] + e[0] * t - p[0], a[1] + e[1] * t - p[1], a[2] + e[2] * t - p[2]);
}

function brutePolyline(track: TrackData, p: Vec3): number {
  const m = track.path.length;
  let best = Infinity;
  for (let i = 0; i < (track.closed ? m : m - 1); i++) best = Math.min(best, segDist(track.path[i], track.path[(i + 1) % m], p));
  return best;
}

/** Random points 0-40 m from random path samples, some of them off the path's bounding box. */
function probes(track: TrackData, rng: Rng, n: number): Vec3[] {
  return Array.from({ length: n }, () => {
    const q = track.path[rng.int(0, track.path.length - 1)];
    const r = rng.range(0, 40);
    const a = rng.range(0, 2 * Math.PI);
    return [q[0] + Math.cos(a) * r, q[1] + rng.range(-15, 15), q[2] + Math.sin(a) * r] as Vec3;
  });
}

describe('PathIndex', () => {
  it('finds the same sample as a brute-force scan, in 3D and in the horizontal plane', () => {
    const rng = new Rng(4);
    for (const track of tracks) {
      const idx = new PathIndex(track.path);
      for (const p of [...probes(track, rng, 150), [1e5, 0, -1e5] as Vec3, [-1e4, 50, 3e3] as Vec3]) {
        const i = idx.nearest(p[0], p[1], p[2]);
        expect(idx.lastDist).toBeCloseTo(dist3(track.path[bruteNearest(track.path, p)], p[0], p[1], p[2]), 9);
        expect(dist3(track.path[i], p[0], p[1], p[2])).toBeCloseTo(idx.lastDist, 9);
        const j = idx.nearestXZ(p[0], p[2]);
        let best = Infinity;
        for (const q of track.path) best = Math.min(best, Math.hypot(q[0] - p[0], q[2] - p[2]));
        expect(Math.hypot(track.path[j][0] - p[0], track.path[j][2] - p[2])).toBeCloseTo(best, 9);
      }
    }
  });

  it('collectXZ returns exactly the samples within the radius', () => {
    const rng = new Rng(5);
    for (const track of tracks.slice(0, 6)) {
      const idx = new PathIndex(track.path);
      for (const p of probes(track, rng, 40)) {
        const r = rng.range(1, 30);
        const got: number[] = [];
        idx.collectXZ(p[0], p[2], r, got);
        const want: number[] = [];
        track.path.forEach((q, i) => {
          if (Math.hypot(q[0] - p[0], q[2] - p[2]) <= r) want.push(i);
        });
        expect(got.sort((a, b) => a - b)).toEqual(want);
      }
    }
  });
});

describe('nearestPathIndex', () => {
  it('matches a brute-force scan without a hint', () => {
    const rng = new Rng(6);
    for (const track of tracks) {
      for (const p of probes(track, rng, 100)) {
        const i = nearestPathIndex(track, p);
        expect(dist3(track.path[i], p[0], p[1], p[2])).toBeCloseTo(dist3(track.path[bruteNearest(track.path, p)], p[0], p[1], p[2]), 9);
      }
    }
  });

  it('follows a flying pilot with the previous result as hint', () => {
    for (const track of tracks) {
      let hint = 0;
      for (let i = 0; i < track.path.length; i++) {
        const q = track.path[i];
        const p: Vec3 = [q[0] + 0.7, q[1] + 0.4, q[2] - 0.5];
        hint = nearestPathIndex(track, p, hint);
        expect(dist3(track.path[hint], p[0], p[1], p[2])).toBeCloseTo(dist3(track.path[bruteNearest(track.path, p)], p[0], p[1], p[2]), 9);
      }
    }
  });

  it('recovers from a stale hint far from the pilot (a respawn)', () => {
    for (const track of tracks) {
      const m = track.path.length;
      const target = Math.floor(m * 0.8);
      const p: Vec3 = [track.path[target][0], track.path[target][1] + 0.2, track.path[target][2]];
      const i = nearestPathIndex(track, p, 3);
      expect(dist3(track.path[i], p[0], p[1], p[2])).toBeLessThanOrEqual(dist3(track.path[target], p[0], p[1], p[2]) + 1e-9);
    }
  });

  it('wraps the hint window over the seam of a closed track and clamps it on an open one', () => {
    const closed = tracks.find((t) => t.closed)!;
    const m = closed.path.length;
    const past = closed.path[3];
    expect(nearestPathIndex(closed, past, m - 5)).toBe(nearestPathIndex(closed, past));
    const open = tracks.find((t) => !t.closed)!;
    const last = open.path[open.path.length - 1];
    expect(nearestPathIndex(open, last, open.path.length - 1)).toBe(open.path.length - 1);
    expect(nearestPathIndex(open, open.path[0], 0)).toBe(0);
  });
});

describe('distanceToPath', () => {
  it('is zero on the path and half a sample gap between two samples at most', () => {
    for (const track of tracks) {
      for (let i = 0; i < track.path.length - 1; i += 7) {
        const a = track.path[i];
        const b = track.path[i + 1];
        expect(distanceToPath(track, a)).toBeCloseTo(0, 9);
        expect(distanceToPath(track, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2])).toBeLessThan(1e-6);
      }
    }
  });

  it('agrees with a brute-force polyline distance for random points, closed and open', () => {
    const rng = new Rng(7);
    for (const track of tracks) {
      let worst = 0;
      for (const p of probes(track, rng, 200)) {
        const d = distanceToPath(track, p);
        const ref = brutePolyline(track, p);
        expect(d).toBeGreaterThanOrEqual(ref - 1e-9);
        worst = Math.max(worst, d - ref);
      }
      expect(worst, `${track.style} seed ${track.seed}`).toBeLessThan(0.05);
    }
  });

  it('measures across the seam of a closed loop', () => {
    const closed = tracks.find((t) => t.closed)!;
    const a = closed.path[closed.path.length - 1];
    const b = closed.path[0];
    const d = distanceToPath(closed, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + 0.3, (a[2] + b[2]) / 2]);
    // 0.3 m straight above the seam midpoint: the segment slope makes the perpendicular a touch shorter, never longer.
    expect(d).toBeLessThanOrEqual(0.3 + 1e-9);
    expect(d).toBeGreaterThan(0.25);
  });

  it('returns Infinity for an empty path', () => {
    const empty = { ...tracks[0], path: [] as Vec3[] };
    expect(distanceToPath(empty, [0, 0, 0])).toBe(Infinity);
  });
});
