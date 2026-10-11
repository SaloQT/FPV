import { beforeAll, describe, expect, it } from 'vitest';
import type { Vec3 } from '../../contracts';
import { createTerrainSampler } from '../terrain/sampler';
import { testTerrainData } from '../track/testTerrain';
import { GuestMode } from './crowd';
import { generatePark, gradeParkTerrain } from './generator';
import { GUEST_SEAT_Y, guestContactLeg, guestSoleLift } from './guestPose';
import { STAIR_RAIL_RADIUS } from './assembly';
import { compileGuestStairs, STAIR_HEADWAY, STAIR_LANE } from './guestStairs';
import { inverseRotate, pose, rotate } from './math';
import { COASTER_FLOOR, TEACUPS } from './rideDimensions';
import { defaultParkRecipe } from './recipe';
import { ParkRuntime } from './runtime';
import type { ParkData, RideFamily } from './types';

let generated: ParkData;
beforeAll(() => {
  const recipe = { ...defaultParkRecipe(1337), guests: 0 };
  generated = generatePark(recipe, createTerrainSampler(gradeParkTerrain(testTerrainData({ resolution: 64, cellSize: 32 }), recipe)));
}, 240000);

function fixture(family: RideFamily, height = 1.95, stairs = false, guests = 1) {
  const source = generated.rides.find(r => r.family === family)!, ids = new Map(source.bodies.map((id, i) => [id, i]));
  const ride = { ...source, id: 0, station: 1, bodies: source.bodies.map((_, i) => i) };
  const park: ParkData = { ...generated, recipe: { ...generated.recipe, guests }, rides: [ride], parts: stairs ? generated.parts.filter(p => p.walkSurface?.ride === source.id).map(p => ({ ...p, walkSurface: { kind: 'tread' as const, ride: 0 } })) : [], rooms: [], lights: [], routes: [], entrance: 0,
    bodies: source.bodies.map(id => ({ ...generated.bodies[id], ride: 0, parent: generated.bodies[id].parent === undefined ? undefined : ids.get(generated.bodies[id].parent!) })),
    nodes: [{ pos: ride.exit[0], kind: 'entrance', links: [1] }, { pos: ride.boarding[0], kind: 'station', links: [0] }], paths: [{ a: 0, b: 1, width: 6 }] };
  const runtime = new ParkRuntime(park), c = runtime.crowd, state = runtime.rides[0];
  state.phase = 'boarding'; state.theta = family === 'wheel' ? -Math.PI / 2 : 0; state.phi = state.omega = state.phiV = 0; state.y = family === 'swings' ? 5.6 : 2; state.hinges.fill(0);
  for (const train of state.trains) { train.seatIds.fill(-1); train.passengers = 0; train.passengerMass = 0; train.restraint = 0; if (ride.curve) train.s = ride.curve.stationEnd - 6; }
  runtime['updateBodies'](); c.height[0] = height; runtime['assign'](0, 0, 0, 0); state.trains[0].passengers = 1;
  const seat = runtime.guestSeat(0, pose()), staging = runtime['guestStagingPoint'](0, seat);
  c.pos.set(staging); c.previous.set(staging); runtime['transitionStage'][0] = runtime['boardingPaths'][0].length - 1;
  runtime['updateRiders'](0);
  const step = (dt: number) => { c.previous.set(c.pos); c.previousSeatBlend.set(c.seatBlend); runtime['updateRiders'](dt); };
  return { runtime, c, state, ride, source, seat, staging, step };
}

describe('boarding support and seat transfers', () => {
  it('fits both complete guest lanes inside the actual generated sloping handrails', () => {
    for (const flight of compileGuestStairs(generated)) {
      expect(flight).toBeDefined(); const f = flight!; let clear = Infinity, rails = 0;
      // A single 100 mm step up to a low ride platform carries no handrails; every flight of two or more risers does.
      if (f.top - f.bottom <= 0.2 + 1e-9) continue;
      for (const part of generated.parts) {
        // Every cast stair, coaster stations included, carries STAIR_RAIL_RADIUS rails.
        if (part.body >= 0 || part.shape !== 'cylinder' || Math.abs(part.half[0] - STAIR_RAIL_RADIUS) > 1e-8) continue;
        const t = f.project(part.pos); if (t < 0 || t > f.length) continue;
        const side = Math.abs(f.lateral(part.pos)); if (side < 1.2 || side > f.halfWidth + 0.2) continue;
        const floor = f.bottom + t / f.length * (f.top - f.bottom), elevation = part.pos[1] - floor;
        const axis = rotate(part.rot, [0, 1, 0]);
        if (elevation < 0.8 || elevation > 1.3 || Math.abs(axis[0] * f.forward[0] + axis[2] * f.forward[2]) < 0.7) continue;
        rails++; clear = Math.min(clear, side - part.half[0]);
      }
      expect(rails).toBeGreaterThanOrEqual(2);
      // The mesh envelope test separately proves maximum posed half-width < .46 m.
      expect(STAIR_LANE + 0.46 + 0.05).toBeLessThan(clear);
    }
  });
  it('keeps physical headway through slowdown and lets opposing boarding/exit lanes pass without deadlock', () => {
    const f = fixture('steel', 1.95, true, 6), flight = compileGuestStairs(f.runtime.park)[0]!, paths: Vec3[][] = [], finished = new Set<number>();
    const point = (t: number, lane: number): Vec3 => [flight.origin[0] + flight.forward[0] * t + flight.forward[2] * lane,
      flight.bottom + Math.max(0, Math.min(1, t / flight.length)) * (flight.top - flight.bottom), flight.origin[2] + flight.forward[2] * t - flight.forward[0] * lane];
    for (let i = 0; i < 6; i++) {
      const direction = i < 3 ? 1 : -1, index = i % 3, start = direction > 0 ? -2.4 - index * (STAIR_HEADWAY + 0.1) : flight.length + 2.4 + index * (STAIR_HEADWAY + 0.1), end = direction > 0 ? flight.length + 2.4 : -2.4;
      f.c.mode[i] = direction > 0 ? GuestMode.Boarding : GuestMode.Exit; f.c.ride[i] = 0; f.c.seatBlend[i] = 0; f.c.pos.set(point(start, direction * STAIR_LANE), i * 3); f.runtime['transitionStage'][i] = 0;
      paths.push([point(end, direction * STAIR_LANE)]);
      // Walkers judge who holds them back by the route each other guest is on, so the route walked here must be the one the runtime holds.
      f.runtime['boardingPaths'][i] = paths[i];
    }
    let passed = false;
    for (let step = 0; step < 4000 && finished.size < 6; step++) {
      f.c.previous.set(f.c.pos); f.c.reindex();
      for (let i = 0; i < 6; i++) if (!finished.has(i) && f.runtime['walkTransition'](i, paths[i], 1 / 60)) { finished.add(i); f.c.mode[i] = GuestMode.Walk; f.c.stairFlight[i] = -1; }
      for (let i = 0; i < 6; i++) for (let j = i + 1; j < 6; j++) if (!finished.has(i) && !finished.has(j)) {
        const a = f.c.pos.subarray(i * 3, i * 3 + 3), b = f.c.pos.subarray(j * 3, j * 3 + 3), sameLane = Math.sign(flight.lateral(a)) === Math.sign(flight.lateral(b));
        if (sameLane) expect(Math.abs(flight.project(a) - flight.project(b))).toBeGreaterThanOrEqual(STAIR_HEADWAY - 1e-7);
        else if (Math.abs(flight.project(a) - flight.project(b)) < 0.1) { passed = true; expect(Math.abs(flight.lateral(a) - flight.lateral(b))).toBeCloseTo(2 * STAIR_LANE, 8); }
      }
    }
    expect(passed).toBe(true); expect(finished.size).toBe(6);
  });

  it('settles a blocked swing foot and raises it before resuming route movement', () => {
    const f = fixture('steel', 1.75, true, 2), flight = compileGuestStairs(f.runtime.park)[0]!, targets = new Float64Array(8), direction = flight.forward;
    const at = (t: number): Vec3 => [flight.origin[0] + direction[0] * t, flight.bottom + t / flight.length * (flight.top - flight.bottom), flight.origin[2] + direction[2] * t];
    const start = at(1.26), end = at(flight.length + 1), blocker = at(1.76);
    for (let i = 0; i < 2; i++) { f.c.mode[i] = GuestMode.Boarding; f.c.ride[i] = 0; f.c.seatBlend[i] = 0; }
    f.c.pos.set(start, 0); f.c.pos.set(blocker, 3); f.runtime['transitionStage'][0] = 0;
    // The blocker is on the same route up the flight; without it the runtime would still hold a route from the fixture's start-up.
    f.runtime['boardingPaths'][1] = [end]; f.runtime['transitionStage'][1] = 0;
    for (let step = 0; step < 30; step++) { f.c.previous.set(f.c.pos); f.c.reindex(); f.runtime['walkTransition'](0, [end], 1 / 60); }
    for (let k = 0; k < 3; k++) expect(f.c.pos[k]).toBeCloseTo(start[k], 10); expect(f.c.stairActivity[0]).toBe(0);
    expect(f.runtime.guestStairContacts(0, f.c.pos, 1, targets)).toBe(true);
    for (let side = 0; side < 2; side++) {
      const ankleT = flight.project(start) - targets[side * 2 + 1] * f.c.height[0];
      expect(start[1] + targets[side * 2] * f.c.height[0]).toBeGreaterThanOrEqual(flight.support(ankleT) - 1e-8);
    }
    f.c.pos.set(at(5), 3);
    for (let step = 0; step < 10; step++) { f.c.previous.set(f.c.pos); f.c.reindex(); f.runtime['walkTransition'](0, [end], 1 / 60); }
    for (let k = 0; k < 3; k++) expect(f.c.pos[k]).toBeCloseTo(start[k], 10);
    for (let step = 0; step < 15; step++) { f.c.previous.set(f.c.pos); f.c.reindex(); f.runtime['walkTransition'](0, [end], 1 / 60); }
    expect(flight.project(f.c.pos)).toBeGreaterThan(flight.project(start));
  });
  it('compiles every generated flight from its solids and walks both directions without a landing-height discontinuity', () => {
    const compiled = compileGuestStairs(generated);
    expect(compiled.filter(Boolean)).toHaveLength(generated.rides.length);
    for (const family of ['steel', 'inverted', 'drop', 'carousel', 'topspin'] as const) for (const descending of [false, true]) {
      const f = fixture(family, 1.05, true), flight = compileGuestStairs(f.runtime.park)[0]!, targets = new Float64Array(8);
      const direction = descending ? -1 : 1, approach = flight.lead(direction), landing = flight.routePoint([flight.origin[0] + flight.forward[0] * (flight.length + 1.4), flight.top, flight.origin[2] + flight.forward[2] * (flight.length + 1.4)], direction);
      const start = descending ? landing : approach, end = descending ? approach : landing;
      f.c.pos.set(start); f.c.previous.set(start); f.runtime['transitionStage'][0] = 0; let samples = 0, largestVerticalStep = 0, previousHip: number | undefined, diagnostic = '';
      for (let step = 0; step < 2000; step++) {
        f.c.previous.set(f.c.pos); f.c.stairFlight[0] = -1;
        const done = f.runtime['walkTransition'](0, [end], 1 / 60);
        if (f.runtime.guestStairContacts(0, f.c.pos, step / 60, targets)) {
          samples++; const leg = guestContactLeg(targets, false, Math.hypot(f.c.vel[0], f.c.vel[2])), hip = f.c.pos[1] + (0.525 - leg.drop) * f.c.height[0];
          if (previousHip !== undefined && Math.abs(hip - previousHip) > largestVerticalStep) { largestVerticalStep = Math.abs(hip - previousHip); diagnostic = JSON.stringify({ step, t: flight.project(f.c.pos), targets: [...targets], hip, previousHip, speed: Math.hypot(f.c.vel[0], f.c.vel[2]) }); } previousHip = hip;
        }
        if (done) break;
      }
      expect(samples).toBeGreaterThan(50); expect(largestVerticalStep, `${family}, descending=${descending} ${diagnostic}`).toBeLessThan(0.06);
      expect([...f.c.pos]).toEqual(end); expect(f.runtime['transitionStage'][0]).toBe(1);
    }
  });
  it('ends walking on actual deck heights, independent of guest height or seated origin', () => {
    for (const family of ['steel', 'inverted', 'wheel', 'carousel', 'swings', 'ship', 'pendulum', 'drop', 'teacups', 'scrambler', 'enterprise', 'topspin'] as const) {
      const short = fixture(family, 1.05), tall = fixture(family, 1.95);
      expect(short.staging).toEqual(tall.staging); expect(tall.c.seatBlend[0]).toBe(0);
      expect([...tall.c.pos]).toEqual(tall.staging);
      const deck = tall.ride.boarding.at(-1)!;
      let expected = family === 'teacups' || family === 'carousel' ? tall.ride.pos[1] + 0.8 : family === 'scrambler' ? tall.ride.pos[1] + 0.2 : deck[1];
      // A cup door may open onto its small turntable: there the guest stands on the generated disc's top face.
      if (family === 'teacups') for (let i = 0; i < tall.source.bodies.length; i++) {
        const disc = generated.parts.find(p => p.body === tall.source.bodies[i] && p.shape === 'cylinder' && p.half[0] === TEACUPS.tableRadius);
        if (!disc) continue;
        const body = tall.runtime.bodies[i], local = inverseRotate(body.rot, tall.staging.map((v, k) => v - body.pos[k]) as Vec3);
        if (Math.hypot(local[0] - disc.pos[0], local[2] - disc.pos[2]) <= disc.half[0]) expected = body.pos[1] + disc.pos[1] + disc.half[1];
      }
      if (tall.ride.curve && family !== 'inverted') {
        const id = tall.runtime['seatBodies'][0][0], body = tall.runtime.bodies[id], local = inverseRotate(body.rot, tall.staging.map((v, k) => v - body.pos[k]) as Vec3);
        const floor = generated.parts.find(p => p.body === tall.source.bodies[id] && p.shape === 'box' && p.half[0] === 0.96 && p.pos[1] + p.half[1] === COASTER_FLOOR)!;
        expect(local[1]).toBeCloseTo(floor.pos[1] + floor.half[1], 8);
        expect(Math.abs(local[0] - floor.pos[0])).toBeLessThan(floor.half[0]); expect(Math.abs(local[2] - floor.pos[2])).toBeLessThan(floor.half[2]);
      } else expect(tall.staging[1], family).toBeCloseTo(expected, 6);
      expect(Math.abs(tall.staging[1] - (tall.seat.pos[1] - tall.c.height[0] * GUEST_SEAT_Y)), family).toBeGreaterThan(0.01);
    }
  });

  it('keeps transfer soles above support and joins the fully seated pelvis without a position jump', () => {
    for (const family of ['steel', 'inverted', 'wheel', 'teacups', 'scrambler', 'enterprise', 'topspin'] as const) for (const height of [1.05, 1.95]) {
      const f = fixture(family, height), h = f.c.height[0], finalSole = f.seat.pos[1] - GUEST_SEAT_Y * h + guestSoleLift(1, f.c.seatAngle[0]) * h;
      let last = [...f.c.pos];
      for (let tick = 0; tick < 340; tick++) {
        f.step(1 / 250); const seating = f.c.seatBlend[0];
        const sole = f.c.pos[1] + guestSoleLift(seating, f.c.seatAngle[0]) * h;
        expect(sole, `${family} ${height} at ${seating}`).toBeGreaterThanOrEqual(Math.min(f.staging[1], finalSole) - 1e-6);
        expect(Math.hypot(...[0, 1, 2].map(k => f.c.pos[k] - last[k])), family).toBeLessThan(0.035); last = [...f.c.pos];
      }
      expect(f.c.mode[0]).toBe(GuestMode.Riding); expect(f.c.seatBlend[0]).toBe(1);
      const pelvis = rotate(f.seat.rot, [0, h * GUEST_SEAT_Y, 0]);
      for (let k = 0; k < 3; k++) expect(f.c.pos[k] + pelvis[k], family).toBeCloseTo(f.seat.pos[k], 7);
      const endpoint = f.runtime.guestTransferPose(0, 1 - 1e-7, pose());
      expect(Math.hypot(...endpoint.pos.map((v, k) => v - f.c.pos[k])), family).toBeLessThan(1e-6);
    }
  });

  it('keeps the wheel interlocked through standing up and until the fixed landing is reached', () => {
    const f = fixture('wheel'); for (let tick = 0; tick < 340; tick++) f.step(1 / 250);
    const train = f.state.trains[0], mass = train.passengerMass, seated = [...f.c.pos];
    train.phaseTime = 1; expect(f.runtime['unload'](f.ride, train, 0)).toBe(false);
    expect(f.c.mode[0]).toBe(GuestMode.Exit); expect(f.c.seatBlend[0]).toBe(1); expect([...f.c.pos]).toEqual(seated);
    for (let tick = 0; tick < 340; tick++) { f.step(1 / 250); expect(train.seatIds[0]).toBe(0); expect(train.passengerMass).toBe(mass); }
    expect(f.c.seatBlend[0]).toBe(0); expect(train.passengers).toBe(1);
    for (let tick = 0; tick < 2000 && train.passengers; tick++) f.step(1 / 250);
    expect(train.seatIds[0]).toBe(-1); expect(train.passengers).toBe(0); expect(train.passengerMass).toBe(0);
    expect(f.runtime['transitionStage'][0]).toBeGreaterThan(0);
  });

  it('attaches a partial transfer to the actual moving seat and retains its local coordinates', () => {
    const f = fixture('wheel'); f.step(0.5); const a = f.runtime.guestTransferPose(0, f.c.seatBlend[0], pose());
    const original = inverseRotate(f.seat.rot, a.pos.map((v, k) => v - f.seat.pos[k]) as Vec3);
    f.state.theta += 0.2; f.runtime['updateBodies'](); const seat = f.runtime.guestSeat(0, pose()), b = f.runtime.guestTransferPose(0, f.c.seatBlend[0], pose());
    const moved = inverseRotate(seat.rot, b.pos.map((v, k) => v - seat.pos[k]) as Vec3);
    for (let k = 0; k < 3; k++) expect(moved[k]).toBeCloseTo(original[k], 8);
  });

  it('retains an upright train occupant across the car doorway until both entry waypoints are cleared', () => {
    const f = fixture('steel'); for (let tick = 0; tick < 340; tick++) f.step(1 / 250);
    const train = f.state.trains[0]; train.phaseTime = 1; f.runtime['unload'](f.ride, train, 0);
    for (let tick = 0; tick < 2000 && f.runtime['transitionStage'][0] < 1; tick++) f.step(1 / 250);
    expect(f.runtime['transitionStage'][0]).toBe(1); expect(train.seatIds[0]).toBe(0);
    for (let tick = 0; tick < 1000 && train.passengers; tick++) f.step(1 / 250);
    expect(f.runtime['transitionStage'][0]).toBe(2); expect(train.seatIds[0]).toBe(-1);
    expect(f.c.pos[1]).toBeCloseTo(f.ride.boarding.at(-1)![1], 8);
  });

  it('uses the actual moving cabin floor for Enterprise and Top Spin shoe clearance', () => {
    for (const family of ['enterprise', 'topspin'] as const) for (const height of [1.05, 1.95]) {
      const f = fixture(family, height), id = f.runtime['seatBodies'][0][0], body = f.runtime.bodies[id];
      const floor = generated.parts.find(p => p.body === f.source.bodies[id] && p.shape === 'box' && Math.abs(p.half[0] - (family === 'enterprise' ? 0.515 : 6.1)) < 1e-9 && p.half[1] === (family === 'enterprise' ? 0.06 : 0.1))!;
      const local = inverseRotate(body.rot, f.seat.pos.map((v, k) => v - body.pos[k]) as Vec3), h = f.c.height[0];
      const soleY = local[1] - h * GUEST_SEAT_Y + h * guestSoleLift(1, f.c.seatAngle[0]);
      expect(soleY, `${family}, height ${height}`).toBeGreaterThanOrEqual(floor.pos[1] + floor.half[1] - 1e-8);
      if (height > 1.9) expect(soleY).toBeCloseTo(floor.pos[1] + floor.half[1], 8);
    }
  });
});
