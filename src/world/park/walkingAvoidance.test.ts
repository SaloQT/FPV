import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../../contracts';
import type { ParkRuntime } from './runtime';
import type { ParkPart } from './types';
import type { AvoidanceLine } from './crowd';
import { ParkCollision } from './collision';

const box = (pos: Vec3, half: Vec3): ParkPart => ({ shape: 'box', pos, half, rot: [0, 0, 0, 1], color: [0.2, 0.2, 0.2], roughness: 0.9, metalness: 0, emissive: 0, solid: true, detail: 0, body: -1 });
function avoidance(parts: ParkPart[], feet: Vec3): AvoidanceLine[] {
  const crowd: { avoidObstacles?: (x: number, y: number, z: number, lines: AvoidanceLine[]) => void } = {};
  const runtime = { park: { parts, rides: [] }, bodies: [], previousBodies: [], crowd, elapsed: 0, tick: 0 };
  new ParkCollision(runtime as unknown as ParkRuntime);
  const lines: AvoidanceLine[] = []; crowd.avoidObstacles!(...feet, lines); return lines;
}

describe('pedestrian obstacle broad phase', () => {
  it('blocks a shin-high planter that the old shoulder-only probe missed', () => {
    const lines = avoidance([box([0, 12.25, 0], [0.5, 0.2, 0.5])], [0.75, 12, 0]);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.some(line => line.nx > 0.99 && Math.abs(line.nz) < 1e-8 && line.c > 0)).toBe(true);
  });
  it('does not treat pavement and stepable curbs as pedestrian walls', () => {
    const lines = avoidance([box([0, 12.04, 0], [3, 0.04, 3]), box([2, 12.16, 0], [0.1, 0.04, 2])], [1.95, 12, 0]);
    expect(lines).toEqual([]);
  });
  it('keeps avoiding full-height structures and uses the complete tree away from park ground level', () => {
    const wall = box([0, 13.5, 0], [0.5, 1.5, 0.5]), upperWall = box([0, 23.5, 0], [0.5, 1.5, 0.5]);
    for (const [parts, feet] of [[[wall], [0.75, 12, 0]], [[upperWall], [0.75, 22, 0]]] as [ParkPart[], Vec3][]) {
      expect(avoidance(parts, feet).some(line => line.nx > 0.99 && line.c > 0)).toBe(true);
    }
  });
});
