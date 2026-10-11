import { describe, expect, it } from 'vitest';
import { Crowd, GuestMode } from './crowd';
import { defaultParkRecipe } from './recipe';
import type { ParkData, RideDefinition } from './types';

function plaza(guests: number): ParkData {
  const ride = (id: number, station: number): RideDefinition => ({ id, station, family: 'carousel', name: `Ride ${id}`, theme: 'carnival', pos: [station * 20, 12, 0], yaw: 0, radius: 5, height: 6, capacity: 4,
    queue: [[station * 20, 12, 0]], exit: [], boarding: [], cars: 1, trains: 1, carLength: 2, emptyCarMass: 100, dragArea: 1, rolling: 0, liftSpeed: 0, motorForce: 100, motorPower: 100, motorTorque: 100, brakeForce: 100, targetOmega: 1, inertia: 100, duration: 20, bodies: [], maxG: 4, maxJerk: 100 });
  return { recipe: { ...defaultParkRecipe(17, 'compact'), guests }, layout: 'hub', bounds: { min: [-100, 0, -100], max: [100, 100, 100] }, entrance: 0, launch: { pos: [0, 12, 0], yaw: 0 },
    nodes: [{ pos: [-20, 12, 0], links: [1], kind: 'entrance' }, { pos: [0, 12, 0], links: [0, 2], kind: 'station' }, { pos: [20, 12, 0], links: [1], kind: 'station' }],
    paths: [{ a: 0, b: 1, width: 8 }, { a: 1, b: 2, width: 8 }], rides: [ride(0, 1), ride(1, 2)], parts: [], bodies: [], lights: [], rooms: [], routes: [] };
}

describe('pedestrian navigation and avoidance', () => {
  it('distributes initial guests by pavement area with traffic in both directions', () => {
    const p = plaza(4000); p.nodes[2].pos[0] = 180;
    const a = new Crowd(p), b = new Crowd(p); let shortPath = 0, reverse = 0;
    for (let i = 0; i < a.count; i++) { if (a.node[i] === 0 || a.target[i] === 0) shortPath++; if (a.node[i] > a.target[i]) reverse++; }
    expect(shortPath).toBeGreaterThan(330); expect(shortPath).toBeLessThan(470);
    expect(reverse).toBeGreaterThan(1800); expect(reverse).toBeLessThan(2200);
    expect(a.pos).toEqual(b.pos); expect(a.mass).toEqual(b.mass);
  });
  it('passes opposing pedestrians without overlapping or leaving the pavement', () => {
    const c = new Crowd(plaza(2));
    c.pos.set([-13, 12, 0, -7, 12, 0]); c.vel.fill(0); c.node.set([0, 1]); c.target.set([1, 0]); c.goal.set([2, 0]);
    let closest = Infinity;
    for (let frame = 0; frame < 140; frame++) {
      c.steer(0.04, null);
      for (let step = 0; step < 10; step++) {
        c.move(0.004); closest = Math.min(closest, Math.hypot(c.pos[0] - c.pos[3], c.pos[2] - c.pos[5]));
        expect(Math.abs(c.pos[2])).toBeLessThan(3.7); expect(Math.abs(c.pos[5])).toBeLessThan(3.7);
      }
    }
    expect(closest).toBeGreaterThan(0.57); expect(c.pos[0]).toBeGreaterThan(c.pos[3]);
  });
  it('uses a connected edge when all ride queues are full', () => {
    const p = plaza(1), c = new Crowd(p);
    c.pos.set(p.nodes[1].pos); c.node[0] = c.target[0] = c.goal[0] = 1; c.ride[0] = 0;
    c.queue[0].push(0); c.queue[1].push(0);
    c.steer(0.04, null);
    expect(p.nodes[c.node[0]].links).toContain(c.target[0]);
    expect(c.vel.every(Number.isFinite)).toBe(true);
  });
  it('prefers an available destination instead of immediately rejoining the same station', () => {
    const c = new Crowd(plaza(1)); c.node[0] = 1;
    for (let i = 0; i < 100; i++) { c.chooseDestination(0); expect(c.goal[0]).toBe(2); }
  });
  it('removes stale spatial hash entries after moving between distant cells', () => {
    const c = new Crowd(plaza(3)); c.pos.set([0, 12, 0, 0, 12, 0, 0, 12, 0]); c.reindex();
    const old: number[] = []; c.neighbors(0, 0, 1, i => old.push(i)); expect(old.sort()).toEqual([0, 1, 2]);
    c.pos.set([100, 12, 100, 100, 12, 100, 100, 12, 100]); c.reindex();
    const stale: number[] = [], current: number[] = []; c.neighbors(0, 0, 1, i => stale.push(i)); c.neighbors(100, 100, 1, i => current.push(i));
    expect(stale).toEqual([]); expect(current.sort()).toEqual([0, 1, 2]);
  });
  it('stays finite and bounded in an initially overlapping dense crowd', () => {
    const c = new Crowd(plaza(100)); c.mode.fill(GuestMode.Walk); c.node.fill(0); c.target.fill(1); c.goal.fill(2);
    for (let i = 0; i < c.count; i++) c.pos.set([-10 + (i % 10) * 0.1, 12, Math.floor(i / 10) * 0.1], i * 3);
    for (let frame = 0; frame < 25; frame++) {
      const previous = c.vel.slice(); c.steer(0.04, [0, 13, 0]);
      for (let i = 0; i < c.count; i++) expect(Math.hypot(c.vel[i * 3] - previous[i * 3], c.vel[i * 3 + 2] - previous[i * 3 + 2])).toBeLessThanOrEqual(0.100000001);
      for (let step = 0; step < 10; step++) c.move(0.004);
    }
    expect(c.pos.every(Number.isFinite)).toBe(true);
    for (let i = 0; i < c.count; i++) expect(Math.hypot(c.vel[i * 3], c.vel[i * 3 + 2])).toBeLessThanOrEqual(1.76);
  });
});
