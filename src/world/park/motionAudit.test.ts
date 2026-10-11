import { expect, it } from 'vitest';
import { createTerrainSampler } from '../terrain/sampler';
import { testTerrainData } from '../track/testTerrain';
import { auditPark } from './constructionAudit';
import { TOPSPIN_ARM, TOPSPIN_PIVOT } from './flatPhysics';
import { generatePark, gradeParkTerrain } from './generator';
import { auditMotion } from './motionAudit';
import { METAL, Parts } from './parts';
import { defaultParkRecipe } from './recipe';
import { ParkRuntime } from './runtime';

it('reports a fixed post that only the moving Top Spin gondola reaches, and only in motion', () => {
  const recipe = { ...defaultParkRecipe(1337), guests: 0 };
  const park = generatePark(recipe, createTerrainSampler(gradeParkTerrain(testTerrainData({ resolution: 64, cellSize: 32 }), recipe)));
  const ride = park.rides.find(r => r.family === 'topspin')!;
  // A post standing where the gondola axis passes with the arms horizontal, clear of every part at rest.
  const z = -TOPSPIN_ARM, post = new Parts(park, ride.pos, ride.yaw).rod([0, TOPSPIN_PIVOT - 0.4, z], [0, TOPSPIN_PIVOT + 0.4, z], 0.05, METAL), index = park.parts.indexOf(post);
  const rest = auditPark(park, new ParkRuntime(park).bodies, { focus: i => i === index, checks: { ends: false, support: false, coplanar: false, degenerate: false } });
  expect(rest.findings.map(f => f.detail), 'nothing touches the post at rest').toEqual([]);
  // No guests: the ride dispatches after its 24 s boarding window and 4 s restraint check, then swings the arms over.
  const moving = auditMotion(park, { start: 24, span: 40, step: 0.05, families: ['topspin'] });
  const hits = moving.findings.filter(f => f.kind === 'motion-interference' && f.parts.includes(index));
  expect(hits.length, moving.findings.map(f => `${f.kind} ${f.parts} t=${f.time}`).join('\n')).toBeGreaterThan(0);
  expect(Math.min(...hits.map(f => f.time))).toBeGreaterThan(24);
}, 300000);
