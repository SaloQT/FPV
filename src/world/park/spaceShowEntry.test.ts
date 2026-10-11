import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../../contracts';
import { createTerrainSampler } from '../terrain/sampler';
import { testTerrainData } from '../track/testTerrain';
import { SHOW_OPENING_HALF, SHOW_WALL_HALF_THICKNESS, showWallCrossings } from './coasterAccess';
import { generatePark, gradeParkTerrain } from './generator';
import { defaultParkRecipe } from './recipe';
import type { ParkData, ParkSize, RideDefinition } from './types';

/** What would walk a guest into a wall of the space show building: queue, stair foot, exit or station on a wall, or a path meeting a wall outside its front opening. */
function entryProblems(park: ParkData, ride: RideDefinition): string[] {
  const room = park.rooms.find(r => r.ride === ride.id)!, T = SHOW_WALL_HALF_THICKNESS, centre = (room.min[0] + room.max[0]) / 2, problems: string[] = [];
  const inWall = (p: Vec3) => p[0] > room.min[0] - T && p[0] < room.max[0] + T && p[2] > room.min[2] - T && p[2] < room.max[2] + T
    && !(p[0] > room.min[0] + T && p[0] < room.max[0] - T && p[2] > room.min[2] + T && p[2] < room.max[2] - T);
  const named: [string, Vec3][] = [...ride.queue.map((p, i): [string, Vec3] => [`queue point ${i}`, p]), ...ride.boarding.map((p, i): [string, Vec3] => [`boarding point ${i}`, p]),
    ...ride.exit.map((p, i): [string, Vec3] => [`exit point ${i}`, p]), ['station node', park.nodes[ride.station].pos]];
  for (const [name, p] of named) if (inWall(p)) problems.push(`${name} stands in a wall`);
  for (const c of showWallCrossings(park, room.min, room.max)) {
    for (const [wall, at] of [[c.enter, c.at[0]], [c.leave, c.at[1]]] as [number, Vec3][]) {
      if (wall < 0) continue;
      if (wall !== 3) problems.push(`path ${c.a}-${c.b} meets wall ${wall}, which has no opening`);
      else if (Math.abs(at[0] - centre) > SHOW_OPENING_HALF - 1.5) problems.push(`path ${c.a}-${c.b} meets the front wall ${Math.abs(at[0] - centre).toFixed(1)} m off the opening's centre`);
    }
  }
  return problems;
}

describe.each([[1337, 'destination'], [7, 'mega'], [20000060, 'mega']] as [number, ParkSize][])('space show building entry, seed %i, %s', (seed, size) => {
  const recipe = { ...defaultParkRecipe(seed, size), guests: 0 };
  const park = generatePark(recipe, createTerrainSampler(gradeParkTerrain(testTerrainData({ resolution: 64, cellSize: 32 }), recipe)));
  const ride = park.rides.find(r => r.family === 'space');
  it('has a space coaster whose queue, stair foot, exit and station walk stay clear of the walls and meet the building at the front opening', () => {
    expect(ride).toBeDefined();
    expect(entryProblems(park, ride!)).toEqual([]);
  }, 900000);
  it('notices a queue point moved into a wall and a path that meets a side wall', () => {
    const room = park.rooms.find(r => r.ride === ride!.id)!, queue = ride!.queue.map(p => [...p] as Vec3), saved = ride!.queue;
    try {
      ride!.queue = queue; queue[0][0] = room.min[0];
      expect(entryProblems(park, ride!)).toContain('queue point 0 stands in a wall');
    } finally { ride!.queue = saved; }
    const link = park.nodes.findIndex(n => n.pos[0] > room.min[0] + 5 && n.pos[0] < room.max[0] - 5 && n.pos[2] > room.min[2] + 5 && n.pos[2] < room.max[2] - 5 && n.links.length);
    const outside: Vec3 = [room.min[0] - 20, 12.2, (room.min[2] + room.max[2]) / 2], added = park.nodes.push({ pos: outside, links: [link], kind: 'path' }) - 1;
    park.nodes[link].links.push(added);
    try { expect(entryProblems(park, ride!).some(m => m.includes('meets wall 0'))).toBe(true); }
    finally { park.nodes[link].links.pop(); park.nodes.pop(); }
  }, 900000);
}, 900000);
