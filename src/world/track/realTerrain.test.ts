import { beforeAll, describe, expect, it } from 'vitest';
import type { TerrainParams, TerrainSampler, TrackData } from '../../contracts';
import { createTerrainSampler, generateTerrain } from '../terrain';
import { distanceToBox, trackColliders } from './colliders';
import { generateTrack } from './generator';
import { STYLE_SPECS, type TrackStyle } from './styles';
import { validateTrack } from './validate';

/** The synthetic-terrain suites prove the rules; this one proves them against the real terrain module and its sampler. */
const STYLES: TrackStyle[] = ['race', 'freestyle', 'mountain', 'sprint'];
const SEEDS = 6;
const MAPS: TerrainParams[] = [
  { seed: 7, quality: 'low', resolution: 512, cellSize: 4 },
  { seed: 42, quality: 'low', resolution: 256, cellSize: 8 },
];

interface Case {
  sampler: TerrainSampler;
  tracks: { style: TrackStyle; seed: number; track: TrackData }[];
}
const cases: Case[] = [];

beforeAll(() => {
  for (const params of MAPS) {
    const sampler = createTerrainSampler(generateTerrain(params));
    const tracks: Case['tracks'] = [];
    for (const style of STYLES) for (let seed = 1; seed <= SEEDS; seed++) tracks.push({ style, seed, track: generateTrack({ seed, style }, sampler) });
    cases.push({ sampler, tracks });
  }
}, 120000);

describe('tracks on the real terrain module', () => {
  it('every track validates and keeps the requested gate count', () => {
    for (const { sampler, tracks } of cases) {
      for (const { style, seed, track } of tracks) {
        expect(validateTrack(track, sampler).errors, `${style} seed ${seed}`).toEqual([]);
        expect(track.gates.length, `${style} seed ${seed}`).toBe(STYLE_SPECS[style].defaultGates);
      }
    }
  });

  it('obstacles stand on the real ground and above the waterline', () => {
    for (const { sampler, tracks } of cases) {
      for (const { track } of tracks) {
        for (const o of track.obstacles) {
          const h = sampler.heightAt(o.pos[0], o.pos[2]);
          expect(Math.abs(o.pos[1] - h)).toBeLessThan(0.05);
          expect(h).toBeGreaterThanOrEqual(sampler.data.waterLevel + 0.1);
        }
      }
    }
  });

  it('the centreline keeps clear of every collider box, and gate legs reach the sampled ground', () => {
    for (const { sampler, tracks } of cases) {
      for (const { style, seed, track } of tracks) {
        const boxes = trackColliders(track, sampler);
        for (let i = 0; i < track.path.length; i += 3) {
          const p = track.path[i];
          for (const b of boxes) {
            if (Math.abs(b.center[0] - p[0]) > 8 || Math.abs(b.center[2] - p[2]) > 8) continue;
            expect(distanceToBox(b, p[0], p[1], p[2]), `${style} seed ${seed} sample ${i}`).toBeGreaterThan(0.1);
          }
        }
        for (const g of track.gates) {
          if (g.kind === 'flag') continue;
          const low = Math.min(...trackColliders({ ...track, obstacles: [], gates: [g] }, sampler).map((b) => b.center[1] - b.half[1]));
          expect(low, `${style} seed ${seed} gate ${g.index}`).toBeLessThan(sampler.heightAt(g.pos[0], g.pos[2]) + 1.2);
        }
      }
    }
  });
});
