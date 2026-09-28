import type { FlightMode, Quat, Vec3 } from '../../contracts';
import { G0, clamp, quatIntegrateBody, quatRotateInv } from '../math3d';

export interface ImuFusionConfig {
  /** Proportional gain of the accelerometer correction, rad/s per unit error (imu_dcm_kp 2500 -> 0.25). */
  kp: number;
  /** Accelerometer is trusted only while |a| is within this fraction of 1 g. */
  accelWindow: number;
}

export const DEFAULT_IMU_FUSION: ImuFusionConfig = { kp: 0.25, accelWindow: 0.15 };

/** Mahony complementary attitude filter fusing gyro rates with the accelerometer's gravity reference. */
export class Mahony {
  /** Estimated attitude, body -> world, [x, y, z, w]. */
  readonly q: Quat = [0, 0, 0, 1];
  /** World up expressed in the body frame, from the last update. */
  readonly up: Vec3 = [0, 1, 0];

  constructor(readonly cfg: ImuFusionConfig) {}

  reset(q: Quat): void {
    this.q[0] = q[0];
    this.q[1] = q[1];
    this.q[2] = q[2];
    this.q[3] = q[3];
    quatRotateInv(this.q, 0, 1, 0, this.up);
  }

  /** `g*` is the measured body rate in rad/s, `a*` the accelerometer specific force in m/s^2 (body axes). */
  update(dt: number, gx: number, gy: number, gz: number, ax: number, ay: number, az: number): void {
    const v = this.up;
    quatRotateInv(this.q, 0, 1, 0, v);
    const mag = Math.sqrt(ax * ax + ay * ay + az * az);
    let cx = 0, cy = 0, cz = 0;
    if (mag > 1e-3) {
      const trust = clamp(1 - Math.abs(mag / G0 - 1) / this.cfg.accelWindow, 0, 1);
      const k = (this.cfg.kp * trust) / mag;
      cx = k * (ay * v[2] - az * v[1]);
      cy = k * (az * v[0] - ax * v[2]);
      cz = k * (ax * v[1] - ay * v[0]);
    }
    quatIntegrateBody(this.q, gx + cx, gy + cy, gz + cz, dt);
    quatRotateInv(this.q, 0, 1, 0, v);
  }
}

export interface LevelConfig {
  /** Betaflight `angle_strength` (P of the level controller); the loop gain is P/10 per second. */
  strength: number;
  /** Maximum bank/pitch commanded by full stick in angle mode, degrees. */
  limitDeg: number;
  /** Stick deflection (0..1) at which horizon-mode self-levelling has faded out completely. */
  horizonTransition: number;
  /** Bound on the rate the level controller may request, deg/s. */
  maxRate: number;
}

export const DEFAULT_LEVEL: LevelConfig = { strength: 50, limitDeg: 55, horizonTransition: 0.75, maxRate: 600 };

const RAD2DEG = 180 / Math.PI;

/** Roll-right angle from the body-frame up vector, degrees (any heading, valid past 90 degrees). */
export function rollAngleDeg(up: Vec3): number {
  return Math.atan2(-up[0], up[1]) * RAD2DEG;
}

/** Nose-down angle from the body-frame up vector, degrees. */
export function pitchAngleDeg(up: Vec3): number {
  return Math.atan2(up[2], up[1]) * RAD2DEG;
}

/**
 * Angle / horizon self-levelling. `rate` holds the acro setpoints (deg/s, FC axes) on entry; for angle mode roll and pitch
 * are replaced with the attitude-error rate, for horizon mode a levelling term is added and fades with stick deflection.
 */
export function applyLevel(cfg: LevelConfig, mode: FlightMode, up: Vec3, rollStick: number, pitchStick: number, rate: Float64Array): void {
  if (mode === 'acro') return;
  const gain = cfg.strength * 0.1;
  const roll = rollAngleDeg(up);
  const pitch = pitchAngleDeg(up);
  if (mode === 'angle') {
    rate[0] = clamp((rollStick * cfg.limitDeg - roll) * gain, -cfg.maxRate, cfg.maxRate);
    rate[1] = clamp((pitchStick * cfg.limitDeg - pitch) * gain, -cfg.maxRate, cfg.maxRate);
    return;
  }
  const defl = Math.max(Math.abs(rollStick), Math.abs(pitchStick));
  const strength = clamp(1 - defl / cfg.horizonTransition, 0, 1);
  rate[0] += clamp(-roll * gain * strength, -cfg.maxRate, cfg.maxRate);
  rate[1] += clamp(-pitch * gain * strength, -cfg.maxRate, cfg.maxRate);
}
