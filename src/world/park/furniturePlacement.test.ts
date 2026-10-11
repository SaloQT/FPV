import { expect, it } from 'vitest';
import { createTerrainSampler } from '../terrain/sampler';
import { testTerrainData } from '../track/testTerrain';
import { auditPark } from './constructionAudit';
import { generatePark, gradeParkTerrain } from './generator';
import { defaultParkRecipe } from './recipe';
import type { ParkSize } from './types';

/** Benches, path lamps and queue rails and canopies are placed beside rides, buildings and scenery. None may stand inside anything already built. */
it.each([[1337, 'destination'], [7, 'compact'], [4294967295, 'compact']] as [number, ParkSize][])('places no bench, lamp or queue furniture inside a built part (seed %i, %s)', (seed, size) => {
  const recipe = { ...defaultParkRecipe(seed, size), guests: 0 };
  const park = generatePark(recipe, createTerrainSampler(gradeParkTerrain(testTerrainData({ resolution: 64, cellSize: 32 }), recipe)));
  // Benches and queue furniture are built with the furniture category; path lamps are the 0.09 m poles 5 m tall.
  const placed = (i: number) => { const p = park.parts[i]; return p.body < 0 && (p.category === 'furniture' || p.shape === 'cylinder' && p.half[0] === 0.09 && Math.abs(p.half[1] - 2.5) < 1e-9); };
  expect(park.parts.some((_, i) => placed(i))).toBe(true);
  const report = auditPark(park, [], { focus: placed, checks: { ends: false, support: false, coplanar: false, degenerate: false } });
  expect(report.findings.map(f => `${f.kind} ${(f.measured * 1000).toFixed(1)} mm parts ${f.parts.join(',')} at ${f.location.map(v => v.toFixed(2))}: ${f.detail}`)).toEqual([]);
}, 120000);
