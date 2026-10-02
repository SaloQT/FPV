import { DEG, LUNAR_FEATURES, LUNAR_ROWS, galacticAxesEquatorial } from './celestial';
import type { AtmosphereSettings } from './settings';

/** Rows (vec4) before the lunar feature table; mirrors struct AtmosParams in shaders/sky/atmos_uniforms.wgsl. */
export const FIXED_ROWS = 11;
export const ATMOS_PARAM_BYTES = (FIXED_ROWS + LUNAR_ROWS) * 16;
const OBLIQUITY_J2000 = 23.4392911 * DEG;

const ROW = {
  flags: 0, sky2: 4, cloudA: 8, cloudB: 12, wind: 16, cloudC: 20, cloudD: 24, eclNorth: 28, gal0: 32, gal1: 36, gal2: 40, maria: 44,
} as const;

export interface AtmosParamInputs {
  settings: AtmosphereSettings;
  moonScattering: boolean;
  seed: number;
  timeSeconds: number;
  /** Row-major J2000 equatorial -> world rotation (AstroState.equatorialToWorld). */
  equatorialToWorld: ArrayLike<number>;
  starMagLimit: number;
  cloudSteps: number;
  jitterIndex: number;
  /** Cloud shadow map: world (x, z) of its centre and side length, metres. */
  shadowCenterX: number;
  shadowCenterZ: number;
  shadowExtentM: number;
  historyBlend: number;
  historyValid: boolean;
  lightSteps: number;
  /** Night-dome radiance (nits, rgb) for the world sky-view LUT (see nightDome.ts); stored in the free w lanes of the galactic axis rows. */
  nightDome?: ArrayLike<number>;
}

/** World-space drift (metres, x east / z south) of a layer after `timeSeconds` of wind toward a compass bearing. */
export function windOffset(speed: number, bearingDeg: number, timeSeconds: number, out: [number, number] = [0, 0]): [number, number] {
  const a = bearingDeg * DEG;
  out[0] = Math.sin(a) * speed * timeSeconds;
  out[1] = -Math.cos(a) * speed * timeSeconds;
  return out;
}

/** World-space direction of the ecliptic north pole: the J2000 pole (0, -sin eps, cos eps) rotated by the celestial matrix. */
export function eclipticNorthWorld(m: ArrayLike<number>, out: [number, number, number] = [0, 0, 0]): [number, number, number] {
  const s = -Math.sin(OBLIQUITY_J2000), c = Math.cos(OBLIQUITY_J2000);
  for (let i = 0; i < 3; i++) out[i] = m[3 * i + 1] * s + m[3 * i + 2] * c;
  return out;
}

const CUMULUS_WIND: [number, number] = [0, 0];
const CIRRUS_WIND: [number, number] = [0, 0];
const ECL: [number, number, number] = [0, 0, 0];

/** The uniform buffer's CPU mirror. Constant tables are written once; write() refreshes the per-frame rows without allocating. */
export class AtmosUniforms {
  readonly data = new Float32Array(ATMOS_PARAM_BYTES / 4);

  constructor() {
    const d = this.data;
    const axes = galacticAxesEquatorial();
    for (let a = 0; a < 3; a++) {
      const o = ROW.gal0 + a * 4;
      d[o] = axes[a][0]; d[o + 1] = axes[a][1]; d[o + 2] = axes[a][2];
    }
    LUNAR_FEATURES.forEach((f, k) => {
      const o = ROW.maria + k * 8;
      d[o] = f.lonDeg * DEG; d[o + 1] = f.latDeg * DEG; d[o + 2] = f.radiusLonDeg * DEG; d[o + 3] = f.radiusLatDeg * DEG;
      d[o + 4] = f.strength; d[o + 5] = f.softness; d[o + 6] = f.rotationDeg * DEG; d[o + 7] = f.kind === 'mare' ? 0 : 1;
    });
  }

  write(p: AtmosParamInputs): Float32Array {
    const d = this.data, s = p.settings;
    d[ROW.flags] = p.moonScattering ? 1 : 0; d[ROW.flags + 1] = s.nightSkyScale; d[ROW.flags + 2] = s.starBrightness; d[ROW.flags + 3] = s.twinkle;
    d[ROW.sky2] = s.milkyWayEnabled ? s.milkyWayBrightness : 0; d[ROW.sky2 + 1] = s.starsEnabled ? 1 : 0;
    d[ROW.sky2 + 2] = s.cloudsEnabled ? 1 : 0; d[ROW.sky2 + 3] = p.starMagLimit;
    d[ROW.cloudA] = s.cloudCoverage; d[ROW.cloudA + 1] = s.cirrusCoverage; d[ROW.cloudA + 2] = s.cloudDensity; d[ROW.cloudA + 3] = p.seed;
    d[ROW.cloudB] = s.cumulusBaseKm; d[ROW.cloudB + 1] = s.cumulusTopKm; d[ROW.cloudB + 2] = s.cirrusBaseKm; d[ROW.cloudB + 3] = s.cirrusTopKm;
    windOffset(s.windSpeed, s.windDirectionDeg, p.timeSeconds, CUMULUS_WIND);
    windOffset(s.windSpeed * 1.8, s.windDirectionDeg + 15, p.timeSeconds, CIRRUS_WIND);
    d[ROW.wind] = CUMULUS_WIND[0]; d[ROW.wind + 1] = CUMULUS_WIND[1]; d[ROW.wind + 2] = CIRRUS_WIND[0]; d[ROW.wind + 3] = CIRRUS_WIND[1];
    d[ROW.cloudC] = p.cloudSteps; d[ROW.cloudC + 1] = p.jitterIndex; d[ROW.cloudC + 2] = p.shadowCenterX; d[ROW.cloudC + 3] = p.shadowCenterZ;
    d[ROW.cloudD] = p.historyBlend; d[ROW.cloudD + 1] = p.historyValid ? 1 : 0; d[ROW.cloudD + 2] = p.lightSteps; d[ROW.cloudD + 3] = p.shadowExtentM;
    eclipticNorthWorld(p.equatorialToWorld, ECL);
    d[ROW.eclNorth] = ECL[0]; d[ROW.eclNorth + 1] = ECL[1]; d[ROW.eclNorth + 2] = ECL[2];
    d[ROW.eclNorth + 3] = (s.windDirectionDeg + 15) * DEG;
    const dome = p.nightDome;
    d[ROW.gal0 + 3] = dome ? dome[0] : 0; d[ROW.gal1 + 3] = dome ? dome[1] : 0; d[ROW.gal2 + 3] = dome ? dome[2] : 0;
    return d;
  }
}
