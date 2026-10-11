import { describe, expect, it } from 'vitest';
import { testTerrainData } from '../track/testTerrain';
import { createTerrainSampler } from '../terrain/sampler';
import { defaultParkRecipe, parkRecipeKey, sanitizeParkRecipe } from './recipe';
import { generatePark, gradeParkTerrain } from './generator';
import { ParkRuntime } from './runtime';
import { railSample, sampleRail } from './curve';
import { TrainDynamics, newTrain } from './ridePhysics';
import { inverseRotate } from './math';
import { partDistance } from './collision';
import type { Vec3 } from '../../contracts';

function park(seed = 1337, size: 'compact' | 'destination' | 'mega' = 'destination', guests = 100) {
  const recipe = { ...defaultParkRecipe(seed, size), guests };
  const terrain = gradeParkTerrain(testTerrainData({ resolution: 64, cellSize: 32 }), recipe);
  return generatePark(recipe, createTerrainSampler(terrain));
}

describe('procedural operating park', () => {
  it('canonicalizes recipes and rejects unknown generator versions', () => {
    expect(parkRecipeKey(defaultParkRecipe(17))).toBe(parkRecipeKey(sanitizeParkRecipe(JSON.parse(parkRecipeKey(defaultParkRecipe(17))))));
    expect(sanitizeParkRecipe({ size: 'mega', guests: Infinity }).guests).toBe(10000);
    expect(() => sanitizeParkRecipe({ version: 2 })).toThrow('version');
  });
  it('builds the full destination library and connected pedestrian network', () => {
    const p = park();
    expect(p.rides).toHaveLength(18); expect(p.rides.filter(r => r.curve)).toHaveLength(7);
    const seen = new Set([p.entrance]), pending = [p.entrance];
    while (pending.length) for (const n of p.nodes[pending.pop()!].links) if (!seen.has(n)) { seen.add(n); pending.push(n); }
    expect(seen.size).toBe(p.nodes.length); expect(p.rooms.length).toBe(1);
    for (const r of p.rides) if (r.preflight) {
      expect(r.preflight.minSpeed, `${r.family} stalls`).toBeGreaterThan(0);
      expect(r.preflight.maxG, `${r.family} g ${r.preflight.maxG} at ${r.preflight.maxAt} speed ${r.preflight.maxSpeed}`).toBeLessThan(5.5);
    }
    const paving = p.parts.filter(part => part.body < 0 && part.solid && part.surface === 'paving'), local: Vec3 = [0, 0, 0], normal: Vec3 = [0, 1, 0];
    for (const ride of p.rides) if (ride.curve) for (let i = 0; i <= 12; i++) {
      const a = ride.queue[0], b = ride.boarding[0], t = i / 12, x = a[0] + (b[0] - a[0]) * t, z = a[2] + (b[2] - a[2]) * t;
      expect(paving.some(part => {
        // Horizontal gable prisms rotate their local Y extent into the ground plane.
        // The enclosing sphere is rotation invariant; local X/Z alone can reject real pavement.
        if (Math.hypot(x - part.pos[0], z - part.pos[2]) > Math.hypot(...part.half) + 0.1) return false;
        local[0] = x - part.pos[0]; local[1] = 12.12 - part.pos[1]; local[2] = z - part.pos[2]; inverseRotate(part.rot, local, local);
        return partDistance(part, local, normal) < 0.001;
      }), `${ride.name} queue to stair-foot paving`).toBe(true);
    }
  }, 30000);
  it('keeps rail samples finite, normalized and continuous at closure', () => {
    const p = park(18, 'compact'); const a = railSample(), b = railSample();
    for (const r of p.rides) if (r.curve) {
      for (let s = 0; s < r.curve.length; s += 3) { sampleRail(r.curve, s, a); expect([...a.pos, ...a.tangent, ...a.up, ...a.curvature].every(Number.isFinite)).toBe(true); expect(Math.hypot(...a.tangent)).toBeCloseTo(1, 8); }
      sampleRail(r.curve, 0, a); sampleRail(r.curve, r.curve.length, b); expect(b.pos).toEqual(a.pos);
    }
  }, 30000);
  it('keeps dense mega junctions connected across both directions of a grazing grid edge', () => {
    const recipe = { ...defaultParkRecipe(186338, 'mega'), layout: 'loop' as const, guests: 0 };
    const terrain = gradeParkTerrain(testTerrainData({ resolution: 64, cellSize: 32 }), recipe);
    const p = generatePark(recipe, createTerrainSampler(terrain)), seen = new Set([p.entrance]), pending = [p.entrance];
    while (pending.length) for (const id of p.nodes[pending.pop()!].links) if (!seen.has(id)) { seen.add(id); pending.push(id); }
    expect(p.rides).toHaveLength(32); expect(seen.size).toBe(p.nodes.length);
  }, 30000);
  it('advances deterministically independent of frame subdivision and preserves every guest', () => {
    const p = park(17, 'compact', 80), a = new ParkRuntime(p), b = new ParkRuntime(p);
    for (let i = 0; i < 120; i++) a.advance(1 / 60);
    for (let i = 0; i < 240; i++) b.advance(1 / 120);
    expect(a.tick).toBe(b.tick); expect(a.crowd.pos).toEqual(b.crowd.pos);
    expect(a.rides.map(r => r.trains.map(t => [t.s, t.v]))).toEqual(b.rides.map(r => r.trains.map(t => [t.s, t.v])));
    const seated = a.rides.flatMap(r => r.trains.flatMap(t => [...t.seatIds].filter(i => i >= 0)));
    expect(new Set(seated).size).toBe(seated.length); expect(a.crowd.mode.length).toBe(80);
  }, 30000);
  it('conserves mechanical energy without drives and losses', () => {
    const p = park(7, 'compact', 0), source = p.rides[0], ride = { ...source, dragArea: 0, rolling: 0 };
    const model = new TrainDynamics(ride), t = newTrain(ride); t.s = ride.curve!.liftEnd + 10; t.v = 20;
    const e = model.energy(t);
    for (let i = 0; i < 500; i++) model.step(t, 1 / 250, false, false);
    expect(Math.abs(model.energy(t) - e) / e).toBeLessThan(0.005);
  }, 30000);
  it('keeps flight guide segments clear of the physical structures', () => {
    const p = park(1337, 'destination', 0), r = new ParkRuntime(p), hit = { normal: [0, 1, 0] as [number, number, number], velocity: [0, 0, 0] as [number, number, number], penetration: 0, friction: 0, restitution: 0 };
    for (const route of p.routes) for (let i = 1; i < route.path.length; i++) {
      const t = r.collision.sweep(route.path[i - 1], route.path[i], 0.3, hit);
      expect(t, `${route.parkCourse} segment ${i}`).toBe(1);
    }
  }, 30000);
  it('brakes a fully loaded drop tower before its bottom catch', () => {
    const p = park(1337, 'destination', 0), runtime = new ParkRuntime(p), ride = p.rides.find(r => r.family === 'drop')!, s = runtime.rides[ride.id];
    s.phase = 'running'; s.phaseTime = ride.duration * 0.6; s.y = ride.height; s.vy = 0;
    s.trains[0].passengers = ride.capacity; s.trains[0].passengerMass = ride.capacity * 103;
    let worstCatchSpeed = 0, peakG = 0;
    for (let i = 0; i < 5000; i++) { if (s.y < 2.015) worstCatchSpeed = Math.max(worstCatchSpeed, Math.abs(s.vy)); runtime.advance(1 / 250); peakG = Math.max(peakG, (s.verticalA + 9.80665) / 9.80665); }
    expect(worstCatchSpeed).toBeLessThan(0.75); expect(peakG).toBeLessThan(4); expect(s.y).toBeCloseTo(2, 1);
  }, 30000);
});
