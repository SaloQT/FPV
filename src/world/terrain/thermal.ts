/**
 * Thermal erosion (talus creep) and soil-creep diffusion.
 * Thermal: material above the local angle of repose slides to lower neighbours, building talus fans under cliffs while
 * hard rock (large `talus`) keeps its steep faces. Creep: linear diffusion on gentle ground only, removing droplet pock marks.
 */

const SQRT2 = Math.SQRT2;

/**
 * In-place Gauss-Seidel thermal relaxation with alternating scan direction (no directional drift).
 * `talusTan` is the tangent of the repose angle per cell (falls back to `defaultTan` when null).
 */
export function* thermalErode(
  h: Float32Array,
  n: number,
  cell: number,
  talusTan: Float32Array | null,
  defaultTan: number,
  iterations: number,
  rate: number,
  report: (fraction: number) => void,
): Generator<void> {
  for (let it = 0; it < iterations; it++) {
    const forward = (it & 1) === 0;
    for (let jj = 1; jj < n - 1; jj++) {
      const j = forward ? jj : n - 1 - jj;
      const row = j * n;
      for (let ii = 1; ii < n - 1; ii++) {
        const id = row + (forward ? ii : n - 1 - ii);
        const h0 = h[id];
        const t1 = (talusTan === null ? defaultTan : talusTan[id]) * cell;
        const t2 = t1 * SQRT2;
        const e0 = h0 - h[id - 1] - t1;
        const e1 = h0 - h[id + 1] - t1;
        const e2 = h0 - h[id - n] - t1;
        const e3 = h0 - h[id + n] - t1;
        const e4 = h0 - h[id - n - 1] - t2;
        const e5 = h0 - h[id - n + 1] - t2;
        const e6 = h0 - h[id + n - 1] - t2;
        const e7 = h0 - h[id + n + 1] - t2;
        const c0 = e0 > 0 ? e0 : 0;
        const c1 = e1 > 0 ? e1 : 0;
        const c2 = e2 > 0 ? e2 : 0;
        const c3 = e3 > 0 ? e3 : 0;
        const c4 = e4 > 0 ? e4 : 0;
        const c5 = e5 > 0 ? e5 : 0;
        const c6 = e6 > 0 ? e6 : 0;
        const c7 = e7 > 0 ? e7 : 0;
        const total = c0 + c1 + c2 + c3 + c4 + c5 + c6 + c7;
        if (total <= 0) continue;
        const max = Math.max(Math.max(Math.max(c0, c1), Math.max(c2, c3)), Math.max(Math.max(c4, c5), Math.max(c6, c7)));
        const k = (rate * max) / total;
        h[id] = h0 - rate * max;
        h[id - 1] += c0 * k;
        h[id + 1] += c1 * k;
        h[id - n] += c2 * k;
        h[id + n] += c3 * k;
        h[id - n - 1] += c4 * k;
        h[id - n + 1] += c5 * k;
        h[id + n - 1] += c6 * k;
        h[id + n + 1] += c7 * k;
      }
    }
    report((it + 1) / iterations);
    yield;
  }
}

/**
 * Diffuses heights toward the 8-neighbour mean with weight `strength` on ground flatter than tan(slope) ~ `flatTan`.
 * `weight` (optional, 0..1 per cell) further scales the effect, e.g. stronger on the flat valley floor.
 */
export function* creepSmooth(
  h: Float32Array,
  n: number,
  cell: number,
  weight: Float32Array | null,
  flatTan: number,
  strength: number,
  iterations: number,
  report: (fraction: number) => void,
): Generator<void> {
  const tmp = new Float32Array(n * n);
  const inv = 1 / (2 * cell);
  const lo = flatTan * 0.5;
  const span = flatTan * 1.5;
  for (let it = 0; it < iterations; it++) {
    tmp.set(h);
    for (let j = 1; j < n - 1; j++) {
      for (let i = 1, id = j * n + 1; i < n - 1; i++, id++) {
        const gx = (h[id + 1] - h[id - 1]) * inv;
        const gz = (h[id + n] - h[id - n]) * inv;
        const s = Math.sqrt(gx * gx + gz * gz);
        let w = 1 - (s - lo) / span;
        w = w < 0 ? 0 : w > 1 ? 1 : w;
        if (weight !== null) w *= weight[id];
        if (w <= 0) continue;
        const mean =
          (h[id - 1] + h[id + 1] + h[id - n] + h[id + n] + 0.7071 * (h[id - n - 1] + h[id - n + 1] + h[id + n - 1] + h[id + n + 1])) /
          (4 + 4 * 0.7071);
        tmp[id] = h[id] + strength * w * (mean - h[id]);
      }
    }
    h.set(tmp);
    report((it + 1) / iterations);
    yield;
  }
}
