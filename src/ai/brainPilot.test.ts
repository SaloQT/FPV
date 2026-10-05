import { describe, expect, it } from 'vitest';
import type { StickInput } from '../contracts';
import { makeQuadState, makeStick, makeTrack } from '../game/testKit';
import { randomBrain } from './testBrains';
import { BrainPilot } from './brainPilot';
import { OBS, PHYSICS_PER_ACTION } from './spec';

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
});
