import type { Vec3 } from '../contracts';
import { Rng, TWO_PI } from './math3d';

export interface WindConfig {
  /** Mean wind speed at flying height, m/s. */
  meanSpeed: number;
  /** Direction the wind blows FROM, radians clockwise from north (0 = north wind, pi/2 = east wind). */
  fromDirection: number;
  /** Turbulence intensity scale (1 = nominal Dryden-like level for the mean speed, 0 = calm air). */
  turbulence: number;
  /** Random gust events per minute (0 disables). */
  gustsPerMinute: number;
  /** Peak gust speed as a multiple of the mean speed (plus a 1 m/s floor). */
  gustFactor: number;
}

export const windDefaults: Readonly<WindConfig> = {
  meanSpeed: 2,
  fromDirection: 0.6,
  turbulence: 1,
  gustsPerMinute: 1.5,
  gustFactor: 0.8,
};

interface Gust {
  active: boolean;
  start: number;
  duration: number;
  vx: number;
  vy: number;
  vz: number;
}

const MAX_GUSTS = 4;
const TURB_SCALE_LENGTH = 25;
const MIN_TURB_SPEED = 3;
const GUST_LIFETIME = 120;

/** Wind field: mean vector, Dryden-style seeded turbulence (time-domain, 3 axes) and travelling 1-cosine gusts. */
export class Wind {
  readonly cfg: WindConfig;
  private readonly rng: Rng;
  private mx = 0;
  private mz = 0;
  private ux = 1;
  private uz = 0;
  private xu = 0;
  private xv1 = 0;
  private xv2 = 0;
  private xw1 = 0;
  private xw2 = 0;
  private nextGust = 0;
  private readonly gusts: Gust[] = [];

  private readonly seed: number;

  constructor(seed = 1, cfg: Partial<WindConfig> = {}) {
    this.seed = seed ^ 0x51ed270b;
    this.rng = new Rng(this.seed);
    this.cfg = { ...windDefaults, ...cfg };
    for (let i = 0; i < MAX_GUSTS; i++) this.gusts.push({ active: false, start: 0, duration: 1, vx: 0, vy: 0, vz: 0 });
    this.applyMean();
    this.scheduleGust(0);
  }

  private applyMean(): void {
    const c = this.cfg;
    this.mx = -Math.sin(c.fromDirection) * c.meanSpeed;
    this.mz = Math.cos(c.fromDirection) * c.meanSpeed;
    if (c.meanSpeed > 0.05) {
      this.ux = this.mx / c.meanSpeed;
      this.uz = this.mz / c.meanSpeed;
    } else {
      this.ux = 1;
      this.uz = 0;
    }
  }

  setMean(speed: number, fromDirectionRad: number): void {
    this.cfg.meanSpeed = Math.max(0, speed);
    this.cfg.fromDirection = fromDirectionRad;
    this.applyMean();
  }

  setTurbulence(scale: number, gustsPerMinute = this.cfg.gustsPerMinute): void {
    this.cfg.turbulence = Math.max(0, scale);
    this.cfg.gustsPerMinute = Math.max(0, gustsPerMinute);
  }

  reset(): void {
    this.rng.reseed(this.seed);
    this.xu = this.xv1 = this.xv2 = this.xw1 = this.xw2 = 0;
    for (const g of this.gusts) g.active = false;
    this.scheduleGust(0);
  }

  /** Start a gust at time `t` with peak velocity `peak` (m/s, world axes) lasting `duration` seconds. */
  triggerGust(t: number, peakX: number, peakY: number, peakZ: number, duration: number): void {
    let slot = this.gusts[0];
    for (const g of this.gusts) {
      if (!g.active) {
        slot = g;
        break;
      }
      if (g.start < slot.start) slot = g;
    }
    slot.active = true;
    slot.start = t;
    slot.duration = Math.max(duration, 0.1);
    slot.vx = peakX;
    slot.vy = peakY;
    slot.vz = peakZ;
  }

  private scheduleGust(t: number): void {
    const rate = this.cfg.gustsPerMinute / 60;
    this.nextGust = rate > 0 ? t - Math.log(1 - this.rng.next()) / rate : Infinity;
  }

  /** Advance the turbulence filters; `airspeed` sets the spatial-to-temporal scale (Taylor hypothesis). */
  update(dt: number, airspeed: number, t: number): void {
    const c = this.cfg;
    const speed = Math.max(airspeed, MIN_TURB_SPEED);
    const tau = TURB_SCALE_LENGTH / speed;
    const sigma = c.turbulence * (0.1 + 0.16 * c.meanSpeed);
    const a = Math.exp(-dt / tau);
    const drive = Math.sqrt(1 - a * a);
    const r = this.rng;
    this.xu = a * this.xu + drive * sigma * r.gauss();
    this.xv1 = a * this.xv1 + drive * r.gauss();
    this.xv2 = a * this.xv2 + (1 - a) * this.xv1;
    this.xw1 = a * this.xw1 + drive * r.gauss();
    this.xw2 = a * this.xw2 + (1 - a) * this.xw1;
    if (t >= this.nextGust) {
      const peak = c.gustFactor * c.meanSpeed + 1;
      const s = 0.5 + r.next();
      this.triggerGust(t, this.ux * peak * s, 0.2 * peak * (r.next() - 0.5), this.uz * peak * s, 1.5 + 2.5 * r.next());
      this.scheduleGust(t);
    }
  }

  /** Write the world-frame wind velocity at `pos` and time `t` into `out`. Allocation-free. */
  sample(pos: Vec3, t: number, out: Vec3): Vec3 {
    const sigma = this.cfg.turbulence * (0.1 + 0.16 * this.cfg.meanSpeed);
    const cross = Math.SQRT2 * sigma * this.xv2;
    const vert = 0.6 * Math.SQRT2 * sigma * this.xw2;
    let x = this.mx + this.xu * this.ux - cross * this.uz;
    let y = vert;
    let z = this.mz + this.xu * this.uz + cross * this.ux;
    const frontSpeed = Math.max(this.cfg.meanSpeed, 1);
    const along = pos[0] * this.ux + pos[2] * this.uz;
    for (let i = 0; i < MAX_GUSTS; i++) {
      const g = this.gusts[i];
      if (!g.active) continue;
      const phase = (t - g.start - along / frontSpeed) / g.duration;
      if (t - g.start > GUST_LIFETIME + g.duration) {
        g.active = false;
        continue;
      }
      if (phase <= 0 || phase >= 1) continue;
      const w = 0.5 * (1 - Math.cos(TWO_PI * phase));
      x += g.vx * w;
      y += g.vy * w;
      z += g.vz * w;
    }
    out[0] = x;
    out[1] = y;
    out[2] = z;
    return out;
  }
}
