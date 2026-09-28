import { toHalf } from '../../render/half';

/** CPU single-scattering atmosphere (Hillaire 2020 coefficients, per km) used only by the dev harness until the real module lands. */
export const RB = 6360;
export const RT = 6460;
export const H = Math.sqrt(RT * RT - RB * RB);
export const T_W = 256, T_H = 64, SKY_W = 192, SKY_H = 108, AP_N = 32, AP_MAX_M = 12000, AP_K = 6;

const RAY = [5.802e-3, 13.558e-3, 33.1e-3];
const MIE_SCATTER = 3.996e-3, MIE_EXT = 8.396e-3;
const OZONE = [0.65e-3, 1.881e-3, 0.085e-3];
const MIE_G = 0.8;
const MULTI_SCATTER = 0.3;
const GROUND_ALBEDO = 0.15;

const ext = new Float64Array(3), scat = new Float64Array(3), tSun = new Float64Array(3), dens = new Float64Array(3);

/** Fills `dens` with the Rayleigh, Mie and ozone density profiles at a height in km. */
function density(hKm: number): void {
  dens[0] = Math.exp(-hKm / 8); dens[1] = Math.exp(-hKm / 1.2); dens[2] = Math.max(0, 1 - Math.abs(hKm - 25) / 15);
}

function extinction(hKm: number, out: Float64Array): void {
  density(hKm);
  for (let c = 0; c < 3; c++) out[c] = RAY[c] * dens[0] + MIE_EXT * dens[1] + OZONE[c] * dens[2];
}

/** Transmittance LUT, texel-centre generation with the parameterisation documented in atmosphere_sample.wgsl. */
export function buildTransmittance(): Float32Array {
  const out = new Float32Array(T_W * T_H * 3), steps = 48, od = new Float64Array(3);
  for (let j = 0; j < T_H; j++) {
    const rho = H * ((j + 0.5) / T_H), r = Math.sqrt(rho * rho + RB * RB);
    for (let i = 0; i < T_W; i++) {
      const d = RT - r + ((i + 0.5) / T_W) * (rho + H - (RT - r));
      const mu = d === 0 ? 1 : Math.max(-1, Math.min(1, (H * H - rho * rho - d * d) / (2 * r * d)));
      const len = -r * mu + Math.sqrt(Math.max(r * r * (mu * mu - 1) + RT * RT, 0)), ds = len / steps;
      od.fill(0);
      for (let s = 0; s < steps; s++) {
        const t = (s + 0.5) * ds;
        extinction(Math.max(Math.sqrt(t * t + 2 * r * mu * t + r * r) - RB, 0), ext);
        for (let c = 0; c < 3; c++) od[c] += ext[c] * ds;
      }
      for (let c = 0; c < 3; c++) out[(j * T_W + i) * 3 + c] = Math.exp(-od[c]);
    }
  }
  return out;
}

/** Bilinear lookup that mirrors sampleTransmittance() in the shader. */
export function sampleTransmittance(lut: Float32Array, r: number, mu: number, out: Float64Array): void {
  const rho = Math.sqrt(Math.max(r * r - RB * RB, 0));
  const d = Math.max(0, -r * mu + Math.sqrt(Math.max(r * r * (mu * mu - 1) + RT * RT, 0)));
  const dMin = RT - r, dMax = rho + H;
  const u = Math.min(Math.max((d - dMin) / Math.max(dMax - dMin, 1e-6), 0), 1), v = Math.min(Math.max(rho / H, 0), 1);
  const fx = Math.min(Math.max(u * T_W - 0.5, 0), T_W - 1), fy = Math.min(Math.max(v * T_H - 0.5, 0), T_H - 1);
  const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(x0 + 1, T_W - 1), y1 = Math.min(y0 + 1, T_H - 1), ax = fx - x0, ay = fy - y0;
  for (let c = 0; c < 3; c++) {
    const a = lut[(y0 * T_W + x0) * 3 + c], b = lut[(y0 * T_W + x1) * 3 + c], e = lut[(y1 * T_W + x0) * 3 + c], f = lut[(y1 * T_W + x1) * 3 + c];
    out[c] = (a + (b - a) * ax) * (1 - ay) + (e + (f - e) * ax) * ay;
  }
}

export interface March { L: Float64Array; T: Float64Array }
export const newMarch = (): March => ({ L: new Float64Array(3), T: new Float64Array(3).fill(1) });

function phaseRayleigh(c: number): number { return (3 / (16 * Math.PI)) * (1 + c * c); }
function phaseMie(c: number): number {
  const g2 = MIE_G * MIE_G;
  return (1 - g2) / (4 * Math.PI * Math.pow(1 + g2 - 2 * MIE_G * c, 1.5));
}

/** Integrates single scattering (plus a crude isotropic second order) over t0..t1 (km) along a ray, updating `m` in place. */
export function marchSegment(
  m: March, lut: Float32Array, sunLux: number, o: readonly number[], dir: readonly number[], sun: readonly number[], t0: number, t1: number,
): void {
  const t = 0.5 * (t0 + t1), ds = t1 - t0;
  const px = o[0] + dir[0] * t, py = o[1] + dir[1] * t, pz = o[2] + dir[2] * t, rP = Math.hypot(px, py, pz);
  const hKm = Math.max(rP - RB, 0), sunMu = (px * sun[0] + py * sun[1] + pz * sun[2]) / rP;
  const cosTheta = dir[0] * sun[0] + dir[1] * sun[1] + dir[2] * sun[2];
  const lit = sunMu > -Math.sqrt(Math.max(1 - (RB * RB) / (rP * rP), 0));
  if (lit) sampleTransmittance(lut, rP, sunMu, tSun); else tSun.fill(0);
  extinction(hKm, ext);
  const dr = dens[0], dm = dens[1];
  const pr = phaseRayleigh(cosTheta), pm = phaseMie(cosTheta);
  for (let c = 0; c < 3; c++) {
    const rs = RAY[c] * dr, ms = MIE_SCATTER * dm;
    scat[c] = sunLux * tSun[c] * (rs * pr + ms * pm + MULTI_SCATTER * (rs + ms) / (4 * Math.PI));
    const seg = Math.exp(-ext[c] * ds);
    m.L[c] += (m.T[c] * (scat[c] - scat[c] * seg)) / ext[c];
    m.T[c] *= seg;
  }
}

/** Distance (km) along `dir` from a point at radius r to the atmosphere top, or to the ground when the ray hits it. */
export function rayExtent(r: number, dirY: number): { t: number; ground: boolean } {
  const b = r * dirY, disc = b * b - (r * r - RB * RB);
  if (disc > 0 && dirY < 0) return { t: -b - Math.sqrt(disc), ground: true };
  return { t: -b + Math.sqrt(b * b - (r * r - RT * RT)), ground: false };
}

/** Lambertian bounce off the ground at the end of a ray (added to the marched sky). */
export function groundBounce(m: March, lut: Float32Array, sunLux: number, o: readonly number[], dir: readonly number[], sun: readonly number[], t: number): void {
  const px = o[0] + dir[0] * t, py = o[1] + dir[1] * t, pz = o[2] + dir[2] * t, rP = Math.hypot(px, py, pz);
  const mu = (px * sun[0] + py * sun[1] + pz * sun[2]) / rP;
  if (mu <= 0) return;
  sampleTransmittance(lut, rP, mu, tSun);
  for (let c = 0; c < 3; c++) m.L[c] += (m.T[c] * GROUND_ALBEDO * sunLux * tSun[c] * mu) / Math.PI;
}

export function writeHalfRgba(dst: Uint16Array, texel: number, r: number, g: number, b: number, a: number): void {
  const clamp = (v: number): number => Math.min(Math.max(v, 0), 60000);
  const o = texel * 4;
  dst[o] = toHalf(clamp(r)); dst[o + 1] = toHalf(clamp(g)); dst[o + 2] = toHalf(clamp(b)); dst[o + 3] = toHalf(a);
}

export function transmittanceToHalf(lut: Float32Array): Uint16Array {
  const out = new Uint16Array(T_W * T_H * 4);
  for (let i = 0; i < T_W * T_H; i++) writeHalfRgba(out, i, lut[i * 3], lut[i * 3 + 1], lut[i * 3 + 2], 1);
  return out;
}
