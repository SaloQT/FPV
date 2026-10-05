import type { Physics, QuadState, StickInput, TrackData, TrackGate } from '../contracts';
import type { InputAction, InputSource } from '../input/types';
import { GameSession } from './session';

export function makeGate(over: Partial<TrackGate> = {}): TrackGate {
  return { index: 0, kind: 'square', pos: [0, 2, -10], yaw: 0, roll: 0, pitch: 0, width: 2, height: 1, ...over };
}

/** `n` square gates 10 m apart along -Z, 4 x 4 m openings, start pad at the origin. */
export function makeTrack(n: number, over: Partial<TrackData> = {}): TrackData {
  const gates: TrackGate[] = [];
  for (let i = 0; i < n; i++) gates.push({ index: i, kind: 'square', pos: [0, 2, -10 * (i + 1)], yaw: 0, roll: 0, pitch: 0, width: 4, height: 4 });
  return { seed: 1, style: 'race', gates, obstacles: [], path: [], closed: false, length: 10 * n, start: { pos: [0, 0, 0], yaw: 0 }, laps: 1, ...over };
}

export function makeQuadState(over: Partial<QuadState> = {}): QuadState {
  return {
    time: 0, pos: [0, 0, 0], vel: [0, 0, 0], quat: [0, 0, 0, 1], angVel: [0, 0, 0],
    motorOmega: [0, 0, 0, 0], motorCmd: [0, 0, 0, 0], batteryVoltage: 16.8, batteryCurrent: 0, batteryMah: 0,
    gForce: [0, 1, 0], armed: false, onGround: false, crashed: false, impactSpeed: 0, ...over,
  };
}

export function makeStick(over: Partial<StickInput> = {}): StickInput {
  return { roll: 0, pitch: 0, yaw: 0, throttle: 0, armed: false, mode: 'acro', turtle: false, ...over };
}

/** Physics double: moves with `vel` when armed, records what it was given, and lets tests script crashes. */
export class FakePhysics implements Physics {
  readonly state: QuadState = makeQuadState();
  steps = 0;
  resets: { pos: [number, number, number]; yaw: number }[] = [];
  inputs: StickInput[] = [];
  crashOnStep = -1;
  onStep: ((s: QuadState, dt: number) => void) | null = null;

  step(dt: number, input: StickInput): void {
    const s = this.state;
    this.steps++;
    this.inputs.push({ ...input });
    s.time += dt;
    s.armed = input.armed;
    s.pos[0] += s.vel[0] * dt;
    s.pos[1] += s.vel[1] * dt;
    s.pos[2] += s.vel[2] * dt;
    s.crashed = this.steps === this.crashOnStep;
    this.onStep?.(s, dt);
  }

  reset(pos: [number, number, number], yawRad: number): void {
    this.resets.push({ pos: [pos[0], pos[1], pos[2]], yaw: yawRad });
    const s = this.state;
    s.pos[0] = pos[0];
    s.pos[1] = pos[1];
    s.pos[2] = pos[2];
    s.vel.fill(0);
    s.time = 0;
    s.armed = false;
    s.crashed = false;
    s.onGround = false;
    s.quat[0] = 0;
    s.quat[1] = Math.sin(yawRad / 2);
    s.quat[2] = 0;
    s.quat[3] = Math.cos(yawRad / 2);
  }

  setColliders(): void {}
}

/** Input double: the test edits `stick` and queues `actions`; it records how the session drove the arm switch and throttle. */
export class FakeInput implements InputSource {
  stick: StickInput = makeStick();
  actions: InputAction[] = [];
  armed = false;
  enabled = true;
  pointerLocked = false;
  throttleSets: number[] = [];
  recenters = 0;

  poll(): StickInput {
    return this.stick;
  }

  takeActions(): readonly InputAction[] {
    const out = this.actions;
    this.actions = [];
    return out;
  }

  setArmed(armed: boolean): void {
    this.armed = armed;
  }

  setThrottle(value: number): void {
    this.throttleSets.push(value);
    this.stick.throttle = value;
  }

  recenter(): void {
    this.recenters++;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }
}

export interface SessionRig {
  physics: FakePhysics;
  input: FakeInput;
  session: GameSession;
  /** Runs `seconds` of frames (default 10 ms each, i.e. 10 steps at the rig's 1 kHz physics) with the input's stick. */
  run(seconds: number, frame?: number): void;
}

/** A session on doubles: 1 kHz physics, a 3-gate track, already past the start screen unless `started` is false. */
export function makeSessionRig(over: { track?: TrackData | null; autoRespawn?: boolean; started?: boolean; timeScale?: number; now?: () => number } = {}): SessionRig {
  const physics = new FakePhysics();
  const input = new FakeInput();
  const session = new GameSession({
    physics,
    input,
    track: over.track === undefined ? makeTrack(3) : over.track,
    settings: { physicsHz: 1000, autoRespawn: over.autoRespawn ?? false, timeMs: 0, timeScale: over.timeScale ?? 1 },
    ...(over.now ? { now: over.now } : {}),
  });
  if (over.started !== false) session.closeMenu();
  const run = (seconds: number, frame = 0.01): void => {
    const n = Math.round(seconds / frame);
    for (let i = 0; i < n; i++) session.update(frame, input.stick);
  };
  return { physics, input, session, run };
}
