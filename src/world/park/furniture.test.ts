import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../../contracts';
import { partDistance } from './collision';
import { measureJoints } from './construction';
import { areaLamp, entranceFrame, liddedBin, parkBench, serviceDoor, terraceTable } from './furniture';
import { inverseRotate, rotate, yawPoint } from './math';
import { Parts } from './parts';
import { defaultParkRecipe } from './recipe';
import { PARK_GRADE, PAVING_TOP } from './surfaces';
import { sign } from './theme';
import type { ParkData, ParkPart } from './types';

function scene(): ParkData { return { recipe: defaultParkRecipe(), layout: 'hub', bounds: { min: [-1000, 12, -1000], max: [1000, 100, 1000] }, entrance: 0,
  launch: { pos: [0, 12, 0], yaw: 0 }, rides: [], parts: [], bodies: [], lights: [], rooms: [], routes: [], nodes: [], paths: [] }; }
const at = (p: ParkPart, point: Vec3) => partDistance(p, inverseRotate(p.rot, point.map((v, k) => v - p.pos[k]) as Vec3), [0, 1, 0]);
const world = (p: ParkPart, point: Vec3): Vec3 => rotate(p.rot, point).map((v, k) => v + p.pos[k]) as Vec3;

describe('static furniture contact construction', () => {
  it('connects every bench slat to a ground-bearing frame with finite bearing faces', () => {
    for (const yaw of [0, 0.49, -1.8]) {
      const park = scene(); parkBench(new Parts(park, [74, PARK_GRADE, -23], yaw));
      const graph = park.parts.map(() => new Set<number>());
      for (const joint of park.joints ?? []) {
        graph[joint.a.part].add(joint.b.part); graph[joint.b.part].add(joint.a.part);
        const a = park.parts[joint.a.part], b = park.parts[joint.b.part], anchor = world(a, joint.a.point);
        // Small two-dimensional patches prove shared surfaces, not merely coincident centres.
        const faceAxes: [number, number] = joint.name.includes('backrest') || joint.name.includes('weld') ? [0, 1] : [0, 2];
        for (const u of [-0.02, 0.02]) for (const v of [-0.02, 0.02]) {
          const delta: Vec3 = [0, 0, 0]; delta[faceAxes[0]] = u; delta[faceAxes[1]] = v;
          const shift = rotate(a.rot, delta), point = anchor.map((n, k) => n + shift[k]) as Vec3;
          expect(Math.abs(at(a, point))).toBeLessThan(1e-10); expect(Math.abs(at(b, point))).toBeLessThan(1e-10);
        }
      }
      const grounded = park.parts.map((p, i) => ({ p, i })).filter(({ p }) => Math.abs(p.pos[1] - p.half[1] - PARK_GRADE) < 1e-9).map(v => v.i);
      const seen = new Set(grounded), todo = [...grounded];
      while (todo.length) for (const i of graph[todo.pop()!]) if (!seen.has(i)) { seen.add(i); todo.push(i); }
      expect(seen.size).toBe(park.parts.length);
      expect(measureJoints(park).filter(m => !m.pass)).toEqual([]);
    }
  });
  it('grounds queue lamps and entrance columns independently of builder origin and checks finite cap contact', () => {
    for (const y of [PARK_GRADE, PAVING_TOP]) for (const yaw of [0.37, 2.1]) {
      const park = scene(), b = new Parts(park, [31, y, -87], yaw); areaLamp(b, 8, 5); entranceFrame(b);
      expect(measureJoints(park).filter(m => !m.pass)).toEqual([]);
      const footings = park.parts.filter(p => p.surface === 'concrete'); expect(footings).toHaveLength(3);
      for (const p of footings) { expect(p.pos[1] - p.half[1]).toBeCloseTo(PARK_GRADE, 10); expect(p.pos[1] + p.half[1]).toBeCloseTo(PAVING_TOP, 10); }
      for (const joint of park.joints ?? []) if (joint.name === 'lamp/post housing') {
        const p = park.parts[joint.a.part], head = park.parts[joint.b.part];
        for (let i = 0; i < 16; i++) expect(Math.abs(at(head, world(p, [p.half[0] * Math.cos(i * Math.PI / 8), p.half[1], p.half[0] * Math.sin(i * Math.PI / 8)])))).toBeLessThan(1e-10);
      }
    }
  });
  it('puts every glyph against its board and spans the measured board-to-wall gap with real mounts', () => {
    const park = scene(), b = new Parts(park, [15, 12, -11], 0.83), wall = b.box([0, 4, 0.1], [8, 1, 0.1], [0.5, 0.5, 0.5]);
    const board = sign(b, 'TRADING CO', [0, 4, -0.5], [0.8, 0.7, 0.5], 0.12, 0);
    for (const glyph of park.parts.filter(p => !p.solid)) for (const x of [-glyph.half[0], glyph.half[0]]) for (const y of [-glyph.half[1], glyph.half[1]])
      expect(Math.abs(at(board, world(glyph, [x, y, glyph.half[2]])))).toBeLessThan(1e-10);
    const spacers = park.parts.filter(p => p.shape === 'cylinder'); expect(spacers).toHaveLength(2);
    for (const spacer of spacers) for (let i = 0; i < 12; i++) {
      const circle: Vec3 = [spacer.half[0] * Math.cos(i * Math.PI / 6), spacer.half[1], spacer.half[0] * Math.sin(i * Math.PI / 6)];
      expect(Math.abs(at(wall, world(spacer, circle)))).toBeLessThan(1e-10);
    }
    expect(measureJoints(park).filter(m => !m.pass)).toEqual([]);
  });
  it('seals rear door frames to the leaf and attaches both ends of each pull handle', () => {
    const park = scene(), b = new Parts(park, [22, 12, 53], -0.61); serviceDoor(b, 2.8, 4, [0.2, 0.1, 0.05]);
    for (let x = 2.03; x < 3.58; x += 0.037) for (let y = 0.2; y < 2.49; y += 0.061) {
      const point = yawPoint(b.origin, b.yaw, [x, y, 4.035]);
      expect(park.parts.some(p => at(p, point) <= 1e-10), `Unsealed service door at ${x},${y}`).toBe(true);
    }
    expect(measureJoints(park).filter(m => !m.pass)).toEqual([]);
  });
  it('seats stool caps and bin lids on their actual support surfaces', () => {
    const park = scene(), b = new Parts(park, [11, 12, 82], 1.38); terraceTable(b, 0, [0.2, 0.1, 0.05], [0.7, 0.6, 0.4]); liddedBin(b, 6, 2, 0.12);
    expect(measureJoints(park).filter(m => !m.pass)).toEqual([]);
    for (const joint of park.joints ?? []) if (joint.name === 'stool/seat pedestal') {
      const p = park.parts[joint.a.part], seat = park.parts[joint.b.part];
      expect(p.pos[1] - p.half[1]).toBeCloseTo(PAVING_TOP, 10);
      for (let i = 0; i < 16; i++) expect(Math.abs(at(seat, world(p, [p.half[0] * Math.cos(i * Math.PI / 8), p.half[1], p.half[0] * Math.sin(i * Math.PI / 8)])))).toBeLessThan(1e-10);
    }
  });
});
