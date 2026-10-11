import { expect, it } from 'vitest';
import { createTerrainSampler } from '../terrain/sampler';
import { testTerrainData } from '../track/testTerrain';
import { auditPark, partFamily } from './constructionAudit';
import { generatePark, gradeParkTerrain } from './generator';
import { pose } from './math';
import { defaultParkRecipe } from './recipe';
import { RAIL } from './rideDimensions';
import { PARK_DT } from './ridePhysics';
import { ParkRuntime } from './runtime';

const COASTER_FAMILIES = ['steel', 'wooden', 'inverted', 'launch', 'hyper', 'mine', 'space'];

/** The running rails are built from straight tube lengths that cut up to RAIL.chordError inside the exact track curve, and the cars ride on those
 * lengths. This runs every coaster family with its trains moving and checks that no wheel sinks into a rail deeper than the audit's contact tolerance (0.5 mm). */
it('keeps every running wheel of every coaster family on its rail tube while the trains run', () => {
  const recipe = { ...defaultParkRecipe(1337, 'destination'), guests: 400 };
  const park = generatePark(recipe, createTerrainSampler(gradeParkTerrain(testTerrainData({ resolution: 64, cellSize: 32 }), recipe)));
  const isRailTube = (i: number) => park.parts[i].body < 0 && park.parts[i].shape === 'cylinder' && park.parts[i].half[0] === RAIL.radius;
  const isWheel = (i: number) => park.parts[i].body >= 0 && park.parts[i].wheelRadius !== undefined && COASTER_FAMILIES.includes(partFamily(park, i));
  const wheelFamilies = new Set(park.parts.map((_, i) => i).filter(isWheel).map(i => partFamily(park, i)));
  expect([...wheelFamilies].sort()).toEqual([...COASTER_FAMILIES].sort());
  const runtime = new ParkRuntime(park), poses = park.bodies.map(() => pose());
  const sunk: string[] = [];
  for (const time of [30, 45]) {
    while (runtime.elapsed < time - 1e-9) runtime.advance(Math.min(PARK_DT, time - runtime.elapsed));
    for (let i = 0; i < poses.length; i++) runtime.bodyPose(i, runtime.elapsed, poses[i]);
    const report = auditPark(park, poses, { time: runtime.elapsed, focus: isWheel, checks: { ends: false, support: false, coplanar: false, degenerate: false } });
    for (const f of report.findings) {
      if (f.kind !== 'penetration' || !f.parts.some(isWheel) || !f.parts.some(isRailTube)) continue;
      sunk.push(`t=${time} ${f.family} ${(f.measured * 1000).toFixed(2)} mm: parts ${f.parts.join(',')} at ${f.location.map(v => v.toFixed(2))}`);
    }
  }
  expect(sunk).toEqual([]);
}, 600000);
