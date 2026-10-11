import { describe, expect, it } from 'vitest';
import type { ObstacleCollider, StickInput } from '../contracts';
import { makeQuadState, makeStick, makeTrack } from '../game/testKit';
import { Rng } from '../sim/math3d';
import { randomBrain } from './testBrains';
import { BrainPilot, SAMPLE_STD_MAX } from './brainPilot';
import { LEGACY_OBS_SIZE, NEAR_RANGE, OBS, OBS_SIZE, PHYSICS_PER_ACTION } from './spec';

const DT = 1 / 4000;

describe('BrainPilot', () => {
  it('decides once every PHYSICS_PER_ACTION physics steps and holds the sticks in between', () => {
    const pilot = new BrainPilot(randomBrain(), () => 0, 6);
    let calls = 0;
    const act = pilot.policy.act.bind(pilot.policy);
    pilot.policy.act = (o, out) => { calls++; return act(o, out); };
    const race = { track: makeTrack(3), nextGate: 0 };
    const s = makeQuadState({ armed: true, pos: [0, 2, 0] });
    const cmd: StickInput = makeStick();
    for (let i = 0; i < PHYSICS_PER_ACTION * 3; i++) pilot.control(s, cmd, race, DT);
    expect(calls).toBe(3);
    pilot.control(s, cmd, race, DT);
    expect(calls).toBe(4);
  });

  it('sends acro sticks in range and zero throttle until the flight controller has armed', () => {
    const pilot = new BrainPilot(randomBrain([8], 5, 2), () => 0, 6);
    const cmd = makeStick({ mode: 'angle' });
    const race = { track: makeTrack(3), nextGate: 0 };
    pilot.control(makeQuadState({ armed: false }), cmd, race, DT);
    expect(cmd.throttle).toBe(0);
    expect(cmd.mode).toBe('acro');
    for (const v of [cmd.roll, cmd.pitch, cmd.yaw]) expect(Math.abs(v)).toBeLessThanOrEqual(1);
    pilot.reset();
    pilot.control(makeQuadState({ armed: true }), cmd, race, DT);
    expect(cmd.throttle).toBeGreaterThanOrEqual(0);
    expect(cmd.throttle).toBeLessThanOrEqual(1);
    expect(cmd.throttle).toBe((pilot.lastAction[3] + 1) / 2);
  });

  it('starts every placement from the rest action', () => {
    const pilot = new BrainPilot(randomBrain(), () => 0, 6);
    const seen: number[][] = [];
    const act = pilot.policy.act.bind(pilot.policy);
    pilot.policy.act = (o, out) => { seen.push(Array.from(o).slice(OBS.prevAct, OBS.prevAct + 4)); return act(o, out); };
    const race = { track: makeTrack(3), nextGate: 0 };
    const s = makeQuadState({ armed: true });
    const cmd = makeStick();
    for (let i = 0; i <= PHYSICS_PER_ACTION; i++) pilot.control(s, cmd, race, DT);
    pilot.reset();
    pilot.control(s, cmd, race, DT);
    expect(seen[0]).toEqual([0, 0, 0, -1]);
    expect(seen[1]).not.toEqual([0, 0, 0, -1]);
    expect(seen[2]).toEqual([0, 0, 0, -1]);
  });

  it('samples from the brain action spread, capped, when given a random source, the same way for the same seed', () => {
    const brain = randomBrain();
    const race = { track: makeTrack(3), nextGate: 0 };
    const s = makeQuadState({ armed: true, pos: [0, 2, 0] });
    const first = (pilot: BrainPilot): number[] => {
      pilot.control(s, makeStick(), race, DT);
      return Array.from(pilot.lastAction);
    };
    const mean = first(new BrainPilot(brain, () => 0, 6));
    const a = first(new BrainPilot(brain, () => 0, 6, new Rng(7)));
    expect(first(new BrainPilot(brain, () => 0, 6, new Rng(7)))).toEqual(a);
    expect(first(new BrainPilot(brain, () => 0, 6, new Rng(8)))).not.toEqual(a);
    expect(a).not.toEqual(mean);
    // The test brain's own spread is exp(-1) = 0.37; the pilot draws with at most SAMPLE_STD_MAX before the squash.
    const raw = (x: number): number => Math.atanh(x);
    const spread = (seed: number): number => {
      const rng = new Rng(seed);
      let sq = 0;
      for (let k = 0; k < 400; k++) sq += (raw(first(new BrainPilot(brain, () => 0, 6, rng))[0]) - raw(mean[0])) ** 2;
      return Math.sqrt(sq / 400);
    };
    expect(spread(11)).toBeGreaterThan(SAMPLE_STD_MAX * 0.85);
    expect(spread(11)).toBeLessThan(SAMPLE_STD_MAX * 1.15);
  });

  it('shows a brain that senses obstacles the colliders it is given; a brain from before obstacle sensing flies as it did', () => {
    const race = { track: makeTrack(3), nextGate: 0 };
    const s = makeQuadState({ armed: true, pos: [0, 2, 0] });
    const wall: ObstacleCollider[] = [{ kind: 'box', center: [0, 2, -4], half: [5, 5, 0.5], yaw: 0 }];
    const seen = (pilot: BrainPilot, colliders: ObstacleCollider[]): number[] => {
      let obs: number[] = [];
      const act = pilot.policy.act.bind(pilot.policy);
      pilot.policy.act = (o, out) => { obs = Array.from(o); return act(o, out); };
      pilot.setColliders(colliders);
      pilot.control(s, makeStick(), race, DT);
      return obs;
    };
    const open = seen(new BrainPilot(randomBrain(), () => 0, 6), []);
    const walled = seen(new BrainPilot(randomBrain(), () => 0, 6), wall);
    expect(walled.slice(0, OBS.rays)).toEqual(open.slice(0, OBS.rays));
    expect(walled[OBS.near + 5 * 4 + 3]).toBeCloseTo(1 - 3.5 / NEAR_RANGE, 9);
    expect(open[OBS.near + 5 * 4 + 3]).toBe(0);
    // The ground shows in the rays without colliders too
    expect(Math.max(...open.slice(OBS.rays, OBS.near))).toBeGreaterThan(0);
    const old = randomBrain([8, 8], 3, 0.3, LEGACY_OBS_SIZE);
    expect(seen(new BrainPilot(old, () => 0, 6), wall).slice(OBS.rays)).toEqual(new Array(OBS_SIZE - OBS.rays).fill(0));
  });
});
