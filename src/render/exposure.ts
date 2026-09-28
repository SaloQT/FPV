import type { AstroState } from '../contracts';

export const SUN_TOA_LUX = 1.27e5;
export const STARLIGHT_FLOOR_NITS = 3e-5;
const MIN_PRE = 1e-6;
const MAX_PRE = 1e2;

/** Allen: apparent magnitude of the moon from phase angle alpha (degrees, 0 = full), then lux = 10^(-0.4 (m + 14.18)). ~0.263 lux at full. */
export function moonIlluminanceLux(phaseAngleRad: number): number {
  const a = Math.abs(phaseAngleRad) * (180 / Math.PI);
  const m = -12.73 + 1.49 * a + 0.043 * a * a * a * a;
  return Math.pow(10, -0.4 * (m + 14.18));
}

// Diffuse skylight on a horizontal plane (lux) vs solar elevation (deg), log10; interpolated (CIE twilight tables, clear sky).
const SKY_ELEV = [-18, -12, -6, 0, 10, 30, 60, 90];
const SKY_LOG_LUX = [-3.1, -2.0, 0.53, 2.6, 3.6, 4.1, 4.3, 4.3];

export function skyIlluminanceLux(sunElevationRad: number): number {
  const h = sunElevationRad * (180 / Math.PI);
  if (h <= SKY_ELEV[0]) return Math.pow(10, SKY_LOG_LUX[0]);
  for (let i = 1; i < SKY_ELEV.length; i++) {
    if (h <= SKY_ELEV[i]) {
      const t = (h - SKY_ELEV[i - 1]) / (SKY_ELEV[i] - SKY_ELEV[i - 1]);
      return Math.pow(10, SKY_LOG_LUX[i - 1] + (SKY_LOG_LUX[i] - SKY_LOG_LUX[i - 1]) * t);
    }
  }
  return Math.pow(10, SKY_LOG_LUX[SKY_LOG_LUX.length - 1]);
}

/** Approximate luminance (cd/m2) of a 0.18-albedo horizontal surface: direct sun + skylight + moon, floored at starlight. */
export function estimateSceneLuminance(astro: AstroState, cameraHeight: number): number {
  const heightFactor = Math.exp(-Math.max(cameraHeight, 0) / 8500);
  const sinSun = Math.sin(astro.sunElevation);
  const tSun = Math.exp((-0.15 * heightFactor) / Math.max(sinSun, 0.05));
  const sun = (0.18 / Math.PI) * SUN_TOA_LUX * tSun * Math.max(sinSun, 0);
  const sky = (0.18 / Math.PI) * skyIlluminanceLux(astro.sunElevation);
  const sinMoon = Math.sin(astro.moonElevation);
  const tMoon = Math.exp((-0.15 * heightFactor) / Math.max(sinMoon, 0.05));
  const moon = (0.18 / Math.PI) * moonIlluminanceLux(astro.moonPhaseAngle) * tMoon * Math.max(sinMoon, 0);
  return Math.max(sun + sky + moon, STARLIGHT_FLOOR_NITS);
}

export function preExposureFor(luminance: number): number {
  return Math.min(MAX_PRE, Math.max(MIN_PRE, 1 / (4 * luminance)));
}

/** Smooths the pre-exposure in log space so TAA/bloom history (stored pre-exposed) stays valid across frames. */
export class ExposureController {
  private logCur = 0;
  private logPrev = 0;
  private primed = false;
  readonly timeConstant = 0.4;
  readonly maxStep = Math.log(1.02);

  get preExposure(): number { return Math.exp(this.logCur); }
  get prevPreExposure(): number { return Math.exp(this.logPrev); }

  update(dt: number, astro: AstroState, cameraHeight: number): void {
    const target = Math.log(preExposureFor(estimateSceneLuminance(astro, cameraHeight)));
    this.logPrev = this.logCur;
    if (!this.primed) { this.logCur = this.logPrev = target; this.primed = true; return; }
    const k = 1 - Math.exp(-Math.max(dt, 0) / this.timeConstant);
    const step = (target - this.logCur) * k;
    this.logCur += Math.max(-this.maxStep, Math.min(this.maxStep, step));
  }

  reset(): void { this.primed = false; }
}
