import { describe, expect, it } from 'vitest';
import { gameplayQuality, type RenderQuality, type TerrainQuality } from '../contracts';
import { EXTREME_PROFILE, isExtreme, qualityProfile, tierTable } from '../render/contracts';
import { qualityCostIndex, resolveQuality } from '../render/qualityPresets';
import { buildColliders } from '../render/vegetation/colliders';
import { TIER_LIMITS, placeVegetation } from '../render/vegetation/placement';
import { trackBoardKey } from '../ui/leaderboard';
import { trackFileJson } from '../ui/builderModel';
import { shareUrl } from '../ui/seedModel';
import { defaultAppSettings, SETTINGS_KEY, SETTINGS_VERSION } from '../ui/settingsSchema';
import { SettingsStore, type StorageLike } from '../ui/settingsStore';
import { createTerrainSampler, generateTerrain } from '../world/terrain';
import { generateTrack } from '../world/track/generator';
import { parseParams, settingsPatch } from './params';
import { worldKey } from './preview';
import { buildWorld, type World, type WorldDeps } from './world';

function storage(saved: unknown): StorageLike {
  const data = new Map<string, string>([[SETTINGS_KEY, JSON.stringify(saved)]]);
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
}

describe('extreme is a selectable tier', () => {
  it('parses from the URL', () => {
    const p = parseParams('?quality=extreme');
    expect(p.quality).toBe('extreme');
    expect(settingsPatch(p, defaultAppSettings()).quality).toBe('extreme');
  });

  it('loads from saved settings, and settings saved before it existed still load', () => {
    expect(new SettingsStore(storage({ version: SETTINGS_VERSION, settings: { quality: 'extreme' } })).get().quality).toBe('extreme');
    expect(new SettingsStore(storage({ version: SETTINGS_VERSION, settings: { quality: 'ultra', fov: 100 } })).get()).toMatchObject({ quality: 'ultra', fov: 100 });
    const old = new SettingsStore(storage({ version: SETTINGS_VERSION, settings: { fov: 95 } })).get();
    expect(old.quality).toBe(defaultAppSettings().quality);
    expect(old.fov).toBe(95);
  });

  it('turns Performance 240 off when picked', () => {
    const store = new SettingsStore(null);
    store.patch({ quality: 'high', performance240: true });
    store.patch({ quality: 'extreme', performance240: false });
    expect(store.get()).toMatchObject({ quality: 'extreme', performance240: false });
  });
});

describe('extreme starts as ultra', () => {
  it('has the ultra profile with only the EXTREME_PROFILE fields replaced', () => {
    expect(qualityProfile('extreme')).toEqual({ ...qualityProfile('ultra'), ...EXTREME_PROFILE, tier: 'extreme' });
    expect(resolveQuality({ quality: 'extreme', performance240: false }).tier).toBe('extreme');
  });

  it('never asks for less work than ultra', () => {
    expect(qualityCostIndex(qualityProfile('extreme'))).toBeGreaterThanOrEqual(qualityCostIndex(qualityProfile('ultra')));
  });

  it('isExtreme answers for a tier or a profile', () => {
    expect(isExtreme('extreme')).toBe(true);
    expect(isExtreme(qualityProfile('extreme'))).toBe(true);
    for (const t of ['low', 'medium', 'high', 'ultra'] as const) expect(isExtreme(qualityProfile(t))).toBe(false);
  });

  it('tier tables give extreme the ultra value unless a module opts in', () => {
    const table = tierTable({ low: 1, medium: 2, high: 3, ultra: 4 });
    expect(table.extreme).toBe(4);
    expect(tierTable({ low: 1, medium: 2, high: 3, ultra: 4 }, 9)).toEqual({ low: 1, medium: 2, high: 3, ultra: 4, extreme: 9 });
  });
});

describe('extreme never changes gameplay', () => {
  it('builds the world, places vegetation and keys tracks as ultra', () => {
    expect(gameplayQuality('extreme')).toBe('ultra');
    for (const q of ['low', 'medium', 'high', 'ultra'] as const) expect(gameplayQuality(q)).toBe(q);
    expect(TIER_LIMITS.extreme).toEqual(TIER_LIMITS.ultra);
  });

  // The app's own world path (terrain, track) at a small grid, then the vegetation and colliders the game builds on it.
  const asked: TerrainQuality[] = [];
  const deps: WorldDeps = {
    generateTerrain: async (p) => {
      asked.push(p.quality);
      return generateTerrain({ ...p, resolution: 256, cellSize: 8 });
    },
    createSampler: createTerrainSampler,
    generateTrack,
  };
  const build = (seed: number, quality: RenderQuality): Promise<World> =>
    buildWorld({ seed, style: 'race', gateCount: 8, laps: 2, difficulty: 0.5, quality }, deps);

  for (const seed of [7, 1337, 90210]) {
    it(`seed ${seed}: terrain, track, placement and colliders match ultra`, async () => {
      asked.length = 0;
      const [u, x] = await Promise.all([build(seed, 'ultra'), build(seed, 'extreme')]);
      expect(asked).toEqual(['ultra', 'ultra']);
      expect(x.terrain.height.length).toBe(256 * 256);
      expect(x.terrain).toEqual(u.terrain);
      expect(x.track).toEqual(u.track);
      const pu = placeVegetation(u.terrain, u.track, TIER_LIMITS.ultra);
      const px = placeVegetation(x.terrain, x.track, TIER_LIMITS.extreme);
      expect(px).toEqual(pu);
      expect(buildColliders(px)).toEqual(buildColliders(pu));
      expect(trackBoardKey(x.terrainSeed, x.quality, x.track)).toBe(trackBoardKey(u.terrainSeed, u.quality, u.track));
    }, 60000);
  }

  it('shares, saves and previews the same world as ultra', () => {
    const s = { ...defaultAppSettings(), quality: 'extreme' as const };
    expect(worldKey(s)).toBe(worldKey({ ...s, quality: 'ultra' }));
    const w = { terrainSeed: 5, trackSeed: 5, style: 'race' as const, gateCount: 8, laps: 2, difficulty: 0.5, quality: 'extreme' as const };
    expect(new URL(shareUrl('https://example.test/', w)).searchParams.get('quality')).toBe('ultra');
    const track = { gates: [], path: [], obstacles: [], style: 'race' } as unknown as Parameters<typeof trackFileJson>[0]['track'];
    expect(JSON.parse(trackFileJson({ terrainSeed: 5, quality: 'extreme', track })).quality).toBe('ultra');
  });
});
