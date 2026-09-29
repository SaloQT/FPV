/** Pure animation state of the quad model: persistent prop phases, solid/blur cross-fade, LED levels and model matrices. */
import type { Quat, Vec3 } from '../../contracts';
import { MOTOR_SPIN } from './quadLayout';

const TAU = Math.PI * 2;
/** Blades are fully drawn below `SOLID_FULL` rad/s and gone by `SOLID_GONE`; the blur disc fades in around the same range. */
export const SOLID_FULL = 40;
export const SOLID_GONE = 60;
const BLUR_START = 35;
const BLUR_FULL = 65;
export const BLUR_ALPHA = 0.26;
/** The quad is not drawn when the camera is this close to its centre of mass (first person view). */
export const HIDE_DISTANCE = 0.35;
/** A pose jump larger than this (respawn) drops the previous pose so no smear is drawn. */
export const POSE_JUMP = 2;

export const LED_REAR_STRENGTH = 0.3;
export const LED_FRONT_STRENGTH = 0.45;
export const LED_COLOURS: readonly Vec3[] = [[1, 0.04, 0.02], [1, 0.04, 0.02], [1, 0.93, 0.8], [1, 0.93, 0.8]];
const BLINK_HZ = 1.3;

export function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export const solidFraction = (omega: number): number => 1 - smoothstep(SOLID_FULL, SOLID_GONE, Math.abs(omega));
export const blurAlpha = (omega: number): number => BLUR_ALPHA * smoothstep(BLUR_START, BLUR_FULL, Math.abs(omega));

export interface Rotors {
  /** Accumulated rotation of each prop in [0, tau): integral of |omega| dt, so a prop never jumps when the speed changes. */
  phase: Float64Array;
  /** Signed angle about +Y this frame and the previous one (positive is counter-clockwise seen from above). */
  angle: Float64Array;
  prevAngle: Float64Array;
  solid: Float64Array;
  blur: Float64Array;
}

export function createRotors(): Rotors {
  const phase = new Float64Array(4);
  for (let i = 0; i < 4; i++) phase[i] = i * 0.7;
  const angle = new Float64Array(4);
  for (let i = 0; i < 4; i++) angle[i] = MOTOR_SPIN[i] * phase[i];
  return { phase, angle, prevAngle: Float64Array.from(angle), solid: new Float64Array(4).fill(1), blur: new Float64Array(4) };
}

/** Advances every prop by |omega| * dt; the render angle takes the sign of the motor's physical spin direction. */
export function stepRotors(r: Rotors, omega: ArrayLike<number>, dt: number): void {
  for (let i = 0; i < 4; i++) {
    // A single NaN from the sim would poison the accumulated phase for the rest of the run.
    const w = Number.isFinite(omega[i]) ? omega[i] : 0;
    r.prevAngle[i] = r.angle[i];
    r.phase[i] = (r.phase[i] + Math.abs(w) * (Number.isFinite(dt) ? dt : 0)) % TAU;
    r.angle[i] = MOTOR_SPIN[i] * r.phase[i];
    r.solid[i] = solidFraction(w);
    r.blur[i] = blurAlpha(w);
  }
}

/** 1 when armed; blinks briefly when disarmed. Fully off between blinks so the LED reads as dark. */
export function ledLevel(armed: boolean, time: number): number {
  if (armed) return 1;
  const p = (time * BLINK_HZ) % 1;
  return smoothstep(0, 0.03, p) - smoothstep(0.2, 0.24, p);
}

/** Column-major 4x4 for a rigid body pose (rotation from the quaternion [x, y, z, w], translation `pos`). */
export function packModel(out: Float32Array, pos: Vec3, q: Quat): void {
  const [x, y, z, w] = q;
  out[0] = 1 - 2 * (y * y + z * z);
  out[1] = 2 * (x * y + z * w);
  out[2] = 2 * (x * z - y * w);
  out[3] = 0;
  out[4] = 2 * (x * y - z * w);
  out[5] = 1 - 2 * (x * x + z * z);
  out[6] = 2 * (y * z + x * w);
  out[7] = 0;
  out[8] = 2 * (x * z + y * w);
  out[9] = 2 * (y * z - x * w);
  out[10] = 1 - 2 * (x * x + y * y);
  out[11] = 0;
  out[12] = pos[0];
  out[13] = pos[1];
  out[14] = pos[2];
  out[15] = 1;
}

export interface QuadPose {
  model: Float32Array;
  prevModel: Float32Array;
  /** False until the first pose arrives; also cleared to force a reset. */
  valid: boolean;
}

export function createPose(): QuadPose {
  return { model: new Float32Array(16), prevModel: new Float32Array(16), valid: false };
}

/** Moves the pose forward one frame: the old model becomes `prevModel` unless this is the first frame or a teleport. */
export function stepPose(p: QuadPose, pos: Vec3, q: Quat): void {
  const jumped = p.valid && Math.hypot(pos[0] - p.model[12], pos[1] - p.model[13], pos[2] - p.model[14]) > POSE_JUMP;
  if (p.valid && !jumped) p.prevModel.set(p.model);
  packModel(p.model, pos, q);
  if (!p.valid || jumped) p.prevModel.set(p.model);
  p.valid = true;
}

export function cameraInsideQuad(camera: Vec3, quadPos: Vec3): boolean {
  return Math.hypot(camera[0] - quadPos[0], camera[1] - quadPos[1], camera[2] - quadPos[2]) < HIDE_DISTANCE;
}
