import { describe, expect, it } from 'vitest';
import { initialWorldRequest } from '../../app/boot';
import { parseParams, settingsPatch } from '../../app/params';
import { buildWorld, type WorldDeps } from '../../app/world';
import { defaultAppSettings } from '../../ui/settingsSchema';
import { generateTerrain } from '../../world/terrain/generate';
import { createTerrainSampler } from '../../world/terrain/sampler';
import { generateTrack } from '../../world/track/generator';
import { worldGeometry } from './dashGeom';
import { buildMixWorld, trainWorldSpecs } from './worldMix';

const deps: WorldDeps = { generateTerrain: async (p) => generateTerrain(p), createSampler: createTerrainSampler, generateTrack };

describe('a training world opened in the game', () => {
  it('rebuilds the same track from its dashboard link, through the URL parameters and the first world request of the game', async () => {
    // Style worlds at difficulties 0.3 to 0.6 (0.6 is 0.6000000000000001 in training) and a track-builder recipe world.
    for (const spec of trainWorldSpecs({ worlds: 5, seed: 1, recipes: 1 })) {
      const w = buildMixWorld(spec);
      const query = worldGeometry(w, 0).game;
      expect(query).toMatch(/quality=low/);
      const params = parseParams(`?${query}`);
      const base = defaultAppSettings();
      const settings = { ...base, ...settingsPatch(params, base) };
      const game = await buildWorld(initialWorldRequest(settings, params), deps);
      expect(game.terrainSeed).toBe(spec.seed);
      expect(game.track.gates.map((g) => [g.kind, ...g.pos])).toEqual(w.track.gates.map((g) => [g.kind, ...g.pos]));
      expect(game.track.laps).toBe(w.track.laps);
    }
  }, 120_000);
});
