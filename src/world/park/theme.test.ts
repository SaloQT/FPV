import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../../contracts';
import { partDistance } from './collision';
import { inverseRotate, yawPoint } from './math';
import { defaultParkRecipe } from './recipe';
import { attractionScenery, decoratePublicRealm, themedBuilding } from './theme';
import { measureJoints } from './construction';
import { Parts } from './parts';
import { PARK_THEMES, type ParkData, type RideDefinition } from './types';

function scene(): ParkData {
  return { recipe: defaultParkRecipe(), layout: 'hub', bounds: { min: [-1000, 12, -1000], max: [1000, 100, 1000] }, entrance: 0, launch: { pos: [0, 12, 0], yaw: 0 }, rides: [], nodes: [], paths: [], parts: [], bodies: [], lights: [], rooms: [], routes: [] };
}

describe('physical theme architecture', () => {
  it('supports queue rail ends and grounds off-pavement gateway columns in every theme', () => {
    for (const theme of PARK_THEMES) {
      const park = scene(), yaw = 0.83, origin: Vec3 = [22, 12.2, -53];
      const ride = { id: 0, family: 'carousel', theme, yaw, name: 'TEST RIDE', queue: [origin] } as RideDefinition;
      attractionScenery(park, ride, true);
      const base = yawPoint(origin, yaw, [5, 0, 0]);
      const at = (local: Vec3) => { const world = yawPoint(base, yaw, local); return Math.min(...park.parts.filter(p => p.solid).map(p => partDistance(p, inverseRotate(p.rot, world.map((v, k) => v - p.pos[k]) as Vec3), [0, 1, 0]))); };
      for (let lane = 0; lane < 5; lane++) for (const y of [0, 0.5, 1.05]) expect(at([-5.6 + lane * 1.2, y, 13]), `${theme} rail end unsupported`).toBeLessThan(1e-9);
      for (const x of [-9, 9]) expect(Math.abs(at([x, -0.2, 20])), `${theme} floating gateway`).toBeLessThan(1e-9);
      expect(measureJoints(park).filter(m => !m.pass)).toEqual([]);
    }
  });
  it('builds hollow shop shells with closed street doors for every theme', () => {
    for (const theme of PARK_THEMES) {
      const park = scene(), origin: Vec3 = [42, 12, -30], yaw = 0.31;
      themedBuilding(park, origin, yaw, theme, 127);
      const at = (p: Vec3) => {
        const world = yawPoint(origin, yaw, p), local: Vec3 = [0, 0, 0], normal: Vec3 = [0, 1, 0];
        return Math.min(...park.parts.filter(part => part.solid).map(part => {
          for (let k = 0; k < 3; k++) local[k] = world[k] - part.pos[k];
          inverseRotate(part.rot, local, local); return partDistance(part, local, normal);
        }));
      };
      expect(at([0, 2, 0]), theme).toBeGreaterThan(0.6);
      expect(at([0.7, 1.6, -3.83]), theme).toBeLessThan(0);
      expect(at([5.85, 2.9, 0]), theme).toBeLessThan(0);
      expect(at([0, 0.08, -6.8]), `${theme} paved shop approach`).toBeLessThan(0);
      for (const part of park.parts) {
        expect([...part.pos, ...part.half, ...part.rot, ...part.color].every(Number.isFinite), theme).toBe(true);
        expect(part.half.every(v => v > 0), theme).toBe(true);
        if (part.shape === 'cone') expect(part.half[0]).toBe(part.half[2]);
      }
    }
  });
  it('mounts every show-building cladding back directly on its actual shell wall', () => {
    for (const wallHalf of [0.35, 0.57]) {
      const park = scene(), b = new Parts(park), center: Vec3 = [117, 27, -83], hx = 80, hz = 50, opening = 12, color: Vec3 = [0.01, 0.01, 0.01];
      const min: Vec3 = [center[0] - hx, 11.5, center[2] - hz], max: Vec3 = [center[0] + hx, 42, center[2] + hz];
      b.box([center[0], 42, center[2]], [hx, 0.35, hz], color);
      for (const side of [-1, 1]) {
        b.box([center[0] + side * hx, center[1], center[2]], [wallHalf, 15, hz], color);
        b.box([center[0] + side * (hx + opening) / 2, center[1], max[2]], [(hx - opening) / 2, 15, wallHalf], color);
      }
      b.box([center[0], center[1], min[2]], [hx, 15, wallHalf], color);
      park.rooms.push({ min, max, ride: 0 });
      attractionScenery(park, { id: 0, family: 'space', theme: 'space', yaw: 0.73, name: 'TEST RIDE', queue: [[0, 12.2, 100]] } as unknown as RideDefinition, true);
      const joints = park.joints!.filter(j => j.name === 'show-building/cladding wall face');
      expect(joints.length).toBeGreaterThan(20);
      for (const joint of joints) {
        const host = park.parts[joint.a.part], plate = park.parts[joint.b.part], axis = plate.half[0] < plate.half[2] ? 0 : 2, other = axis === 0 ? 2 : 0;
        for (const u of [-1, 0, 1]) for (const y of [-1, 0, 1]) {
          const point: Vec3 = [...plate.pos]; point[axis] = host.pos[axis] + Math.sign(plate.pos[axis] - host.pos[axis]) * host.half[axis];
          point[other] += u * plate.half[other]; point[1] += y * plate.half[1];
          for (const part of [host, plate]) {
            const local = inverseRotate(part.rot, point.map((v, k) => v - part.pos[k]) as Vec3);
            expect(Math.abs(partDistance(part, local, [0, 1, 0]))).toBeLessThan(1e-9);
          }
        }
      }
      expect(measureJoints(park).filter(m => !m.pass)).toEqual([]);
    }
  });
  it('connects rest terraces to the pedestrian graph while keeping their approach aisle clear', () => {
    const park = scene();
    park.nodes = [{ pos: [0, 12.2, 0], links: [1], kind: 'entrance' }, { pos: [0, 12.2, 120], links: [0], kind: 'path' }];
    park.paths = [{ a: 0, b: 1, width: 8 }];
    decoratePublicRealm(park);
    expect(park.nodes.filter(n => n.kind === 'facility')).toHaveLength(1);
    const seen = new Set([0]), todo = [0];
    while (todo.length) for (const id of park.nodes[todo.pop()!].links) if (!seen.has(id)) { seen.add(id); todo.push(id); }
    expect(seen.size).toBe(park.nodes.length);
    for (const path of park.paths) if (path.width === 2.4) {
      const a = park.nodes[path.a].pos, b = park.nodes[path.b].pos, local: Vec3 = [0, 0, 0], normal: Vec3 = [0, 1, 0];
      for (let f = 0; f <= 1; f += 0.025) for (const part of park.parts) {
        if (!part.solid || part.pos[1] + part.half[1] < 12.65 || part.pos[1] - part.half[1] > 14.3) continue;
        local[0] = a[0] + (b[0] - a[0]) * f - part.pos[0]; local[1] = 13.4 - part.pos[1]; local[2] = a[2] + (b[2] - a[2]) * f - part.pos[2]; inverseRotate(part.rot, local, local);
        expect(partDistance(part, local, normal)).toBeGreaterThan(1.2);
      }
    }
  });
  it('rejects a terrace whose entrance would cross a streetlamp', () => {
    const park = scene();
    park.nodes = [{ pos: [0, 12.2, 0], links: [1], kind: 'entrance' }, { pos: [0, 12.2, 120], links: [0], kind: 'path' }];
    park.paths = [{ a: 0, b: 1, width: 8 }];
    new Parts(park).rod([5, 12, 60], [5, 17, 60], 0.07, [0.2, 0.2, 0.2]);
    decoratePublicRealm(park);
    expect(park.nodes.filter(n => n.kind === 'facility')).toHaveLength(0);
  });
});
