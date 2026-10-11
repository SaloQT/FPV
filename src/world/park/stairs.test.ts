import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../../contracts';
import { STAIR_MAX_RISER, STAIR_RAIL_RADIUS, stairFlight } from './assembly';
import { auditPark } from './constructionAudit';
import { gjk, solidOf } from './interference';
import { rotate } from './math';
import { CONCRETE, METAL, Parts } from './parts';
import { defaultParkRecipe } from './recipe';
import type { ParkData } from './types';

const INCH = 0.0254, ORIGIN: Vec3 = [3, 1, -2];
function scene(): ParkData {
  return { recipe: defaultParkRecipe(), layout: 'hub', bounds: { min: [-1000, -100, -1000], max: [1000, 100, 1000] }, entrance: 0, launch: { pos: [0, 0, 0], yaw: 0 },
    rides: [], parts: [], bodies: [], lights: [], rooms: [], routes: [], nodes: [], paths: [] };
}

/** Ride stairs follow the 2010 ADA Standards limits quoted in docs/park-construction-sources.md: risers at most 7 in (504.2),
 * the handrail grip top 34 to 38 in above the nosings (505.4), a round grip 1.25 to 2 in across (505.7.1), 1.5 in clear of
 * anything beside it (505.5), and nothing touching the grip except from below (505.6). */
describe('ride stairs', () => {
  const cases = [0.45, 1.2, 2.9, 6.1].flatMap(rise => [false, true].flatMap(guarded => [0, 0.7].map(yaw => ({ rise, guarded, yaw }))));
  it.each(cases)('rise $rise m, guard $guarded, yaw $yaw', ({ rise, guarded, yaw }) => {
    const park = scene(), b = new Parts(park, ORIGIN, yaw);
    const flight = stairFlight(b, { halfWidth: 1.5, bottomY: 0, topY: rise, topZ: 0, color: CONCRETE, railColor: METAL, name: 'stair', ...(guarded ? { guardHeight: 1.05 } : {}) });
    const riser = rise / flight.steps, going = flight.length / flight.steps, slope = riser / going;
    // Builder-frame z of a world point (the builder turns by yaw about +y), and the nosing line height there.
    const localZ = (p: Vec3) => (p[0] - ORIGIN[0]) * Math.sin(yaw) + (p[2] - ORIGIN[2]) * Math.cos(yaw);
    const nosing = (z: number) => ORIGIN[1] + riser + (flight.length - z) * slope;
    expect(riser).toBeLessThanOrEqual(STAIR_MAX_RISER + 1e-12);
    expect(2 * STAIR_RAIL_RADIUS).toBeGreaterThanOrEqual(1.25 * INCH); expect(2 * STAIR_RAIL_RADIUS).toBeLessThanOrEqual(2 * INCH);
    expect(flight.handrails).toHaveLength(2); expect(flight.guards).toHaveLength(guarded ? 2 : 0);
    for (const rail of flight.handrails) {
      const railZ = localZ(rail.pos), axisAt = (z: number) => rail.pos[1] + (railZ - z) * slope;
      const grip = rail.pos[1] + STAIR_RAIL_RADIUS * Math.hypot(1, slope) - nosing(railZ);
      expect(grip).toBeGreaterThanOrEqual(34 * INCH); expect(grip).toBeLessThanOrEqual(38 * INCH);
      const handrail = solidOf(rail, park.parts.indexOf(rail));
      let obstructed = 0;
      park.parts.forEach((part, i) => {
        if (part === rail) return;
        const gap = gjk(handrail, solidOf(part, i));
        if (!gap.intersect && gap.distance >= 1.5 * INCH - 1e-9) return;
        // Anything nearer than 1.5 in must be a vertical bar ending inside the rail from below, its top on the rail axis.
        expect(part.shape === 'cylinder' && Math.abs(Math.abs(rotate(part.rot, [0, 1, 0])[1]) - 1) < 1e-9, `part ${i} meets the handrail from the side: ${part.shape} half ${part.half} pos ${part.pos.map(v => v.toFixed(3))} gap ${gap.intersect ? "overlap" : gap.distance.toFixed(4)} rail ${rail.pos.map(v => v.toFixed(3))}`).toBe(true);
        expect(part.pos[1] + part.half[1], `part ${i} rises past the handrail axis`).toBeLessThanOrEqual(axisAt(localZ(part.pos)) + 1e-9);
        obstructed += 2 * part.half[0] * Math.hypot(1, slope);
      });
      // 505.6: the bottom of the grip is obstructed for at most 20 percent of its length.
      expect(obstructed).toBeLessThanOrEqual(0.2 * 2 * rail.half[1]);
    }
    const report = auditPark(park, [], { checks: { support: false } });
    expect(report.findings.map(f => `${f.kind} ${(f.measured * 1000).toFixed(1)} mm ${f.parts} ${f.detail}`)).toEqual([]);
  });
});
