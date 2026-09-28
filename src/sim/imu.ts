import type { Vec3 } from '../contracts';
import { Rng, TWO_PI } from './math3d';

export interface ImuParams {
  /** RMS white noise of one gyro sample, rad/s. */
  gyroNoise: number;
  /** Std-dev of the constant per-axis gyro bias drawn at reset, rad/s. */
  gyroBias: number;
  /** Gyro vibration amplitude at `vibrationOmega` (per motor, at the motor's rotation frequency), rad/s. */
  gyroVibration: number;
  /** Bandwidth of the IMU's own digital low-pass on the gyro, Hz. */
  gyroBandwidthHz: number;
  /** RMS white noise of one accelerometer sample, m/s^2. */
  accelNoise: number;
  /** Accelerometer vibration amplitude at `vibrationOmega` (per motor), m/s^2. */
  accelVibration: number;
  /** Accelerometer low-pass (the FC's acc filter), Hz. */
  accelBandwidthHz: number;
  /** Rotor speed at which the vibration amplitudes above apply; amplitude scales with speed squared (imbalance force). */
  vibrationOmega: number;
}

/** Gyro + accelerometer model: seeded white noise, bias, rpm-locked frame vibration and a first-order bandwidth limit. */
export class ImuSensor {
  /** Measured body rate, rad/s (body axes as QuadState.angVel). */
  readonly gyro: Vec3 = [0, 0, 0];
  /** Measured specific force, m/s^2 (body axes). */
  readonly accel: Vec3 = [0, 0, 0];
  private readonly rng: Rng;
  private readonly bias = new Float64Array(3);
  private readonly phase = new Float64Array(4);
  private readonly gyroDir = new Float64Array(12);
  private readonly accelDir = new Float64Array(12);
  private readonly motorGain = new Float64Array(4);
  private lastDt = 0;
  private gyroAlpha = 1;
  private accelAlpha = 1;

  private readonly seed: number;

  constructor(readonly p: ImuParams, seed: number) {
    this.seed = seed ^ 0x1f3d5b79;
    this.rng = new Rng(this.seed);
    this.reset();
  }

  /** Redraw the seeded per-flight constants (bias, vibration directions) and restart the filters at rest. */
  reset(): void {
    const r = this.rng;
    r.reseed(this.seed);
    for (let a = 0; a < 3; a++) this.bias[a] = r.gauss() * this.p.gyroBias;
    for (let m = 0; m < 4; m++) {
      this.phase[m] = r.next() * TWO_PI;
      this.motorGain[m] = 0.7 + 0.6 * r.next();
      for (let a = 0; a < 3; a++) {
        this.gyroDir[m * 3 + a] = r.gauss();
        this.accelDir[m * 3 + a] = r.gauss();
      }
    }
    this.gyro.fill(0);
    this.accel.fill(0);
  }

  /** Start the low-pass filters from the present truth so a fresh flight has no start-up transient. */
  prime(rate: Vec3, specificForce: Vec3): void {
    for (let a = 0; a < 3; a++) {
      this.gyro[a] = rate[a] + this.bias[a];
      this.accel[a] = specificForce[a];
    }
  }

  /** Take one sample from the true body rate, true specific force and the present motor speeds (rad/s). */
  sample(dt: number, rate: Vec3, specificForce: Vec3, motorOmega: ArrayLike<number>): void {
    const p = this.p;
    if (dt !== this.lastDt) {
      this.lastDt = dt;
      this.gyroAlpha = 1 - Math.exp(-TWO_PI * p.gyroBandwidthHz * dt);
      this.accelAlpha = 1 - Math.exp(-TWO_PI * p.accelBandwidthHz * dt);
    }
    const r = this.rng;
    let gx = rate[0] + this.bias[0] + p.gyroNoise * r.gauss();
    let gy = rate[1] + this.bias[1] + p.gyroNoise * r.gauss();
    let gz = rate[2] + this.bias[2] + p.gyroNoise * r.gauss();
    let ax = specificForce[0] + p.accelNoise * r.gauss();
    let ay = specificForce[1] + p.accelNoise * r.gauss();
    let az = specificForce[2] + p.accelNoise * r.gauss();
    const inv = 1 / p.vibrationOmega;
    for (let m = 0; m < 4; m++) {
      const w = Math.abs(motorOmega[m]);
      let ph = this.phase[m] + w * dt;
      if (ph > TWO_PI) ph -= TWO_PI;
      this.phase[m] = ph;
      const k = this.motorGain[m] * w * w * inv * inv;
      const s = Math.sin(ph) * k * p.gyroVibration;
      const c = Math.cos(ph) * k * p.accelVibration;
      const o = m * 3;
      gx += s * this.gyroDir[o];
      gy += s * this.gyroDir[o + 1];
      gz += s * this.gyroDir[o + 2];
      ax += c * this.accelDir[o];
      ay += c * this.accelDir[o + 1];
      az += c * this.accelDir[o + 2];
    }
    const ga = this.gyroAlpha, aa = this.accelAlpha;
    this.gyro[0] += (gx - this.gyro[0]) * ga;
    this.gyro[1] += (gy - this.gyro[1]) * ga;
    this.gyro[2] += (gz - this.gyro[2]) * ga;
    this.accel[0] += (ax - this.accel[0]) * aa;
    this.accel[1] += (ay - this.accel[1]) * aa;
    this.accel[2] += (az - this.accel[2]) * aa;
  }
}
