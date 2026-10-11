import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../../contracts';
import { partDistance } from './collision';
import { inverseRotate } from './math';
import { carParts, RUBBER } from './parts';
import { COASTER_SEAT } from './rideDimensions';
import { COASTER_FAMILIES, type CoasterFamily, type ParkData, type RideDefinition } from './types';

function build(family: CoasterFamily) {
  const ride = { id: 0, family, carLength: 3.4, bodies: [0] } as RideDefinition;
  const park = { parts: [], bodies: [{ ride: 0, role: 'car', index: 0, local: [0, 0, 0], train: 0 }] } as unknown as ParkData;
  carParts(park, 0, ride, [0.2, 0.3, 0.4]); return { park, ride };
}

describe('manufactured coaster vehicles', () => {
  it('aligns all cushions and restraints with the authoritative seated pelvis anchors', () => {
    for (const family of COASTER_FAMILIES) {
      const { park } = build(family), cushions = park.parts.filter(p => p.body === 0 && p.shape === 'box' && p.color === RUBBER && p.half[0] === 0.245);
      expect(cushions).toHaveLength(4);
      for (const seat of cushions) expect(seat.pos[1] + seat.half[1]).toBeCloseTo(family === 'inverted' ? -1.5 : COASTER_SEAT, 12);
      expect(park.bodies.filter(b => b.role === 'restraint')).toHaveLength(4);
      expect(park.bodies.slice(1).every(b => b.parent === 0 && b.train === 0)).toBe(true);
      expect(park.parts.every(p => [...p.pos, ...p.half, ...p.rot].every(Number.isFinite))).toBe(true);
    }
  });
  it('places load, up-stop and side guide wheels tangent to each running rail', () => {
    for (const family of ['steel', 'inverted'] as const) {
      const { park } = build(family), wheels = park.parts.filter(p => p.wheelRadius);
      expect(wheels).toHaveLength(12);
      for (const wheel of wheels) {
        const rail: Vec3 = [Math.sign(wheel.pos[0]) * 0.71, 0, wheel.pos[2]], local = inverseRotate(wheel.rot, rail.map((v, k) => v - wheel.pos[k]) as Vec3);
        expect(partDistance(wheel, local, [0, 1, 0])).toBeCloseTo(0.085, 10);
      }
    }
  });
});
