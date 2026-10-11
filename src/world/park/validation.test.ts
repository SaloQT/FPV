import { describe, expect, it } from 'vitest';
import { testTerrainData } from '../track/testTerrain';
import { createTerrainSampler } from '../terrain/sampler';
import { defaultParkRecipe, PARK_PRESETS } from './recipe';
import { generatePark, gradeParkTerrain } from './generator';
import { PARK_LAYOUTS, PARK_SIZES, PARK_THEMES, type ParkRecipe } from './types';
import { newTrain, TrainDynamics } from './ridePhysics';
import { GuestMode } from './crowd';
import { ParkRuntime } from './runtime';
import { measureJoints } from './construction';

function build(recipe: ParkRecipe) {
  const terrain = gradeParkTerrain(testTerrainData({ resolution: 64, cellSize: 32 }), recipe);
  return generatePark(recipe, createTerrainSampler(terrain));
}
describe('park generation and operation envelopes', () => {
  it('accepts 100 reproducible seeds across every size, layout and theme', () => {
    for (let i = 0; i < 100; i++) {
      const size = PARK_SIZES[i % 3], recipe: ParkRecipe = { ...defaultParkRecipe((i * 1000003) >>> 0, size), layout: PARK_LAYOUTS[i % 4], theme: i % 9 === 8 ? 'mixed' : PARK_THEMES[i % 8], guests: 0 };
      let p; try { p = build(recipe); } catch (e) { throw new Error(`Seed ${recipe.seed}, ${size}, ${recipe.layout}: ${String(e)}`); }
      expect(p.rides.length).toBe(PARK_PRESETS[size].rides);
      for (const r of p.rides) if (r.preflight) { expect(r.preflight.maxG).toBeLessThanOrEqual(r.maxG); expect(r.preflight.maxJerk).toBeLessThanOrEqual(r.maxJerk); }
      const seen = new Set([p.entrance]), todo = [p.entrance];
      while (todo.length) for (const id of p.nodes[todo.pop()!].links) if (!seen.has(id)) { seen.add(id); todo.push(id); }
      expect(seen.size).toBe(p.nodes.length);
      const runtime = new ParkRuntime(p), hit = { normal: [0, 1, 0] as [number, number, number], velocity: [0, 0, 0] as [number, number, number], penetration: 0, friction: 0, restitution: 0 };
      const disconnected = measureJoints(p, runtime.bodies).filter(j => !j.pass);
      expect(disconnected.slice(0, 8).map(j => ({ name: j.name, anchor: j.anchorError, separation: j.separation, lateral: j.lateralError })), `Seed ${recipe.seed}, ${size}, ${recipe.layout}: declared construction interfaces`).toEqual([]);
      for (const route of p.routes) for (let j = 1; j < route.path.length; j++) {
        const point = route.path[j], label = `Seed ${recipe.seed}, ${size}, ${route.parkCourse}, segment ${j}`;
        expect(runtime.collision.contact(...point, 0.3, hit), label).toBe(false);
        expect(runtime.collision.sweep(route.path[j - 1], point, 0.3, hit), label).toBe(1);
      }
    }
  }, 600000); // Dense districts and continuous guide/woody-branch sweeps: 100 worlds took 336 s in the layout audit.
  it('converges when the integration step is halved with empty and full trains', () => {
    const p = build({ ...defaultParkRecipe(43, 'compact'), guests: 0 });
    for (const r of p.rides.filter(r => r.curve)) for (const passengers of [0, r.capacity]) {
      const a = newTrain(r), b = newTrain(r), model = new TrainDynamics(r); a.s = b.s = r.curve!.liftEnd + 4; a.v = b.v = 18; a.passengers = b.passengers = passengers;
      for (let i = 0; i < 2500; i++) { model.step(a, 1 / 250, false, false); model.step(b, 1 / 500, false, false); model.step(b, 1 / 500, false, false); }
      expect(Math.abs(a.s - b.s)).toBeLessThan(0.035); expect(Math.abs(a.v - b.v)).toBeLessThan(0.02);
    }
  }, 30000);
  it('runs every attraction repeatedly without losing, duplicating or detaching guests', () => {
    const p = build({ ...defaultParkRecipe(1337), guests: 400 }), runtime = new ParkRuntime(p);
    for (let i = 0; i < 36000; i++) runtime.advance(1 / 60);
    for (const s of runtime.rides) expect(s.completed).toBeGreaterThanOrEqual(1);
    const c = runtime.crowd, occupied = runtime.rides.flatMap(s => s.trains.flatMap(t => [...t.seatIds].filter(id => id >= 0))), queued = c.queue.flat();
    expect(new Set(occupied).size).toBe(occupied.length); expect(new Set(queued).size).toBe(queued.length);
    expect(occupied.every(id => c.mode[id] === GuestMode.Boarding || c.mode[id] === GuestMode.Riding || c.mode[id] === GuestMode.Exit && c.seat[id] >= 0 && runtime['transitionStage'][id] < runtime['releaseStage'][id])).toBe(true);
    expect(queued.every(id => c.mode[id] === GuestMode.Queue)).toBe(true);
    for (let i = 0; i < c.count; i++) if (c.mode[i] === GuestMode.Boarding || c.mode[i] === GuestMode.Riding || c.mode[i] === GuestMode.Exit && c.seatBlend[i] > 0) expect(occupied.includes(i)).toBe(true);
    expect([...c.pos, ...c.vel].every(Number.isFinite)).toBe(true); expect(c.mode.length).toBe(400);
    // A drone respawn does not recreate the park. Render interpolation cannot advance the authoritative clock.
    const elapsed = runtime.elapsed, tick = runtime.tick; runtime.present(0.5, 1 / 4000); runtime.advance(0);
    expect(runtime.elapsed).toBe(elapsed); expect(runtime.tick).toBe(tick);
  }, 120000);
});
