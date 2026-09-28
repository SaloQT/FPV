import type { Quat, StickInput, Vec3 } from '../../contracts';
import { clamp } from '../math3d';
import { DEFAULT_IMU_FUSION, DEFAULT_LEVEL, Mahony, applyLevel, type ImuFusionConfig, type LevelConfig } from './angle';
import { Pt1, RpmFilterBank, type RpmFilterConfig } from './filters';
import { DEFAULT_MIXER, Mixer, type MixerConfig } from './mixer';
import { DEFAULT_PID, PidController, type PidConfig } from './pid';
import { DEFAULT_RATES, stickToRate, type RateProfile } from './rates';

export interface FcConfig {
  rates: RateProfile;
  pid: PidConfig;
  mixer: MixerConfig;
  level: LevelConfig;
  imu: ImuFusionConfig;
  rpmFilter: RpmFilterConfig;
  gyroLpf1Hz: number;
  gyroLpf2Hz: number;
  /** Arming is refused (and latched off until the switch is cycled) above this throttle. */
  armThrottleMax: number;
  /** Airmode and I-term accumulation begin once throttle first exceeds this after arming. */
  airmodeStartThrottle: number;
}

export const DEFAULT_FC: FcConfig = {
  rates: DEFAULT_RATES,
  pid: DEFAULT_PID,
  mixer: DEFAULT_MIXER,
  level: DEFAULT_LEVEL,
  imu: DEFAULT_IMU_FUSION,
  rpmFilter: { enabled: true, harmonics: 3, q: 5, minHz: 100, weights: [1, 0.5, 0.25] },
  gyroLpf1Hz: 300,
  gyroLpf2Hz: 500,
  armThrottleMax: 0.05,
  airmodeStartThrottle: 0.25,
};

const RAD2DEG = 180 / Math.PI;

/** Betaflight-style flight controller: gyro filtering, rates, angle/horizon, PID, mixer, arming and turtle mode. */
export class FlightController {
  armed = false;
  /** Signed motor duty per motor after the mixer, -1..1. */
  readonly motors: Float64Array;
  /** Rate setpoint (deg/s) and filtered gyro (deg/s), FC axes: roll right, nose down, yaw right. */
  readonly setpoint = new Float64Array(3);
  readonly gyro = new Float64Array(3);
  readonly pid: PidController;
  readonly mixer: Mixer;
  readonly imu: Mahony;
  private readonly rpm: RpmFilterBank;
  private readonly lpf1 = [new Pt1(), new Pt1(), new Pt1()];
  private readonly lpf2 = [new Pt1(), new Pt1(), new Pt1()];
  private airmodeActive = false;
  private prevArmSwitch = false;
  private armBlocked = false;

  constructor(readonly cfg: FcConfig = DEFAULT_FC) {
    this.pid = new PidController(cfg.pid);
    this.mixer = new Mixer(cfg.mixer);
    this.imu = new Mahony(cfg.imu);
    this.rpm = new RpmFilterBank(cfg.rpmFilter, 4, 3);
    this.motors = this.mixer.out;
  }

  /** Disarm and clear every filter and integrator; the attitude estimate is set to `q`. */
  reset(q: Quat): void {
    this.armed = false;
    this.airmodeActive = false;
    this.prevArmSwitch = false;
    this.armBlocked = false;
    this.pid.reset();
    this.mixer.reset();
    this.rpm.reset();
    this.setpoint.fill(0);
    this.gyro.fill(0);
    for (let a = 0; a < 3; a++) {
      this.lpf1[a].reset();
      this.lpf2[a].reset();
    }
    this.imu.reset(q);
  }

  /** Force the attitude estimate (as after a level calibration). */
  syncAttitude(q: Quat): void {
    this.imu.reset(q);
  }

  /**
   * One FC loop iteration. `gyroBody` is the measured body rate (rad/s), `accelBody` the accelerometer (m/s^2) and
   * `motorOmega` the motor speeds (rad/s) used by the RPM filter.
   */
  update(dt: number, input: StickInput, gyroBody: Vec3, accelBody: Vec3, motorOmega: ArrayLike<number>): void {
    const c = this.cfg;
    this.imu.update(dt, gyroBody[0], gyroBody[1], gyroBody[2], accelBody[0], accelBody[1], accelBody[2]);
    this.filterGyro(dt, gyroBody, motorOmega);
    this.updateArming(input);
    if (!this.armed) {
      this.mixer.reset();
      return;
    }
    if (input.turtle) {
      this.pid.reset();
      this.mixer.turtle(input.roll, input.pitch, input.yaw);
      return;
    }
    const throttle = clamp(input.throttle, 0, 1);
    if (!this.airmodeActive && throttle > c.airmodeStartThrottle) this.airmodeActive = true;
    const r = c.rates;
    const sp = this.setpoint;
    sp[0] = stickToRate(r.type, r.roll, input.roll);
    sp[1] = stickToRate(r.type, r.pitch, input.pitch);
    sp[2] = stickToRate(r.type, r.yaw, input.yaw);
    applyLevel(c.level, input.mode, this.imu.up, clamp(input.roll, -1, 1), clamp(input.pitch, -1, 1), sp);
    this.pid.update(dt, sp, this.gyro, throttle, this.airmodeActive);
    this.mixer.run(dt, this.pid.sum, throttle, this.airmodeActive);
  }

  private filterGyro(dt: number, w: Vec3, motorOmega: ArrayLike<number>): void {
    const c = this.cfg;
    this.rpm.update(dt, motorOmega);
    const g = this.gyro;
    g[0] = this.filterAxis(0, -w[2] * RAD2DEG, dt, c);
    g[1] = this.filterAxis(1, -w[0] * RAD2DEG, dt, c);
    g[2] = this.filterAxis(2, -w[1] * RAD2DEG, dt, c);
  }

  private filterAxis(axis: number, x: number, dt: number, c: FcConfig): number {
    const y = this.rpm.apply(axis, x);
    this.lpf1[axis].configure(c.gyroLpf1Hz, dt);
    this.lpf2[axis].configure(c.gyroLpf2Hz, dt);
    return this.lpf2[axis].apply(this.lpf1[axis].apply(y));
  }

  private updateArming(input: StickInput): void {
    const sw = input.armed;
    if (!sw) {
      this.armed = false;
      this.armBlocked = false;
      this.airmodeActive = false;
      this.prevArmSwitch = false;
      return;
    }
    if (!this.armed && !this.armBlocked) {
      if (input.throttle <= this.cfg.armThrottleMax) {
        this.armed = true;
        this.airmodeActive = false;
        this.pid.reset();
      } else if (!this.prevArmSwitch) {
        this.armBlocked = true;
      }
    }
    this.prevArmSwitch = true;
  }
}
