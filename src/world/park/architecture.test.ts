import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../../contracts';
import { pitchedRoof, shopAwning, shopfront, slopedRoofPost } from './architecture';
import { partDistance } from './collision';
import { measureJoints } from './construction';
import { axisAngle, inverseRotate, rotate, yawPoint } from './math';
import { Parts } from './parts';
import { defaultParkRecipe } from './recipe';
import { themedBuilding } from './theme';
import { PARK_THEMES, type ParkData, type ParkPart } from './types';
import { PAVING_TOP } from './surfaces';

function scene(): ParkData { return { recipe: defaultParkRecipe(), layout: 'hub', bounds: { min: [-1000, 12, -1000], max: [1000, 100, 1000] }, entrance: 0,
  launch: { pos: [0, 12, 0], yaw: 0 }, rides: [], parts: [], bodies: [], lights: [], rooms: [], routes: [], nodes: [], paths: [] }; }
const at = (p: ParkPart, point: Vec3) => partDistance(p, inverseRotate(p.rot, point.map((v, k) => v - p.pos[k]) as Vec3), [0, 1, 0]);

describe('architecture contact planes', () => {
  it.each(PARK_THEMES)('closes the %s facade and keeps threshold, foundations and declared roof contacts on their physical surfaces', theme => {
    for (const yaw of [0, 0.73]) {
      const park = scene(), origin: Vec3 = [32, 12, -41]; themedBuilding(park, origin, yaw, theme, 73);
      for (let x = -5.69; x < 5.7; x += 0.217) for (let y = 0.21; y < 5.6; y += 0.23) {
        const point = yawPoint(origin, yaw, [x, y, -3.85]);
        expect(park.parts.some(p => p.solid && at(p, point) <= 1e-8), `${theme} facade hole at ${x},${y}`).toBe(true);
      }
      const paving = park.parts.filter(p => p.surface === 'paving');
      for (const p of paving) expect(p.pos[1] + p.half[1]).toBeCloseTo(PAVING_TOP, 10);
      const measurements = measureJoints(park); expect(measurements.length).toBeGreaterThan(0);
      expect(measurements.filter(m => !m.pass)).toEqual([]);
      for (const joint of park.joints ?? []) for (const anchor of [joint.a, joint.b]) {
        expect(Math.abs(partDistance(park.parts[anchor.part], anchor.point, [0, 1, 0])), joint.name).toBeLessThan(1e-9);
      }
    }
  });
  it('tiles multi-unit storefront bays without cracks at party piers, door edges or window corners', () => {
    const park = scene(), b = new Parts(park), wall = { surface: 'masonry' as const };
    for (let i = -1; i <= 1; i++) shopfront(b, i * 12.8, 6.4, -10, 6.1, 3.8, 2, [0.5, 0.4, 0.3], [0.2, 0.1, 0.05], wall);
    for (let x = -19.19; x < 19.2; x += 0.193) for (let y = 0.2; y <= 6.1; y += 0.231) expect(park.parts.some(p => at(p, [x, y, -10]) <= 1e-8), `${x},${y}`).toBe(true);
  });
  it('provides finite flat post bearings and matching sloped shoe faces instead of point-only canopy contacts', () => {
    const park = scene(); themedBuilding(park, [32, 12, -41], 0.73, 'alpine', 73);
    for (const joint of park.joints ?? []) {
      const a = park.parts[joint.a.part], b = park.parts[joint.b.part];
      const world = (v: Vec3): Vec3 => rotate(a.rot, v).map((n, k) => n + a.pos[k]) as Vec3;
      if (joint.name === 'awning post-to-shoe bearing') for (let i = 0; i < 16; i++) {
        const t = i * Math.PI / 8; expect(Math.abs(at(b, world([a.half[0] * Math.cos(t), a.half[1], a.half[0] * Math.sin(t)])))).toBeLessThan(1e-9);
      }
      if (joint.name === 'awning shoe-to-canopy bearing') for (const x of [-a.half[0], -a.half[0] / 2, 0]) for (const z of [-a.half[2], 0, a.half[2]]) {
        const y = a.half[1] * (1 + 2 * x / a.half[0]); expect(Math.abs(at(b, world([x, y, z])))).toBeLessThan(1e-9);
      }
    }
  });
  it('seals every point along a gable slope to the roof underside at different pitches and yaw angles', () => {
    for (const yaw of [0, 0.41, 2.2]) for (const rise of [1.2, 2.25, 3.1]) {
      const park = scene(), b = new Parts(park, [60, 12, -21], yaw);
      pitchedRoof(b, 5.6, 6.8, 4.8, rise, [0.2, 0.3, 0.4], 'paint', 6, 4);
      const panels = park.parts.filter(p => p.shape === 'box'), gables = park.parts.filter(p => p.shape === 'gable');
      for (const gable of gables) for (let x = -5.99; x <= 6; x += 0.271) {
        const local: Vec3 = [x, gable.half[1] * (1 - 2 * Math.abs(x) / gable.half[0]), 0], vector = rotate(gable.rot, local), point = vector.map((v, k) => v + gable.pos[k]) as Vec3;
        expect(Math.min(...panels.map(p => Math.abs(at(p, point))))).toBeLessThan(1e-8);
      }
    }
  });
  it('joins gutters to the finite eave edges across roof pitches, thicknesses and headings', () => {
    for (const yaw of [0, 0.73, -2.1]) for (const rise of [1.2, 2.25, 3.1]) for (const halfThickness of [0.045, 0.14]) {
      const park = scene(), b = new Parts(park, [60, 12, -21], yaw);
      pitchedRoof(b, 5.6, 6.8, 4.8, rise, [0.2, 0.3, 0.4], 'paint', 6, 4, undefined, { halfThickness });
      const seams = park.joints!.filter(j => j.name === 'roof/gutter eave seam');
      expect(seams).toHaveLength(2);
      for (const joint of seams) {
        const roof = park.parts[joint.a.part], gutter = park.parts[joint.b.part], side = Math.sign(joint.a.point[0]);
        for (let i = 0; i <= 32; i++) {
          const local: Vec3 = [side * roof.half[0], -roof.half[1], (i / 16 - 1) * roof.half[2]];
          const point = rotate(roof.rot, local).map((v, k) => v + roof.pos[k]) as Vec3;
          expect(Math.abs(at(gutter, point))).toBeLessThan(1e-9);
          expect(point[1]).toBeCloseTo(gutter.pos[1] + gutter.half[0], 10);
        }
        // The entire round gutter stays below the roof's lowest finite edge; no roof penetration.
        for (let i = 0; i < 24; i++) {
          const a = i * Math.PI / 12;
          const point = rotate(gutter.rot, [gutter.half[0] * Math.cos(a), 0, gutter.half[0] * Math.sin(a)]).map((v, k) => v + gutter.pos[k]) as Vec3;
          expect(at(roof, point)).toBeGreaterThanOrEqual(-1e-9);
        }
      }
      expect(measureJoints(park).filter(m => !m.pass)).toEqual([]);
    }
  });
  it('gives queue and landmark roof posts finite shoes on either slope axis', () => {
    for (const yaw of [0.31, 1.7]) for (const axis of ['x', 'z']) {
      const park = scene(), b = new Parts(park, [40, 12.2, -70], yaw), slope = 0.16, angle = Math.atan(slope);
      const roof = b.box([0, 4, 0], [5, 0.08, 5], [0.3, 0.4, 0.5], { localRot: axis === 'x' ? axisAngle([0, 0, 1], angle) : axisAngle([1, 0, 0], -angle) });
      slopedRoofPost(b, roof, 2, -1, 0, 4 + slope * (axis === 'x' ? 2 : -1) - 0.08 / Math.cos(angle), axis === 'x' ? [slope, 0] : [0, slope], 0.12);
      expect(measureJoints(park).filter(m => !m.pass)).toEqual([]);
      for (const joint of park.joints ?? []) {
        const a = park.parts[joint.a.part], other = park.parts[joint.b.part];
        const world = (v: Vec3): Vec3 => rotate(a.rot, v).map((n, k) => n + a.pos[k]) as Vec3;
        if (joint.name.includes('flat shoe')) for (let i = 0; i < 20; i++) expect(Math.abs(at(other, world([a.half[0] * Math.cos(i * Math.PI / 10), a.half[1], a.half[0] * Math.sin(i * Math.PI / 10)])))).toBeLessThan(1e-9);
        else for (const x of [-a.half[0], -a.half[0] / 2, 0]) for (const z of [-a.half[2], 0, a.half[2]]) expect(Math.abs(at(other, world([x, a.half[1] * (1 + 2 * x / a.half[0]), z])))).toBeLessThan(1e-9);
      }
    }
  });
  it('joins the whole valance seam to the finite tilted panel edge across pitches and builder rotations', () => {
    for (const yaw of [0, 0.73, -2.1]) for (const drop of [0.1, 0.28, 0.65, 1.2]) {
      const park = scene(), b = new Parts(park, [42, 12, -19], yaw);
      shopAwning(b, 1.4, 6.32, -9.8, -13.05, 4.17, drop, [0.4, 0.3, 0.2]);
      const joint = park.joints!.find(j => j.name === 'awning canopy-to-valance edge seam')!;
      const panel = park.parts[joint.a.part], valance = park.parts[joint.b.part];
      for (let i = 0; i <= 32; i++) {
        const local: Vec3 = [(i / 16 - 1) * panel.half[0], -panel.half[1], -panel.half[2]];
        const point = rotate(panel.rot, local).map((v, k) => v + panel.pos[k]) as Vec3;
        expect(Math.abs(at(valance, point))).toBeLessThan(1e-9);
        expect(point[1]).toBeCloseTo(valance.pos[1] + valance.half[1], 10);
      }
      // Every corner of the hanging plate is at or below its seam; it cannot cut through the canopy.
      for (const x of [-valance.half[0], valance.half[0]]) for (const y of [-valance.half[1], valance.half[1]]) for (const z of [-valance.half[2], valance.half[2]]) {
        const point = rotate(valance.rot, [x, y, z]).map((v, k) => v + valance.pos[k]) as Vec3;
        expect(at(panel, point)).toBeGreaterThanOrEqual(-1e-9);
      }
      expect(measureJoints(park).filter(m => !m.pass)).toEqual([]);
    }
  });
});
