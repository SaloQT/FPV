import { describe, expect, it } from 'vitest';
import type { TerrainSampler, Vec3 } from '../../contracts';
import { testTerrainData } from '../track/testTerrain';
import { createTerrainSampler } from '../terrain/sampler';
import { distanceToBox, gateColliders } from '../track/colliders';
import { SENSE_FLOOR, SENSE_VOXEL, parkSenseColliders } from './raceColliders';
import { PILOT_GATE_SPACING, parkPilotTrack } from './pilotGates';
import { gatePassed } from '../track/gate';
import { defaultParkRecipe } from './recipe';
import { generatePark, gradeParkTerrain, selectedParkTrack } from './generator';
import { ParkRuntime } from './runtime';
import { RACE, RaceClearance } from './raceCourse';
import { PARK_GRADE } from './surfaces';
import { pose, rotate } from './math';
import type { ParkData, ParkSize } from './types';

const parks = new Map<string, ParkData>();
function racePark(seed: number, size: ParkSize, route: 'race' | 'free' = 'race'): ParkData {
  const key = `${seed}/${size}/${route}`;
  let park = parks.get(key);
  if (!park) {
    const recipe = { ...defaultParkRecipe(seed, size), guests: 0, route };
    park = generatePark(recipe, createTerrainSampler(gradeParkTerrain(testTerrainData({ resolution: 64, cellSize: 32 }), recipe)));
    parks.set(key, park);
  }
  return park;
}
const course = (p: ParkData) => { const t = selectedParkTrack(p); expect(t.parkCourse).toBe('race'); return t; };
const CASES: [number, ParkSize][] = [[1337, 'destination'], [7, 'compact']];

describe('park race course', () => {
  it.each(CASES)('builds a closed course with a start gate and a start pad behind it (seed %i, %s)', (seed, size) => {
    const p = racePark(seed, size), t = course(p);
    expect(t.closed).toBe(true); expect(t.laps).toBe(RACE.laps); expect(t.style).toBe('race');
    expect(t.gates.length).toBeGreaterThanOrEqual(size === 'compact' ? 8 : 15);
    expect(t.gates[0].kind).toBe('start');
    t.gates.forEach((g, i) => expect(g.index).toBe(i));
    expect(t.length).toBeGreaterThan(size === 'compact' ? 800 : 1500);
    // The pad stands on the lawn behind the start gate, facing it.
    const s = t.start, g = t.gates[0], f = [-Math.sin(s.yaw), -Math.cos(s.yaw)], to = [g.pos[0] - s.pos[0], g.pos[2] - s.pos[2]], d = Math.hypot(to[0], to[1]);
    expect(s.pos[1]).toBe(PARK_GRADE); expect(d).toBeLessThan(70); expect((f[0] * to[0] + f[1] * to[1]) / d).toBeGreaterThan(0.99);
  }, 120000);

  it.each(CASES)('keeps every metre of the line clear of park solids and ride envelopes (seed %i, %s)', (seed, size) => {
    const p = racePark(seed, size), t = course(p), clear = new RaceClearance(p);
    let worst = Infinity;
    for (const q of t.path) worst = Math.min(worst, clear.distance(q[0], q[1], q[2]));
    expect(worst).toBeGreaterThanOrEqual(RACE.exact);
    // The park's own collision agrees: a 2 m sphere swept along the whole line touches nothing, trees included.
    const runtime = new ParkRuntime(p), hit = { normal: [0, 1, 0] as Vec3, velocity: [0, 0, 0] as Vec3, penetration: 0, friction: 0, restitution: 0 };
    for (let i = 0; i < t.path.length; i++) expect(runtime.collision.sweep(t.path[i], t.path[(i + 1) % t.path.length], 2, hit), `segment ${i}`).toBe(1);
    for (const q of t.path) expect(q[1] - PARK_GRADE).toBeGreaterThanOrEqual(RACE.low);
  }, 120000);

  it.each(CASES)('faces every gate along the line, which passes through its opening (seed %i, %s)', (seed, size) => {
    const t = course(racePark(seed, size)), P = t.path, n = P.length;
    for (const g of t.gates) {
      let best = 0, bd = Infinity;
      for (let i = 0; i < n; i++) { const d = Math.hypot(P[i][0] - g.pos[0], P[i][1] - g.pos[1], P[i][2] - g.pos[2]); if (d < bd) { bd = d; best = i; } }
      expect(bd, `gate ${g.index}`).toBeLessThan(0.01);
      let passed = false;
      for (let k = -3; k < 3; k++) passed ||= gatePassed(g, P[(best + k + n) % n], P[(best + k + 1 + n) % n]);
      expect(passed, `gate ${g.index}`).toBe(true);
    }
  }, 120000);

  it.each(CASES)('keeps gate frames and legs clear of park solids and their feet off the walkways (seed %i, %s)', (seed, size) => {
    const p = racePark(seed, size), t = course(p), clear = new RaceClearance(p), flat = { heightAt: () => PARK_GRADE } as unknown as TerrainSampler;
    for (const g of t.gates) for (const box of gateColliders(g, flat)) {
      const h = box.half, top = box.center[1] + h[1];
      // Every box is sampled along its long side, from just above the paving up.
      for (let y = Math.max(box.center[1] - h[1], PARK_GRADE + 0.4); y <= top; y += 0.25) {
        const thick = Math.min(Math.max(h[0], h[2]), 0.5);
        expect(clear.solid(box.center[0], y, box.center[2], true), `gate ${g.index}`).toBeGreaterThan(thick);
      }
      if (box.center[1] - h[1] > PARK_GRADE + 0.3) continue;
      for (const path of p.paths) {
        const a = p.nodes[path.a].pos, b = p.nodes[path.b].pos, ex = b[0] - a[0], ez = b[2] - a[2];
        const u = Math.max(0, Math.min(1, ((box.center[0] - a[0]) * ex + (box.center[2] - a[2]) * ez) / (ex * ex + ez * ez || 1)));
        expect(Math.hypot(box.center[0] - a[0] - ex * u, box.center[2] - a[2] - ez * u), `gate ${g.index} foot`).toBeGreaterThan(path.width / 2);
      }
    }
  }, 120000);

  it('keeps every moving ride part away from the line over four minutes of operation', () => {
    const p = racePark(1337, 'destination'), t = course(p), runtime = new ParkRuntime(p), body = pose(), world: Vec3 = [0, 0, 0];
    const hash = new Map<string, Vec3[]>(), key = (x: number, z: number) => `${Math.floor(x / 8)},${Math.floor(z / 8)}`;
    for (const q of t.path) { const k = key(q[0], q[2]); (hash.get(k) ?? hash.set(k, []).get(k)!).push(q); }
    const moving = p.parts.filter(q => q.solid && q.body >= 0);
    let worst = Infinity;
    for (let time = 0; time < 240; time += 0.5) {
      runtime.advance(0.5);
      for (const part of moving) {
        runtime.bodyPose(part.body, runtime.elapsed, body); rotate(body.rot, part.pos, world);
        const x = body.pos[0] + world[0], y = body.pos[1] + world[1], z = body.pos[2] + world[2], r = Math.hypot(...part.half);
        for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (const q of hash.get(key(x + dx * 8, z + dz * 8)) ?? []) worst = Math.min(worst, Math.hypot(q[0] - x, q[1] - y, q[2] - z) - r);
      }
    }
    // Path points are 1 m apart, so a part can sit up to half a metre closer to the line between them.
    expect(worst - 0.5).toBeGreaterThan(1);
  }, 400000);

  it('covers the park round the line with box stand-ins for the AI pilots that leave the line clear', () => {
    const p = racePark(7, 'compact'), t = course(p), boxes = parkSenseColliders(p, t), clear = new RaceClearance(p);
    expect(boxes.length).toBeGreaterThan(500);
    const inside = (x: number, y: number, z: number) => boxes.some(b => Math.abs(x - b.center[0]) <= b.half[0] && Math.abs(y - b.center[1]) <= b.half[1] && Math.abs(z - b.center[2]) <= b.half[2]);
    // Every solid and ride-envelope point near the line is inside a box: sampled on a 1.7 m lattice round every 25th line point.
    let solid = 0;
    for (let i = 0; i < t.path.length; i += 25) for (let dx = -12; dx <= 12; dx += 1.7) for (let dy = -6; dy <= 6; dy += 1.7) for (let dz = -12; dz <= 12; dz += 1.7) {
      const x = t.path[i][0] + dx, y = t.path[i][1] + dy, z = t.path[i][2] + dz;
      if (y < PARK_GRADE + SENSE_FLOOR + 1 || clear.solid(x, y, z) > 0 && clear.rides(x, y, z) > 0) continue;
      solid++;
      expect(inside(x, y, z), `${x.toFixed(1)} ${y.toFixed(1)} ${z.toFixed(1)}`).toBe(true);
    }
    expect(solid).toBeGreaterThan(20);
    // The boxes stand out from the shapes by at most a cube diagonal, so the line keeps most of its clearance.
    for (const q of t.path) for (const b of boxes) {
      if (Math.abs(b.center[0] - q[0]) > b.half[0] + 3 || Math.abs(b.center[2] - q[2]) > b.half[2] + 3) continue;
      expect(distanceToBox(b, q[0], q[1], q[2])).toBeGreaterThan(RACE.exact - SENSE_VOXEL * Math.sqrt(3));
    }
  }, 120000);

  it('lays out the tour and every coaster route for an AI pilot: gates along the line and a pad 10 m or more behind gate 0', () => {
    const p = racePark(7, 'compact', 'free');
    expect(parkPilotTrack(p, p.routes.find(r => r.parkCourse === 'free')!)).toBeNull();
    for (const route of p.routes.filter(r => r.parkCourse === 'tour' || r.parkCourse?.startsWith('coaster-'))) {
      const t = parkPilotTrack(p, route)!, label = route.parkCourse;
      expect(t.gates.length, label).toBeGreaterThanOrEqual(route.gates.length || Math.floor(route.length / PILOT_GATE_SPACING) - 1);
      t.gates.forEach((g, i) => expect(g.index, label).toBe(i));
      // Gate 0 is where the line starts, and every gate lies on the line.
      expect(Math.hypot(...[0, 1, 2].map(k => t.path[0][k] - t.gates[0].pos[k])), label).toBeLessThan(1);
      for (const g of t.gates) expect(Math.min(...t.path.map(q => Math.hypot(q[0] - g.pos[0], q[1] - g.pos[1], q[2] - g.pos[2]))), label).toBeLessThan(1);
      // The pad stands on the ground behind gate 0, facing it.
      const s = t.start, g = t.gates[0], f = [-Math.sin(s.yaw), -Math.cos(s.yaw)], to = [g.pos[0] - s.pos[0], g.pos[2] - s.pos[2]], d = Math.hypot(to[0], to[1]);
      expect(s.pos[1], label).toBe(PARK_GRADE);
      expect(d, label).toBeGreaterThanOrEqual(9.9); expect(d, label).toBeLessThan(60);
      expect((f[0] * to[0] + f[1] * to[1]) / d, label).toBeGreaterThan(0.99);
    }
  }, 120000);

  it('builds the race course only for parks that ask for it', () => {
    expect(racePark(7, 'compact', 'free').routes.some(r => r.parkCourse === 'race')).toBe(false);
  }, 120000);

  it('puts each park tour gate once round the circle', () => {
    const tour = racePark(7, 'compact', 'free').routes.find(r => r.parkCourse === 'tour')!, g = tour.gates;
    expect(g.length).toBe(24);
    for (let i = 1; i < g.length; i++) expect(Math.hypot(g[i].pos[0] - g[0].pos[0], g[i].pos[2] - g[0].pos[2])).toBeGreaterThan(10);
  }, 120000);
});
