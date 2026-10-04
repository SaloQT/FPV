/**
 * Betaflight 4.x rate curves. Stick input is -1..1, output is the angular-rate setpoint in deg/s.
 *
 * Units of `AxisRates` per type:
 *  - actual:     rcRate = centre sensitivity (deg/s), superRate = rate at full stick (deg/s), expo 0..1
 *  - betaflight: rcRate = RC rate (1.0 -> 200 deg/s at centre), superRate = super rate 0..0.99, expo 0..1
 *  - quick:      rcRate = centre sensitivity (deg/s), superRate = rate at full stick (deg/s), expo 0..1
 */
export type RateType = 'actual' | 'betaflight' | 'quick';

/** Every rate type the flight controller can fly, in menu order. */
export const RATE_TYPES: readonly RateType[] = ['actual', 'betaflight', 'quick'];

export interface AxisRates {
  rcRate: number;
  superRate: number;
  expo: number;
}

export interface RateProfile {
  type: RateType;
  roll: AxisRates;
  pitch: AxisRates;
  yaw: AxisRates;
}

/** Betaflight clamps the setpoint to +-1998 deg/s. */
export const SETPOINT_RATE_LIMIT = 1998;
const RC_RATE_INCREMENTAL = 14.54;

export const DEFAULT_RATES: RateProfile = {
  type: 'actual',
  roll: { rcRate: 70, superRate: 670, expo: 0 },
  pitch: { rcRate: 70, superRate: 670, expo: 0 },
  yaw: { rcRate: 70, superRate: 600, expo: 0 },
};

function clampSetpoint(x: number): number {
  return x > SETPOINT_RATE_LIMIT ? SETPOINT_RATE_LIMIT : x < -SETPOINT_RATE_LIMIT ? -SETPOINT_RATE_LIMIT : x;
}

function actualRate(r: AxisRates, s: number): number {
  const a = Math.abs(s);
  const s2 = s * s;
  const curve = a * (s2 * s2 * s * r.expo + s * (1 - r.expo));
  const stickMovement = Math.max(0, r.superRate - r.rcRate);
  return s * r.rcRate + stickMovement * curve;
}

function betaflightRate(r: AxisRates, s: number): number {
  const a = Math.abs(s);
  const c = r.expo > 0 ? s * a * a * a * r.expo + s * (1 - r.expo) : s;
  const rc = r.rcRate > 2 ? r.rcRate + RC_RATE_INCREMENTAL * (r.rcRate - 2) : r.rcRate;
  let rate = 200 * rc * c;
  if (r.superRate > 0) rate /= Math.min(Math.max(1 - a * r.superRate, 0.01), 1);
  return rate;
}

function quickRate(r: AxisRates, s: number): number {
  const a = Math.abs(s);
  const rc = r.rcRate;
  const maxDps = Math.max(r.superRate, rc);
  const k = maxDps > 0 && rc > 0 ? (maxDps / rc - 1) / (maxDps / rc) : 0;
  const curve = a * a * a * r.expo + a * (1 - r.expo);
  return s * rc / Math.min(Math.max(1 - curve * k, 0.01), 1);
}

/** Map a stick deflection (-1..1) to the rate setpoint in deg/s for one axis. */
export function stickToRate(type: RateType, r: AxisRates, stick: number): number {
  const s = stick > 1 ? 1 : stick < -1 ? -1 : stick;
  const v = type === 'actual' ? actualRate(r, s) : type === 'betaflight' ? betaflightRate(r, s) : quickRate(r, s);
  return clampSetpoint(v);
}

/** Rate at full stick for one axis, deg/s. */
export function maxRate(type: RateType, r: AxisRates): number {
  return stickToRate(type, r, 1);
}
