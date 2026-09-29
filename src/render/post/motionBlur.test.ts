import { describe, expect, it } from 'vitest';
import { resolveShader } from '../shaderLib';
import { MOTION_BLUR_TUNING as T, blurLengthPx, gatherOffset, maxBlurLengthPx, motionBlurDefines, shutterFraction, tileGrid } from './motionBlur';

describe('shutterFraction', () => {
  it('is exposureTime / dt, so the streak is a fixed time span whatever the frame rate', () => {
    expect(shutterFraction(1 / 60)).toBeCloseTo(60 / 400, 9);
    expect(shutterFraction(1 / 240)).toBeCloseTo(240 / 400, 9);
  });

  it('is clamped to [0, maxShutter] for very fast frames and degenerate dt', () => {
    expect(shutterFraction(1 / 1000)).toBe(T.maxShutter);
    expect(shutterFraction(0)).toBe(T.maxShutter);
    expect(shutterFraction(-1)).toBe(T.maxShutter);
    expect(shutterFraction(10)).toBeGreaterThanOrEqual(0);
    expect(shutterFraction(10)).toBeLessThan(0.01);
  });
});

describe('maxBlurLengthPx', () => {
  it('is 3 percent of the height up to 32 px', () => {
    expect(maxBlurLengthPx(720)).toBeCloseTo(21.6, 9);
    expect(maxBlurLengthPx(1080)).toBe(T.maxBlurPx);
    expect(maxBlurLengthPx(4320)).toBe(T.maxBlurPx);
  });
});

describe('blurLengthPx', () => {
  it('scales the per-frame pixel motion by the shutter fraction', () => {
    const dt = 1 / 60;
    expect(blurLengthPx(0.01, 0, 1920, 1080, dt)).toBeCloseTo(19.2 * 0.15, 9);
    expect(blurLengthPx(0, 0.02, 1920, 1080, dt)).toBeCloseTo(21.6 * 0.15, 9);
    expect(blurLengthPx(0.003, 0.004, 1000, 1000, dt)).toBeCloseTo(5 * 0.15, 9);
  });

  it('is direction independent and zero at rest', () => {
    expect(blurLengthPx(-0.01, 0, 1920, 1080, 1 / 60)).toBeCloseTo(blurLengthPx(0.01, 0, 1920, 1080, 1 / 60), 12);
    expect(blurLengthPx(0, 0, 1920, 1080, 1 / 60)).toBe(0);
  });

  it('gives the same physical streak for the same velocity at different frame rates', () => {
    const at60 = blurLengthPx(0.04, 0, 1920, 1080, 1 / 60);
    const at120 = blurLengthPx(0.02, 0, 1920, 1080, 1 / 120);
    expect(at120).toBeCloseTo(at60, 9);
  });

  it('never exceeds the cap however fast the camera moves', () => {
    expect(blurLengthPx(0.9, 0.9, 1920, 1080, 1 / 400)).toBe(maxBlurLengthPx(1080));
    expect(blurLengthPx(0.9, 0, 1280, 720, 1 / 30)).toBeCloseTo(maxBlurLengthPx(720), 9);
  });

  it('stays within two tiles, so half a streak is inside the 3x3 neighbour footprint', () => {
    expect(maxBlurLengthPx(1080)).toBeLessThanOrEqual(2 * T.tile);
  });
});

describe('tileGrid', () => {
  it('covers partial tiles at the right and bottom edge', () => {
    expect(tileGrid(1920, 1080)).toEqual({ x: 120, y: 68 });
    expect(tileGrid(17, 16)).toEqual({ x: 2, y: 1 });
    expect(tileGrid(1, 1)).toEqual({ x: 1, y: 1 });
  });
});

describe('gatherOffset', () => {
  it('stratifies the samples over [-0.5, 0.5) for any jitter in [0, 1)', () => {
    for (const jitter of [0, 0.37, 0.999]) {
      let prev = -Infinity;
      for (let i = 0; i < T.samples; i++) {
        const t = gatherOffset(i, jitter);
        expect(t).toBeGreaterThanOrEqual(-0.5);
        expect(t).toBeLessThan(0.5);
        expect(t).toBeGreaterThan(prev);
        prev = t;
      }
    }
  });

  it('is centred on the pixel on average', () => {
    let sum = 0;
    for (let i = 0; i < T.samples; i++) sum += gatherOffset(i, 0.5);
    expect(sum / T.samples).toBeCloseTo(0, 12);
  });
});

describe('motion blur shader source', () => {
  it('resolves with every define substituted and all three entry points', () => {
    const code = resolveShader('post/motionblur.wgsl', motionBlurDefines());
    expect(code).not.toContain('${');
    expect(Array.from(code.matchAll(/@compute[^\n]*\n\s*fn\s+(\w+)/g), (m) => m[1])).toEqual(['tile_max', 'neighbor_max', 'blur']);
  });
});
