import { describe, expect, it } from 'vitest';
import type { QuadState, StickInput, TrackData } from '../contracts';
import type { GameState } from '../game/stateMachine';
import { GameSession } from '../game/session';
import { createSessionSnapshot } from '../game/sessionTypes';
import { FakeInput, makeGate, makeQuadState, makeTrack } from '../game/testKit';
import { getPreset } from '../sim/presets';
import { QuadPhysics } from '../sim/quad';
import { flatTerrain } from '../sim/testkit';
import type { ScenarioName } from './params';
import { HOVER_AGL_M, HOVER_STICK, ScenarioPilot } from './scenario';

interface Rig {
  inner: FakeInput;
  pilot: ScenarioPilot;
  quad: QuadState;
  set(state: GameState): void;
  next(n: number): void;
  poll(dt?: number): StickInput;
}

/** A pilot on hand-set state: the tests move the quad and the game state themselves. */
function rig(scenario: ScenarioName, opts: { track?: TrackData | null; hoverAgl?: number; ground?: number } = {}): Rig {
  const inner = new FakeInput();
  const quad = makeQuadState({ pos: [0, 0.05, 0] });
  let state: GameState = 'menu';
  let nextGate = 0;
  const track = opts.track === undefined ? makeTrack(3) : opts.track;
  const pilot = new ScenarioPilot(inner, scenario, {
    quad: () => quad,
    state: () => state,
    track: () => track,
    nextGate: () => nextGate,
    groundHeightAt: () => opts.ground ?? 0,
    hoverAgl: opts.hoverAgl,
  });
  pilot.setEnabled(true);
  return {
    inner, pilot, quad,
    set: (s) => { state = s; },
    next: (n) => { nextGate = n; },
    poll: (dt = 1 / 60) => pilot.poll(dt),
  };
}

function yawQuat(quad: QuadState, yaw: number): void {
  quad.quat[0] = 0;
  quad.quat[1] = Math.sin(yaw / 2);
  quad.quat[2] = 0;
  quad.quat[3] = Math.cos(yaw / 2);
}

describe('ScenarioPilot pass-through', () => {
  it('gives no stick input in the menu and mirrors the wrapped source', () => {
    const r = rig('hover');
    r.inner.armed = true;
    const s = r.poll();
    expect([s.roll, s.pitch, s.yaw, s.throttle]).toEqual([0, 0, 0, 0]);
    expect(s.armed).toBe(true);
    expect(s.mode).toBe('angle');
    expect(r.pilot.armed).toBe(true);
    r.inner.actions = ['respawn'];
    expect(r.pilot.takeActions()).toEqual(['respawn']);
    r.pilot.setThrottle(0.4);
    expect(r.inner.throttleSets).toEqual([0.4]);
    r.pilot.setEnabled(false);
    expect(r.inner.enabled).toBe(false);
    expect(r.pilot.pointerLocked).toBe(false);
  });

  it('does nothing while disabled', () => {
    const r = rig('hover');
    r.pilot.setEnabled(false);
    r.set('flying');
    expect(r.poll().throttle).toBe(0);
  });
});

describe('ScenarioPilot on the pad', () => {
  it('arms about a third of a second after the pad is ready, then climbs', () => {
    const r = rig('hover');
    r.set('ready');
    r.poll(0.16);
    expect(r.inner.armed).toBe(false);
    r.poll(0.16);
    expect(r.inner.armed).toBe(true);
    const s = r.poll(0.016);
    expect(s.armed).toBe(true);
    expect(s.throttle).toBeGreaterThan(HOVER_STICK);
  });

  it('arms again after a respawn returns to ready', () => {
    const r = rig('hover');
    r.set('ready');
    r.poll(0.35);
    r.poll(0.016);
    expect(r.inner.armed).toBe(true);
    r.set('crashed');
    r.poll();
    r.inner.armed = false; // the session disarms on the way back to the pad
    r.set('ready');
    r.poll(0.1);
    expect(r.inner.armed).toBe(false);
    r.poll(0.25);
    expect(r.inner.armed).toBe(true);
  });
});

describe('ScenarioPilot hover', () => {
  it('raises the throttle below the target altitude and lowers it above', () => {
    const r = rig('hover');
    r.set('flying');
    r.quad.pos[1] = 0.5;
    expect(r.poll().throttle).toBeGreaterThan(HOVER_STICK + 0.05);
    const r2 = rig('hover');
    r2.set('flying');
    r2.quad.pos[1] = 3;
    expect(r2.poll().throttle).toBeLessThan(HOVER_STICK - 0.05);
    const r3 = rig('hover');
    r3.set('flying');
    r3.quad.pos[1] = HOVER_AGL_M;
    expect(r3.poll().throttle).toBeCloseTo(HOVER_STICK, 1);
  });

  it('measures the target from the local ground and honours hoverAgl', () => {
    const r = rig('hover', { hoverAgl: 4, ground: 10 });
    r.set('flying');
    r.quad.pos[1] = 11.5; // 1.5 m above ground: well below the 4 m target
    expect(r.poll().throttle).toBeGreaterThan(HOVER_STICK + 0.2);
    r.quad.pos[1] = 14;
    const level = rig('hover', { hoverAgl: 4, ground: 10 });
    level.set('flying');
    level.quad.pos[1] = 14;
    expect(level.poll().throttle).toBeCloseTo(HOVER_STICK, 1);
  });

  it('brakes drift with pitch and roll and holds the heading it started with', () => {
    const r = rig('hover');
    r.set('flying');
    r.quad.pos[1] = HOVER_AGL_M;
    r.quad.vel[2] = -2; // drifting forward (-Z): nose down would speed up, so it must pitch back
    expect(r.poll().pitch).toBeLessThan(0);
    const r2 = rig('hover');
    r2.set('flying');
    r2.quad.pos[1] = HOVER_AGL_M;
    yawQuat(r2.quad, 0.5);
    expect(r2.poll().yaw).toBeCloseTo(0, 6); // first sample sets the heading to hold
    yawQuat(r2.quad, 0);
    expect(r2.poll().yaw).toBe(-0.6); // now 0.5 rad off to the left of the held heading: clamped correction
  });
});

describe('ScenarioPilot crash', () => {
  it('climbs first, then cuts the throttle and pitches into the ground', () => {
    const r = rig('crash');
    r.set('flying');
    r.quad.pos[1] = 1;
    const up = r.poll();
    expect(up.throttle).toBeGreaterThan(HOVER_STICK);
    expect(up.pitch).not.toBe(0.5);
    r.quad.pos[1] = 3;
    const dive = r.poll();
    expect(dive.throttle).toBe(0);
    expect(dive.pitch).toBe(0.5);
    r.quad.pos[1] = 0.5; // once diving it keeps diving
    expect(r.poll().throttle).toBe(0);
  });
});

describe('ScenarioPilot fly and gate', () => {
  const trackAt = (x: number): TrackData => makeTrack(0, { gates: [makeGate({ index: 0, pos: [x, 2, -10], width: 4, height: 4 }), makeGate({ index: 1, pos: [x, 2, -20], width: 4, height: 4 })] });

  it('turns toward the next gate and speeds up when it is ahead', () => {
    const ahead = rig('fly', { track: trackAt(0) });
    ahead.set('flying');
    ahead.quad.pos[1] = 2;
    const a = ahead.poll();
    expect(Math.abs(a.yaw)).toBeLessThan(0.05);
    expect(a.pitch).toBeGreaterThan(0.1);
    const left = rig('fly', { track: trackAt(-10) });
    left.set('flying');
    left.quad.pos[1] = 2;
    expect(left.poll().yaw).toBeLessThan(-0.1); // left of the nose is a negative yaw stick
    const right = rig('fly', { track: trackAt(10) });
    right.set('flying');
    right.quad.pos[1] = 2;
    expect(right.poll().yaw).toBeGreaterThan(0.1);
  });

  it('flies at the gate height, not at the hover height', () => {
    const r = rig('fly', { track: trackAt(0) });
    r.set('flying');
    r.quad.pos[1] = HOVER_AGL_M; // gate centre is at 2 m: still below it, so climb
    expect(r.poll().throttle).toBeGreaterThan(HOVER_STICK);
  });

  it('hovers once the last gate is cleared, and after gate 0 in the gate scenario', () => {
    const done = rig('fly', { track: trackAt(0) });
    done.set('flying');
    done.quad.pos[1] = HOVER_AGL_M;
    done.next(2);
    const d = done.poll();
    expect(d.pitch).toBeCloseTo(0, 9);
    expect(d.roll).toBeCloseTo(0, 9);
    const gate = rig('gate', { track: trackAt(0) });
    gate.set('flying');
    gate.quad.pos[1] = 2;
    expect(gate.poll().pitch).toBeGreaterThan(0.1);
    gate.next(1);
    expect(gate.poll().pitch).toBeCloseTo(0, 9);
  });

  it('follows the centreline round a detour instead of cutting straight to the gate', () => {
    const path: [number, number, number][] = [];
    for (let x = 0; x <= 15; x++) path.push([x, 2, 0]);
    for (let z = -1; z >= -40; z--) path.push([15, 2, z]);
    for (let x = 14; x >= 0; x--) path.push([x, 2, -40]);
    const gates = [makeGate({ index: 0, pos: [0, 2, 0], width: 4, height: 4 }), makeGate({ index: 1, pos: [0, 2, -40], width: 4, height: 4 })];
    const r = rig('fly', { track: makeTrack(0, { gates, path, length: path.length - 1 }) });
    r.set('flying');
    r.next(1);
    r.quad.pos[1] = 2;
    expect(r.poll().yaw).toBeGreaterThan(0.3); // the straight line to gate 1 would give no yaw at all
  });

  it('hovers at the end of an open track that asks for another lap instead of turning back through the gate', () => {
    const path: [number, number, number][] = [];
    for (let z = 0; z >= -60; z--) path.push([0, 2, z]);
    const gates = [makeGate({ index: 0, pos: [0, 2, 0], width: 4, height: 4 }), makeGate({ index: 1, pos: [0, 2, -60], width: 4, height: 4 })];
    const r = rig('fly', { track: makeTrack(0, { gates, path, length: 60, laps: 2 }) });
    r.set('flying');
    r.next(0);
    r.quad.pos[0] = 0;
    r.quad.pos[1] = 2;
    r.quad.pos[2] = -58;
    const s = r.poll();
    expect(s.pitch).toBeCloseTo(0, 9);
    expect(s.roll).toBeCloseTo(0, 9);
  });

  it('hovers without a track', () => {
    const r = rig('fly', { track: null });
    r.set('flying');
    r.quad.pos[1] = HOVER_AGL_M;
    expect(r.poll().pitch).toBeCloseTo(0, 9);
  });
});

/** The pilot flying the real physics through the real session on flat ground. */
function closedLoop(scenario: ScenarioName, seconds: number, track: TrackData): { session: GameSession; physics: QuadPhysics; states: Set<GameState>; maxGate: number } {
  const ground = flatTerrain(0);
  const physics = new QuadPhysics(getPreset('QUAD_5IN_6S'), ground, 1);
  const snap = createSessionSnapshot();
  const inner = new FakeInput();
  let session!: GameSession;
  const pilot = new ScenarioPilot(inner, scenario, {
    quad: () => physics.state,
    state: () => session.state,
    track: () => session.raceTrack,
    nextGate: () => snap.race.nextGate,
    groundHeightAt: ground.heightAt,
  });
  session = new GameSession({ physics, input: pilot, track, settings: { physicsHz: 4000, autoRespawn: false, timeMs: 0, timeScale: 1 }, groundHeightAt: ground.heightAt });
  session.closeMenu();
  const states = new Set<GameState>();
  let maxGate = 0;
  for (let i = 0; i < seconds * 60; i++) {
    session.frame(1 / 60);
    session.snapshot(snap);
    states.add(session.state);
    maxGate = Math.max(maxGate, snap.race.nextGate);
  }
  return { session, physics, states, maxGate };
}

describe('ScenarioPilot closed loop', () => {
  it('takes off from the pad and holds a steady hover near 1.5 m', () => {
    const { session, physics } = closedLoop('hover', 10, makeTrack(3));
    const s = physics.state;
    expect(session.state).toBe('flying');
    expect(s.pos[1]).toBeGreaterThan(1.0);
    expect(s.pos[1]).toBeLessThan(2.2);
    expect(Math.hypot(s.vel[0], s.vel[1], s.vel[2])).toBeLessThan(1);
    expect(Math.hypot(s.pos[0], s.pos[2])).toBeLessThan(3);
  });

  it('dives into the ground in the crash scenario', () => {
    const { states } = closedLoop('crash', 10, makeTrack(3));
    expect(states.has('crashed')).toBe(true);
  });

  it('flies a 3-gate track through every gate and finishes the race', () => {
    const { states, maxGate, session } = closedLoop('fly', 14, makeTrack(3));
    expect(maxGate).toBe(2);
    expect(states.has('finished')).toBe(true);
    expect(session.state).toBe('finished');
  });

  it('clears only the first gate in the gate scenario, then hovers past it', () => {
    const { states, maxGate, physics } = closedLoop('gate', 12, makeTrack(3));
    expect(maxGate).toBe(1);
    expect(states.has('finished')).toBe(false);
    expect(physics.state.pos[1]).toBeGreaterThan(0.5);
  });
});
