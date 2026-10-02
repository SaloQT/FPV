import type { StarCatalog, Vec3 } from '../../contracts';
import { magToIlluminance, starDirectionEq } from '../../world/astro/stars';
import { fromHalf } from '../half';
import { FAINT_STAR_MAG, MILKY_WAY_HEIGHT, MILKY_WAY_WIDTH, equatorialToGalactic, uvFromGalactic } from './milkyWay';
import { NITS_PER_S10, ZODIACAL_COLOR, zodiacalS10 } from './physics';

/**
 * Night-sky light that the sky-view LUT does not carry (it holds airglow and the unresolved floor): the zodiacal light, the Milky Way and the
 * catalogue stars brighter than FAINT_STAR_MAG (fainter ones are inside the Milky Way map). The ground sees them all, so the ambient must too:
 * on a moonless night they are about 35 % of the total sky illuminance (~2.5e-3 lux), which the LUT alone leaves out.
 *
 * The result is one radiance M (nits, rgb) for the world sky-view LUT, applied there as  M * T(cosZ) * horizon(cosZ)  like the airglow, chosen so that the
 * horizontal illuminance of that term equals the real one: M = E_real / (pi K) with K the cosine-weighted mean of T * horizon. The sky pass draws
 * the real zodiacal light, Milky Way and stars itself, so only the ambient and the reflections read this.
 */
const HEMISPHERE_SAMPLES = 192;
const MAP_DOWNSAMPLE = 4;
const LUMINOUS_TAU = 0.1;
const HORIZON_LO = 0;
const HORIZON_HI = 0.04;
const MIN_COS = 0.02;
/** A recompute is due when the sky has turned by this much (max matrix element change, about 0.4 degrees: 1.6 minutes of sidereal time). */
const REFRESH_TOLERANCE = 0.0075;

const smooth = (lo: number, hi: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
};

/** Upper-hemisphere sample directions (area-uniform Fibonacci spiral, +Y up) with cosine, extinction and horizon weights. */
function buildHemisphere(): { dirs: Float32Array; weight: Float32Array; kernel: number } {
  const dirs = new Float32Array(HEMISPHERE_SAMPLES * 3), weight = new Float32Array(HEMISPHERE_SAMPLES);
  const golden = Math.PI * (3 - Math.sqrt(5));
  let kernel = 0;
  for (let i = 0; i < HEMISPHERE_SAMPLES; i++) {
    const y = (i + 0.5) / HEMISPHERE_SAMPLES, r = Math.sqrt(1 - y * y), a = golden * i;
    dirs[i * 3] = r * Math.cos(a); dirs[i * 3 + 1] = y; dirs[i * 3 + 2] = r * Math.sin(a);
    weight[i] = y * Math.exp(-LUMINOUS_TAU / Math.max(y, MIN_COS));
    kernel += weight[i] * smooth(HORIZON_LO, HORIZON_HI, y);
  }
  return { dirs, weight, kernel: (2 / HEMISPHERE_SAMPLES) * kernel };
}

const HEMI = buildHemisphere();
/** Cosine-weighted mean of the extinction and horizon taper the LUT applies to M: the dome's horizontal illuminance is pi * M * this. */
export const NIGHT_DOME_KERNEL = HEMI.kernel;

/** Evaluates the night dome for a sky orientation. Holds the downsampled Milky Way map and the bright stars; allocation free per refresh. */
export class NightDome {
  private readonly map: Float32Array;
  private readonly mapW = MILKY_WAY_WIDTH / MAP_DOWNSAMPLE;
  private readonly mapH = MILKY_WAY_HEIGHT / MAP_DOWNSAMPLE;
  private readonly starDir: Float32Array;
  private readonly starLux: Float32Array;
  private readonly cache = new Float64Array(9);
  private cached = false;
  private readonly out: Vec3 = [0, 0, 0];
  private readonly gal: [number, number] = [0, 0];
  private readonly uv: [number, number] = [0, 0];

  /** `texels` is the baked Milky Way map (rgba half floats); `catalog` the star catalogue (null: no stars). */
  constructor(texels: Uint16Array, catalog: StarCatalog | null) {
    const w = this.mapW, h = this.mapH, f = MAP_DOWNSAMPLE;
    this.map = new Float32Array(w * h * 3);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      for (let dy = 0; dy < f; dy++) for (let dx = 0; dx < f; dx++) {
        const o = ((y * f + dy) * MILKY_WAY_WIDTH + x * f + dx) * 4;
        for (let c = 0; c < 3; c++) this.map[(y * w + x) * 3 + c] += fromHalf(texels[o + c]) / (f * f);
      }
    }
    const stars: number[] = [], lux: number[] = [];
    const dir: Vec3 = [0, 0, 0];
    if (catalog) {
      for (let i = 0; i < catalog.count; i++) {
        const mag = catalog.data[i * 4 + 2];
        if (mag > FAINT_STAR_MAG) continue;
        starDirectionEq(catalog.data[i * 4], catalog.data[i * 4 + 1], dir);
        stars.push(dir[0], dir[1], dir[2]);
        lux.push(magToIlluminance(mag));
      }
    }
    this.starDir = Float32Array.from(stars);
    this.starLux = Float32Array.from(lux);
  }

  /** True when `equatorialToWorld` (row-major 3x3) differs enough from the one the last result was computed for. */
  needsRefresh(e: ArrayLike<number>): boolean {
    if (!this.cached) return true;
    for (let i = 0; i < 9; i++) if (Math.abs(e[i] - this.cache[i]) > REFRESH_TOLERANCE) return true;
    return false;
  }

  private mapAt(eqX: number, eqY: number, eqZ: number, c: number): number {
    equatorialToGalactic(eqX, eqY, eqZ, this.gal);
    uvFromGalactic(this.gal[0], this.gal[1], this.uv);
    const x = Math.min(this.mapW - 1, Math.max(0, Math.floor(this.uv[0] * this.mapW)));
    const y = Math.min(this.mapH - 1, Math.max(0, Math.floor(this.uv[1] * this.mapH)));
    return this.map[(y * this.mapW + x) * 3 + c];
  }

  /**
   * The LUT radiance M (nits) for the given sky: `e` row-major J2000 -> world rotation, `sun` the world sun direction, `ecl` the world ecliptic north,
   * `milkyWay` and `stars` the settings' brightness multipliers (0 = off). The result is only valid until the next call.
   */
  compute(e: ArrayLike<number>, sun: ArrayLike<number>, ecl: ArrayLike<number>, milkyWay: number, stars: number): Vec3 {
    for (let i = 0; i < 9; i++) this.cache[i] = e[i];
    this.cached = true;
    const acc = this.out;
    acc[0] = acc[1] = acc[2] = 0;
    const { dirs, weight } = HEMI;
    const k = 2 / HEMISPHERE_SAMPLES;
    for (let i = 0; i < HEMISPHERE_SAMPLES; i++) {
      const dx = dirs[i * 3], dy = dirs[i * 3 + 1], dz = dirs[i * 3 + 2];
      const eqX = e[0] * dx + e[3] * dy + e[6] * dz, eqY = e[1] * dx + e[4] * dy + e[7] * dz, eqZ = e[2] * dx + e[5] * dy + e[8] * dz;
      const zod = zodiacalS10(dx * sun[0] + dy * sun[1] + dz * sun[2], dx * ecl[0] + dy * ecl[1] + dz * ecl[2]) * NITS_PER_S10;
      const wgt = k * weight[i];
      for (let c = 0; c < 3; c++) acc[c] += wgt * (zod * ZODIACAL_COLOR[c] + milkyWay * this.mapAt(eqX, eqY, eqZ, c));
    }
    if (stars > 0) {
      const sd = this.starDir, lux = this.starLux;
      for (let s = 0; s < lux.length; s++) {
        const x = sd[s * 3], y = sd[s * 3 + 1], z = sd[s * 3 + 2];
        const up = e[3] * x + e[4] * y + e[5] * z;
        if (up <= MIN_COS) continue;
        const flux = (stars * lux[s] * up * Math.exp(-LUMINOUS_TAU / up)) / Math.PI;
        acc[0] += flux; acc[1] += flux; acc[2] += flux;
      }
    }
    for (let c = 0; c < 3; c++) acc[c] /= HEMI.kernel;
    return acc;
  }
}
