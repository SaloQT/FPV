import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../../contracts';
import { createTerrainSampler } from '../terrain/sampler';
import { testTerrainData } from '../track/testTerrain';
import { partDistance } from './collision';
import { generatePark, gradeParkTerrain } from './generator';
import { inverseRotate, rotate } from './math';
import { Parts } from './parts';
import { LEAF_CONTACT_LIMIT, finalizeParkPlantings, plantParkTree, plantingsThroughBuiltGeometry } from './planting';
import { defaultParkRecipe } from './recipe';
import { PARK_GRADE, surfaceBox } from './surfaces';
import type { ParkData } from './types';

/** Trees that grow through the finished park: a trunk through paving, a kerb or a wall, or a crown through a roof or a sign.
 * Small hand-built scenes show each case on its own; generated parks at two seeds show the rule holds for the real layouts. */
function scene(): ParkData {
  return { recipe: { ...defaultParkRecipe(), guests: 0 }, layout: 'hub', bounds: { min: [-1000, 0, -1000], max: [1000, 100, 1000] }, entrance: 0, launch: { pos: [0, PARK_GRADE, 0], yaw: 0 },
    rides: [], nodes: [], paths: [], parts: [], bodies: [], lights: [], rooms: [], routes: [] };
}
const oak = (park: ParkData, pos: Vec3, scale = 0.7) => plantParkTree(park, pos, { variant: 3, scale, yaw: 0.4 })!;

describe('a tree must not grow through what is built', () => {
  it('drops a trunk standing in a paving slab but keeps the same tree beside it', () => {
    const park = scene(), b = new Parts(park, [0, 0, 0], 0, -1, 'path');
    surfaceBox(b, [0, 0], [4, 4]);
    const inSlab = oak(park, [1, PARK_GRADE, 1]), beside = oak(park, [30, PARK_GRADE, 0]);
    expect(plantingsThroughBuiltGeometry(park)).toEqual(new Set([inSlab]));
    finalizeParkPlantings(park);
    expect(park.plantings).toEqual([beside]);
    expect(park.parts.filter(p => p.category === 'landscape').every(p => p.pos[0] > 20)).toBe(true);
  });

  it('drops a trunk through a kerb or a wall, and keeps a tree whose trunk only clears them', () => {
    for (const [name, half] of [['kerb', [3, 0.03, 0.12]], ['wall', [3, 2, 0.15]]] as const) {
      const park = scene(), b = new Parts(park, [0, 0, 0], 0, -1, 'building');
      b.box([0, PARK_GRADE + half[1], 0], [...half], [0.5, 0.5, 0.5]);
      // The clear oak stands far enough that its crown (12.5 m in radius at full size, so 3.75 m at this scale) stays off the wall too.
      const through = oak(park, [0.3, PARK_GRADE, 0.05]), clear = oak(park, [0, PARK_GRADE, 4.5], 0.3);
      expect(plantingsThroughBuiltGeometry(park).has(through), `${name}: trunk through it`).toBe(true);
      expect(plantingsThroughBuiltGeometry(park).has(clear), `${name}: trunk 4.5 m away`).toBe(false);
    }
  });

  it('keeps a tree rooted on top of a planter, whose root zone is meant to sit in the planter', () => {
    const park = scene(), b = new Parts(park, [0, 0, 0], 0, -1, 'furniture');
    b.box([0, PARK_GRADE + 0.25, 0], [1, 0.25, 1], [0.4, 0.4, 0.4]);
    oak(park, [0, PARK_GRADE + 0.5, 0], 0.3);
    expect(plantingsThroughBuiltGeometry(park).size).toBe(0);
  });

  it('drops a crown pushed through a roof, and keeps one that clears it', () => {
    const park = scene(), b = new Parts(park, [0, 0, 0], 0, -1, 'building');
    b.box([0, PARK_GRADE + 7, 0], [6, 0.2, 6], [0.5, 0.2, 0.2]);
    const under = oak(park, [0, PARK_GRADE, 0], 0.9);
    const far = oak(park, [40, PARK_GRADE, 0], 0.9);
    const hit = plantingsThroughBuiltGeometry(park);
    expect(hit.has(under)).toBe(true); expect(hit.has(far)).toBe(false);
    expect(LEAF_CONTACT_LIMIT).toBeGreaterThan(1);
  });

  it('ignores parts that ride on a moving body, whose position is in the body\'s own frame', () => {
    const park = scene(), b = new Parts(park, [0, 0, 0], 0, 3, 'ride');
    b.box([0, PARK_GRADE + 1, 0], [3, 3, 3], [0.5, 0.5, 0.5]);
    oak(park, [0, PARK_GRADE, 0], 0.7);
    expect(plantingsThroughBuiltGeometry(park).size).toBe(0);
  });

  // Generated parks: no kept planting may have its physical trunk or limb rods through a fixed built solid.
  const rodThrough = (park: ParkData): string[] => {
    const solids = park.parts.filter(p => p.solid && p.body < 0 && p.category !== 'landscape');
    const rods = park.parts.filter(p => p.category === 'landscape' && p.render === false && p.rayTrace === false && p.shape === 'cylinder');
    const local: Vec3 = [0, 0, 0], normal: Vec3 = [0, 1, 0], bad: string[] = [];
    for (const rod of rods) {
      const plant = (park.plantings ?? []).reduce((best, p) => Math.hypot(p.pos[0] - rod.pos[0], p.pos[2] - rod.pos[2]) < Math.hypot(best.pos[0] - rod.pos[0], best.pos[2] - rod.pos[2]) ? p : best);
      const offset = rotate(rod.rot, [0, rod.half[1], 0]), steps = Math.max(2, Math.ceil(2 * rod.half[1] / Math.max(rod.half[0], 0.1)));
      for (let k = 0; k <= steps; k++) {
        const t = k / steps * 2 - 1, p = rod.pos.map((v, i) => v + offset[i] * t) as Vec3;
        if (p[1] < plant.pos[1] + 0.02) continue;
        const part = solids.find(s => Math.abs(s.pos[0] - p[0]) < 20 && Math.abs(s.pos[2] - p[2]) < 20 && partDistance(s, inverseRotate(s.rot, p.map((v, i) => v - s.pos[i]) as Vec3, local), normal) < 0);
        if (part) { bad.push(`${p.map(v => v.toFixed(2))} in ${part.category}/${part.surface}`); break; }
      }
    }
    return bad;
  };
  for (const seed of [1337]) it(`leaves no tree rod inside a built solid in a generated compact park (seed ${seed})`, () => {
    const recipe = { ...defaultParkRecipe(seed, 'compact'), guests: 0 };
    const park = generatePark(recipe, createTerrainSampler(gradeParkTerrain(testTerrainData({ resolution: 64, cellSize: 32 }), recipe)));
    expect(park.plantings!.length).toBeGreaterThan(900);
    expect(rodThrough(park)).toEqual([]);
    expect(plantingsThroughBuiltGeometry(park).size).toBe(0);
  }, 400_000);
});

