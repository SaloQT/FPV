import { beforeAll, describe, expect, it } from 'vitest';
import type { Vec3 } from '../../contracts';
import { GUEST_LODS, GUEST_LOOKS, skinGuestMesh } from '../../render/park/guestSkinReference';
import { createTerrainSampler } from '../terrain/sampler';
import { testTerrainData } from '../track/testTerrain';
import { generatePark, gradeParkTerrain } from './generator';
import { GUEST_MAX_HEIGHT, GUEST_SEAT_Y, GUEST_SEATED_HALF_WIDTH, GUEST_SWING_PAN_FRONT, guestSeatAngle } from './guestPose';
import { signedDistance, solidOf } from './interference';
import { pose, rotate } from './math';
import { defaultParkRecipe } from './recipe';
import { ParkRuntime } from './runtime';
import type { ParkData, RideFamily } from './types';

let generated: ParkData;
beforeAll(() => {
  const recipe = { ...defaultParkRecipe(1337), guests: 0 };
  generated = generatePark(recipe, createTerrainSampler(gradeParkTerrain(testTerrainData({ resolution: 64, cellSize: 32 }), recipe)));
}, 240000);

/**
 * The deepest a skinned rider reaches into any solid part of its own ride, in metres, with the ride at rest and the guest seated and the restraint closed.
 * A closed lap bar is meant to press a little into the soft belly, so the limit is a few centimetres rather than zero.
 */
function deepestIntrusion(family: RideFamily, height: number): { depth: number; part: string } {
  const source = generated.rides.find(r => r.family === family)!, ids = new Map(source.bodies.map((id, i) => [id, i])), own = new Set(source.bodies);
  const ride = { ...source, id: 0, station: 1, bodies: source.bodies.map((_, i) => i) };
  const park: ParkData = { ...generated, recipe: { ...generated.recipe, guests: 1 }, rides: [ride], parts: generated.parts.filter(p => p.body >= 0 && own.has(p.body)).map(p => ({ ...p, body: ids.get(p.body)! })), rooms: [], lights: [], routes: [], entrance: 0,
    bodies: source.bodies.map(id => ({ ...generated.bodies[id], ride: 0, parent: generated.bodies[id].parent === undefined ? undefined : ids.get(generated.bodies[id].parent!) })),
    nodes: [{ pos: ride.exit[0], kind: 'entrance', links: [1] }, { pos: ride.boarding[0], kind: 'station', links: [0] }], paths: [{ a: 0, b: 1, width: 6 }] };
  const runtime = new ParkRuntime(park), c = runtime.crowd, state = runtime.rides[0];
  state.phase = 'boarding'; state.theta = family === 'wheel' ? -Math.PI / 2 : 0; state.phi = state.omega = state.phiV = 0; state.y = 2; state.hinges.fill(0);
  for (const train of state.trains) { train.seatIds.fill(-1); train.passengers = 0; train.passengerMass = 0; train.restraint = 1; if (ride.curve) train.s = ride.curve.stationEnd - 6; }
  runtime['updateBodies'](); c.height[0] = height; runtime['assign'](0, 0, 0, 0, true); state.trains[0].passengers = 1; runtime['updateRiders'](0);
  const seat = runtime.guestSeat(0, pose()), solids = park.parts.map((p, i) => solidOf(p, i, runtime.bodies[p.body]));
  let depth = 0, part = '';
  for (const v of skinGuestMesh('near', { kind: 'seated', blend: 1, seatAngle: c.seatAngle[0], straddle: c.straddle[0], panFront: c.seatFront[0] }, height, GUEST_LOOKS.mid, c.seatAngle[0])) {
    const local = rotate(seat.rot, [v.pos[0] * height, (v.pos[1] - GUEST_SEAT_Y) * height, v.pos[2] * height]), p: Vec3 = [seat.pos[0] + local[0], seat.pos[1] + local[1], seat.pos[2] + local[2]];
    solids.forEach((s, i) => { const d = signedDistance(s, p); if (d < -depth) { depth = -d; part = `${park.parts[i].shape} ${park.parts[i].half.map(x => x.toFixed(2)).join('/')} (guest joint ${v.joint})`; } });
  }
  return { depth, part };
}

describe('seated guests against the solid parts of every ride', () => {
  const LIMIT = 0.035;
  const families: RideFamily[] = ['steel', 'launch', 'inverted', 'wooden', 'hyper', 'mine', 'space', 'wheel', 'carousel', 'swings', 'ship', 'pendulum', 'drop', 'teacups', 'scrambler', 'observation', 'enterprise', 'topspin'];
  for (const family of families) {
    it(`keeps a seated guest of every size out of the ride's solid parts, ${family}`, () => {
      if (!generated.rides.some(r => r.family === family)) return;
      const bad: string[] = [];
      for (const height of [1.05, 1.75, 1.95]) {
        const { depth, part } = deepestIntrusion(family, height);
        if (depth > LIMIT) bad.push(`${family} ${height} m: ${(depth * 100).toFixed(1)} cm into ${part}`);
      }
      expect(bad, bad.join('\n')).toEqual([]);
    }, 240000);
  }
});

it('keeps the swing seat depth the guests are fitted to equal to the swing seat the generator builds', () => {
  const pan = generated.parts.find(p => p.shape === 'box' && p.body >= 0 && generated.bodies[p.body].ride !== undefined && generated.rides[generated.bodies[p.body].ride].family === 'swings' && p.half[0] === 0.45 && p.half[1] === 0.12)!;
  expect(pan, 'swing seat pan').toBeDefined();
  expect(-(pan.pos[2] - pan.half[2])).toBeCloseTo(GUEST_SWING_PAN_FRONT, 3);
});

it('keeps every seated guest within the seated half width that rides space their end seats by', () => {
  let widest = 0;
  for (const height of [1.05, 1.5, 1.75, GUEST_MAX_HEIGHT]) for (const lod of GUEST_LODS) for (const build of ['slim', 'mid', 'broad'] as const) {
    const angle = guestSeatAngle(height, 0.45);
    for (const v of skinGuestMesh(lod, { kind: 'seated', blend: 1, seatAngle: angle, straddle: 0 }, height, GUEST_LOOKS[build], angle)) widest = Math.max(widest, Math.abs(v.pos[0]) * height);
  }
  expect(widest).toBeLessThanOrEqual(GUEST_SEATED_HALF_WIDTH);
  // The constant stays tight, so seats are not spread for a body nobody has.
  expect(widest).toBeGreaterThan(GUEST_SEATED_HALF_WIDTH - 0.02);
});
