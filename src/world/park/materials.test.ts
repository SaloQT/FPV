import { describe, expect, it } from 'vitest';
import { createTerrainSampler } from '../terrain/sampler';
import { testTerrainData } from '../track/testTerrain';
import { generatePark, gradeParkTerrain } from './generator';
import { NON_METAL_SURFACES, Parts } from './parts';
import { defaultParkRecipe } from './recipe';
import type { ParkData, ParkSize } from './types';

describe('park materials', () => {
  it('refuses a metalness on a non-metal surface when a part is built', () => {
    const b = new Parts({ parts: [] } as unknown as ParkData);
    expect(() => b.box([0, 0, 0], [1, 1, 1], [0.1, 0.1, 0.1], { surface: 'glass', metalness: 0.2 })).toThrow(/glass part cannot have metalness/);
    expect(() => b.box([0, 0, 0], [1, 1, 1], [0.1, 0.1, 0.1], { surface: 'glass', metalness: 0 })).not.toThrow();
  });
  /** Recolouring after a part is built (show-building blackout, palettes) must keep the rule too. */
  it.each([[1337, 'destination'], [7, 'compact']] as [number, ParkSize][])('gives concrete, timber, fabric, masonry, foliage, paving and glass no metalness (seed %i, %s)', (seed, size) => {
    const recipe = { ...defaultParkRecipe(seed, size), guests: 0 };
    const park = generatePark(recipe, createTerrainSampler(gradeParkTerrain(testTerrainData({ resolution: 64, cellSize: 32 }), recipe)));
    const metallic = park.parts.flatMap((p, i) => NON_METAL_SURFACES.has(p.surface) && p.metalness !== 0 ? [`${p.surface} part ${i} metalness ${p.metalness} at ${p.pos.map(v => v.toFixed(2))}`] : []);
    expect(metallic.slice(0, 20)).toEqual([]);
  }, 120000);
});
