import { expect, it } from 'vitest';
import { createTerrainSampler } from '../terrain/sampler';
import { testTerrainData } from '../track/testTerrain';
import { partDistance } from './collision';
import { measureJoints } from './construction';
import { generatePark, gradeParkTerrain } from './generator';
import { defaultParkRecipe } from './recipe';
import { ParkRuntime } from './runtime';
import { pose as bodyPose } from './math';
import { PARK_DT } from './ridePhysics';

it.each([7, 1337, 4294967295])('keeps physical ride welds, hinge axes and sliding interfaces connected across operating poses (seed %i)', seed => {
  const recipe = { ...defaultParkRecipe(seed), guests: 0 }, park = generatePark(recipe, createTerrainSampler(gradeParkTerrain(testTerrainData({ resolution: 64, cellSize: 32 }), recipe)));
  const runtime = new ParkRuntime(park);
  const joints = park.joints!.filter(j => /^\d+\//.test(j.name) || park.parts[j.a.part].body >= 0 || park.parts[j.b.part].body >= 0);
  const subject = { ...park, joints };
  expect(measureJoints(subject, runtime.bodies).filter(j => !j.pass).map(j => j.name), 'Initial operating snapshot').toEqual([]);
  const moving = { ...park, joints: joints.filter(j => park.parts[j.a.part].body >= 0 || park.parts[j.b.part].body >= 0) }, poses = park.bodies.map(() => bodyPose());
  const offMaterial: string[] = [];
  for (const joint of joints) if (joint.anchorModel !== 'virtual-axis') for (const anchor of [joint.a, joint.b]) {
    if (partDistance(park.parts[anchor.part], anchor.point, [0, 1, 0]) > 1e-8 && offMaterial.length < 20) offMaterial.push(joint.name);
  }
  expect(offMaterial, 'Declared material interfaces must lie on or inside their actual primitives').toEqual([]);
  for (let pose = 0; pose < 8; pose++) {
    for (const ride of park.rides) {
      if (ride.curve) continue;
      const state = runtime.rides[ride.id], f = (pose + 0.1) / 8;
      state.phase = 'running'; state.phaseTime = pose * 3; state.theta = pose * 0.73; state.omega = 0.7; state.phiV = 0;
      state.phi = ride.family === 'enterprise' ? f * 1.48 : ride.family === 'swings' ? f * 0.8 : ride.family === 'topspin' ? pose * 0.6 : f * 0.6;
      state.y = ride.family === 'swings' ? 5.6 + (ride.height - 5.6) * f : 2 + (ride.height - 2) * f; state.vy = 0;
      state.hinges.fill(f); state.hingeV.fill(0); state.trains[0].restraint = 0.15 + f * 0.8;
    }
    runtime.advance(1 / 250);
    for (const alpha of [0, 0.25, 0.5, 0.75, 1]) {
      for (let i = 0; i < poses.length; i++) runtime.bodyPose(i, (runtime.tick - 1 + alpha) * PARK_DT, poses[i]);
      const failed = measureJoints(moving, poses).filter(j => !j.pass);
      expect(failed.slice(0, 12).map(j => ({ name: j.name, separation: j.separation, lateral: j.lateralError, axis: j.axisError })), `operating pose ${pose}, alpha ${alpha}`).toEqual([]);
    }
  }
}, 30000);
