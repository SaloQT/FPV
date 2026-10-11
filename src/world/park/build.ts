import type { ProgressFn } from '../../contracts';
import { generateTerrain } from '../terrain/generate';
import { createTerrainSampler } from '../terrain/sampler';
import { generatePark, gradeParkTerrain, selectedParkTrack } from './generator';
import { sanitizeParkRecipe } from './recipe';
import type { ParkBuild, ParkRecipe } from './types';

/** Canonical physical terrain: graphics settings never change a park or its navigation. */
export function buildPark(recipeInput: ParkRecipe, progress?: ProgressFn): ParkBuild {
  const recipe = sanitizeParkRecipe(recipeInput);
  const terrain = gradeParkTerrain(generateTerrain({ seed: recipe.seed, quality: 'high', resolution: 1024, cellSize: 2, relief: 60 },
    (s, f) => progress?.(s, f * 0.3)), recipe);
  const park = generatePark(recipe, createTerrainSampler(terrain), (s, f) => progress?.(s, 0.3 + f * 0.7));
  return { terrain, park, track: selectedParkTrack(park) };
}
