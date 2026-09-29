import { describe, expect, it } from 'vitest';
import shaderSource from '../shaders/post/bloom.wgsl?raw';
import { BLOOM_TUNING, bloomEnergy, bloomLevelSizes, bloomLevelWeights } from './bloom';

const sum = (a: readonly number[]): number => a.reduce((s, v) => s + v, 0);

describe('bloomLevelSizes', () => {
  it('halves with round-up from half resolution', () => {
    const s = bloomLevelSizes(1920, 1080);
    expect(s.map((l) => l.width)).toEqual([960, 480, 240, 120, 60, 30]);
    expect(s.map((l) => l.height)).toEqual([540, 270, 135, 68, 34, 17]);
  });

  it('covers odd sizes: every level is ceil(previous / 2)', () => {
    const s = bloomLevelSizes(1001, 333);
    expect(s[0]).toEqual({ width: 501, height: 167 });
    for (let i = 1; i < s.length; i++) {
      expect(s[i].width).toBe(Math.ceil(s[i - 1].width / 2));
      expect(s[i].height).toBe(Math.ceil(s[i - 1].height / 2));
    }
  });

  it('never yields a zero, fractional or growing level, whatever the output size', () => {
    for (const [w, h] of [[1, 1], [2, 3], [0, 0], [-5, 7], [3, 1080], [1920, 1], [0.4, 0.9], [NaN, 64]]) {
      const s = bloomLevelSizes(w, h);
      expect(s).toHaveLength(BLOOM_TUNING.levels);
      s.forEach((l, i) => {
        expect(Number.isInteger(l.width) && Number.isInteger(l.height)).toBe(true);
        expect(l.width).toBeGreaterThanOrEqual(1);
        expect(l.height).toBeGreaterThanOrEqual(1);
        if (i > 0) {
          expect(l.width).toBeLessThanOrEqual(s[i - 1].width);
          expect(l.height).toBeLessThanOrEqual(s[i - 1].height);
        }
      });
    }
  });

  it('collapses to 1x1 levels for a 1x1 output', () => {
    expect(bloomLevelSizes(1, 1).every((l) => l.width === 1 && l.height === 1)).toBe(true);
  });
});

describe('bloom energy mix', () => {
  it('tables have one entry per level and normalised distributions', () => {
    expect(BLOOM_TUNING.soft).toHaveLength(BLOOM_TUNING.levels);
    expect(BLOOM_TUNING.veil).toHaveLength(BLOOM_TUNING.levels);
    expect(sum(BLOOM_TUNING.soft)).toBeCloseTo(1, 12);
    expect(sum(BLOOM_TUNING.veil)).toBeCloseTo(1, 12);
  });

  it('level weights sum to the total scattered energy, inside the 3-8 % range', () => {
    const w = bloomLevelWeights();
    expect(w).toHaveLength(BLOOM_TUNING.levels);
    expect(sum(w)).toBeCloseTo(bloomEnergy(), 12);
    expect(bloomEnergy()).toBeGreaterThanOrEqual(0.03);
    expect(bloomEnergy()).toBeLessThanOrEqual(0.08);
    expect(w.every((v) => v > 0)).toBe(true);
  });

  it('veiling glare only lives in the wide (coarse) levels', () => {
    const T = BLOOM_TUNING;
    const firstVeil = T.veil.findIndex((v) => v > 0);
    expect(firstVeil).toBeGreaterThanOrEqual(T.levels / 2);
    for (let i = 0; i < firstVeil; i++) expect(bloomLevelWeights()[i]).toBeCloseTo(T.energy * T.soft[i], 12);
    expect(T.glare).toBeLessThan(T.energy);
  });
});

describe('bloom.wgsl kernels', () => {
  const num = (s: string): number => parseFloat(s);

  it('13-tap downsample weights sum to 1', () => {
    const m = shaderSource.match(/e \* ([\d.]+) \+ \(a \+ c \+ g \+ i\) \* ([\d.]+) \+ \(b \+ d \+ f \+ h\) \* ([\d.]+) \+ \(j \+ k \+ l \+ m\) \* ([\d.]+)/);
    expect(m).not.toBeNull();
    const [, e, corners, edges, inner] = m!.map(num);
    expect(e + 4 * corners + 4 * edges + 4 * inner).toBeCloseTo(1, 12);
  });

  it('Karis box weights sum to 1', () => {
    const base = [...shaderSource.matchAll(/let w\d = ([\d.]+) \/ \(1\.0 \+ luma\(g\d\)\)/g)].map((m) => num(m[1]));
    expect(base).toHaveLength(5);
    expect(sum(base)).toBeCloseTo(1, 12);
  });

  it('9-tap tent weights sum to 1', () => {
    const m = shaderSource.match(/corners \* ([\d.]+) \+ edges \* ([\d.]+) \+ centre \* ([\d.]+)/);
    expect(m).not.toBeNull();
    const [, corners, edges, centre] = m!.map(num);
    expect(4 * corners + 4 * edges + centre).toBeCloseTo(1, 12);
  });
});
