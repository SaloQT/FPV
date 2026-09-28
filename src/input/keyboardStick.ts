import { clamp } from './curves';

export interface KeyboardAxes {
  throttleUp: boolean;
  throttleDown: boolean;
  throttleCut: boolean;
  boost: boolean;
  yawLeft: boolean;
  yawRight: boolean;
  rollLeft: boolean;
  rollRight: boolean;
  pitchUp: boolean;
  pitchDown: boolean;
}

export const THROTTLE_UP_RATE = 0.9;
export const THROTTLE_DOWN_RATE = 1.4;
export const BOOST_FACTOR = 2.5;
/** Seconds from centre to full deflection, and from full deflection back to centre. */
export const RAMP_UP_S = 0.12;
export const RAMP_DOWN_S = 0.1;

/** Moves toward a target at the attack rate, or toward zero at the (independent) release rate. */
function ramp(current: number, target: number, dt: number): number {
  if (target === 0) {
    const step = dt / RAMP_DOWN_S;
    return current > 0 ? Math.max(0, current - step) : Math.min(0, current + step);
  }
  const step = dt / RAMP_UP_S;
  return current < target ? Math.min(target, current + step) : Math.max(target, current - step);
}

/**
 * Keyboard as a radio: roll, pitch and yaw are springy sticks with a fast attack and release; throttle is a latched
 * gimbal that stays where it was left (W/S ramp it, X cuts it), like a real throttle without a centring spring.
 * Signs follow StickInput: D = yaw > 0 (nose right), right = roll > 0, pitch up key = nose up = pitch < 0.
 */
export class KeyboardStick {
  roll = 0;
  pitch = 0;
  yaw = 0;
  throttle = 0;

  update(dt: number, k: KeyboardAxes): void {
    this.roll = ramp(this.roll, (k.rollRight ? 1 : 0) - (k.rollLeft ? 1 : 0), dt);
    this.pitch = ramp(this.pitch, (k.pitchDown ? 1 : 0) - (k.pitchUp ? 1 : 0), dt);
    this.yaw = ramp(this.yaw, (k.yawRight ? 1 : 0) - (k.yawLeft ? 1 : 0), dt);
    const boost = k.boost ? BOOST_FACTOR : 1;
    let t = this.throttle;
    if (k.throttleUp) t += THROTTLE_UP_RATE * boost * dt;
    if (k.throttleDown) t -= THROTTLE_DOWN_RATE * boost * dt;
    this.throttle = k.throttleCut ? 0 : clamp(t, 0, 1);
  }

  releaseSticks(): void {
    this.roll = this.pitch = this.yaw = 0;
  }
}
