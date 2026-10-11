import { it, expect } from 'vitest';
import { generatePark, gradeParkTerrain } from './generator';
import { defaultParkRecipe } from './recipe';
import { createTerrainSampler } from '../terrain/sampler';
import { testTerrainData } from '../track/testTerrain';
import { ParkRuntime } from './runtime';
import type { Vec3 } from '../../contracts';
import { Rng, deriveSeed } from '../track/rng';
import { coasterLayout } from './coasterLayout';
import { compileCurve } from './curve';
import { coasterSupportStations } from './coasterSupports';
import { COASTER_FAMILIES } from './types';

it.each([107148, 110865, 316767, 661478, 704790])('resolves support framing for previously conflicting seed %i', seed => {
  for (let i = 0; i < 10; i++) {
    const family = COASTER_FAMILIES[i % COASTER_FAMILIES.length], rng = new Rng(deriveSeed(seed, 902, i)); rng.range(45, 85);
    const plan = coasterLayout(family, rng), curve = compileCurve(plan.points.map(p => [p[0], p[1] + 12, p[2]]), plan.station, plan.lift, plan.brake, 24);
    expect(() => coasterSupportStations(curve, family === 'inverted', family === 'wooden'), `${family}/${i}`).not.toThrow();
  }
});

it.each([7, 4201, 4294967295])('keeps built coaster guides clear of their physical support frames (seed %i)', seed => {
  const recipe = { ...defaultParkRecipe(seed, 'destination'), guests: 0 };
  const park = generatePark(recipe, createTerrainSampler(gradeParkTerrain(testTerrainData({ resolution: 64, cellSize: 32 }), recipe)));
  const runtime = new ParkRuntime(park), hit = { normal: [0, 1, 0] as Vec3, velocity: [0, 0, 0] as Vec3, penetration: 0, friction: 0, restitution: 0 };
  for (const route of park.routes) if (route.parkCourse?.startsWith('coaster-')) for (let i = 1; i < route.path.length; i++) {
    expect(runtime.collision.sweep(route.path[i - 1], route.path[i], 0.3, hit), `${route.parkCourse} segment ${i}`).toBe(1);
  }
}, 30000);
