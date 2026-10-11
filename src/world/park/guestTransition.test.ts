import { beforeAll, describe, expect, it } from 'vitest';
import type { Vec3 } from '../../contracts';
import renderSource from '../../render/park/index.ts?raw';
import { createTerrainSampler } from '../terrain/sampler';
import { testTerrainData } from '../track/testTerrain';
import { GuestMode } from './crowd';
import { generatePark, gradeParkTerrain } from './generator';
import { GUEST_WALK_ACCEL, guestLegPose, guestRenderSpeed } from './guestPose';
import { pose, rotate } from './math';
import { defaultParkRecipe } from './recipe';
import { PARK_DT } from './ridePhysics';
import { ParkRuntime } from './runtime';
import type { ParkData, RideFamily } from './types';

let generated: ParkData;
beforeAll(() => {
  const recipe = { ...defaultParkRecipe(1337), guests: 0 };
  generated = generatePark(recipe, createTerrainSampler(gradeParkTerrain(testTerrainData({ resolution: 64, cellSize: 32 }), recipe)));
}, 240000);

/** One ride with one guest assigned to seat 0, standing at the start of the boarding path facing along it. */
function fixture(family: RideFamily, height: number) {
  const source = generated.rides.find(r => r.family === family)!, ids = new Map(source.bodies.map((id, i) => [id, i]));
  const ride = { ...source, id: 0, station: 1, bodies: source.bodies.map((_, i) => i) };
  const park: ParkData = { ...generated, recipe: { ...generated.recipe, guests: 1 }, rides: [ride], parts: [], rooms: [], lights: [], routes: [], entrance: 0,
    bodies: source.bodies.map(id => ({ ...generated.bodies[id], ride: 0, parent: generated.bodies[id].parent === undefined ? undefined : ids.get(generated.bodies[id].parent!) })),
    nodes: [{ pos: ride.exit[0], kind: 'entrance', links: [1] }, { pos: ride.boarding[0], kind: 'station', links: [0] }], paths: [{ a: 0, b: 1, width: 6 }] };
  const runtime = new ParkRuntime(park), c = runtime.crowd, state = runtime.rides[0];
  state.phase = 'boarding'; state.theta = family === 'wheel' ? -Math.PI / 2 : 0; state.phi = state.omega = state.phiV = 0; state.y = 2; state.hinges.fill(0);
  for (const train of state.trains) { train.seatIds.fill(-1); train.passengers = 0; train.passengerMass = 0; train.restraint = 0; if (ride.curve) train.s = ride.curve.stationEnd - 6; }
  runtime['updateBodies'](); c.height[0] = height; runtime['assign'](0, 0, 0, 0); state.trains[0].passengers = 1;
  const path = runtime['boardingPaths'][0] as Vec3[];
  c.pos.set(path[0]); c.previous.set(path[0]); c.yaw[0] = Math.atan2(-(path[1][0] - path[0][0]), -(path[1][2] - path[0][2]));
  runtime['updateRiders'](0);
  return { runtime, c, state, ride };
}

/** Where the two soles touch the ground in the horizontal plane, as the pose shader would place them. */
function soles(runtime: ParkRuntime, tick: number): { feet: [number, number][]; speed: number; seated: boolean } {
  const c = runtime.crowd, h = c.height[0], blend = c.seatBlend[0], seated = c.mode[0] === GuestMode.Riding && blend === 1;
  const position: Vec3 = [c.pos[0], c.pos[1], c.pos[2]], rot: [number, number, number, number] = [0, Math.sin(c.yaw[0] / 2), 0, Math.cos(c.yaw[0] / 2)];
  if (blend > 0) { const transfer = runtime.guestTransferPose(0, blend, pose()); for (let k = 0; k < 3; k++) position[k] = transfer.pos[k]; for (let k = 0; k < 4; k++) rot[k] = transfer.rot[k]; }
  const speed = guestRenderSpeed(c.vel[0], c.vel[2], seated), time = tick * PARK_DT, feet: [number, number][] = [];
  for (const right of [false, true]) {
    const leg = guestLegPose(time, speed, h, right), at = rotate(rot, [(right ? 0.057 : -0.057) * h, 0, leg.ankle[1] * h]);
    feet.push([position[0] + at[0], position[2] + at[2]]);
  }
  return { feet, speed, seated };
}

/** Boards a guest, seats them, then lets them out again, and returns the most any sole moved between two consecutive ticks while not seated. */
function worstSoleStep(family: RideFamily, height: number): { board: number; exit: number; ticks: number; seatedSeen: boolean } {
  const { runtime, c, ride, state } = fixture(family, height);
  let tick = 0, last = soles(runtime, tick), board = 0, exit = 0, seatedSeen = false, phase: 'board' | 'ride' | 'exit' = 'board', rideTicks = 0;
  const step = () => {
    c.previous.set(c.pos); c.previousSeatBlend.set(c.seatBlend); runtime['updateRiders'](PARK_DT); tick++;
    const now = soles(runtime, tick);
    if (!now.seated && !last.seated) {
      const moved = Math.max(...now.feet.map((f, k) => Math.hypot(f[0] - last.feet[k][0], f[1] - last.feet[k][1])));
      if (phase === 'exit') exit = Math.max(exit, moved); else board = Math.max(board, moved);
    }
    last = now;
  };
  for (let n = 0; n < 60000; n++) {
    if (phase === 'board') { step(); if (c.mode[0] === GuestMode.Riding) { phase = 'ride'; seatedSeen = true; } }
    else if (phase === 'ride') { step(); if (++rideTicks > 50) { state.trains[0].restraint = 0; runtime['unload'](ride, state.trains[0], 0.4); phase = 'exit'; } }
    else step();
    if (phase === 'exit' && c.mode[0] === GuestMode.Walk) break;
  }
  expect(c.mode[0], `${family} ${height}: guest finished the exit`).toBe(GuestMode.Walk);
  return { board, exit, ticks: tick, seatedSeen };
}

describe('guest walking onto and off a ride seat', () => {
  // A normal swing foot moves a few centimetres per tick; a foot that jumps to a new stride position covers up to half a metre in one.
  const STEP_LIMIT = 0.1;
  for (const family of ['teacups', 'carousel', 'steel'] as RideFamily[]) {
    it(`never moves a sole more than ${STEP_LIMIT * 100} cm in a tick between the walk and the seat, ${family}, for guests 1.05 to 1.95 m tall`, () => {
      if (!generated.rides.some(r => r.family === family)) return;
      const bad: string[] = [];
      for (const height of [1.05, 1.5, 1.95]) {
        const w = worstSoleStep(family, height);
        expect(w.seatedSeen, `${family} ${height}: reached the seat`).toBe(true);
        if (w.board > STEP_LIMIT) bad.push(`${family} ${height} m boarding: a sole moved ${(w.board * 100).toFixed(1)} cm in one tick`);
        if (w.exit > STEP_LIMIT) bad.push(`${family} ${height} m leaving: a sole moved ${(w.exit * 100).toFixed(1)} cm in one tick`);
      }
      expect(bad, bad.join('\n')).toEqual([]);
    });
  }

  it('starts from standing and stops at the seat without the walking pace changing faster than the set acceleration', () => {
    const { runtime, c } = fixture('teacups', 1.75);
    let worst = 0, previous = 0, top = 0;
    for (let n = 0; n < 20000 && c.mode[0] === GuestMode.Boarding && c.seatBlend[0] === 0; n++) {
      c.previous.set(c.pos); runtime['updateRiders'](PARK_DT);
      // The pace the walk is aiming for; the measured velocity also carries a one-tick spike each time the guest snaps onto a waypoint.
      const speed = Math.max(0, runtime['walkSpeed'][0]);
      worst = Math.max(worst, Math.abs(speed - previous) / PARK_DT); previous = speed; top = Math.max(top, speed);
    }
    expect(top, 'reached the boarding pace').toBeGreaterThan(1);
    expect(worst).toBeLessThan(GUEST_WALK_ACCEL * 1.5);
    expect(previous, 'pace when the walk ends').toBeLessThan(0.2);
    expect(Math.hypot(c.vel[0], c.vel[2]), 'velocity handed to the seat transfer').toBeLessThan(0.2);
  });

  it('marks riders on carousel horses as straddling, and riders on every other ride as not', () => {
    for (const family of ['carousel', 'steel', 'teacups'] as RideFamily[]) {
      if (!generated.rides.some(r => r.family === family)) continue;
      expect(fixture(family, 1.5).c.straddle[0], family).toBe(family === 'carousel' ? 1 : 0);
    }
    expect(renderSource, 'the straddle flag reaches the shader in the instance colour alpha').toContain('c.straddle[i]');
  });

  it('is fed to the pose shader from the guest\'s real motion during seat transfers, not forced to a standstill', () => {
    expect(guestRenderSpeed(0.5, 0, false)).toBeCloseTo(0.5, 6);
    expect(guestRenderSpeed(0.5, 0, true)).toBe(0);
    expect(renderSource).toContain('guestRenderSpeed(');
  });
});
