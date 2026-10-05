import { describe, expect, it } from 'vitest';
import type { ObstacleCollider, TrackData, TrackGate, Vec3 } from '../../contracts';
import { PadGround } from '../../app/padGround';
import { GATE_COLORS } from '../../ui/trackPreviewModel';
import { trackColliders } from '../../world/track/colliders';
import { trackGateFrame } from '../../world/track/gate';
import { testSampler, testTerrainData } from '../../world/track/testTerrain';
import { DASH_GRID, DASH_PATH_MAX, openingLoop, worldGeometry } from './dashGeom';
import { buildTrainWorld, type TrainWorld } from './worlds';

function gate(index: number, kind: TrackGate['kind'], pos: Vec3, extra: Partial<TrackGate> = {}): TrackGate {
  return { index, kind, pos, yaw: 0.3 * index, pitch: 0, roll: 0, width: 3, height: 2.4, ...extra };
}

function handWorld(pathPoints: number): TrainWorld {
  const terrain = testTerrainData({ seed: 4, resolution: 256, cellSize: 8, waterFraction: 0.1 });
  const sampler = testSampler(terrain);
  const path: Vec3[] = [];
  for (let i = 0; i < pathPoints; i++) {
    const a = (i / pathPoints) * 2 * Math.PI;
    path.push([200 * Math.cos(a), 30 + 5 * Math.sin(3 * a), 200 * Math.sin(a)]);
  }
  const track: TrackData = {
    seed: 9,
    style: 'technical',
    closed: true,
    laps: 2,
    length: 2 * Math.PI * 200,
    start: { pos: [0, 10, 0], yaw: 0.5 },
    gates: [
      gate(0, 'start', [10, 12, 0]),
      gate(1, 'arch', [50, 14, 20], { width: 4, height: 4 }),
      gate(2, 'drop', [80, 20, 40], { pitch: -Math.PI / 2, width: 3, height: 3, feature: 'drop' }),
      gate(3, 'tunnel', [120, 12, 0], { depth: 6, feature: 'tunnel' }),
      gate(4, 'hoop', [140, 15, -30], { roll: 0.4, feature: 'split-s' }),
    ],
    obstacles: [
      { kind: 'pole', pos: [30, 5, 30], yaw: 0, size: [0.2, 6, 0.2] },
      { kind: 'wall', pos: [-30, 5, 30], yaw: 1, size: [8, 3, 0.4] },
    ],
    path,
  };
  const colliders: ObstacleCollider[] = trackColliders(track, sampler);
  for (let i = 0; i < 7; i++) colliders.push({ kind: 'box', center: [i, 0, i], half: [1, 1, 1], yaw: 0 });
  return { seed: 9, style: 'technical', terrain, sampler, ground: new PadGround(sampler, track), track, colliders };
}

describe('dashboard world geometry', () => {
  it('is JSON-safe and complete', () => {
    const w = handWorld(400);
    const g = worldGeometry(w, 3);
    const back = JSON.parse(JSON.stringify(g));
    expect(back).toStrictEqual(g);
    expect(g.index).toBe(3);
    expect(g.style).toBe('technical');
    expect(g.closed).toBe(true);
    expect(g.laps).toBe(2);
    expect(g.gates).toHaveLength(5);
    expect(g.obstacles.map((o) => o.round)).toEqual([true, false]);
    expect(g.boxes.length).toBe(trackColliders(w.track, w.sampler).length);
    expect(g.vegetationColliders).toBe(7);
    expect(g.gates[2].feature).toBe('drop');
    expect(g.gates[0].feature).toBeNull();
    expect(g.gates[3].depth).toBe(6);
    expect(g.gates[0].depth).toBeNull();
    for (const k of g.gates) expect(k.color).toBe(GATE_COLORS[k.kind as TrackGate['kind']]);
  });

  it('downsamples the terrain to a rounded 128 grid over the same square', () => {
    const w = handWorld(100);
    const t = worldGeometry(w, 0).terrain;
    expect(t.n).toBe(DASH_GRID);
    expect(t.height).toHaveLength(DASH_GRID * DASH_GRID);
    expect(t.step * (t.n - 1)).toBeCloseTo((t.resolution - 1) * t.cellSize, 2);
    for (const h of t.height) expect(Math.round(h * 10) / 10).toBe(h);
    expect(t.water).not.toBeNull();
    // A block average stays within the source range and close to the point sample in the middle of the map.
    const lo = Math.min(...t.height), hi = Math.max(...t.height);
    expect(lo).toBeGreaterThanOrEqual(t.min - 0.1);
    expect(hi).toBeLessThanOrEqual(t.max + 0.1);
    const mid = 64;
    const x = t.origin[0] + mid * t.step, z = t.origin[1] + mid * t.step;
    expect(Math.abs(t.height[mid * t.n + mid] - w.sampler.heightAt(x, z))).toBeLessThan(5);
  });

  it('thins the path to the cap with arc length and ground height', () => {
    const w = handWorld(4001);
    const p = worldGeometry(w, 0).path;
    expect(p.length).toBeLessThanOrEqual(DASH_PATH_MAX);
    expect(p.length).toBeGreaterThan(DASH_PATH_MAX * 0.6);
    const last = w.track.path[w.track.path.length - 1];
    expect(p[p.length - 1][0]).toBeCloseTo(last[0], 1);
    for (let i = 1; i < p.length; i++) expect(p[i][3]).toBeGreaterThan(p[i - 1][3]);
    expect(p[p.length - 1][3]).toBeGreaterThan(0.99 * 2 * Math.PI * 200);
    expect(p[10][4]).toBeCloseTo(w.sampler.heightAt(p[10][0], p[10][2]), 0);
    const short = worldGeometry(handWorld(50), 0).path;
    expect(short).toHaveLength(50);
  });

  it('puts the opening outline in the gate plane, horizontal for a drop', () => {
    const w = handWorld(100);
    const g = worldGeometry(w, 0);
    for (const dg of g.gates) {
      const f = trackGateFrame(w.track.gates[dg.index]);
      for (const p of dg.outline) {
        const d = (p[0] - dg.pos[0]) * f.forward[0] + (p[1] - dg.pos[1]) * f.forward[1] + (p[2] - dg.pos[2]) * f.forward[2];
        expect(Math.abs(d)).toBeLessThan(0.02);
      }
    }
    const drop = g.gates[2];
    expect(drop.forward[1]).toBeCloseTo(-1, 3);
    for (const p of drop.outline) expect(p[1]).toBeCloseTo(drop.pos[1], 1);
    // Upright rectangle: the four corners at +-height/2.
    const ys = g.gates[0].outline.map((p) => p[1]);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(2.4, 1);
  });

  it('walks round each opening shape once', () => {
    expect(openingLoop({ kind: 'square', width: 2, height: 1 })).toEqual([[-1, -0.5], [1, -0.5], [1, 0.5], [-1, 0.5]]);
    const hoop = openingLoop({ kind: 'hoop', width: 2, height: 2 });
    expect(hoop).toHaveLength(16);
    for (const [u, v] of hoop) expect(Math.hypot(u, v)).toBeCloseTo(1, 6);
    const arch = openingLoop({ kind: 'arch', width: 2, height: 3 });
    // Top of the arch is the springing line (0.5 above centre) plus the radius.
    expect(Math.max(...arch.map((p) => p[1]))).toBeCloseTo(1.5, 6);
    expect(arch[0]).toEqual([-1, -1.5]);
  });

  it('describes a real training world', () => {
    const w = buildTrainWorld({ seed: 1001, style: 'race', difficulty: 0.4 });
    const g = worldGeometry(w, 0);
    expect(g.gates.length).toBe(w.track.gates.length);
    expect(g.boxes.length + g.vegetationColliders).toBe(w.colliders.length);
    expect(g.vegetationColliders).toBeGreaterThan(0);
    const json = JSON.stringify(g);
    expect(JSON.parse(json)).toStrictEqual(g);
    // About 100 KB of height grid plus the track: small enough to send 48 of them once.
    expect(json.length).toBeLessThan(400_000);
  }, 120_000);
});
