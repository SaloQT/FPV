import { expect, it } from 'vitest';
import { createTerrainSampler } from '../terrain/sampler';
import { testTerrainData } from '../track/testTerrain';
import { GuestMode } from './crowd';
import { generatePark, gradeParkTerrain } from './generator';
import { defaultParkRecipe } from './recipe';
import { ParkRuntime } from './runtime';

it('keeps every coaster loading and unloading: riders leaving the stair foot never hold up the riders still coming down', () => {
  const recipe = { ...defaultParkRecipe(1337), guests: 400 };
  const park = generatePark(recipe, createTerrainSampler(gradeParkTerrain(testTerrainData({ resolution: 64, cellSize: 32 }), recipe)));
  const runtime = new ParkRuntime(park), crowd = runtime.crowd, coasters = park.rides.filter(r => r.curve);
  const moved = new Map<number, { x: number; z: number; since: number }>();
  let longestStill = 0, where = "";
  for (let step = 0; step < 300 * 60; step++) {
    runtime.advance(1 / 60);
    if (step % 60) continue;
    // Anyone leaving a train who stays on one spot for a minute is stuck (a full train queueing for the stair waits about half that).
    for (let g = 0; g < crowd.count; g++) {
      if (crowd.mode[g] !== GuestMode.Exit || !park.rides[crowd.ride[g]].curve) { moved.delete(g); continue; }
      const x = crowd.pos[g * 3], z = crowd.pos[g * 3 + 2], seen = moved.get(g);
      if (!seen || Math.hypot(x - seen.x, z - seen.z) > 0.05) moved.set(g, { x, z, since: runtime.elapsed });
      else if (runtime.elapsed - seen.since > longestStill) { longestStill = runtime.elapsed - seen.since; where = `guest ${g} on ${park.rides[crowd.ride[g]].name} at ${x.toFixed(1)}, ${crowd.pos[g * 3 + 1].toFixed(1)}, ${z.toFixed(1)}, stage ${runtime["transitionStage"][g]} of ${runtime["boardingPaths"][g].length}`; }
    }
  }
  expect(longestStill, `longest time a rider leaving a train stood still (${where})`).toBeLessThan(60);
  for (const ride of coasters) expect(runtime.rides[ride.id].completed, `${ride.name} (${ride.family}) cycles in 300 s`).toBeGreaterThanOrEqual(2);
}, 600000);

it.each([0, 400])('stands every train of a coaster clear of the others at the start, with %i guests', guests => {
  const recipe = { ...defaultParkRecipe(1337), guests };
  const park = generatePark(recipe, createTerrainSampler(gradeParkTerrain(testTerrainData({ resolution: 64, cellSize: 32 }), recipe)));
  const runtime = new ParkRuntime(park);
  const separation = (): number => {
    let least = Infinity;
    for (const ride of park.rides) if (ride.curve) {
      const trains = runtime.rides[ride.id].trains, loop = ride.curve.length, length = ride.cars * ride.carLength;
      for (let a = 0; a < trains.length; a++) for (let b = a + 1; b < trains.length; b++) {
        const gap = Math.abs(trains[a].s - trains[b].s) % loop;
        least = Math.min(least, Math.min(gap, loop - gap) - length);
      }
    }
    return least;
  };
  expect(separation(), 'bumper to bumper distance between two trains of one coaster at t = 0').toBeGreaterThan(0);
  for (let step = 0; step < 120 * 60; step++) runtime.advance(1 / 60);
  expect(separation(), 'bumper to bumper distance after two minutes').toBeGreaterThan(0);
}, 600000);
