import { beforeAll, describe, expect, it } from 'vitest';
import type { ObstacleCollider, TerrainSampler, TrackData, TrackGate, Vec3 } from '../../contracts';
import { distanceToBox, gateColliders, obstacleCollider, trackColliders } from './colliders';
import { GATE_TUBE, insideOpening, trackGateFrame } from './gate';
import { generateTrack } from './generator';
import type { TrackStyle } from './styles';
import { makeTestSampler } from './testTerrain';

const STYLES: TrackStyle[] = ['race', 'freestyle', 'mountain', 'sprint'];
let sampler: TerrainSampler;
const tracks: TrackData[] = [];

beforeAll(() => {
  sampler = makeTestSampler({ seed: 3 });
  for (const style of STYLES) for (let seed = 1; seed <= 10; seed++) tracks.push(generateTrack({ seed, style }, sampler));
}, 60000);

/** True when the point is strictly inside the oriented box. */
function inside(b: ObstacleCollider, p: Vec3): boolean {
  const c = Math.cos(b.yaw);
  const s = Math.sin(b.yaw);
  const dx = p[0] - b.center[0];
  const dz = p[2] - b.center[2];
  return Math.abs(c * dx - s * dz) < b.half[0] && Math.abs(p[1] - b.center[1]) < b.half[1] && Math.abs(s * dx + c * dz) < b.half[2];
}

function gate(over: Partial<TrackGate> = {}): TrackGate {
  return { index: 0, kind: 'square', pos: [0, 8, 0], yaw: 0, roll: 0, pitch: 0, width: 2, height: 2, ...over };
}

describe('trackColliders', () => {
  it('has a box for every obstacle and at least four per gate, with sane extents', () => {
    for (const t of tracks) {
      const boxes = trackColliders(t, sampler);
      let expected = t.obstacles.length;
      for (const g of t.gates) {
        const n = gateColliders(g, sampler).length;
        expect(n).toBeGreaterThanOrEqual(g.kind === 'flag' ? 2 : 4);
        expected += n;
      }
      expect(boxes.length).toBe(expected);
      expect(boxes.length).toBeLessThan(6000);
      for (const b of boxes) {
        expect(b.kind).toBe('box');
        expect(b.center.every(Number.isFinite) && b.half.every((h) => Number.isFinite(h) && h > 0) && Number.isFinite(b.yaw)).toBe(true);
      }
    }
  });

  it('builds a plain square gate from tubes 0.06 m thick: two posts, two bars, legs and plates', () => {
    const boxes = gateColliders(gate());
    expect(boxes.length).toBe(8);
    const posts = boxes.filter((b) => b.half[1] > 1 && b.half[0] < 0.05 && Math.abs(b.center[1] - 8) < 0.01);
    expect(posts.length).toBe(2);
    for (const b of posts) expect(b.half[0]).toBeCloseTo(GATE_TUBE / 2, 6);
    const bars = boxes.filter((b) => b.half[0] > 0.9 && b.half[1] < 0.05);
    expect(bars.length).toBe(2);
  });

  it('turns obstacles into boxes on the ground: round ones from radius x height, rocks and walls from full extents', () => {
    const cone = obstacleCollider({ kind: 'cone', pos: [3, 2, 4], yaw: 0, size: [0.15, 0.45, 0.15] });
    expect(cone.half).toEqual([0.15, 0.225, 0.15]);
    expect(cone.center[1]).toBeCloseTo(2.225, 9);
    const wall = obstacleCollider({ kind: 'wall', pos: [0, 1, 0], yaw: 0.5, size: [6, 1, 0.4] });
    expect(wall.half).toEqual([3, 0.5, 0.2]);
    expect(wall.yaw).toBe(0.5);
  });

  it('puts every box of an upright gate on the gate yaw', () => {
    for (const t of tracks) {
      for (const g of t.gates) for (const b of gateColliders(g, sampler)) expect(b.yaw).toBe(g.yaw);
    }
  });
});

describe('gate openings stay clear', () => {
  it('no box reaches into the opening beyond a 0.12 m margin (0.16 m when rolled or pitched), every kind', () => {
    const kinds = ['square', 'arch', 'hoop', 'dive', 'start', 'finish', 'flag'] as const;
    for (const kind of kinds) {
      for (const [yaw, roll, pitch] of [[0, 0, 0], [0.7, 0.3, 0], [2.1, -0.4, 0], [-1, 0, kind === 'dive' ? -1.05 : 0], [4, 0.2, 0.5]]) {
        if (kind === 'flag' && (roll !== 0 || pitch !== 0)) continue;
        const g = gate({ kind, yaw, roll, pitch, width: 2.4, height: 2.6, pos: [5, 9, -7] });
        const boxes = gateColliders(g);
        const margin = roll !== 0 || pitch !== 0 ? 0.16 : 0.12;
        const shrunk = { ...g, width: g.width - 2 * margin, height: g.height - 2 * margin };
        const f = trackGateFrame(g);
        let hits = 0;
        for (let u = -1.2; u <= 1.2; u += 0.05) {
          for (let v = -1.3; v <= 1.5; v += 0.05) {
            if (!insideOpening(shrunk, u, v)) continue;
            for (const w of [-0.05, 0, 0.05]) {
              const p: Vec3 = [0, 1, 2].map((k) => g.pos[k] + f.right[k] * u + f.up[k] * v + f.forward[k] * w) as Vec3;
              for (const b of boxes) if (inside(b, p)) hits++;
            }
          }
        }
        expect(hits, `${kind} yaw ${yaw} roll ${roll} pitch ${pitch}`).toBe(0);
      }
    }
  });

  it('legs reach the ground when a sampler is given', () => {
    for (const t of tracks.slice(0, 12)) {
      for (const g of t.gates) {
        if (g.kind === 'flag') continue;
        const boxes = gateColliders(g, sampler);
        const low = Math.min(...boxes.map((b) => b.center[1] - b.half[1]));
        const ground = Math.min(sampler.heightAt(g.pos[0], g.pos[2]), sampler.heightAt(g.pos[0] + 2, g.pos[2]), sampler.heightAt(g.pos[0] - 2, g.pos[2]));
        expect(low).toBeLessThan(ground + 1.2);
      }
    }
  });
});

describe('centreline versus colliders', () => {
  it('the path never enters any collider box (checked every 5 cm)', () => {
    for (const track of tracks) {
      const boxes = trackColliders(track, sampler);
      const reach = boxes.map((b) => Math.hypot(b.half[0], b.half[1], b.half[2]) + 0.1);
      const m = track.path.length;
      const edges = track.closed ? m : m - 1;
      for (let i = 0; i < edges; i++) {
        const a = track.path[i];
        const b = track.path[(i + 1) % m];
        const near: number[] = [];
        for (let k = 0; k < boxes.length; k++) {
          const c = boxes[k].center;
          if (Math.abs(c[0] - a[0]) < reach[k] + 1 && Math.abs(c[2] - a[2]) < reach[k] + 1 && Math.abs(c[1] - a[1]) < reach[k] + 1) near.push(k);
        }
        if (near.length === 0) continue;
        for (let s = 0; s <= 20; s++) {
          const p: Vec3 = [a[0] + ((b[0] - a[0]) * s) / 20, a[1] + ((b[1] - a[1]) * s) / 20, a[2] + ((b[2] - a[2]) * s) / 20];
          for (const k of near) expect(inside(boxes[k], p), `${track.style} seed ${track.seed} sample ${i} box ${k}`).toBe(false);
        }
      }
    }
  });

  it('the path keeps a body-width margin from every box (0.15 m) apart from the gate it flies through', () => {
    for (const track of tracks.slice(0, 20)) {
      const boxes = trackColliders(track, sampler);
      for (let i = 0; i < track.path.length; i += 2) {
        const p = track.path[i];
        for (const b of boxes) {
          if (Math.abs(b.center[0] - p[0]) > 8 || Math.abs(b.center[2] - p[2]) > 8) continue;
          expect(distanceToBox(b, p[0], p[1], p[2])).toBeGreaterThan(0.15);
        }
      }
    }
  });
});
