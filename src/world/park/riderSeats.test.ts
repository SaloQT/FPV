import { expect, it } from 'vitest';
import type { Vec3 } from '../../contracts';
import { createTerrainSampler } from '../terrain/sampler';
import { testTerrainData } from '../track/testTerrain';
import { generatePark, gradeParkTerrain } from './generator';
import { add, pose, rotate } from './math';
import { defaultParkRecipe } from './recipe';
import { SEAT_PAN } from './rideDimensions';
import { ParkRuntime } from './runtime';

/** The runtime keeps its own table of where riders sit; every entry must land on a seat the generator built. A rideSeat's
 * shell is the moulded sphere [0.24, 0.14, 0.36] placed 0.02 up and 0.02 back from the seat origin, and the rider sits SEAT_PAN above that origin. */
it('seats every rider on a seat that was built for them, on every ride', () => {
  const recipe = { ...defaultParkRecipe(1337, 'destination'), guests: 1 };
  const park = generatePark(recipe, createTerrainSampler(gradeParkTerrain(testTerrainData({ resolution: 64, cellSize: 32 }), recipe)));
  const runtime = new ParkRuntime(park), c = runtime.crowd, seatBodies = runtime['seatBodies'] as Int32Array[];
  const shells = new Map<number, { at: Vec3; forward: Vec3 }[]>();
  for (const p of park.parts) if (p.body >= 0 && p.shape === 'sphere' && p.half[0] === 0.24 && p.half[1] === 0.14 && p.half[2] === 0.36) {
    const origin = add(p.pos, rotate(p.rot, [0, -0.02, -0.02])), list = shells.get(p.body) ?? [];
    list.push({ at: add(origin, rotate(p.rot, [0, SEAT_PAN, 0])), forward: rotate(p.rot, [0, 0, -1]) }); shells.set(p.body, list);
  }
  const problems: string[] = [], checked = new Set<string>();
  for (const ride of park.rides) for (let train = 0; train < ride.trains; train++) for (let seat = 0; seat < ride.capacity; seat++) {
    const id = seatBodies[ride.id][train * ride.capacity + seat], built = shells.get(id);
    if (!built) continue; // Swings, carousel horses and other seats not built by rideSeat.
    checked.add(ride.family);
    c.ride[0] = ride.id; c.seat[0] = seat; c.train[0] = train;
    const rider = runtime.guestSeat(0, pose()), at = rider.pos, body = runtime.bodies[id];
    const gaps = built.map(b => Math.hypot(...add(body.pos, rotate(body.rot, b.at)).map((v, k) => v - at[k]))), miss = Math.min(...gaps), nearest = built[gaps.indexOf(miss)];
    // The rider faces the way the seat faces (seats face their local -z).
    const facing = rotate(rider.rot, [0, 0, -1]), seatFacing = rotate(body.rot, nearest.forward);
    if (facing.reduce((s, v, k) => s + v * seatFacing[k], 0) < 1 - 1e-9) problems.push(`${ride.family} ride ${ride.id} train ${train} seat ${seat}: rider faces away from the seat, is 0 mm`);
    if (miss > 1e-6) problems.push(`${ride.family} ride ${ride.id} train ${train} seat ${seat}: rider is ${(miss * 1000).toFixed(1)} mm from the nearest built seat`);
  }
  const summary = new Map<string, number[]>(); for (const line of problems) { const family = line.split(" ")[0] + (line.includes("faces away") ? " facing" : " position"), mm = Number(line.match(/is ([0-9.]+) mm/)![1]); summary.set(family, [...(summary.get(family) ?? []), mm]); }
  expect([...summary].map(([family, misses]) => `${family}: ${misses.length} seats, ${Math.min(...misses)} to ${Math.max(...misses)} mm`)).toEqual([]);
  expect([...checked].sort()).toEqual(expect.arrayContaining(['enterprise', 'scrambler', 'teacups', 'topspin', 'wheel']));
}, 180000);
