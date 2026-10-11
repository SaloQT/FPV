import { beforeAll, describe, expect, it } from 'vitest';
import type { Vec3 } from '../../contracts';
import { testTerrainData } from '../track/testTerrain';
import { createTerrainSampler } from '../terrain/sampler';
import { generatePark, gradeParkTerrain } from './generator';
import { defaultParkRecipe } from './recipe';
import { ParkRuntime } from './runtime';
import { axisAngle, pose } from './math';
import { GuestMode } from './crowd';
import { partDistance } from './collision';
import type { EnvironmentContact, ParkData, ParkPart } from './types';

let base: ParkData;
beforeAll(() => { const recipe = { ...defaultParkRecipe(1337, 'compact'), guests: 0 }; base = generatePark(recipe, createTerrainSampler(gradeParkTerrain(testTerrainData({ resolution: 64, cellSize: 32 }), recipe))); }, 30000);
const part = (options: Partial<ParkPart>): ParkPart => ({ shape: 'box', pos: [0, 20, 0], half: [1, 1, 1], rot: [0, 0, 0, 1], color: [0.2, 0.2, 0.2], roughness: 0.5, metalness: 0.7, emissive: 0, body: -1, detail: 0, solid: true, ...options });
const contact = (): EnvironmentContact => ({ normal: [0, 1, 0], velocity: [0, 0, 0], penetration: 0, friction: 0, restitution: 0 });
describe('shared park physical geometry', () => {
  it('uses the cone surface rather than its bounding cylinder for contacts', () => {
    const normal: Vec3 = [0, 0, 0], p = part({ shape: 'cone', half: [2, 2, 2] });
    expect(partDistance(p, [3, 0, 0], normal)).toBeCloseTo(4 / Math.sqrt(5), 8);
    expect(normal[0]).toBeCloseTo(2 / Math.sqrt(5), 8); expect(normal[1]).toBeCloseTo(1 / Math.sqrt(5), 8);
    expect(partDistance(p, [0, 0, 0], normal)).toBeCloseTo(-2 / Math.sqrt(5), 8);
    expect(partDistance(p, [0, -3, 0], normal)).toBeCloseTo(1); expect(normal).toEqual([0, -1, 0]);
    expect(partDistance(p, [0, 2, 0], normal)).toBeCloseTo(0); expect(Math.hypot(...normal)).toBeCloseTo(1);
  });
  it('has exact ellipsoid distances and valid normals at shape centers', () => {
    const normal: Vec3 = [0, 0, 0], p = part({ shape: 'sphere', half: [1, 2, 3] });
    expect(partDistance(p, [0, 0, 5], normal)).toBeCloseTo(2, 8); expect(normal[2]).toBeCloseTo(1);
    expect(partDistance(p, [0, 0, 0], normal)).toBeCloseTo(-1); expect(Math.hypot(...normal)).toBeCloseTo(1);
    expect(partDistance(part({ shape: 'cylinder', half: [0.1, 4, 0.1] }), [0, 0, 0], normal)).toBeCloseTo(-0.1); expect(Math.hypot(...normal)).toBeCloseTo(1);
  });
  it('stops a sphere crossing a thin rotated rail when neither endpoint overlaps', () => {
    const r = new ParkRuntime({ ...base, parts: [part({ shape: 'cylinder', half: [0.025, 5, 0.025], rot: axisAngle([0, 0, 1], Math.PI / 4) })] }), out = contact();
    r.collision.setStep(1 / 1000);
    expect(r.collision.contact(2, 20, 0, 0.05, out)).toBe(false);
    const t = r.collision.sweep([-2, 20, 0], [2, 20, 0], 0.05, out);
    expect(t).toBeGreaterThan(0.45); expect(t).toBeLessThan(0.5); expect(Math.hypot(...out.normal)).toBeCloseTo(1);
  });
  it('uses linear plus angular velocity at a rotating surface', () => {
    const id = base.rides[0].bodies[0], r = new ParkRuntime({ ...base, rides: base.rides.map((ride, i) => i === 0 ? { ...ride, pos: [0, 12, 0] } : ride), parts: [part({ pos: [2, 0, 0], half: [1, 0.2, 1], body: id })] });
    for (const b of [r.bodies[id], r.previousBodies[id]]) { b.pos = [0, 20, 0]; b.rot = [0, 0, 0, 1]; b.vel = [1, 0, 0]; b.omega = [0, 0, 2]; }
    const out = contact(); expect(r.collision.contact(2, 20.25, 0, 0.1, out)).toBe(true);
    expect(out.velocity[0]).toBeCloseTo(0.5); expect(out.velocity[1]).toBeCloseTo(4);
  });
  it('keeps an inverted passenger solid and aligned with the car', () => {
    const r = new ParkRuntime({ ...base, recipe: { ...base.recipe, guests: 1 }, parts: [] }), c = r.crowd, id = base.rides[0].bodies.find(i => base.bodies[i].role === 'car' && base.bodies[i].train === 1 && base.bodies[i].index === 0)!;
    for (const b of [r.bodies[id], r.previousBodies[id]]) { b.pos = [0, 20, 0]; b.rot = axisAngle([1, 0, 0], Math.PI); }
    c.mode[0] = GuestMode.Riding; c.ride[0] = 0; c.train[0] = 1; c.seat[0] = 0;
    const a: Vec3 = [0, 0, 0], b: Vec3 = [0, 0, 0]; r.guestCapsule(0, a, b);
    expect(b[1]).toBeLessThan(a[1]); c.pos.set(a); c.previous.set(c.pos); c.reindex();
    expect(r.collision.contact(a[0] + 0.1, (a[1] + b[1]) / 2, a[2], 0.05, contact())).toBe(true);
    const seat = r.guestSeat(0, pose()); expect(seat.pos.every(Number.isFinite)).toBe(true);
  });
});
