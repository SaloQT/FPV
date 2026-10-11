import { describe, expect, it, vi } from 'vitest';
import { parseParams, settingsPatch } from '../../app/params';
import { buildWorld } from '../../app/world';
import { makeTrack } from '../../game/testKit';
import { defaultAppSettings } from '../../ui/settingsSchema';
import { decodeParkRecipe, shareUrl, shareWorld, toBase64Url } from '../../ui/seedModel';
import { testTerrainData } from '../track/testTerrain';
import { createTerrainSampler } from '../terrain/sampler';
import { defaultParkRecipe } from './recipe';
import { parkSettings } from './settings';
import type { ParkData, ParkRecipe } from './types';

describe('theme park application integration', () => {
  it('reopens the complete recipe from a share link independently of graphics quality', () => {
    const recipe: ParkRecipe = { ...defaultParkRecipe(4294967295, 'mega'), layout: 'boardwalk', theme: 'steampunk', guests: 8765, route: 'coaster', coaster: 9 };
    const settings = { ...defaultAppSettings(), ...parkSettings(recipe) };
    const url = new URL(shareUrl('https://sim.example/fly/?old=1#old', shareWorld(settings, null)));
    expect(url.hash).toBe(''); expect(url.searchParams.has('old')).toBe(false);
    for (const quality of ['low', 'ultra']) {
      url.searchParams.set('quality', quality);
      const params = parseParams(url.search);
      expect(params.parkRecipe).toEqual(recipe);
      expect(settingsPatch(params, defaultAppSettings())).toMatchObject({ ...parkSettings(recipe), quality });
    }
  });

  it('sanitizes handwritten URLs and ignores damaged or unsupported recipe links', () => {
    const params = parseParams('?world=theme-park&seed=17&size=compact&layout=valley&theme=space&guests=12000&route=coaster&coaster=99');
    expect(params.parkRecipe).toEqual({ ...defaultParkRecipe(17, 'compact'), layout: 'valley', theme: 'space', guests: 10000, route: 'coaster', coaster: 2 });
    for (const code of ['garbage!', 'eyJzZWVkIjo', toBase64Url(JSON.stringify({ version: 2, seed: 7 })), 'A'.repeat(4097)]) {
      expect(decodeParkRecipe(code)).toBeNull(); expect(parseParams(`?park=${code}`).parkRecipe).toBeUndefined();
    }
    expect(parseParams('').parkRecipe).toBeUndefined();
  });

  it('builds a park through its worker dependency without calling legacy generators or changing its physical world by tier', async () => {
    const recipe = defaultParkRecipe(81), terrain = testTerrainData(), track = makeTrack(0);
    const park: ParkData = { recipe, layout: 'hub', bounds: { min: [-1024, 0, -1024], max: [1024, 200, 1024] }, entrance: 0,
      launch: { pos: [0, 12, 100], yaw: 0 }, rides: [], nodes: [], paths: [], parts: [], bodies: [], lights: [], rooms: [], routes: [track] };
    const generatePark = vi.fn(async () => ({ terrain, park, track })), generateTerrain = vi.fn(), generateTrack = vi.fn();
    for (const quality of ['low', 'ultra'] as const) {
      const world = await buildWorld({ parkRecipe: recipe, seed: 81, style: 'race', gateCount: 12, laps: 3, difficulty: 0.35, quality },
        { generatePark, generateTerrain, generateTrack, createSampler: createTerrainSampler });
      expect(world.terrain).toBe(terrain); expect(world.park).toBe(park); expect(world.request.parkRecipe).toBe(recipe);
      expect(world.seed).toBe(81); expect(world.quality).toBe(quality);
    }
    expect(generatePark).toHaveBeenCalledTimes(2); expect(generateTerrain).not.toHaveBeenCalled(); expect(generateTrack).not.toHaveBeenCalled();
  });
});
