/** Pure mapping from motor speeds and flight context to the 14 motor-synth parameters (no WebAudio, unit tested). */
import { clamp, motorLoudness, smoothingAlpha, smoothstep, TWO_PI } from './dsp';
import {
  MOTOR_COUNT, MOTOR_FREQ_MAX, MOTOR_PARAM_COUNT, P_AMP, P_FLUTTER, P_FREQ, P_NOISE, P_NOISE_FC, P_ROUGH, P_RUMBLE, P_SPREAD,
} from './motorParams';

/** Full-throttle motor speed of the default 5 inch 6S build (about 31.5k rpm). */
export const DEFAULT_OMEGA_MAX = 3300;

/** Per-motor frequency offsets: the slow beating between motors is a big part of the multirotor sound. */
export const MOTOR_DETUNE: readonly number[] = [1, 1.0028, 0.9975, 1.0016];

export const MOTOR_AMP_SCALE = 0.16;
export const WHOOSH_SCALE = 0.12;
export const RUMBLE_SCALE = 0.5;
const IDLE_FLOOR = 0.03;
const ONBOARD_SPREAD = 0.6;

export interface MotorFrame {
  /** Motor speeds in rad/s (contracts order). */
  omega: ArrayLike<number>;
  dt: number;
  /** World vertical velocity, +up. */
  vy: number;
  /** Frequency scale from the Doppler shift; 1 for none. */
  doppler: number;
  onboard: boolean;
}

export class MotorModel {
  readonly params = new Float64Array(MOTOR_PARAM_COUNT);
  private readonly prev = new Float64Array(MOTOR_COUNT);
  private havePrev = false;
  private flutter = 0;
  private rumble = 0;

  constructor(readonly omegaMax = DEFAULT_OMEGA_MAX) {}

  reset(): void {
    this.havePrev = false;
    this.flutter = 0;
    this.rumble = 0;
  }

  /** Writes and returns the shared `params` array; allocation free. */
  update(f: MotorFrame): Float64Array {
    const p = this.params;
    const dt = clamp(f.dt, 1e-4, 0.25);
    const vy = Number.isFinite(f.vy) ? f.vy : 0;
    const doppler = Number.isFinite(f.doppler) ? f.doppler : 1;
    let ratioSum = 0, whoosh = 0, rate = 0;
    for (let i = 0; i < MOTOR_COUNT; i++) {
      const w = Number.isFinite(f.omega[i]) && f.omega[i] > 0 ? f.omega[i] : 0;
      const loud = motorLoudness(w, this.omegaMax);
      const ratio = clamp(w / this.omegaMax, 0, 1.2);
      const gate = smoothstep(15, 100, w);
      p[P_FREQ + i] = clamp((w / TWO_PI) * MOTOR_DETUNE[i] * doppler, 0, MOTOR_FREQ_MAX);
      p[P_AMP + i] = MOTOR_AMP_SCALE * (IDLE_FLOOR * gate + (1 - IDLE_FLOOR) * loud);
      ratioSum += ratio;
      whoosh += ratio ** 2.6;
      if (this.havePrev) rate += Math.abs(w - this.prev[i]) / dt;
      this.prev[i] = w;
    }
    const ratio = ratioSum / MOTOR_COUNT;
    const flutterTarget = this.havePrev ? 0.55 * smoothstep(400, 6000, rate / MOTOR_COUNT) : 0;
    this.havePrev = true;
    this.flutter += (flutterTarget - this.flutter) * smoothingAlpha(dt, flutterTarget > this.flutter ? 0.03 : 0.25);

    const spin = smoothstep(0.03, 0.2, ratio);
    const wash = smoothstep(2.5, 14, -vy) * spin * (1 - 0.4 * ratio);
    const rumbleTarget = RUMBLE_SCALE * (0.12 * ratio * ratio + wash);
    this.rumble += (rumbleTarget - this.rumble) * smoothingAlpha(dt, rumbleTarget > this.rumble ? 0.08 : 0.4);

    p[P_NOISE] = WHOOSH_SCALE * (whoosh / MOTOR_COUNT);
    p[P_NOISE_FC] = 2000 + 3600 * clamp(ratio, 0, 1);
    p[P_ROUGH] = 0.002 + 0.006 * clamp(ratio, 0, 1);
    p[P_FLUTTER] = this.flutter;
    p[P_RUMBLE] = this.rumble;
    p[P_SPREAD] = f.onboard ? ONBOARD_SPREAD : 0;
    return p;
  }
}
