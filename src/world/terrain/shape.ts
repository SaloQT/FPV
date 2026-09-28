/**
 * Large-scale terrain layout: a meandering valley corridor through the map centre flanked by domain-warped ridged
 * mountains and rolling hills. Feature wavelengths scale with the map extent, so every quality level looks alike.
 */
import { Noise2D, Rng, clamp01, smoothstep } from './noise';

export interface TerrainShape {
  readonly extent: number;
  readonly relief: number;
  readonly warp: Noise2D;
  readonly ridge: Noise2D;
  readonly hill: Noise2D;
  readonly mask: Noise2D;
  readonly hard: Noise2D;
  readonly detail: Noise2D;
  readonly meander: readonly number[];
  readonly offsets: readonly number[];
}

export function createShape(seed: number, extent: number, relief: number): TerrainShape {
  const r = new Rng(seed, 7919);
  return {
    extent,
    relief,
    warp: new Noise2D(seed, 1),
    ridge: new Noise2D(seed, 2),
    hill: new Noise2D(seed, 3),
    mask: new Noise2D(seed, 4),
    hard: new Noise2D(seed, 5),
    detail: new Noise2D(seed, 6),
    meander: [r.range(0.055, 0.085), r.range(0.8, 1.25), r.range(0, 6.283), r.range(0.018, 0.03), r.range(2.3, 3.4), r.range(0, 6.283)],
    offsets: [r.range(-50, 50), r.range(-50, 50), r.range(-50, 50), r.range(-50, 50)],
  };
}

/** World x of the valley centreline at world z. */
function centerlineX(s: TerrainShape, z: number): number {
  const m = s.meander;
  const w = (2 * Math.PI * z) / s.extent;
  return s.extent * (m[0] * (Math.sin(w * m[1] + m[2]) - Math.sin(m[2])) + m[3] * (Math.sin(w * m[4] + m[5]) - Math.sin(m[5])));
}

/** dx/dz of the centreline. */
function centerlineSlope(s: TerrainShape, z: number): number {
  const m = s.meander;
  const w = (2 * Math.PI * z) / s.extent;
  const k = 2 * Math.PI;
  return m[0] * k * m[1] * Math.cos(w * m[1] + m[2]) + m[3] * k * m[4] * Math.cos(w * m[4] + m[5]);
}

/** Rock-hardness field in 0..1 (drives erodibility and talus angle); wavelength ~ extent/6. */
export function hardnessAt(s: TerrainShape, x: number, z: number): number {
  const f = 6 / s.extent;
  return clamp01(0.5 + 0.55 * s.hard.simplex(x * f + 3.1, z * f - 1.7) + 0.25 * s.hard.simplex(x * f * 2.7, z * f * 2.7));
}

/**
 * Macro height in metres (before erosion and before normalisation, roughly 0..1.3*relief) for every vertex of an
 * n x n grid, using only octaves whose wavelength is at least `minWavelength`.
 */
export function fillMacroHeight(out: Float32Array, n: number, cell: number, s: TerrainShape, minWavelength: number): void {
  const E = s.extent;
  const R = s.relief;
  const origin = -(n * cell) / 2;
  const lamM = E / 3;
  const octaves = Math.max(1, Math.min(8, Math.floor(Math.log2(lamM / minWavelength)) + 1));
  const hillOct = Math.max(1, Math.min(4, Math.floor(Math.log2(E / 8 / minWavelength)) + 1));
  const [ox, oz, ox2, oz2] = s.offsets;
  for (let j = 0; j < n; j++) {
    const z = origin + j * cell;
    const cx = centerlineX(s, z);
    const sl = centerlineSlope(s, z);
    const inv = 1 / (E * Math.sqrt(1 + sl * sl));
    const tilt = R * 0.05 * (0.5 + z / E);
    for (let i = 0; i < n; i++) {
      const x = origin + i * cell;
      const d = Math.abs(x - cx) * inv;
      const wall = smoothstep(0.04, 0.32, d);
      const far = smoothstep(0.32, 0.72, d);

      const bw = 0.7 / E;
      const wx = x + 0.09 * E * s.warp.simplex(x * bw + ox, z * bw + oz);
      const wz = z + 0.09 * E * s.warp.simplex(x * bw + ox2, z * bw + oz2);
      const mw = 6.5 / E;
      const px = wx + 0.045 * E * s.warp.simplex(wx * mw + 7.3, wz * mw + 2.1);
      const pz = wz + 0.045 * E * s.warp.simplex(wx * mw - 4.9, wz * mw + 9.7);

      let f = 1 / lamM;
      let amp = 1;
      let weight = 1;
      let sum = 0;
      let norm = 0;
      for (let o = 0; o < octaves; o++) {
        let sig = 1 - Math.abs(s.ridge.simplex(px * f + ox, pz * f + oz));
        sig *= sig * weight;
        weight = clamp01(sig * 2);
        sum += sig * amp;
        norm += amp;
        amp *= 0.5;
        f *= 2;
      }
      const ridged = sum / norm;

      let hf = 1 / (E / 8);
      let ha = 1;
      let hs = 0;
      let hn = 0;
      for (let o = 0; o < hillOct; o++) {
        hs += ha * s.hill.simplex(px * hf + oz, pz * hf + ox);
        hn += ha;
        ha *= 0.5;
        hf *= 2;
      }
      const hills = 0.5 + 0.5 * (hs / hn);

      const mf = 1.8 / E;
      const mask = smoothstep(-0.3, 0.4, s.mask.simplex(x * mf + ox2, z * mf + oz2));

      const rise = 0.55 * wall + 0.2 * far;
      out[j * n + i] = R * (rise + 0.42 * ridged * Math.pow(wall, 0.8) * (0.45 + 0.55 * mask) + 0.1 * hills * (0.35 + 0.65 * wall)) + tilt;
    }
  }
}
