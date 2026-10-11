import { expect, it } from 'vitest';
import type { Vec3 } from '../../contracts';
import { createTerrainSampler } from '../terrain/sampler';
import { testTerrainData } from '../track/testTerrain';
import { partDistance } from './collision';
import { railSample, sampleRail } from './curve';
import { generatePark, gradeParkTerrain } from './generator';
import { add, cross, inverseRotate, mul, rotate } from './math';
import { chassisSolution, solveChassis } from './coasterChassis';
import { coasterBogiePivot, coasterWheelbase, COASTER_SEAT, COASTER_FLOOR } from './rideDimensions';
import { defaultParkRecipe } from './recipe';
import { ParkRuntime } from './runtime';

it('keeps loaded trains clear around complete circuits and provides continuous stairs at a usable boarding height', () => {
  const recipe = { ...defaultParkRecipe(1337, 'destination'), guests: 0 };
  const park = generatePark(recipe, createTerrainSampler(gradeParkTerrain(testTerrainData({ resolution: 64, cellSize: 32 }), recipe))), runtime = new ParkRuntime(park);
  const hits: string[] = [], s = railSample(), normal: Vec3 = [0, 1, 0];
  for (const ride of park.rides) {
    if (!ride.curve) continue;
    const inverted = ride.family === 'inverted';
    const landing = ride.boarding[2];
    const platform = park.parts.find(p => p.body < 0 && p.shape === 'box' && p.half[0] === 2 && p.half[1] === 0.35 && p.half[2] === 13 && Math.hypot(p.pos[0] - landing[0], p.pos[2] - landing[2]) < 0.01)!;
    expect(platform, `${ride.family} physical landing`).toBeDefined();
    sampleRail(ride.curve, ride.curve.stationEnd - 6 - ride.carLength * 2, s);
    const seatHeight = s.pos[1] + (inverted ? -1.5 : COASTER_SEAT) - landing[1];
    expect(seatHeight).toBeCloseTo(inverted ? 1.1 : COASTER_SEAT - COASTER_FLOOR, 6);
    const stairs = park.parts.filter(p => p.body < 0 && p.shape === 'box' && p.half[0] === 1.4 && p.half[2] === 0.175)
      .map(p => ({ part: p, pos: inverseRotate(platform.rot, p.pos.map((v, k) => v - landing[k]) as Vec3) }))
      .filter(p => Math.abs(p.pos[0]) < 0.01 && p.pos[2] > 13 && p.pos[2] < 30).sort((a, b) => a.pos[2] - b.pos[2]);
    expect(stairs.length).toBeGreaterThan(3);
    expect(stairs[0].pos[2] - stairs[0].part.half[2]).toBeCloseTo(13, 8);
    expect(stairs[0].pos[1] + stairs[0].part.half[1]).toBeCloseTo(0, 8);
    for (let i = 1; i < stairs.length; i++) {
      expect(stairs[i - 1].pos[2] + stairs[i - 1].part.half[2]).toBeCloseTo(stairs[i].pos[2] - stairs[i].part.half[2], 8);
      expect(stairs[i - 1].pos[1] - stairs[i].pos[1]).toBeLessThanOrEqual(0.201);
    }
    const probes: { p: Vec3; radius: number; name: string }[] = [];
    for (const x of [-0.47, 0.47]) {
      probes.push({ p: [x, inverted ? -0.55 : 2.07, 0], radius: 0.2, name: 'head' });
      probes.push({ p: [x, inverted ? -2.35 : 0.8, -0.6], radius: 0.13, name: 'feet' });
    }
    for (const x of [-0.99, 0.99]) probes.push({ p: [x, inverted ? -0.4 : 0.74, 0], radius: 0.08, name: 'chassis' });
    const chassis = chassisSolution();
    for (let at = 0; at < ride.curve.length; at += 0.75) {
      solveChassis(ride.curve, at, coasterWheelbase(ride.carLength), coasterBogiePivot(ride.family), chassis);
      const worldProbes = probes.map(probe => ({ ...probe, p: add(chassis.body.pos, rotate(chassis.body.rot, probe.p)) }));
      for (const bogie of [chassis.front, chassis.rear]) for (const x of [-0.71, 0.71]) worldProbes.push({ p: add(bogie.pos, add(mul(cross(bogie.tangent, bogie.up), x), mul(bogie.up, -0.316))), radius: 0.005, name: 'articulated up-stop underside' });
      for (const probe of worldProbes) {
        const p = probe.p;
        runtime.collision.staticTree.query(...p, probe.radius, index => {
          const part = runtime.collision.statics[index], local = inverseRotate(part.rot, p.map((v, k) => v - part.pos[k]) as Vec3);
          const d = partDistance(part, local, normal);
          if (d < probe.radius - 0.004 && hits.length < 20) hits.push(`${ride.family} at ${at.toFixed(2)} ${probe.name}: ${part.shape} at ${part.pos.map(v => v.toFixed(2))}; clearance ${d.toFixed(3)}`);
        });
      }
    }
  }
  expect(hits).toEqual([]);
}, 30000);
