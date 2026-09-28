/**
 * Per-level auxiliary fields: rock hardness, tectonic uplift and the fine-scale detail added whenever the grid is refined.
 */
import { hardnessAt, type TerrainShape } from './shape';
import { clamp01, smoothstep } from './noise';

export function hardnessGrid(n: number, cell: number, s: TerrainShape): Float32Array {
  const out = new Float32Array(n * n);
  const origin = -(n * cell) / 2;
  for (let j = 0; j < n; j++) {
    const z = origin + j * cell;
    for (let i = 0; i < n; i++) out[j * n + i] = hardnessAt(s, origin + i * cell, z);
  }
  return out;
}

/** Uplift per iteration in metres: `floor` of the peak rate everywhere, rising linearly with macro height to the full rate. */
export function upliftGrid(macro: Float32Array, relief: number, rate: number, floor: number): Float32Array {
  const out = new Float32Array(macro.length);
  const inv = 1 / (1.15 * relief);
  for (let k = 0; k < macro.length; k++) out[k] = rate * relief * (floor + (1 - floor) * clamp01(macro[k] * inv));
  return out;
}

/** Rock erodibility for stream-power incision: soft rock (hardness 0) erodes several times faster than hard rock. */
export function erodibilityGrid(hard: Float32Array, soft: number, hardest: number): Float32Array {
  const out = new Float32Array(hard.length);
  for (let k = 0; k < hard.length; k++) out[k] = soft + (hardest - soft) * hard[k];
  return out;
}

/** Repose slope (tan) per cell: loose soil at `soilTan`, hard rock holding up to `rockTan`. */
export function talusGrid(hard: Float32Array, soilTan: number, rockTan: number): Float32Array {
  const out = new Float32Array(hard.length);
  for (let k = 0; k < hard.length; k++) {
    const t = hard[k];
    out[k] = soilTan + (rockTan - soilTan) * t * t;
  }
  return out;
}

const DETAIL_OCTAVES = 2;

/**
 * Adds ridged detail for wavelengths between 4 and 8 cells, scaled by wavelength (constant slope contribution) and
 * concentrated on already steep ground, so valley floors stay smooth while mountainsides get rough.
 */
export function* addDetail(
  h: Float32Array,
  n: number,
  cell: number,
  s: TerrainShape,
  slopeGain: number,
  report: (fraction: number) => void,
): Generator<void> {
  const origin = -(n * cell) / 2;
  const [ox, oz] = s.offsets;
  const out = new Float32Array(h);
  const inv = 1 / (2 * cell);
  const sliceMask = (n >> 3) - 1;
  for (let j = 1; j < n - 1; j++) {
    if ((j & sliceMask) === 0) {
      report(j / n);
      yield;
    }
    const z = origin + j * cell;
    for (let i = 1; i < n - 1; i++) {
      const id = j * n + i;
      const gx = (h[id + 1] - h[id - 1]) * inv;
      const gz = (h[id + n] - h[id - n]) * inv;
      const rugged = 0.2 + 0.8 * smoothstep(0.08, 0.55, Math.sqrt(gx * gx + gz * gz));
      const x = origin + i * cell;
      let wavelength = 8 * cell;
      let sum = 0;
      for (let o = 0; o < DETAIL_OCTAVES; o++) {
        const f = 1 / wavelength;
        const sig = 1 - Math.abs(s.detail.simplex(x * f + ox, z * f + oz));
        sum += wavelength * (sig * sig - 0.5);
        wavelength *= 0.5;
      }
      out[id] = h[id] + slopeGain * rugged * sum;
    }
  }
  h.set(out);
}
