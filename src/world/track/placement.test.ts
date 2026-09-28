import { beforeAll, describe, expect, it } from 'vitest';
import type { TerrainSampler, TrackData, TrackObstacle } from '../../contracts';
import { generateTrack } from './generator';
import type { TrackStyle } from './styles';
import { makeTestSampler } from './testTerrain';

const STYLES: TrackStyle[] = ['race', 'freestyle', 'mountain', 'sprint'];
const SEEDS = 30;
const byStyle = new Map<TrackStyle, TrackData[]>();
let sampler: TerrainSampler;

beforeAll(() => {
  sampler = makeTestSampler({ seed: 3 });
  for (const style of STYLES) {
    const list: TrackData[] = [];
    for (let seed = 1; seed <= SEEDS; seed++) list.push(generateTrack({ seed, style }, sampler));
    byStyle.set(style, list);
  }
}, 60000);

const all = (): TrackData[] => STYLES.flatMap((s) => byStyle.get(s)!);
const isRound = (o: TrackObstacle): boolean => o.kind === 'cone' || o.kind === 'pole' || o.kind === 'flagpole' || o.kind === 'tree';
const footprint = (o: TrackObstacle): number => (isRound(o) ? o.size[0] : Math.hypot(o.size[0], o.size[2]) / 2);
const isLargeKind = (kind: TrackObstacle['kind']): boolean => kind === 'tree' || kind === 'rock' || kind === 'wall';
const isLarge = (o: TrackObstacle): boolean => isLargeKind(o.kind);

describe('obstacle rules', () => {
  it('places at most 250 obstacles, all finite with positive sizes', () => {
    for (const t of all()) {
      expect(t.obstacles.length).toBeLessThanOrEqual(250);
      for (const o of t.obstacles) {
        expect(o.pos.every(Number.isFinite) && Number.isFinite(o.yaw)).toBe(true);
        expect(o.size.every((s) => Number.isFinite(s) && s > 0)).toBe(true);
      }
    }
  });

  it('puts every obstacle on the terrain, above the waterline and on the map', () => {
    const d = sampler.data;
    const half = (d.resolution * d.cellSize) / 2;
    for (const t of all()) {
      for (const o of t.obstacles) {
        const h = sampler.heightAt(o.pos[0], o.pos[2]);
        expect(Math.abs(o.pos[1] - h)).toBeLessThan(0.05);
        expect(h).toBeGreaterThanOrEqual(d.waterLevel + 0.1);
        expect(Math.abs(o.pos[0] - d.origin[0] - half)).toBeLessThan(half);
        expect(Math.abs(o.pos[2] - d.origin[1] - half)).toBeLessThan(half);
      }
    }
  });

  it('keeps at least 4 m between the path and the edge of every tree, rock and wall (1.5 m for markers)', () => {
    for (const t of all()) {
      for (const o of t.obstacles) {
        let near = Infinity;
        for (const p of t.path) near = Math.min(near, Math.hypot(p[0] - o.pos[0], p[2] - o.pos[2]));
        expect(near - footprint(o)).toBeGreaterThanOrEqual((isLarge(o) ? 4 : 1.5) - 1e-6);
      }
    }
  });

  it('never touches a gate frame or the launch pad centre', () => {
    for (const t of all()) {
      for (const o of t.obstacles) {
        for (const g of t.gates) {
          expect(Math.hypot(o.pos[0] - g.pos[0], o.pos[2] - g.pos[2])).toBeGreaterThanOrEqual(Math.max(g.width, g.height) / 2 + footprint(o) + 0.5);
        }
        if (o.kind !== 'cone') expect(Math.hypot(o.pos[0] - t.start.pos[0], o.pos[2] - t.start.pos[2])).toBeGreaterThan(footprint(o) + 2.4);
      }
    }
  });

  it('does not overlap two obstacles', () => {
    for (const t of all().slice(0, 40)) {
      const o = t.obstacles;
      for (let i = 0; i < o.length; i++) {
        for (let j = i + 1; j < o.length; j++) {
          expect(Math.hypot(o[i].pos[0] - o[j].pos[0], o[i].pos[2] - o[j].pos[2])).toBeGreaterThanOrEqual(footprint(o[i]) + footprint(o[j]));
        }
      }
    }
  });
});

describe('obstacle kinds and sizes', () => {
  it('uses physical sizes for the small markers', () => {
    const want = { cone: [0.15, 0.45, 0.15], pole: [0.025, 2, 0.025], flagpole: [0.02, 3, 0.02] } as const;
    for (const t of all()) {
      for (const o of t.obstacles) if (o.kind in want) expect(o.size).toEqual(want[o.kind as keyof typeof want]);
    }
  });

  it('gives trees a slim trunk and rocks, walls and trees a believable size', () => {
    for (const t of all()) {
      for (const o of t.obstacles) {
        if (o.kind === 'tree') {
          expect(o.size[0]).toBeGreaterThanOrEqual(0.2);
          expect(o.size[0]).toBeLessThanOrEqual(0.55);
          expect(o.size[1]).toBeGreaterThanOrEqual(4.5);
          expect(o.size[1]).toBeLessThanOrEqual(14);
        } else if (o.kind === 'rock') {
          expect(Math.max(o.size[0], o.size[2])).toBeLessThanOrEqual(5);
          expect(o.size[1]).toBeLessThanOrEqual(3);
        } else if (o.kind === 'wall') {
          expect(o.size[0]).toBeGreaterThanOrEqual(3);
          expect(o.size[2]).toBeLessThanOrEqual(0.55);
          expect(o.size[1]).toBeLessThanOrEqual(1.7);
        }
      }
    }
  });

  it('every track gets launch-pad cones and scenery; flat courses also get poles, flagpoles and corner cones', () => {
    for (const t of all()) {
      const kinds = new Set(t.obstacles.map((o) => o.kind));
      expect(kinds.has('cone'), `${t.style} seed ${t.seed}`).toBe(true);
      expect([...kinds].some(isLargeKind), `${t.style} seed ${t.seed}`).toBe(true);
    }
    for (const style of ['race', 'sprint'] as const) {
      const list = byStyle.get(style)!;
      for (const kind of ['pole', 'flagpole', 'cone', 'tree'] as const) {
        expect(list.filter((t) => t.obstacles.some((o) => o.kind === kind)).length).toBeGreaterThan(SEEDS * 0.5);
      }
    }
    expect(byStyle.get('mountain')!.filter((t) => t.obstacles.some((o) => o.kind === 'rock')).length).toBeGreaterThan(SEEDS * 0.8);
  });

  it('puts a cone in each corner around the launch pad, even where a closed course flies over it', () => {
    for (const t of all()) {
      const { pos, yaw } = t.start;
      const corners = new Set<string>();
      for (const o of t.obstacles) {
        if (o.kind !== 'cone' || Math.hypot(o.pos[0] - pos[0], o.pos[2] - pos[2]) > 5) continue;
        const dx = o.pos[0] - pos[0];
        const dz = o.pos[2] - pos[2];
        const lateral = Math.cos(yaw) * dx - Math.sin(yaw) * dz;
        const ahead = -Math.sin(yaw) * dx - Math.cos(yaw) * dz;
        corners.add(`${lateral < 0 ? 'L' : 'R'}${ahead < 0.2 ? 'B' : 'F'}`);
      }
      expect([...corners].sort(), `${t.style} seed ${t.seed}`).toEqual(['LB', 'LF', 'RB', 'RF']);
    }
  });
});

describe('determinism', () => {
  it('the same seed and terrain place the same obstacles', () => {
    for (const style of STYLES) {
      const a = generateTrack({ seed: 12, style }, sampler);
      const b = generateTrack({ seed: 12, style }, sampler);
      expect(b.obstacles).toEqual(a.obstacles);
    }
  });
});
