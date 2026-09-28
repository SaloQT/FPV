/** Small n x n float-grid utilities shared by the terrain stages. */

/** Doubles resolution with separable Catmull-Rom interpolation at cell midpoints; vertex k maps to vertex 2k, edges clamp. */
export function upsample2x(src: Float32Array, n: number): Float32Array {
  const m = n * 2;
  const mid = new Float32Array(m * n);
  for (let j = 0; j < n; j++) {
    const r = j * n;
    for (let k = 0; k < n; k++) {
      const a = src[r + (k > 0 ? k - 1 : 0)];
      const b = src[r + k];
      const c = src[r + (k < n - 1 ? k + 1 : n - 1)];
      const d = src[r + (k < n - 2 ? k + 2 : n - 1)];
      mid[j * m + 2 * k] = b;
      mid[j * m + 2 * k + 1] = (-a + 9 * b + 9 * c - d) * 0.0625;
    }
  }
  const out = new Float32Array(m * m);
  for (let k = 0; k < n; k++) {
    const k0 = k > 0 ? k - 1 : 0;
    const k2 = k < n - 1 ? k + 1 : n - 1;
    const k3 = k < n - 2 ? k + 2 : n - 1;
    for (let i = 0; i < m; i++) {
      const b = mid[k * m + i];
      out[2 * k * m + i] = b;
      out[(2 * k + 1) * m + i] = (-mid[k0 * m + i] + 9 * b + 9 * mid[k2 * m + i] - mid[k3 * m + i]) * 0.0625;
    }
  }
  return out;
}

/** In-place separable box blur with edge clamping; `tmp` must be at least n*n. */
export function boxBlur(a: Float32Array, n: number, radius: number, tmp: Float32Array): void {
  if (radius < 1) return;
  const w = 2 * radius + 1;
  const inv = 1 / w;
  for (let j = 0; j < n; j++) {
    const r = j * n;
    let s = a[r] * (radius + 1);
    for (let k = 1; k <= radius; k++) s += a[r + Math.min(k, n - 1)];
    for (let i = 0; i < n; i++) {
      tmp[r + i] = s * inv;
      s += a[r + Math.min(i + radius + 1, n - 1)] - a[r + Math.max(i - radius, 0)];
    }
  }
  for (let i = 0; i < n; i++) {
    let s = tmp[i] * (radius + 1);
    for (let k = 1; k <= radius; k++) s += tmp[Math.min(k, n - 1) * n + i];
    for (let j = 0; j < n; j++) {
      a[j * n + i] = s * inv;
      s += tmp[Math.min(j + radius + 1, n - 1) * n + i] - tmp[Math.max(j - radius, 0) * n + i];
    }
  }
}

/** Copies every edge vertex from its inner neighbour (corners from the diagonal one) so the rim is never steeper than the ground inside. */
export function relaxBorder(h: Float32Array, n: number): void {
  const last = n - 1;
  for (let i = 1; i < last; i++) {
    h[i] = h[n + i];
    h[last * n + i] = h[(last - 1) * n + i];
  }
  for (let j = 1; j < last; j++) {
    h[j * n] = h[j * n + 1];
    h[j * n + last] = h[j * n + last - 1];
  }
  h[0] = h[n + 1];
  h[last] = h[n + last - 1];
  h[last * n] = h[(last - 1) * n + 1];
  h[last * n + last] = h[(last - 1) * n + last - 1];
}

/** Histogram quantile (4096 bins between min and max), exact to about range/4096. */
export function quantile(a: Float32Array, q: number): number {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < a.length; i++) {
    const v = a[i];
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (!(hi > lo)) return lo;
  const bins = 4096;
  const hist = new Uint32Array(bins);
  const scale = (bins - 1) / (hi - lo);
  for (let i = 0; i < a.length; i++) hist[((a[i] - lo) * scale) | 0]++;
  const target = q * a.length;
  let acc = 0;
  for (let b = 0; b < bins; b++) {
    acc += hist[b];
    if (acc >= target) return lo + ((b + 1) / scale);
  }
  return hi;
}

export function minMax(a: Float32Array): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < a.length; i++) {
    const v = a[i];
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return [lo, hi];
}
