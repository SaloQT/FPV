import { TWO_PI } from './math3d';

export interface MotorParams {
  /** Motor velocity constant, rpm per volt. */
  kv: number;
  /** Phase-to-phase resistance, ohm. */
  resistance: number;
  /** Rotor + prop inertia about the spin axis, kg m^2. */
  inertia: number;
  /** ESC current limit per motor, A. */
  maxCurrent: number;
  /** Bearing/windage Coulomb friction torque, Nm. */
  frictionCoulomb: number;
  /** Viscous friction, Nm per rad/s. */
  frictionViscous: number;
  /** ESC duty-command lag time constant, s (48 kHz PWM update + rise filter). */
  escLag: number;
  /** Complementary-PWM braking (BLHeli_32 default with bidirectional DShot). */
  activeBraking: boolean;
  /** Maximum regenerative braking current, A. */
  brakeCurrent: number;
}

/** Friction that draws `noLoadCurrent` at the speed reached with `nominalVolts` applied (split 40% Coulomb / 60% viscous). */
export function motorFriction(kv: number, noLoadCurrent: number, nominalVolts: number): { frictionCoulomb: number; frictionViscous: number } {
  const kt = 60 / (TWO_PI * kv);
  const wNoLoad = (kv * nominalVolts * TWO_PI) / 60;
  const tau0 = kt * noLoadCurrent;
  return { frictionCoulomb: 0.4 * tau0, frictionViscous: (0.6 * tau0) / wNoLoad };
}

const COULOMB_EPS = 8;

/** Brushless motor + ESC. Positive omega is the motor's normal spin direction; negative duty spins it in reverse. */
export class Motor {
  readonly kt: number;
  omega = 0;
  omegaDot = 0;
  /** Filtered duty actually applied to the bridge (-1..1). */
  duty = 0;
  /** Phase current, A (signed; negative while regenerating). */
  current = 0;
  private pending = 0;
  private lagDt = 0;
  private lagAlpha = 1;

  constructor(readonly p: MotorParams) {
    this.kt = 60 / (TWO_PI * p.kv);
  }

  reset(): void {
    this.omega = 0;
    this.omegaDot = 0;
    this.duty = 0;
    this.current = 0;
    this.pending = 0;
  }

  /** Battery current drawn by this motor: bridge duty times phase current. */
  batteryCurrent(): number {
    return this.duty * this.current;
  }

  /** Latch the new command and advance the ESC lag; call once per step before the bus-voltage solve. */
  updateDuty(dt: number, cmd: number): void {
    if (dt !== this.lagDt) {
      this.lagDt = dt;
      this.lagAlpha = 1 - Math.exp(-dt / this.p.escLag);
    }
    this.duty += (this.pending - this.duty) * this.lagAlpha;
    this.pending = cmd;
  }

  private clampCurrent(i: number, volts: number): number {
    const p = this.p;
    let up: number;
    let lo: number;
    if (volts >= 0) {
      up = p.maxCurrent;
      lo = p.activeBraking ? -p.brakeCurrent : 0;
    } else {
      lo = -p.maxCurrent;
      up = p.activeBraking ? p.brakeCurrent : 0;
    }
    return i > up ? up : i < lo ? lo : i;
  }

  /** Battery-side current at bus voltage `vBus` for the present rotor speed (quasi-static, for the bus solve). */
  busCurrentAt(vBus: number): number {
    const volts = this.duty * vBus;
    return this.duty * this.clampCurrent((volts - this.kt * this.omega) / this.p.resistance, volts);
  }

  /** d(busCurrent)/d(vBus): duty^2/R while the current limiter is inactive. */
  busSlopeAt(vBus: number): number {
    const volts = this.duty * vBus;
    const raw = (volts - this.kt * this.omega) / this.p.resistance;
    return this.clampCurrent(raw, volts) === raw ? (this.duty * this.duty) / this.p.resistance : 0;
  }

  /**
   * Advance the rotor one step at bus voltage `vBus`. `loadTorque` is the aerodynamic torque opposing rotation
   * (signed like omega); `extraLoad` is a magnitude of stall/contact drag.
   */
  advance(dt: number, vBus: number, loadTorque: number, extraLoad: number): void {
    const p = this.p;
    const kt = this.kt;
    const w0 = this.omega;
    const volts = this.duty * vBus;
    const sgn = w0 >= COULOMB_EPS ? 1 : w0 <= -COULOMB_EPS ? -1 : w0 / COULOMB_EPS;
    const coul = (p.frictionCoulomb + extraLoad) * sgn;
    const gain = dt / p.inertia;
    const kR = (kt * kt) / p.resistance;
    let w = (w0 + gain * ((kt * volts) / p.resistance - loadTorque - coul)) / (1 + gain * (kR + p.frictionViscous));
    let i = (volts - kt * w) / p.resistance;
    const ic = this.clampCurrent(i, volts);
    if (ic !== i) {
      i = ic;
      w = w0 + gain * (kt * i - loadTorque - coul - p.frictionViscous * w0);
    }
    this.current = i;
    this.omegaDot = (w - w0) / dt;
    this.omega = w;
  }
}
