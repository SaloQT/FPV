import { describe, expect, it } from 'vitest';
import { TIME_STEP_MINUTES } from './clock';
import { makeSessionRig } from './testKit';
import type { GameState } from './stateMachine';
import type { InputAction } from '../input/types';

describe('GameSession stepping', () => {
  it('runs a whole number of fixed steps per frame that adds up to real time', () => {
    const { physics, session, input } = makeSessionRig();
    for (let i = 0; i < 60; i++) session.update(1 / 60, input.stick);
    expect(physics.steps).toBeGreaterThanOrEqual(999);
    expect(physics.steps).toBeLessThanOrEqual(1000);
    expect(session.stats.totalSteps).toBe(physics.steps);
  });

  it('steps physics with the fixed dt and the pilot stick', () => {
    const { physics, session, input } = makeSessionRig();
    input.stick.roll = 0.4;
    input.stick.mode = 'angle';
    session.update(0.005, input.stick);
    expect(physics.steps).toBe(5);
    expect(physics.inputs[0]).toMatchObject({ roll: 0.4, mode: 'angle' });
    expect(session.stats.stepsThisFrame).toBe(5);
    expect(session.stepper.dt).toBeCloseTo(0.001, 12);
  });

  it('caps the catch-up after a stall and counts the dropped steps', () => {
    const { physics, session, input } = makeSessionRig();
    session.update(1, input.stick);
    expect(physics.steps).toBe(50);
    expect(session.stats.droppedSteps).toBe(950);
  });

  it('keeps alpha in [0, 1) whatever the frame time', () => {
    const { session, input } = makeSessionRig();
    for (const dt of [0.0013, 0.0007, 0.0161, 0.0333, 0.2, 0.004]) {
      session.update(dt, input.stick);
      expect(session.alpha).toBeGreaterThanOrEqual(0);
      expect(session.alpha).toBeLessThan(1);
    }
  });

  it('follows a physics rate change and ignores absurd rates', () => {
    const { physics, session, input } = makeSessionRig();
    session.applySettings({ physicsHz: 500 });
    session.update(0.01, input.stick);
    expect(physics.steps).toBe(5);
    session.applySettings({ physicsHz: Number.NaN });
    expect(Number.isFinite(session.stepper.dt)).toBe(true);
  });

  it('does nothing on a zero or negative frame', () => {
    const { physics, session, input } = makeSessionRig();
    session.update(0, input.stick);
    session.update(-1, input.stick);
    expect(physics.steps).toBe(0);
  });

  it('reports the wall time spent in physics', () => {
    let t = 0;
    const { session, input } = makeSessionRig({ now: () => (t += 2.5) });
    session.update(0.01, input.stick);
    expect(session.stats.physicsMs).toBeCloseTo(2.5, 9);
  });
});

describe('GameSession render state', () => {
  it('blends position between the previous and the current step', () => {
    const { physics, session, input } = makeSessionRig();
    physics.state.vel[0] = 10;
    session.update(0.0035, input.stick);
    expect(physics.state.pos[0]).toBeCloseTo(0.03, 9);
    expect(session.alpha).toBeCloseTo(0.5, 6);
    expect(session.renderState(0).pos[0]).toBeCloseTo(0.02, 9);
    expect(session.renderState(1).pos[0]).toBeCloseTo(0.03, 9);
    expect(session.renderState(0.5).pos[0]).toBeCloseTo(0.025, 9);
    expect(session.renderState().pos[0]).toBeCloseTo(0.025, 6);
  });

  it('slerps the attitude and lerps the angular velocity', () => {
    const { physics, session, input } = makeSessionRig();
    physics.onStep = (s): void => {
      const yaw = physics.steps * 0.2;
      s.quat[1] = Math.sin(yaw / 2);
      s.quat[3] = Math.cos(yaw / 2);
      s.angVel[1] = physics.steps;
    };
    session.update(0.002, input.stick);
    const mid = session.renderState(0.5);
    const yaw = 2 * Math.atan2(mid.quat[1], mid.quat[3]);
    expect(yaw).toBeCloseTo(0.3, 9);
    expect(mid.angVel[1]).toBeCloseTo(1.5, 9);
    expect(Math.hypot(...mid.quat)).toBeCloseTo(1, 12);
  });

  it('carries the non-interpolated fields and reuses one object', () => {
    const { physics, session, input } = makeSessionRig();
    physics.state.batteryVoltage = 15.2;
    physics.state.motorOmega[2] = 800;
    session.update(0.002, input.stick);
    const a = session.renderState(0.3);
    const b = session.renderState(0.6);
    expect(a).toBe(b);
    expect(b.batteryVoltage).toBe(15.2);
    expect(b.motorOmega[2]).toBe(800);
    expect(b.pos).not.toBe(physics.state.pos);
  });

  it('clamps alpha outside [0, 1]', () => {
    const { physics, session, input } = makeSessionRig();
    physics.state.vel[0] = 10;
    session.update(0.002, input.stick);
    expect(session.renderState(-3).pos[0]).toBeCloseTo(0.01, 9);
    expect(session.renderState(9).pos[0]).toBeCloseTo(0.02, 9);
  });

  it('does not smear across a respawn teleport', () => {
    const { physics, session, input } = makeSessionRig();
    physics.state.vel[0] = 10;
    session.update(0.005, input.stick);
    session.respawn();
    expect(session.renderState(0).pos[0]).toBeCloseTo(physics.state.pos[0], 12);
    expect(session.renderState(0.7).pos[0]).toBeCloseTo(physics.state.pos[0], 12);
  });
});

describe('GameSession menu, pause and clock', () => {
  it('starts on the start screen with the input disabled, and does not step', () => {
    const { physics, session, input } = makeSessionRig({ started: false });
    expect(session.state).toBe('menu');
    expect(session.started).toBe(false);
    expect(input.enabled).toBe(false);
    session.update(0.02, input.stick);
    expect(physics.steps).toBe(0);
  });

  it('Esc on the start screen does nothing; closeMenu starts the session', () => {
    const { session, input } = makeSessionRig({ started: false });
    input.actions.push('toggle-menu');
    session.update(0.01, input.stick);
    expect(session.state).toBe('menu');
    session.closeMenu();
    expect(session.state).toBe('ready');
    expect(session.started).toBe(true);
    expect(input.enabled).toBe(true);
  });

  it('toggle-menu opens and closes the menu, freezing physics and gating the input', () => {
    const { physics, session, input } = makeSessionRig();
    const seen: string[] = [];
    session.onStateChange = (s: GameState, prev: GameState): void => void seen.push(`${prev}>${s}`);
    input.actions.push('toggle-menu');
    session.update(0.01, input.stick);
    expect(session.state).toBe('menu');
    expect(input.enabled).toBe(false);
    const n = physics.steps;
    session.update(0.05, input.stick);
    expect(physics.steps).toBe(n);
    input.actions.push('toggle-menu');
    session.update(0.01, input.stick);
    expect(session.state).toBe('ready');
    expect(input.enabled).toBe(true);
    expect(seen).toEqual(['ready>menu', 'menu>ready']);
  });

  it('pause freezes the sim but keeps the input alive so P can resume', () => {
    const { physics, session, input } = makeSessionRig();
    input.actions.push('pause');
    session.update(0.01, input.stick);
    expect(session.state).toBe('paused');
    expect(input.enabled).toBe(true);
    const n = physics.steps;
    session.update(0.05, input.stick);
    expect(physics.steps).toBe(n);
    input.actions.push('pause');
    session.update(0.01, input.stick);
    expect(session.state).toBe('ready');
    expect(physics.steps).toBeGreaterThan(n);
  });

  it('time keys nudge the clock by 15 minutes', () => {
    const { session, input } = makeSessionRig();
    input.actions.push('time-forward', 'time-forward');
    session.update(0, input.stick);
    expect(session.clock.timeMs).toBe(2 * TIME_STEP_MINUTES * 60000);
    input.actions.push('time-back');
    session.update(0, input.stick);
    expect(session.clock.timeMs).toBe(TIME_STEP_MINUTES * 60000);
  });

  it('the clock runs at the time scale, also behind the menu, but not while paused', () => {
    const { session, input } = makeSessionRig({ timeScale: 60 });
    session.update(0.2, input.stick);
    expect(session.clock.timeMs).toBeCloseTo(12000, 3);
    session.openMenu();
    session.update(0.2, input.stick);
    expect(session.clock.timeMs).toBeCloseTo(24000, 3);
    session.closeMenu();
    session.togglePause();
    session.update(0.2, input.stick);
    expect(session.clock.timeMs).toBeCloseTo(24000, 3);
    session.applySettings({ timeMs: 5000, timeScale: 0 });
    session.togglePause();
    session.update(0.2, input.stick);
    expect(session.clock.timeMs).toBe(5000);
  });

  it('a long stall does not fast-forward the sky beyond a quarter second', () => {
    const { session, input } = makeSessionRig({ timeScale: 60 });
    session.update(30, input.stick);
    expect(session.clock.timeMs).toBeCloseTo(15000, 3);
  });

  it('forwards every action to the app after handling its own', () => {
    const { session, input } = makeSessionRig();
    const got: InputAction[] = [];
    session.onAction = (a): void => void got.push(a);
    input.actions.push('camera-cycle', 'toggle-help', 'new-track');
    session.update(0.01, input.stick);
    expect(got).toEqual(['camera-cycle', 'toggle-help', 'new-track']);
  });

  it('frame() polls the input, then updates', () => {
    const { physics, session, input } = makeSessionRig();
    input.stick.pitch = -0.3;
    const stick = session.frame(0.004);
    expect(stick).toBe(input.stick);
    expect(physics.inputs[0].pitch).toBe(-0.3);
  });
});
