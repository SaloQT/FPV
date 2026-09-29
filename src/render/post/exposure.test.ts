import { describe, expect, it } from 'vitest';
import { resolveShader } from '../shaderLib';
import {
  DAY_TOTAL_EV, EXPOSURE_TUNING as T, accumulate, adaptTotalEv, binCenterEv, binCoords, centerWeight, exposureDefines, exposureOutput,
  luminanceOf, softClipEv, targetTotalEv, trimmedMeanEv,
} from './exposure';

const KEY_EV = Math.log2(T.key);
const DAY_PRE = 1 / (4 * T.dayReferenceNits);
const binWidthEv = (T.evMax - T.evMin) / T.bins;

function histogramOf(pixels: { l: number; count: number }[]): Float64Array {
  const h = new Float64Array(T.bins);
  for (const { l, count } of pixels) for (let i = 0; i < count; i++) accumulate(h, l, 0.5, 0.5);
  return h;
}

describe('softClipEv', () => {
  it('is the identity up to the knee and monotone, saturating kneeWidth above it', () => {
    expect(softClipEv(KEY_EV + 2)).toBeCloseTo(KEY_EV + 2, 10);
    expect(softClipEv(KEY_EV + T.knee)).toBeCloseTo(KEY_EV + T.knee, 10);
    let prev = -Infinity;
    for (let ev = -14; ev < 12; ev += 0.25) {
      const c = softClipEv(ev);
      expect(c).toBeGreaterThan(prev);
      prev = c;
    }
    expect(softClipEv(60)).toBeLessThan(KEY_EV + T.knee + T.kneeWidth + 1e-9);
    expect(softClipEv(60)).toBeGreaterThan(KEY_EV + T.knee + T.kneeWidth - 1e-3);
  });
});

describe('binCoords', () => {
  it('maps a bin-centre luminance exactly onto that bin', () => {
    for (const i of [0, 7, 20, 33]) {
      const { lo, frac } = binCoords(2 ** binCenterEv(i));
      expect(lo).toBe(i);
      expect(frac).toBeCloseTo(0, 6);
    }
  });

  it('splits linearly between neighbouring bins', () => {
    const mid = binCoords(2 ** (binCenterEv(12) + binWidthEv / 4));
    expect(mid.lo).toBe(12);
    expect(mid.hi).toBe(13);
    expect(mid.frac).toBeCloseTo(0.25, 6);
  });

  it('clamps black to the first bin and compresses any highlight below the last bin', () => {
    expect(binCoords(0)).toEqual({ lo: 0, hi: 1, frac: 0 });
    const sun = binCoords(6e4);
    const absurd = binCoords(1e9);
    expect(sun.hi).toBeLessThan(T.bins - 1);
    expect(absurd.hi).toBeLessThan(T.bins - 1);
    expect(absurd.lo + absurd.frac - (sun.lo + sun.frac)).toBeLessThan(T.kneeWidth / binWidthEv);
  });
});

describe('metering weights', () => {
  it('is 1 in the centre and 1 - centerBias in the corners', () => {
    expect(centerWeight(0.5, 0.5)).toBeCloseTo(1, 10);
    expect(centerWeight(0, 0)).toBeCloseTo(1 - T.centerBias, 10);
    expect(centerWeight(1, 0)).toBeCloseTo(1 - T.centerBias, 10);
  });

  it('accumulates the full integer weight of a sample across the two bins', () => {
    const h = new Float64Array(T.bins);
    accumulate(h, 2 ** (binCenterEv(30) + 0.3 * binWidthEv), 0.5, 0.5);
    expect(h.reduce((a, b) => a + b, 0)).toBe(T.weightScale);
    expect(h[30]).toBeGreaterThan(h[31]);
    accumulate(h, 0.1, 0, 0);
    expect(h.reduce((a, b) => a + b, 0)).toBe(T.weightScale + Math.round(T.weightScale * (1 - T.centerBias)));
  });

  it('uses Rec.709 luminance', () => {
    expect(luminanceOf(1, 1, 1)).toBeCloseTo(1, 6);
    expect(luminanceOf(0, 1, 0)).toBeCloseTo(0.7152, 6);
  });
});

describe('trimmedMeanEv', () => {
  it('is null for an empty histogram and the bin centre for a single bin', () => {
    expect(trimmedMeanEv(new Float64Array(T.bins))).toBeNull();
    const h = new Float64Array(T.bins);
    h[25] = 1000;
    expect(trimmedMeanEv(h)).toBeCloseTo(binCenterEv(25), 9);
  });

  it('averages a symmetric spread around its centre', () => {
    const h = new Float64Array(T.bins);
    h[20] = 500;
    h[30] = 500;
    expect(trimmedMeanEv(h)).toBeCloseTo((binCenterEv(20) + binCenterEv(30)) / 2, 9);
  });

  it('ignores the trimmed tails, so a small hot spot does not move the metered value', () => {
    const base = histogramOf([{ l: 0.22, count: 1000 }]);
    const withSun = histogramOf([{ l: 0.22, count: 970 }, { l: 6e4, count: 30 }]);
    const flat = trimmedMeanEv(base) as number;
    expect(Math.abs((trimmedMeanEv(withSun) as number) - flat)).toBeLessThan(binWidthEv / 4);
  });

  it('bounds the pull of a large bright sky through the soft clip', () => {
    const ground = histogramOf([{ l: 0.22, count: 700 }, { l: 1e5, count: 300 }]);
    const shift = (trimmedMeanEv(ground) as number) - KEY_EV;
    expect(shift).toBeLessThan(0.3 * (T.knee + T.kneeWidth) + binWidthEv);
    expect(shift).toBeGreaterThan(0);
  });
});

describe('targetTotalEv', () => {
  it('leaves a scene metered exactly at the key untouched', () => {
    const total = targetTotalEv(KEY_EV, DAY_PRE);
    const [ratio] = exposureOutput(total, DAY_PRE, KEY_EV);
    expect(ratio).toBeCloseTo(1, 9);
  });

  it('raises exposure by the deficit and lowers it for a bright scene', () => {
    const [dark] = exposureOutput(targetTotalEv(KEY_EV - 2, DAY_PRE), DAY_PRE, KEY_EV - 2);
    const [bright] = exposureOutput(targetTotalEv(KEY_EV + 1, DAY_PRE), DAY_PRE, KEY_EV + 1);
    expect(dark).toBeCloseTo(4, 6);
    expect(bright).toBeCloseTo(0.5, 6);
  });

  it('compensates the gain fully up to maxGainEv and only overGainSlope of the excess beyond it', () => {
    const pre = 2 ** (DAY_TOTAL_EV + T.maxGainEv + 3);
    const preEv = Math.log2(pre);
    const atCap = targetTotalEv(KEY_EV + preEv - (DAY_TOTAL_EV + T.maxGainEv), pre);
    expect(atCap).toBeCloseTo(DAY_TOTAL_EV + T.maxGainEv, 9);
    const over = targetTotalEv(KEY_EV + preEv - (DAY_TOTAL_EV + T.maxGainEv + 4), pre);
    expect(over).toBeCloseTo(DAY_TOTAL_EV + T.maxGainEv + 4 * T.overGainSlope, 9);
  });

  it('keeps a moonless night visibly brighter than a proportional mapping would', () => {
    const nightPre = 1 / (4 * 0.01);
    const total = targetTotalEv(-2, nightPre);
    const [, gainEv] = exposureOutput(total, nightPre, -2);
    expect(gainEv).toBeGreaterThan(T.maxGainEv);
    expect(gainEv).toBeLessThan(Math.log2(nightPre) - DAY_TOTAL_EV);
  });

  it('limits the ratio to +-maxRatioEv and the darkening to minGainEv', () => {
    const [up] = exposureOutput(targetTotalEv(-30, DAY_PRE), DAY_PRE, -30);
    expect(up).toBeCloseTo(2 ** T.maxRatioEv, 6);
    const [down] = exposureOutput(targetTotalEv(20, DAY_PRE), DAY_PRE, 20);
    expect(down).toBeCloseTo(2 ** T.minGainEv, 6);
  });
});

describe('adaptTotalEv', () => {
  it('holds inside the dead band and follows the excess outside it', () => {
    expect(adaptTotalEv(1, 1 + T.deadbandEv * 0.9, 1)).toBe(1);
    expect(adaptTotalEv(1, 1 - T.deadbandEv * 0.9, 1)).toBe(1);
    expect(adaptTotalEv(1, 2, 100)).toBeCloseTo(1 + (1 - T.deadbandEv) * (1 - Math.exp(-T.maxDt / T.tauBrighten)), 12);
  });

  it('is exponential with dt and never overshoots the target', () => {
    let s = 0;
    for (let i = 0; i < 2000; i++) {
      const next = adaptTotalEv(s, 3, 1 / 60);
      expect(next).toBeGreaterThanOrEqual(s);
      expect(next).toBeLessThanOrEqual(3);
      s = next;
    }
    expect(Math.abs(3 - s)).toBeLessThanOrEqual(T.deadbandEv + 1e-9);
    expect(adaptTotalEv(0, 5, 1 / 30)).toBeCloseTo((5 - T.deadbandEv) * (1 - Math.exp(-1 / 30 / T.tauBrighten)), 12);
  });

  it('reacts faster to a brighter scene than to a darker one', () => {
    const toDark = adaptTotalEv(0, 4, 0.1);
    const toBright = 0 - adaptTotalEv(0, -4, 0.1);
    expect(toBright).toBeGreaterThan(toDark);
  });

  it('caps a stalled frame at maxDt', () => {
    expect(adaptTotalEv(0, 4, 5)).toBeCloseTo(adaptTotalEv(0, 4, T.maxDt), 12);
    expect(adaptTotalEv(0, 4, -1)).toBe(0);
  });

  it('does not oscillate under metering noise and a pre-exposure that keeps changing', () => {
    const sceneEv = KEY_EV - 1;
    let s = targetTotalEv(sceneEv, DAY_PRE) + 1;
    const trace: number[] = [];
    for (let i = 0; i < 900; i++) {
      const noise = 0.06 * Math.sin(i * 1.7);
      const pre = DAY_PRE * 2 ** (0.5 * Math.sin(i * 0.05));
      const meanEv = sceneEv + Math.log2(pre / DAY_PRE) + noise;
      s = adaptTotalEv(s, targetTotalEv(meanEv, pre), 1 / 60);
      if (i >= 600) trace.push(s);
    }
    expect(Math.max(...trace) - Math.min(...trace)).toBeLessThan(0.1);
  });
});

describe('exposureOutput', () => {
  it('reports the same total exposure whatever the CPU pre-exposure is', () => {
    const total = -9;
    for (const pre of [1e-5, 5e-5, 3e-3, 1]) {
      const [ratio, gain, mean, totalEv] = exposureOutput(total, pre, -1.5);
      expect(ratio * pre).toBeCloseTo(2 ** total, 12);
      expect(totalEv).toBeCloseTo(total, 9);
      expect(gain).toBeCloseTo(total - DAY_TOTAL_EV, 9);
      expect(mean).toBe(-1.5);
    }
  });
});

describe('exposure shader sources', () => {
  it('resolves with every define substituted and both entry points', () => {
    const code = resolveShader('post/histogram.wgsl', exposureDefines());
    expect(code).not.toContain('${');
    expect(Array.from(code.matchAll(/@compute[^\n]*\n\s*fn\s+(\w+)/g), (m) => m[1])).toEqual(['hist', 'reduce']);
  });
});
