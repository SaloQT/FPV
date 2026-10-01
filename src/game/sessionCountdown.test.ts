import { describe, expect, it } from 'vitest';
import { COUNTDOWN_FROM, COUNTDOWN_GO_HOLD_S, COUNTDOWN_LEAD_S, COUNTDOWN_STEP_S } from './countdown';
import { createSessionSnapshot, HOVER_THROTTLE } from './sessionTypes';
import { makeSessionRig, makeTrack, type SessionRig } from './testKit';

const GO_AT = COUNTDOWN_LEAD_S + COUNTDOWN_FROM * COUNTDOWN_STEP_S;

function raceRig(raceStart = true): { rig: SessionRig; beeps: number[] } {
  const rig = makeSessionRig({ started: false });
  const beeps: number[] = [];
  rig.session.onCountdown = (n) => beeps.push(n);
  rig.session.setRaceStart(raceStart);
  rig.session.closeMenu();
  return { rig, beeps };
}

describe('race start countdown', () => {
  it('beeps 3, 2, 1, GO and refuses to arm until GO', () => {
    const { rig, beeps } = raceRig();
    const snap = createSessionSnapshot();
    rig.run(0.5);
    rig.input.actions.push('arm-toggle');
    rig.run(0.05);
    expect(rig.input.armed).toBe(false);
    expect(rig.session.snapshot(snap).message).toBe('WAIT FOR GO');
    expect(snap.countdown.locked).toBe(true);
    rig.run(GO_AT - 0.55 - 0.1);
    expect(beeps).toEqual([3, 2, 1]);
    rig.input.actions.push('arm-toggle');
    rig.run(0.05);
    expect(rig.input.armed).toBe(false);
    rig.run(0.2);
    expect(beeps).toEqual([3, 2, 1, 0]);
    expect(rig.session.snapshot(snap).countdown).toMatchObject({ active: true, locked: false, value: 0 });
    rig.input.actions.push('arm-toggle');
    rig.run(0.02);
    expect(rig.input.armed).toBe(true);
    rig.run(COUNTDOWN_GO_HOLD_S);
    expect(rig.session.snapshot(snap).countdown.active).toBe(false);
  });

  it('keeps the throttle at zero and the quad disarmed however the pilot pushes during the count', () => {
    const { rig } = raceRig();
    rig.input.armed = true;
    rig.input.stick.throttle = 0.9;
    rig.run(1.5);
    expect(rig.input.armed).toBe(false);
    expect(rig.physics.inputs.every((i) => i.throttle === 0 && !i.armed)).toBe(true);
    expect(rig.input.stick.throttle).toBe(0);
  });

  it('lets the pilot take off right after GO', () => {
    const { rig } = raceRig();
    rig.physics.onStep = (s): void => void (s.onGround = true);
    rig.run(GO_AT + 0.1);
    rig.input.actions.push('arm-toggle');
    rig.run(0.02);
    rig.input.stick.throttle = 0.5;
    rig.run(0.05);
    expect(rig.session.state).toBe('flying');
  });

  it('has no countdown in free flight', () => {
    const { rig, beeps } = raceRig(false);
    const snap = createSessionSnapshot();
    expect(rig.session.snapshot(snap).countdown.active).toBe(false);
    rig.input.actions.push('arm-toggle');
    rig.run(0.05);
    expect(rig.input.armed).toBe(true);
    rig.run(6);
    expect(beeps).toEqual([]);
  });

  it('stands still while the menu is open and goes on afterwards', () => {
    const { rig, beeps } = raceRig();
    rig.run(1.5);
    expect(beeps).toEqual([3]);
    rig.session.openMenu();
    rig.run(5);
    expect(beeps).toEqual([3]);
    rig.session.closeMenu();
    rig.run(1.2);
    expect(beeps).toEqual([3, 2]);
  });

  it('starts again on every restart, new track and on R during the count', () => {
    const { rig, beeps } = raceRig();
    rig.run(GO_AT + 0.5);
    expect(beeps).toEqual([3, 2, 1, 0]);
    rig.session.resetTrack();
    rig.run(GO_AT + 0.5);
    expect(beeps).toEqual([3, 2, 1, 0, 3, 2, 1, 0]);
    rig.session.setTrack(makeTrack(4));
    rig.run(1.5);
    expect(beeps.slice(8)).toEqual([3]);
    rig.input.actions.push('respawn');
    rig.run(0.05);
    expect(rig.session.snapshot().countdown.locked).toBe(true);
    rig.run(1.2);
    expect(beeps.slice(9)).toEqual([3]);
  });

  it('does not start while the start screen is still up, and a new track there waits for the first launch', () => {
    const rig = makeSessionRig({ started: false });
    const beeps: number[] = [];
    rig.session.onCountdown = (n) => beeps.push(n);
    rig.session.setRaceStart(true);
    rig.session.setTrack(makeTrack(5));
    rig.run(3);
    expect(beeps).toEqual([]);
    rig.session.closeMenu();
    rig.run(1.5);
    expect(beeps).toEqual([3]);
  });

  it('switching to free flight cancels a running count and unlocks arming', () => {
    const { rig } = raceRig();
    rig.run(1.5);
    rig.session.setRaceStart(false);
    rig.input.actions.push('arm-toggle');
    rig.run(0.02);
    expect(rig.input.armed).toBe(true);
  });
});

describe('stick snapshot and the finish', () => {
  it('reports the sticks the flight controller got', () => {
    const rig = makeSessionRig();
    const snap = createSessionSnapshot();
    rig.input.stick.roll = 0.3;
    rig.input.stick.pitch = -0.6;
    rig.input.stick.yaw = 0.9;
    rig.run(0.02);
    rig.session.snapshot(snap);
    expect(snap.stick).toEqual({ roll: 0.3, pitch: -0.6, yaw: 0.9 });
  });

  it('releases the input after the finish, hovers in angle mode, and gives the sticks back on restart', () => {
    const rig = makeSessionRig({ track: makeTrack(2) });
    rig.physics.onStep = (s): void => void (s.onGround = true);
    rig.input.armed = true;
    rig.input.stick.throttle = 0.5;
    rig.run(0.02);
    rig.physics.state.vel[2] = -20;
    rig.run(1.1);
    rig.physics.state.vel[2] = 0;
    expect(rig.session.state).toBe('finished');
    expect(rig.input.enabled).toBe(false);
    rig.input.stick.roll = 1;
    rig.run(0.05);
    const last = rig.physics.inputs.at(-1)!;
    expect(last).toMatchObject({ roll: 0, pitch: 0, yaw: 0, mode: 'angle', throttle: HOVER_THROTTLE });
    rig.session.resetTrack();
    expect(rig.session.state).toBe('ready');
    expect(rig.input.enabled).toBe(true);
  });
});

describe('keyboard-only session flow', () => {
  it('start, arm, fly, crash, reset, new track and back to the menu never leaves the session stuck', () => {
    const rig = makeSessionRig({ started: false });
    const { session, input, physics } = rig;
    const states: string[] = [];
    session.onStateChange = (s) => states.push(s);
    session.setRaceStart(true);
    expect(session.state).toBe('menu');
    expect(input.enabled).toBe(false);

    session.closeMenu();
    expect(input.enabled).toBe(true);
    physics.onStep = (s): void => void (s.onGround = true);
    rig.run(GO_AT + 0.1);
    input.actions.push('arm-toggle');
    rig.run(0.02);
    expect(input.armed).toBe(true);
    input.stick.throttle = 0.5;
    rig.run(0.05);
    expect(session.state).toBe('flying');

    physics.crashOnStep = physics.steps + 5;
    rig.run(0.05);
    expect(session.state).toBe('crashed');

    input.actions.push('reset-track');
    rig.run(0.02);
    expect(session.state).toBe('ready');
    expect(input.armed).toBe(false);
    expect(session.snapshot().countdown.locked).toBe(true);

    session.setTrack(makeTrack(6));
    expect(session.state).toBe('ready');
    input.actions.push('toggle-menu');
    rig.run(0.02);
    expect(session.state).toBe('menu');
    expect(input.enabled).toBe(false);
    input.actions.push('toggle-menu');
    rig.run(0.02);
    expect(session.state).toBe('ready');
    expect(input.enabled).toBe(true);
    expect(states).toEqual(['ready', 'flying', 'crashed', 'ready', 'menu', 'ready']);
  });
});
