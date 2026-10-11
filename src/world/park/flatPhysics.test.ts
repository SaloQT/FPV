import { describe, expect, it } from 'vitest';
import { G0 } from '../../sim/math3d';
import { ENTERPRISE_HINGE, ENTERPRISE_RADIUS, enterpriseCabinOverSlot, pivotPendulumAcceleration, rotaryAcceleration, stepEnterpriseHinges, TOPSPIN_ARM, TOPSPIN_PIVOT, TOPSPIN_PLATFORM_DROP } from './flatPhysics';
import { solidBounds, solidOf, support } from './interference';
import { generatePark, gradeParkTerrain } from './generator';
import { testTerrainData } from '../track/testTerrain';
import { createTerrainSampler } from '../terrain/sampler';
import { defaultParkRecipe } from './recipe';
import { ParkRuntime } from './runtime';
import { CAROUSEL_BOBS, CAROUSEL_STROKE } from './rideDimensions';
import { GuestMode } from './crowd';
import { add, axisAngle, inverseRotate, pose, rotate, TAU } from './math';
import { partDistance } from './collision';
import type { Vec3 } from '../../contracts';
import type { ParkData } from './types';

let generated: ParkData | undefined;
function attraction(family: 'enterprise' | 'topspin' | 'carousel', guests = 0): ParkData {
  if (!generated) {
    const recipe = { ...defaultParkRecipe(1337), guests: 0 }, terrain = gradeParkTerrain(testTerrainData({ resolution: 64, cellSize: 32 }), recipe);
    generated = generatePark(recipe, createTerrainSampler(terrain));
  }
  const source = generated.rides.find(r => r.family === family)!, ids = new Map(source.bodies.map((id, i) => [id, i]));
  const ride = { ...source, id: 0, station: 1, bodies: source.bodies.map((_, i) => i) };
  return { ...generated, recipe: { ...generated.recipe, guests }, rides: [ride], parts: [], rooms: [], lights: [], routes: [], entrance: 0,
    bodies: source.bodies.map(id => ({ ...generated!.bodies[id], ride: 0, parent: generated!.bodies[id].parent === undefined ? undefined : ids.get(generated!.bodies[id].parent!) })),
    nodes: [{ pos: [0, 12, 0], kind: 'entrance', links: [1] }, { pos: [0, 12, 20], kind: 'station', links: [0] }], paths: [{ a: 0, b: 1, width: 6 }] };
}

describe('physical flat ride mechanisms', () => {
  it('limits motor torque and mechanical power independently of passenger inertia', () => {
    const inertia = 90000, speed = 4, power = 90000, torque = 40000;
    const a = rotaryAcceleration(speed, 10, inertia, torque, power);
    const loaded = rotaryAcceleration(speed, 10, inertia * 2, torque, power);
    expect((a + speed * 0.018) * inertia * speed).toBeCloseTo(power, 8);
    expect((loaded + speed * 0.018) * inertia * 2).toBeCloseTo(power / speed, 8);
    expect(loaded).toBeLessThan(a);
    expect(rotaryAcceleration(0, 10, inertia, torque, power) * inertia).toBeCloseTo(torque, 8);
  });

  it('conserves free gondola pendulum energy and converges when the step is halved', () => {
    const length = 1.15, radius = 0.55, angle = 1.1;
    const simulate = (dt: number): [number, number, number] => {
      let a = angle, v = 0, worst = 0;
      const energy = G0 * length * (1 - Math.cos(angle));
      for (let i = 0; i < Math.round(12 / dt); i++) {
        v += pivotPendulumAcceleration(a, v, 0, 0, length, radius, 0) * dt; a += v * dt;
        const e = 0.5 * (length ** 2 + radius ** 2) * v * v + G0 * length * (1 - Math.cos(a));
        worst = Math.max(worst, Math.abs(e - energy) / energy);
      }
      return [a, v, worst];
    };
    const coarse = simulate(1 / 250), fine = simulate(1 / 500);
    expect(coarse[2]).toBeLessThan(0.006); expect(fine[2]).toBeLessThan(coarse[2]);
    expect(Math.abs(coarse[0] - fine[0])).toBeLessThan(0.004);
    expect(Math.abs(coarse[1] - fine[1])).toBeLessThan(0.004);
  });

  it('settles Enterprise cabins at the centrifugal and gravitational equilibrium', () => {
    const s = { theta: 0, omega: 1.35, angularA: 0, phi: 0, phiV: 0, tiltA: 0, hinges: new Float64Array(20), hingeV: new Float64Array(20) };
    for (let i = 0; i < 15000; i++) { s.theta += s.omega / 250; stepEnterpriseHinges(s, 1 / 250); }
    for (const beta of s.hinges) {
      const inward = G0 * Math.sin(beta), outward = s.omega ** 2 * (ENTERPRISE_RADIUS + ENTERPRISE_HINGE * Math.sin(beta)) * Math.cos(beta);
      expect(inward).toBeCloseTo(outward, 4);
      expect(beta).toBeGreaterThan(0.9); expect(beta).toBeLessThan(1.1);
    }
    expect(Math.max(...s.hingeV.map(Math.abs))).toBeLessThan(0.001);
  });

  it('simulates each cabin independently when the wheel tilts into gravity', () => {
    const s = { theta: 0, omega: 1.35, angularA: 0, phi: 1.48, phiV: 0, tiltA: 0, hinges: new Float64Array(20).fill(1.1), hingeV: new Float64Array(20) };
    for (let i = 0; i < 6000; i++) { s.theta += s.omega / 250; stepEnterpriseHinges(s, 1 / 250); }
    expect([...s.hinges, ...s.hingeV].every(Number.isFinite)).toBe(true);
    expect(Math.max(...s.hinges) - Math.min(...s.hinges)).toBeGreaterThan(0.1);
    expect(Math.max(...s.hingeV.map(Math.abs))).toBeLessThan(2);
  });

  it('runs both new rides through loaded operation, braking and a level boarding dock', () => {
    for (const family of ['enterprise', 'topspin'] as const) for (const passengerMass of [0, 40 * 103]) {
      const park = attraction(family), ride = park.rides[0];
      const runtime = new ParkRuntime(park), state = runtime.rides[0], cabins = park.bodies.flatMap((body, id) => body.role === 'gondola' ? [id] : []);
      state.phase = 'running'; state.phaseTime = 0; state.trains[0].restraint = 1; state.trains[0].passengerMass = passengerMass;
      const previous = cabins.map(id => [...runtime.bodies[id].pos]), velocity = cabins.map(() => [0, 0, 0]);
      let maxG = 0, maxTilt = 0, maxOmega = 0, peak = '', previousTick = 0, irregularTick = false;
      for (let step = 0; step < 60000 && state.completed === 0; step++) {
        runtime.advance(1 / 250); maxTilt = Math.max(maxTilt, state.phi); maxOmega = Math.max(maxOmega, Math.abs(state.omega));
        irregularTick ||= runtime.tick !== previousTick + 1; previousTick = runtime.tick;
        for (let cabin = 0; cabin < cabins.length; cabin++) {
          const body = runtime.bodies[cabins[cabin]], position = family === 'topspin' ? add(body.pos, rotate(body.rot, [0, -0.67, -0.6])) : body.pos;
          const v = position.map((x, k) => (x - previous[cabin][k]) * 250), acceleration = v.map((x, k) => (x - velocity[cabin][k]) * 250 + (k === 1 ? G0 : 0));
          if (step > 5 && Math.hypot(...acceleration) / G0 > maxG) { maxG = Math.hypot(...acceleration) / G0; peak = `at ${step / 250}s omega=${state.omega}, phi=${state.phi}, phiV=${state.phiV}, beta=${state.hinges[cabin]}, betaV=${state.hingeV[cabin]}`; }
          previous[cabin] = [...position]; velocity[cabin] = v;
        }
      }
      const label = `${family}, payload ${passengerMass} kg, peak ${maxG.toFixed(3)} g ${peak}, phase ${state.phase}, final=${state.theta},${state.omega},${state.phi},${state.phiV}`;
      expect(state.completed, label).toBe(1);
      expect(irregularTick, 'Every exact fixed interval must advance exactly one ride tick').toBe(false);
      expect(maxG, label).toBeLessThan(ride.maxG);
      expect(Math.abs(state.omega), label).toBeLessThan(0.015);
      expect(maxOmega, label).toBeGreaterThan(ride.targetOmega * 0.8);
      if (family === 'enterprise') expect(maxTilt, label).toBeGreaterThan(1.3);
      else {
        const platform = park.bodies.findIndex(body => body.role === 'platform'), pos = runtime.bodies[platform].pos;
        expect(Math.hypot(pos[0] - ride.pos[0], pos[1] - ride.pos[1], pos[2] - ride.pos[2]), 'The loading floor stays lowered until the unloading interlock opens').toBeCloseTo(TOPSPIN_PLATFORM_DROP, 8);
      }
    }
  }, 120000);

  it('seats Enterprise riders only in cabins they can walk to', () => {
    // Opening snapshot: the park seats its first riders directly in every operating ride.
    const recipe = { ...defaultParkRecipe(1337), guests: 400 };
    const full = generatePark(recipe, createTerrainSampler(gradeParkTerrain(testTerrainData({ resolution: 64, cellSize: 32 }), recipe))), opening = new ParkRuntime(full);
    const enterprises = full.rides.filter(r => r.family === 'enterprise');
    expect(enterprises.some(r => opening.rides[r.id].trains[0].passengers > 0), 'an Enterprise is seeded with riders').toBe(true);
    for (const r of enterprises) opening.rides[r.id].trains[0].seatIds.forEach((id, seat) => expect(id >= 0 && enterpriseCabinOverSlot(Math.floor(seat / 2)), `seat ${seat}`).toBe(false));
  }, 300000);

  it('keeps the Top Spin loading floor up for walking guests and lowers it smoothly before dispatch', () => {
    const park = attraction('topspin', 1), runtime = new ParkRuntime(park), state = runtime.rides[0], ride = park.rides[0], c = runtime.crowd;
    const platform = park.bodies.findIndex(body => body.role === 'platform');
    c.mode[0] = GuestMode.Queue; c.ride[0] = 0; c.node[0] = c.target[0] = c.goal[0] = 1;
    c.pos.set(ride.queue[0]); c.previous.set(c.pos); c.queueProgress[0] = 0; c.queue[0].push(0);
    const initial = [...runtime.bodies[platform].pos], previous = [...initial];
    let crossed = false, lowered = false, maxVelocity = 0, waitingDeckMotion = 0;
    for (let i = 0; i < 30000 && state.phase !== 'running'; i++) {
      runtime.advance(1 / 250);
      const pos = runtime.bodies[platform].pos, offset = Math.hypot(...pos.map((x, k) => x - initial[k]));
      maxVelocity = Math.max(maxVelocity, Math.hypot(...pos.map((x, k) => (x - previous[k]) * 250)));
      for (let k = 0; k < 3; k++) previous[k] = pos[k];
      if (c.mode[0] === GuestMode.Boarding) { crossed = true; waitingDeckMotion = Math.max(waitingDeckMotion, offset); }
      if (offset > 0.001) expect(c.mode[0]).toBe(GuestMode.Riding);
      if (Math.abs(state.theta) > 1e-8) expect(offset).toBeCloseTo(TOPSPIN_PLATFORM_DROP, 6);
      if (offset > TOPSPIN_PLATFORM_DROP - 0.001) lowered = true;
    }
    expect(crossed).toBe(true); expect(waitingDeckMotion).toBe(0);
    expect(lowered).toBe(true); expect(state.phase).toBe('running');
    // The floor follows a smootherstep over the 4 s restraint phase, whose steepest slope is 15/8 per unit time.
    const peak = TOPSPIN_PLATFORM_DROP * 15 / 8 / 4;
    expect(maxVelocity).toBeLessThan(peak * 1.0001); expect(maxVelocity).toBeGreaterThan(peak * 0.99);
  }, 30000);

  it('keeps the lowered Top Spin loading floor clear of the freely pitching gondola', () => {
    attraction('topspin');
    const ride = generated!.rides.find(r => r.family === 'topspin')!;
    const cabin = ride.bodies.find(id => generated!.bodies[id].role === 'gondola')!, platform = ride.bodies.find(id => generated!.bodies[id].role === 'platform')!;
    // Gondola solids in its own frame (origin on the gondola shaft axis); the floor in the ride frame, lowered.
    const gondola = generated!.parts.map((p, i) => [p, i] as const).filter(([p]) => p.body === cabin && p.solid).map(([p, i]) => solidOf(p, i));
    const floor = generated!.parts.map((p, i) => [p, i] as const).filter(([p]) => p.body === platform && p.solid).map(([p, i]) => solidOf(p, i, { ...pose(), pos: [0, -TOPSPIN_PLATFORM_DROP, 0] }));
    expect(gondola.length).toBeGreaterThan(10); expect(floor.length).toBeGreaterThan(0);
    const floorTop = Math.max(...floor.map(s => support(s, [0, 1, 0])[1]));
    // Every floor part lies below its top face, and the gondola axis is lowest with the arms hanging straight
    // down (theta = 0), so the clearance at theta = 0 over every pitch bounds every arm angle.
    const axisY = TOPSPIN_PIVOT - TOPSPIN_ARM, steps = 3600, reach = Math.max(...gondola.map(s => { const b = solidBounds(s); return Math.hypot(Math.max(-b[1], b[4]), Math.max(-b[2], b[5])); }));
    let lowest = Infinity;
    for (let k = 0; k < steps; k++) {
      const phi = k * TAU / steps, down = inverseRotate(axisAngle([1, 0, 0], phi), [0, -1, 0]);
      for (const s of gondola) lowest = Math.min(lowest, axisY + rotate(axisAngle([1, 0, 0], phi), support(s, down))[1]);
    }
    // Between samples a point at `reach` from the axis moves at most reach * (pi / steps) vertically.
    const between = reach * Math.PI / steps;
    expect(lowest - floorTop - between, `clearance ${(lowest - floorTop).toFixed(4)} m, sampling bound ${between.toFixed(4)} m`).toBeGreaterThan(0.1);
  });
});

describe('carousel horses', () => {
  /** The Tilden Park carousel manual: 5 in crank throws raise the figures 10 in, the crank turning 4 1/3 times per platform turn. */
  it('ride up and down 10 in, 4 1/3 times per platform turn, in the running ride', () => {
    const park = attraction('carousel'), runtime = new ParkRuntime(park), state = runtime.rides[0];
    const horses = park.bodies.flatMap((body, id) => body.role === 'seat' ? [id] : []);
    expect(horses.length).toBe(16);
    state.phase = 'running'; state.phaseTime = 0; state.trains[0].restraint = 1;
    const low = horses.map(() => Infinity), high = horses.map(() => -Infinity), start = state.theta;
    let peaks = 0, previous = runtime.bodies[horses[0]].pos[1], rising = false;
    for (let step = 0; step < 60000 && state.completed === 0; step++) {
      runtime.advance(1 / 250);
      horses.forEach((id, k) => { const y = runtime.bodies[id].pos[1]; low[k] = Math.min(low[k], y); high[k] = Math.max(high[k], y); });
      const y = runtime.bodies[horses[0]].pos[1]; if (rising && y < previous) peaks++; rising = y > previous; previous = y;
    }
    const turns = Math.abs(state.theta - start) / TAU;
    expect(turns).toBeGreaterThan(3);
    for (let k = 0; k < horses.length; k++) expect(high[k] - low[k], `horse ${k}`).toBeCloseTo(CAROUSEL_STROKE, 3);
    // A whole number of peaks is counted, so the measured rate is within one peak of the gearing over the run.
    expect(Math.abs(peaks - CAROUSEL_BOBS * turns)).toBeLessThanOrEqual(1);
  }, 120000);
});
