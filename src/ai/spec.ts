/**
 * What a drone brain sees and does. The GPU trainer (src/ai/gpu/env.wgsl) and the in-game pilot (brainPilot.ts) both follow
 * this file, so a brain trained headless flies the game's own quad the same way.
 *
 * The brain is a pilot on the sticks: every POLICY_HZ tick it reads the observation vector and sets roll, pitch, yaw and
 * throttle in acro mode. The real flight controller, motors and airframe in src/sim do the rest, at the game's physics rate.
 */
import type { StickInput } from '../contracts';
import { DEFAULT_PHYSICS_HZ } from '../game/stepper';

/** Brain decisions per simulated second; each holds the sticks for PHYSICS_PER_ACTION physics steps. */
export const POLICY_HZ = 50;
/** The physics rate brains are trained at: the game's default. */
export const BRAIN_PHYSICS_HZ = DEFAULT_PHYSICS_HZ;
export const PHYSICS_PER_ACTION = BRAIN_PHYSICS_HZ / POLICY_HZ;

export const OBS_SIZE = 40;
export const ACT_SIZE = 4;

/** Observation slots (see `observe` for the maths; the WGSL builder writes the same slots). */
export const OBS = {
  vel: 0, // body-frame velocity / 10 (m/s)
  rate: 3, // body-frame angular velocity / 10 (rad/s)
  up: 6, // world up in body axes
  agl: 9, // height above the ground (pad included), min(agl, 30) / 10
  g1Dir: 10, // unit vector to the next gate centre, body axes
  g1Dist: 13, // min(distance, 60) / 20
  g1Fwd: 14, // next gate travel axis, body axes
  g1Up: 17, // next gate up axis, body axes
  g1Size: 20, // width / 4, height / 4
  g1Shape: 22, // 0 rectangle, 0.5 arch, 1 ellipse
  g2Rel: 23, // gate after next minus next gate, body axes, length clamped to 60, / 20
  g2Fwd: 26, // gate after next travel axis, body axes
  g2Valid: 29, // 1 when there is a gate after the next one
  prevAct: 30, // the last action (4)
  motor: 34, // motor speeds / 3500 (rad/s)
  battery: 38, // per-cell terminal voltage - 3.8
  g1Along: 39, // signed distance along the next gate's travel axis, clamped to +-60, / 20
} as const;

export const VEL_SCALE = 0.1;
export const RATE_SCALE = 0.1;
export const AGL_MAX = 30;
export const AGL_SCALE = 0.1;
export const DIST_MAX = 60;
export const DIST_SCALE = 1 / 20;
export const MOTOR_SCALE = 1 / 3500;
export const CELL_VOLT_CENTRE = 3.8;

/** The action at a reset: sticks centred, throttle at zero (what the flight controller needs to arm). */
export const REST_ACTION: readonly number[] = [0, 0, 0, -1];

/** Squashed action (each -1..1) to the transmitter sticks: acro, armed, throttle 0..1. */
export function actionToStick(a: ArrayLike<number>, out: StickInput): StickInput {
  out.roll = clampUnit(a[0]);
  out.pitch = clampUnit(a[1]);
  out.yaw = clampUnit(a[2]);
  out.throttle = (clampUnit(a[3]) + 1) * 0.5;
  out.mode = 'acro';
  out.armed = true;
  out.turtle = false;
  return out;
}

function clampUnit(x: number): number {
  return x > 1 ? 1 : x < -1 ? -1 : x;
}

/** Gate opening shape code shared with the GPU: 0 rectangle (square, start, finish, flag, window, ladder, tunnel, hurdle), 0.5 arch, 1 ellipse (hoop, dive, drop). */
export function gateShape(kind: string): number {
  return kind === 'hoop' || kind === 'dive' || kind === 'drop' ? 1 : kind === 'arch' ? 0.5 : 0;
}
