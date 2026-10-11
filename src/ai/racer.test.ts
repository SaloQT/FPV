import { describe, expect, it } from 'vitest';
import type { StickInput } from '../contracts';
import { BRAIN_COOLDOWN_S, RESPAWN_OFFER_S } from '../game/sessionTypes';
import { makeTrack } from '../game/testKit';
import { flatTerrain } from '../sim/testkit';
import type { Brain } from './brain';
import { randomBrain } from './testBrains';
import { BrainRacer, outsideWorld, pastTraining } from './racer';
import { DEFAULT_EPISODE_LIMITS, FLOOR_MARGIN_M } from './spec';

const DT = 1 / 4000;

function racer(brain: Brain = randomBrain([8], 9, 0.5)): BrainRacer {
  const ground = flatTerrain(0);
  return new BrainRacer(brain, { ground, groundHeightAt: (x, z) => ground.heightAt(x, z), track: makeTrack(3), colliders: [] });
}

/** Swaps the brain for scripted sticks (change `sticks` to move them), counting its calls, and records the sticks the quad gets. */
function script(r: BrainRacer, sticks: Partial<StickInput>): { calls: number; sent: StickInput[]; sticks: Partial<StickInput> } {
  const log = { calls: 0, sent: [] as StickInput[], sticks };
  r.pilot.control = (_s, cmd) => {
    log.calls++;
    Object.assign(cmd, { roll: 0, pitch: 0, yaw: 0, throttle: 0, mode: 'acro' }, log.sticks);
  };
  const step = r.physics.step.bind(r.physics);
  r.physics.step = (dt, cmd) => {
    log.sent.push({ ...cmd });
    step(dt, cmd);
  };
  return log;
}

const run = (r: BrainRacer, seconds: number): void => {
  for (let i = 0; i < Math.round(seconds * 4000); i++) r.step(DT);
};

describe('BrainRacer', () => {
  it('sits disarmed on the pad until GO', () => {
    const r = racer();
    const start = [...r.physics.state.pos];
    for (let i = 0; i < 2000; i++) r.step(DT);
    expect(r.physics.state.armed).toBe(false);
    expect(r.time).toBe(0);
    expect(r.physics.state.pos[0]).toBeCloseTo(start[0], 6);
    expect(r.physics.state.pos[2]).toBeCloseTo(start[2], 6);
  });

  it('arms at GO, flies the real physics with finite state, and restarts cleanly', () => {
    const r = racer();
    r.go = true;
    for (let i = 0; i < 4000 * 3; i++) r.step(DT);
    const s = r.physics.state;
    expect(r.time).toBeCloseTo(3, 6);
    for (const v of [...s.pos, ...s.vel, ...s.quat]) expect(Number.isFinite(v)).toBe(true);
    expect(s.armed || s.crashed || r.crashes > 0).toBe(true);
    r.restart();
    expect(r.go).toBe(false);
    expect(r.time).toBe(0);
    expect(r.crashes).toBe(0);
    expect(r.timer.nextGate).toBe(0);
  });

  it('flies on for its cool-down after the finish, then waits on its pad, disarmed', () => {
    const r = racer();
    const pad = [...r.physics.state.pos];
    r.go = true;
    for (let i = 0; i < 4000; i++) r.step(DT);
    Object.defineProperty(r.timer, 'isFinished', { get: () => true });
    r.finishedAt = r.time;
    for (let i = 0; i < 4000 * (BRAIN_COOLDOWN_S - 0.5); i++) r.step(DT);
    expect(r.parked).toBe(false);
    for (let i = 0; i < 4000; i++) r.step(DT);
    expect(r.parked).toBe(true);
    expect(r.physics.state.armed).toBe(false);
    expect(r.physics.state.pos[0]).toBeCloseTo(pad[0], 3);
    expect(r.physics.state.pos[2]).toBeCloseTo(pad[2], 3);
    r.restart();
    expect(r.parked).toBe(false);
  });

  it('lets go of a crashed quad and puts it back at its last gate once the crash has played out', () => {
    const r = racer();
    const pad = r.physics.state.pos.slice();
    // Throttle down to arm, as a brain starts, then up
    const log = script(r, { throttle: 0 });
    r.go = true;
    run(r, 0.05);
    log.sticks.throttle = 0.5;
    run(r, 0.6);
    expect(r.physics.state.pos[1]).toBeGreaterThan(pad[1] + 0.5);
    const step = r.physics.step;
    let crashNow = true;
    r.physics.step = (dt, cmd) => {
      step(dt, cmd);
      if (crashNow) r.physics.state.crashed = true;
      crashNow = false;
    };
    r.step(DT);
    expect(r.crashes).toBe(1);
    const calls = log.calls;
    run(r, RESPAWN_OFFER_S - 0.05);
    // Its training ended the episode at the crash: the brain does not fly on from one
    expect(log.calls).toBe(calls);
    expect(log.sent.at(-1)).toMatchObject({ roll: 0, pitch: 0, yaw: 0, throttle: 0 });
    run(r, 0.1);
    // No gate cleared yet: back on the pad, and the brain has the sticks again
    expect(r.physics.state.pos[1]).toBeLessThan(pad[1] + 0.2);
    expect(r.physics.state.pos[0]).toBeCloseTo(pad[0], 1);
    expect(r.physics.state.pos[2]).toBeCloseTo(pad[2], 1);
    expect(log.calls).toBeGreaterThan(calls);
  });

  it('puts a brain back at the stall time its training used, from its brain file, and restarts the clock there', () => {
    const brain = randomBrain([8], 9, 0.5);
    brain.episode = { stallSeconds: 2, ceiling: 120, respawn: 'last-gate' };
    const r = racer(brain);
    // Armed on the pad at zero throttle: no gate, and still for less than the stuck watch takes
    script(r, { throttle: 0 });
    r.go = true;
    run(r, 1.9);
    expect(r.stalls).toBe(0);
    run(r, 0.2);
    expect(r.stalls).toBe(1);
    run(r, 1.8);
    expect(r.stalls).toBe(1);
    run(r, 0.3);
    expect(r.stalls).toBe(2);
  });

  it('puts a brain back where its training started episodes: the checkpoint, or before the gate due next for older brains', () => {
    const at = (brain: Brain): number[] => {
      const r = racer(brain);
      script(r, { throttle: 0 });
      r.go = true;
      run(r, 0.1);
      // As if gate 1 was cleared: gate 2 is due next
      r.timer.lastGate = 1;
      Object.defineProperty(r.timer, 'nextGate', { get: () => 2 });
      r.physics.state.pos[1] = DEFAULT_EPISODE_LIMITS.ceiling + 5;
      r.step(DT);
      return r.physics.state.pos.slice();
    };
    const recorded = randomBrain([8], 9, 0.5);
    recorded.episode = { ...DEFAULT_EPISODE_LIMITS };
    const gates = makeTrack(3).gates;
    expect(at(recorded)[2]).toBeCloseTo(gates[1].pos[2] + 1.5, 1);
    expect(at(randomBrain([8], 9, 0.5))[2]).toBeCloseTo(gates[2].pos[2] + 1.5, 1);
  });

  it('puts a brain back the moment it leaves the world training flew in', () => {
    const r = racer();
    script(r, { throttle: 0.3 });
    r.go = true;
    run(r, 0.2);
    r.physics.state.pos[1] = DEFAULT_EPISODE_LIMITS.ceiling + 5;
    r.step(DT);
    expect(r.stalls).toBe(1);
    expect(r.physics.state.pos[1]).toBeLessThan(5);
  });
});

describe('where training ended episodes', () => {
  const t = flatTerrain(10).data;

  it('counts off the terrain grid, over its highest point by the ceiling or under its lowest by the margin as out', () => {
    expect(outsideWorld(t, [0, 50, 0], 120)).toBe(false);
    expect(outsideWorld(t, [0, 10 + 121, 0], 120)).toBe(true);
    expect(outsideWorld(t, [0, 10 - FLOOR_MARGIN_M - 1, 0], 120)).toBe(true);
    expect(outsideWorld(t, [1e6 + 1, 50, 0], 120)).toBe(true);
    expect(outsideWorld(t, [0, 50, -1e6 - 1], 120)).toBe(true);
  });

  it('is past training at the stall time or outside the world', () => {
    const limits = { stallSeconds: 6, ceiling: 50, respawn: 'last-gate' as const };
    expect(pastTraining(limits, t, [0, 20, 0], 5.9)).toBe(false);
    expect(pastTraining(limits, t, [0, 20, 0], 6)).toBe(true);
    expect(pastTraining(limits, t, [0, 61, 0], 0)).toBe(true);
  });
});
