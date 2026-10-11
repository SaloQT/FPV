import { expect, it } from 'vitest';
import { RT_PRIM_CAP } from '../../render/vegetation/colliders';
import { parkCanopyProxies, parkWoodProxies } from '../../render/vegetation/parkPlanting';
import { MAX_PRIMS } from '../../render/rt/bvh';
import { createTerrainSampler } from '../terrain/sampler';
import { testTerrainData } from '../track/testTerrain';
import { generatePark, gradeParkTerrain } from './generator';
import { defaultParkRecipe } from './recipe';

it.each(['destination', 'mega'] as const)('keeps %s scenery, operating rides and every guest within the RT primitive budget', size => {
  const recipe = defaultParkRecipe(1337, size);
  const park = generatePark(recipe, createTerrainSampler(gradeParkTerrain(testTerrainData({ resolution: 64, cellSize: 32 }), recipe)));
  const orphaned = park.joints?.filter(j => [j.a, j.b].some(a => { const p = park.parts[a.part]; return p.surface === 'paving' && p.render === false && !p.solid; }));
  expect(orphaned?.map(j => j.name), 'Construction anchors must reference retained material, never hidden pavement source slabs').toEqual([]);
  const physicalWood = park.parts.filter(p => p.render === false && p.rayTrace === false).length;
  const partProxies = park.parts.filter(p => p.rayTrace !== false && p.detail === 0 && (p.solid || p.emissive > 0));
  const coarseWood = parkWoodProxies(park.plantings).length, canopies = parkCanopyProxies(park.plantings).length;
  // Includes a full natural-forest allocation and every visitor even though the renderer uses separate static/dynamic BVHs.
  const total = partProxies.length + coarseWood + canopies + recipe.guests + RT_PRIM_CAP;
  expect(coarseWood).toBeLessThan(physicalWood / 2);
  expect(canopies).toBeGreaterThanOrEqual(park.plantings!.length);
  expect(canopies).toBeLessThanOrEqual(3 * park.plantings!.length);
  expect(total, `${size}: ${partProxies.length} ride/scenery + ${coarseWood} wood + ${canopies} canopy + ${recipe.guests} guests + ${RT_PRIM_CAP} forest`).toBeLessThan(MAX_PRIMS);
  console.info(`${size} RT budget: ${total}/${MAX_PRIMS}; woody shadows ${physicalWood} → ${coarseWood}; ${canopies} planted canopies`);
}, 30000);
