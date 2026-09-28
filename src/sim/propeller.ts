import { Rng, TWO_PI, clamp } from './math3d';

export interface PropParams {
  /** Diameter, m. */
  diameter: number;
  /** Static thrust coefficient, T = CT rho n^2 D^4 (n in rev/s). */
  ct0: number;
  /** Static torque coefficient, Q = CQ rho n^2 D^5. */
  cq0: number;
  /** Advance ratio where linearised CT reaches zero (effective fit over the flight envelope). */
  j0: number;
  /** Advance ratio where linearised CQ reaches zero. */
  jq0: number;
  /** Low-Reynolds-number loss: at zero rpm CT falls by this fraction (vanishes at `reynoldsRef`). */
  reynoldsLoss: number;
  /** Fraction of the CT loss that CQ gains back as extra torque at low rotor speed. */
  reynoldsTorque: number;
  /** Rotor speed (rev/s) above which the blade Reynolds number no longer degrades the coefficients. */
  reynoldsRef: number;
  /** Reverse-spin (turtle mode) thrust and torque relative to forward. */
  reverseThrust: number;
  reverseTorque: number;
  /** In-plane (H-force) drag: H = kH * T * mu, mu = v_perp / (omega R). */
  hForce: number;
  /** Blade-flapping hub moment: M = kFlap * T * mu * D. */
  flapMoment: number;
  /** Peak vortex-ring thrust loss (fraction) when descending at about one induced velocity. */
  vortexLoss: number;
  /** Std-dev of wake turbulence thrust fluctuation while descending through own wake (fraction of thrust). */
  washNoise: number;
}

const SEA_LEVEL_PRESSURE = 101325;
const R_AIR = 287.05;

/** ISA air density for geometric altitude `h` (m); `tempC` overrides the ISA temperature at that altitude. */
export function airDensity(h: number, tempC?: number): number {
  const k = Math.max(1 - 2.2558e-5 * h, 0.05);
  const pressure = SEA_LEVEL_PRESSURE * Math.pow(k, 5.2559);
  const temp = tempC === undefined ? 288.15 - 0.0065 * h : tempC + 273.15;
  return pressure / (R_AIR * temp);
}

/** Cheng ground-effect thrust multiplier for a rotor of radius `radius` whose disc is `z` above the ground, clamped to [1, 1.4]. */
export function groundEffect(z: number, radius: number): number {
  const s = radius / (4 * Math.max(z, 0.45 * radius));
  return Math.min(1 / (1 - s * s), 1.4);
}

const WASH_CUTOFF_HZ = 25;

/** One propeller: thrust and load torque from rotor speed and local inflow. */
export class Propeller {
  /** Thrust along the body +Y axis, N (negative when spun in reverse). */
  thrust = 0;
  /** Aerodynamic torque opposing rotation, Nm, same sign as omega. */
  torque = 0;
  /** In-plane H-force per m/s of in-plane airspeed, N/(m/s). */
  hDrag = 0;
  /** Blade-flapping hub moment per m/s of in-plane airspeed, Nm/(m/s). */
  flapGain = 0;
  private wash = 0;
  private washDt = 0;
  private washAlpha = 1;
  private washNorm = 1;

  constructor(readonly p: PropParams, private readonly rng: Rng) {}

  reset(): void {
    this.thrust = 0;
    this.torque = 0;
    this.hDrag = 0;
    this.flapGain = 0;
    this.wash = 0;
  }

  /**
   * `vAxial` is the body-frame velocity of the prop relative to the air along +Y (positive = moving into its own thrust
   * direction, i.e. climbing) and `ground` the ground-effect multiplier. Afterwards `hDrag` and `flapGain` are the
   * per-(m/s of in-plane airspeed) H-force and hub-moment gains.
   */
  evaluate(omega: number, rho: number, vAxial: number, ground: number, dt: number): void {
    const p = this.p;
    const d = p.diameter;
    const n = Math.abs(omega) / TWO_PI;
    const n2 = n * n;
    const d4 = d * d * d * d;
    if (n < 0.5) {
      this.thrust = 0;
      this.torque = 0;
      this.hDrag = 0;
      this.flapGain = 0;
      this.wash = 0;
      return;
    }
    if (omega < 0) {
      this.thrust = -p.reverseThrust * p.ct0 * rho * n2 * d4;
      this.torque = -p.reverseTorque * p.cq0 * rho * n2 * d4 * d;
      this.hDrag = 0;
      this.flapGain = 0;
      return;
    }
    const j = vAxial / (n * d);
    const re = p.reynoldsLoss * (1 - Math.min(n / p.reynoldsRef, 1));
    const ctScale = clamp(1 - j / p.j0, -0.2, 1.4) * (1 - re);
    const cqScale = clamp(1 - j / p.jq0, -0.1, 1.4) * (1 + p.reynoldsTorque * re);
    const tStatic = p.ct0 * ctScale * rho * n2 * d4;

    let loss = 0;
    let washAmp = 0;
    if (vAxial < 0) {
      const area = Math.PI * d * d * 0.25;
      const vh = Math.sqrt(Math.max(p.ct0 * rho * n2 * d4, 1e-6) / (2 * rho * area));
      const r = -vAxial / vh;
      if (r < 2.5) {
        const s = Math.sin((Math.PI * Math.min(r, 2)) / 2);
        const window = r <= 2 ? s * s : 0;
        loss = p.vortexLoss * window;
        washAmp = p.washNoise * Math.sin((Math.PI * r) / 2.5) ** 2;
      }
    }
    this.updateWash(dt, washAmp);
    this.thrust = tStatic * ground * (1 - loss) * (1 + this.wash);
    this.torque = p.cq0 * cqScale * rho * n2 * d4 * d;
    const tipSpeed = omega * d * 0.5;
    const tPos = Math.max(this.thrust, 0);
    this.hDrag = (p.hForce * tPos) / tipSpeed;
    this.flapGain = (p.flapMoment * tPos * d) / tipSpeed;
  }

  private updateWash(dt: number, amp: number): void {
    if (dt !== this.washDt) {
      this.washDt = dt;
      this.washAlpha = 1 - Math.exp(-TWO_PI * WASH_CUTOFF_HZ * dt);
      this.washNorm = Math.sqrt((2 - this.washAlpha) / this.washAlpha);
    }
    const target = amp > 0 ? this.rng.gauss() * this.washNorm * amp : 0;
    this.wash += (target - this.wash) * this.washAlpha;
  }
}
