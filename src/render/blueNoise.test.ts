import { describe, expect, it } from 'vitest';
import { BLUE_NOISE_SIZE, generateBlueNoiseRG8, voidAndClusterRanks } from './blueNoise';

/** Mean DFT power over the non-DC bins with 0 < |f| <= maxF (cycles per image) of one channel. */
function lowFrequencyPower(values: ArrayLike<number>, size: number, maxF: number): number {
  let sum = 0;
  for (let i = 0; i < values.length; i++) sum += values[i];
  const mean = sum / (size * size);
  const cos = new Float64Array(size * (maxF + 1)), sin = new Float64Array(size * (maxF + 1));
  for (let f = 0; f <= maxF; f++) for (let i = 0; i < size; i++) { cos[f * size + i] = Math.cos((2 * Math.PI * f * i) / size); sin[f * size + i] = Math.sin((2 * Math.PI * f * i) / size); }
  let total = 0, count = 0;
  for (let fy = -maxF; fy <= maxF; fy++) for (let fx = 0; fx <= maxF; fx++) {
    const r = Math.hypot(fx, fy);
    if (r === 0 || r > maxF) continue;
    let re = 0, im = 0;
    for (let y = 0; y < size; y++) {
      const cy = cos[Math.abs(fy) * size + y], sy = Math.sign(fy) * sin[Math.abs(fy) * size + y];
      for (let x = 0; x < size; x++) {
        const v = values[y * size + x] - mean;
        const c = cos[fx * size + x] * cy - sin[fx * size + x] * sy;
        const s = sin[fx * size + x] * cy + cos[fx * size + x] * sy;
        re += v * c; im -= v * s;
      }
    }
    total += (re * re + im * im) / (size * size); count++;
  }
  return total / count;
}

describe('blue noise', () => {
  const rg = generateBlueNoiseRG8();
  const n = BLUE_NOISE_SIZE * BLUE_NOISE_SIZE;
  const ch = (c: number) => Uint8Array.from({ length: n }, (_, i) => rg[i * 2 + c]);

  it('is 128x128 rg8 and deterministic/cached', () => {
    expect(rg.length).toBe(n * 2);
    expect(generateBlueNoiseRG8()).toBe(rg);
  });

  it('has a uniform histogram (every 8-bit level equally often)', () => {
    for (let c = 0; c < 2; c++) {
      const hist = new Uint32Array(256);
      for (const v of ch(c)) hist[v]++;
      expect(Math.min(...hist)).toBe(n / 256);
      expect(Math.max(...hist)).toBe(n / 256);
    }
  });

  it('has far less low-frequency energy than white noise', () => {
    let seed = 12345;
    const white = Uint8Array.from({ length: n }, () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed >>> 24; });
    for (let c = 0; c < 2; c++) {
      const blue = lowFrequencyPower(ch(c), BLUE_NOISE_SIZE, 8);
      const w = lowFrequencyPower(white, BLUE_NOISE_SIZE, 8);
      expect(blue).toBeLessThan(w * 0.05);
    }
  });

  it('channels are decorrelated', () => {
    const a = ch(0), b = ch(1);
    let sa = 0, sb = 0, sab = 0, saa = 0, sbb = 0;
    for (let i = 0; i < n; i++) { sa += a[i]; sb += b[i]; sab += a[i] * b[i]; saa += a[i] * a[i]; sbb += b[i] * b[i]; }
    const cov = sab / n - (sa / n) * (sb / n);
    const corr = cov / Math.sqrt((saa / n - (sa / n) ** 2) * (sbb / n - (sb / n) ** 2));
    expect(Math.abs(corr)).toBeLessThan(0.05);
  });

  it('a full 128x128 rank field is generated within a startup budget', () => {
    const t0 = performance.now();
    const r = voidAndClusterRanks(BLUE_NOISE_SIZE, 99);
    expect(performance.now() - t0).toBeLessThan(2500);
    expect(new Set(r).size).toBe(n);
  }, 20000);

  it('ranks form a permutation (small size)', () => {
    const r = voidAndClusterRanks(32, 7);
    expect(new Set(r).size).toBe(32 * 32);
    expect(Math.max(...r)).toBe(32 * 32 - 1);
  });
});
