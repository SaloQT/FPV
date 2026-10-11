import { expect, it } from 'vitest';
import type { Vec3 } from '../../contracts';
import { createTerrainSampler } from '../terrain/sampler';
import { testTerrainData } from '../track/testTerrain';
import { partDistance } from './collision';
import { generatePark, gradeParkTerrain } from './generator';
import { add, inverseRotate, rotate, sub, yawPoint } from './math';
import { defaultParkRecipe } from './recipe';

it('fits fixed tower caps inside the rotating roof aperture at maximum travel while covering every guide-column end', () => {
  const recipe = { ...defaultParkRecipe(1337), guests: 0 }, park = generatePark(recipe, createTerrainSampler(gradeParkTerrain(testTerrainData({ resolution: 64, cellSize: 32 }), recipe)));
  for (const ride of park.rides.filter(r => r.family === 'observation' || r.family === 'drop')) {
    const at = yawPoint(ride.pos, ride.yaw, [0, ride.height + 4, 0]);
    const cap = park.parts.find(p => p.body < 0 && p.shape === 'box' && Math.hypot(...sub(p.pos, at)) < 1e-8)!; expect(cap).toBeDefined();
    // Columns: the 0.3 m vertical tubes near the axis whose tops reach the cap centre plane (they stand in footings, so their length varies).
    const columns = park.parts.filter(p => p.body < 0 && p.shape === 'cylinder' && Math.abs(p.half[0] - 0.3) < 1e-8 && Math.abs(p.pos[1] + p.half[1] - at[1]) < 1e-8 && Math.hypot(p.pos[0] - ride.pos[0], p.pos[2] - ride.pos[2]) < 3);
    expect(columns).toHaveLength(4);
    for (const column of columns) for (let i = 0; i < 32; i++) {
      const local: Vec3 = [column.half[0] * Math.cos(i * Math.PI / 16), column.half[1], column.half[0] * Math.sin(i * Math.PI / 16)];
      const point = add(column.pos, rotate(column.rot, local));
      expect(partDistance(cap, inverseRotate(cap.rot, sub(point, cap.pos)), [0, 1, 0]), 'Full column cap must enter supporting top-cap material').toBeLessThanOrEqual(1e-9);
    }
    if (ride.family !== 'observation') continue;
    const roofIndices = new Set(park.joints!.filter(j => j.name.startsWith(`${ride.id}/tower-roof/`)).flatMap(j => [j.a.part, j.b.part]));
    const roof = [...roofIndices].map(i => park.parts[i]); expect(roof.length).toBeGreaterThan(0);
    // Exact closest radial distance of each actual oriented deck box to its rotation axis.
    // This circle contains no roof material at any rotation, so an enclosed cap clears the full sweep.
    const innerRadius = Math.min(...roof.map(p => {
      const local = inverseRotate(p.rot, [-p.pos[0], 0, -p.pos[2]]);
      return Math.hypot(Math.max(0, Math.abs(local[0]) - p.half[0]), Math.max(0, Math.abs(local[2]) - p.half[2]));
    }));
    const outerRadius = Math.hypot(cap.half[0], cap.half[2]);
    expect(innerRadius - outerRadius, 'Fixed-cap corners must clear the complete rotating roof sweep').toBeGreaterThan(0.14);
    // At the operating upper target these components overlap vertically; axial clearance alone cannot pass.
    const roofTop = ride.pos[1] + ride.height + Math.max(...roof.map(p => p.pos[1] + p.half[1]));
    expect(roofTop).toBeGreaterThan(cap.pos[1] - cap.half[1]);
  }
}, 30000);
