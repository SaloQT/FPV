import { expect, it } from 'vitest';
import { createTerrainSampler } from '../terrain/sampler';
import { testTerrainData } from '../track/testTerrain';
import { measureJoints } from './construction';
import { generatePark, gradeParkTerrain } from './generator';
import { pose } from './math';
import { defaultParkRecipe } from './recipe';
import { PARK_DT } from './ridePhysics';
import { ParkRuntime } from './runtime';

it('preserves articulated contacts between ticks, independently of sample order and cached parent requests', () => {
  const recipe = { ...defaultParkRecipe(1337), guests: 0 };
  const park = generatePark(recipe, createTerrainSampler(gradeParkTerrain(testTerrainData({ resolution: 64, cellSize: 32 }), recipe)));
  const runtime = new ParkRuntime(park), wheel = park.rides.find(r => r.family === 'wheel')!, enterprise = park.rides.find(r => r.family === 'enterprise')!;
  // Deliberately large increments amplify chord separation. This is a transform test, not a design operating speed.
  for (const ride of [wheel, enterprise]) { const state = runtime.rides[ride.id]; state.phase = 'running'; state.omega = 40; }
  for (const ride of park.rides) if (ride.curve) for (const train of runtime.rides[ride.id].trains) {
    train.s = train.previousS = ride.curve.liftEnd + 35; train.v = 200; train.phase = 'running';
  }
  runtime['updateBodies']();
  runtime.advance(PARK_DT);
  const subject = { ...park, joints: park.joints!.filter(j => j.name.startsWith(`${wheel.id}/wheel`) || j.name.startsWith(`${enterprise.id}/enterprise-gondola`)
    || [j.a, j.b].some(anchor => ['coupler', 'bogie'].includes(park.bodies[park.parts[anchor.part].body]?.role))) };
  expect(subject.joints.length).toBeGreaterThan(20);
  const sampled = park.bodies.map(() => pose());
  for (const alpha of [0.5, 0.2, 0.8, 0.5]) {
    // Child-first requests exercise recursive evaluation and cannot rely on renderer iteration order.
    for (let i = sampled.length - 1; i >= 0; i--) runtime.bodyPose(i, alpha * PARK_DT, sampled[i]);
    expect(measureJoints(subject, sampled).filter(j => !j.pass).map(j => j.name)).toEqual([]);
  }
  const chord = runtime.bodies.map((body, i) => {
    const p = runtime.previousBodies[i], sign = body.rot.reduce((sum, v, k) => sum + v * p.rot[k], 0) < 0 ? -1 : 1;
    const q = p.rot.map((v, k) => (v + sign * body.rot[k]) / 2), n = Math.hypot(...q), result = pose();
    for (let k = 0; k < 3; k++) result.pos[k] = (p.pos[k] + body.pos[k]) / 2;
    for (let k = 0; k < 4; k++) result.rot[k] = q[k] / n;
    return result;
  });
  expect(Math.max(...measureJoints(subject, chord).map(j => j.lateralError)), 'Independent world-pose interpolation would detach the bearing by centimetres').toBeGreaterThan(0.01);
}, 30000);
