import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../../contracts';
import { VARIANT_DEFS, variantPlan } from '../../render/vegetation/variants';
import { buildTreeLods } from '../../render/vegetation/treeGen';
import { add, distance, mul, rotate, yawPoint } from './math';
import { MAX_PARK_PLANTINGS, MAX_PLANT_WOOD_SEGMENTS, finalizeParkPlantings, plantParkTree, plantingBounds } from './planting';
import { defaultParkRecipe } from './recipe';
import type { ParkData } from './types';

function emptyPark(): ParkData {
  return { recipe: { ...defaultParkRecipe(), guests: 0 }, layout: 'hub', bounds: { min: [-1000, 0, -1000], max: [1000, 100, 1000] }, entrance: 0, launch: { pos: [0, 12, 0], yaw: 0 },
    rides: [], nodes: [], paths: [], parts: [], bodies: [], lights: [], rooms: [], routes: [] };
}

describe('explicit engine tree planting', () => {
  it('reserves a mature footprint containing the actual bark and leaf-card vertices at every LOD', () => {
    for (let variant = 0; variant < 8; variant++) {
      const plant = { pos: [0, 0, 0] as Vec3, yaw: 0.81, scale: 0.73, variant, tint: [1, 1, 1] as Vec3 }, bounds = plantingBounds(plant);
      for (const mesh of buildTreeLods(variantPlan(variant)!, VARIANT_DEFS[variant].seed)) {
        let radius = 0, height = 0;
        for (let i = 0; i < mesh.vertexCount; i++) { radius = Math.max(radius, Math.hypot(mesh.pos[i * 3], mesh.pos[i * 3 + 2]) * plant.scale); height = Math.max(height, mesh.pos[i * 3 + 1] * plant.scale); }
        expect(radius, `variant ${variant} mature radius`).toBeLessThanOrEqual(bounds.radius + 1e-6);
        expect(height, `variant ${variant} mature height`).toBeLessThanOrEqual(bounds.height + 1e-6);
      }
    }
  }, 60000);
  it('places solid woody segments on the same deterministic skeleton as the rendered variant', () => {
    for (let variant = 0; variant < 6; variant++) {
      const park = emptyPark(), plant = plantParkTree(park, [30.2, 12, -14.7], { variant, scale: 0.65, yaw: 1.25 })!;
      const plan = variantPlan(variant)!;
      const segments = plan.limbs.filter(limb => limb.order < 2).flatMap(limb => limb.pts.slice(1).map((point, i) => ({
        a: yawPoint(plant.pos, plant.yaw, mul(limb.pts[i], plant.scale)), b: yawPoint(plant.pos, plant.yaw, mul(point, plant.scale)),
        radius: Math.min(limb.radii[i], limb.radii[i + 1]) * plant.scale * (limb.order === 0 ? 0.92 : 0.85),
      })));
      expect(park.parts.length).toBeGreaterThan(3); expect(park.parts.length).toBeLessThanOrEqual(MAX_PLANT_WOOD_SEGMENTS);
      for (const part of park.parts) {
        const offset = rotate(part.rot, [0, part.half[1], 0]), a = add(part.pos, mul(offset, -1)), b = add(part.pos, offset);
        const same = segments.find(s => distance(a, s.a) < 1e-7 && distance(b, s.b) < 1e-7);
        expect(same, `variant ${variant}: shared physical segment`).toBeDefined();
        expect(part.half[0]).toBeCloseTo(same!.radius, 10);
        expect(part.solid).toBe(true); expect(part.render).toBe(false); expect(part.rayTrace).toBe(false); expect(part.category).toBe('landscape');
      }
      const again = emptyPark(); plantParkTree(again, [30.2, 12, -14.7], { variant, scale: 0.65, yaw: 1.25 });
      expect(again.parts).toEqual(park.parts); expect(again.plantings).toEqual(park.plantings);
      expect(plantingBounds(plant).height).toBeGreaterThan(5);
    }
  });

  it('reserves a mature tree envelope around complete flight-guide segments', () => {
    const park = emptyPark();
    plantParkTree(park, [0, 12, 0], { variant: 3, scale: 0.5 });
    const far = plantParkTree(park, [80, 12, 0], { variant: 3, scale: 0.5 })!;
    const before = park.parts.length;
    park.routes.push({ seed: 1, style: 'freestyle', gates: [], obstacles: [], path: [[-20, 16, 0], [20, 16, 0]], closed: false, length: 40, start: park.launch, laps: 1 });
    finalizeParkPlantings(park);
    expect(park.plantings).toEqual([far]); expect(park.parts.length).toBe(before / 2);
    expect(park.parts.every(part => part.pos[0] > 70)).toBe(true);
  });

  it('uses a deterministic generation cap without graphics settings and keeps soft shrubs non-solid', () => {
    const park = emptyPark();
    for (let i = 0; i < MAX_PARK_PLANTINGS + 3; i++) plantParkTree(park, [i, 12, 0], { variant: 6, scale: 0.8, tint: [0.9, 1.1, 0.9] });
    expect(park.plantings).toHaveLength(MAX_PARK_PLANTINGS); expect(park.parts).toHaveLength(0);
    expect(() => plantParkTree(emptyPark(), [0, 0, 0], { variant: 8, scale: 1 })).toThrow('variant');
    expect(() => plantParkTree(emptyPark(), [0, 0, 0] as Vec3, { variant: 0, scale: NaN })).toThrow('finite');
  });
});
