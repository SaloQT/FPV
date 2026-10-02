import { describe, expect, it } from 'vitest';
import { resolveShader } from '../shaderLib';
import {
  DAY_TOTAL_EV, EXPECTED_MEAN_EV, EXPOSURE_TUNING as T, accumulate, adaptHighlight, adaptTotalEv, binCenterEv, binCoords, centerWeight, exposureDefines,
  exposureOutput, foldSky, highlightKneeEv, highlightRoll, keyEvFor, luminanceOf, meterFrame, meteredMeanEv, nightSkyScale, nightWeight, shadeTrimWeight, skyCapLevelEv, softClipEv,
  targetTotalEv, topQuantileEv, trimmedMeanEv,
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

  it('clamps black to the first bin and any highlight to the last, leaving the compression to the mean', () => {
    expect(binCoords(0)).toEqual({ lo: 0, hi: 1, frac: 0 });
    expect(binCoords(6e4)).toEqual({ lo: T.bins - 1, hi: T.bins - 1, frac: 0 });
    expect(binCoords(1e9)).toEqual(binCoords(6e4));
    const bright = binCoords(2 ** (KEY_EV + T.knee + 1));
    expect(bright.lo + bright.frac).toBeCloseTo(((KEY_EV + T.knee + 1 - T.evMin) / binWidthEv) - 0.5, 6);
  });
});

describe('metering weights', () => {
  it('is 1 in the centre, falls by centerBias towards the corners and by vertBias from the bottom row to the top one', () => {
    const radial = 1 - T.centerBias;
    expect(centerWeight(0.5, 0.5)).toBeCloseTo(1, 10);
    expect(centerWeight(0, 1)).toBeCloseTo(radial * (1 + T.vertBias), 10);
    expect(centerWeight(1, 0)).toBeCloseTo(radial * (1 - T.vertBias), 10);
    expect(centerWeight(0.5, 0.9)).toBeGreaterThan(1.5 * centerWeight(0.5, 0.1));
    expect(centerWeight(0.5, 0.1)).toBeGreaterThan(0.5);
  });

  it('accumulates the full integer weight of a sample across the two bins', () => {
    const h = new Float64Array(T.bins);
    accumulate(h, 2 ** (binCenterEv(30) + 0.3 * binWidthEv), 0.5, 0.5);
    expect(h.reduce((a, b) => a + b, 0)).toBe(T.weightScale);
    expect(h[30]).toBeGreaterThan(h[31]);
    accumulate(h, 0.1, 0, 0);
    expect(h.reduce((a, b) => a + b, 0)).toBe(T.weightScale + Math.round(T.weightScale * centerWeight(0, 0)));
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

  it('averages the kept range only: the dark tail and the hot tail are cut by their trim shares', () => {
    const h = new Float64Array(T.bins);
    h[10] = 1000 * T.trimLow;
    h[20] = 500;
    h[30] = 1000 * (1 - T.trimLow - T.trimHigh) - 500;
    h[50] = 1000 * T.trimHigh;
    expect(trimmedMeanEv(h)).toBeCloseTo((binCenterEv(20) * 500 + binCenterEv(30) * (1000 * (1 - T.trimLow - T.trimHigh) - 500)) / (1000 * (1 - T.trimLow - T.trimHigh)), 9);
  });

  it('does not let a dark shade tail pull the metered value down: shade fraction up to trimLow is free', () => {
    const lit = histogramOf([{ l: 0.15, count: 1000 }]);
    const shaded = histogramOf([{ l: 0.15, count: 1000 * (1 - T.trimLow) }, { l: 0.01, count: 1000 * T.trimLow }]);
    expect(Math.abs((trimmedMeanEv(shaded) as number) - (trimmedMeanEv(lit) as number))).toBeLessThan(binWidthEv / 2);
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
    const skyShare = (0.3 - T.trimHigh) / (1 - T.trimLow - T.trimHigh);
    expect(shift).toBeLessThan(skyShare * (T.knee + T.kneeWidth) + binWidthEv);
    expect(shift).toBeGreaterThan(0);
  });
});

describe('shade trim by light level', () => {
  const preEvFor = (nits: number): number => EXPECTED_MEAN_EV - Math.log2(nits);

  it('is off in the dark, on from civil twilight, and smooth in between', () => {
    expect(shadeTrimWeight(preEvFor(T.trimBlendLoNits / 2))).toBe(0);
    expect(shadeTrimWeight(preEvFor(T.trimBlendHiNits * 2))).toBe(1);
    expect(shadeTrimWeight(preEvFor(5000))).toBe(1);
    let prev = 0;
    for (let nits = T.trimBlendLoNits; nits <= T.trimBlendHiNits; nits *= 1.1) {
      const w = shadeTrimWeight(preEvFor(nits));
      expect(w).toBeGreaterThanOrEqual(prev);
      expect(w - prev).toBeLessThan(0.15);
      prev = w;
    }
  });

  it('uses the night mean in the dark and the shade-trimmed mean by day, with the day mean the higher one for a shady frame', () => {
    const h = histogramOf([{ l: 0.01, count: 400 }, { l: 0.15, count: 600 }]);
    const nightPre = 1e3;
    const night = trimmedMeanEv(h, T.trimLowNight) as number;
    const day = trimmedMeanEv(h) as number;
    expect(day).toBeGreaterThan(night + 0.5);
    expect(meteredMeanEv(h, nightPre)).toBeCloseTo(night, 9);
    expect(meteredMeanEv(h, DAY_PRE)).toBeCloseTo(day, 9);
    expect(meteredMeanEv(new Float64Array(T.bins), DAY_PRE)).toBeNull();
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

  // A ground of `nits` metered at 0.25 after its own CPU pre-exposure 0.25 / nits; the scene-linear value the composite then sees is nits * 2^total.
  const groundEv = Math.log2(0.25);
  const displayed = (nits: number): number => nits * 2 ** targetTotalEv(groundEv, 0.25 / nits);

  it('lets the key fall with the metered scene luminance below keyKneeNits and not above it', () => {
    expect(displayed(4 * T.keyKneeNits)).toBeCloseTo(T.key, 6);
    expect(displayed(T.keyKneeNits)).toBeCloseTo(T.key, 6);
    expect(displayed(T.keyKneeNits / 16)).toBeCloseTo(T.key * 16 ** -T.keySlope, 6);
  });

  it('settles at the sensor-gain cap for every scene darker than a moonless-twilight ground, so a moonless night is a dark picture', () => {
    for (const nits of [6e-5, 4.6e-5, 3e-5, 1e-7]) {
      const pre = 0.25 / nits;
      const [ratio, gainEv, , totalEv] = exposureOutput(targetTotalEv(groundEv, pre), pre, groundEv);
      expect(gainEv).toBeCloseTo(T.maxGainEv, 9);
      expect(totalEv).toBeCloseTo(DAY_TOTAL_EV + T.maxGainEv, 9);
      expect(ratio * pre).toBeCloseTo(2 ** totalEv, 12);
    }
  });

  it('stays at the cap up to a ground where the flat night key is reached (about 7.6e-5 nits), then lets the exposure fall as the scene brightens', () => {
    const gain = (nits: number): number => exposureOutput(targetTotalEv(groundEv, 0.25 / nits), 0.25 / nits, groundEv)[1];
    const nightKey = T.key * 2 ** (T.keySlope * (Math.log2(T.keyNightKneeNits) - Math.log2(T.keyKneeNits)));
    const capNits = nightKey / 2 ** (DAY_TOTAL_EV + T.maxGainEv);
    expect(capNits).toBeGreaterThan(5e-5);
    expect(capNits).toBeLessThan(1e-4);
    expect(gain(capNits * 0.95)).toBeCloseTo(T.maxGainEv, 9);
    expect(gain(capNits * 1.05)).toBeLessThan(T.maxGainEv);
    expect(gain(4e-4)).toBeLessThan(T.maxGainEv - 2);
    expect(gain(1e-3)).toBeGreaterThan(gain(1e-2));
    expect(gain(1e-2)).toBeGreaterThan(gain(0.1));
  });

  it('shows a moonless ground dim but readable (code ~6), a moonlit one a little brighter, and a dusk ground below the key but above black', () => {
    expect(displayed(4.6e-5)).toBeGreaterThan(0.01);
    expect(displayed(4.6e-5)).toBeLessThan(0.02);
    expect(displayed(4.6e-5)).toBeLessThan(displayed(4.3e-4));
    expect(displayed(4.3e-4)).toBeGreaterThan(0.02);
    expect(displayed(4.3e-4)).toBeLessThan(0.035);
    expect(displayed(5)).toBeGreaterThan(0.02);
    expect(displayed(5)).toBeLessThan(T.key);
  });

  it('keeps the displayed key rising with the scene from the starlit cap up to the daylight key', () => {
    let prev = 0;
    for (const nits of [1e-6, 1e-5, 4.6e-5, 4.3e-4, 3e-3, 0.03, 0.3, 3, 30, 300, 3000]) {
      const d = displayed(nits);
      expect(d).toBeGreaterThanOrEqual(prev * 0.999);
      prev = d;
    }
  });

  it('leaves the exposure above keyNightKneeNits exactly as the single-slope key law made it', () => {
    for (const nits of [0.1, 0.5, 5, 50, 100, 5000]) {
      const meanEv = groundEv + 1.3;
      const preEv = Math.log2(0.25 / nits);
      const keyEv = Math.log2(T.key) + T.keySlope * Math.min(meanEv - preEv - Math.log2(T.keyKneeNits), 0);
      const want = Math.min(Math.max(preEv + keyEv - meanEv, DAY_TOTAL_EV + T.minGainEv), DAY_TOTAL_EV + T.maxGainEv);
      expect(targetTotalEv(meanEv, 0.25 / nits)).toBeCloseTo(want, 9);
    }
  });

  it('limits the gain to maxGainEv and the darkening to minGainEv, whatever the metered value', () => {
    const [up] = exposureOutput(targetTotalEv(-30, DAY_PRE), DAY_PRE, -30);
    expect(up).toBeCloseTo(2 ** T.maxGainEv, 6);
    const [down] = exposureOutput(targetTotalEv(20, DAY_PRE), DAY_PRE, 20);
    expect(down).toBeCloseTo(2 ** T.minGainEv, 6);
  });

  it('gives up to protectMaxEv of exposure when the brightest decile would land beyond clipEv over the key', () => {
    const noHigh = targetTotalEv(KEY_EV, DAY_PRE);
    expect(targetTotalEv(KEY_EV, DAY_PRE, KEY_EV + T.clipEv)).toBeCloseTo(noHigh, 9);
    expect(targetTotalEv(KEY_EV, DAY_PRE, KEY_EV + T.clipEv + 1)).toBeCloseTo(noHigh - 1, 9);
    expect(targetTotalEv(KEY_EV, DAY_PRE, KEY_EV + T.clipEv + 10)).toBeCloseTo(noHigh - T.protectMaxEv, 9);
  });

  it('holds the brightest 12% of a day frame at about 0.7 scene-linear whatever the shade around it', () => {
    const hist = new Float64Array(T.bins);
    for (let i = 0; i < 80; i++) accumulate(hist, 0.02, 0.5, 0.5);
    for (let i = 0; i < 20; i++) accumulate(hist, 0.8, 0.5, 0.5);
    const mean = meteredMeanEv(hist, DAY_PRE) as number;
    const high = topQuantileEv(hist) as number;
    const [ratio] = exposureOutput(targetTotalEv(mean, DAY_PRE, high), DAY_PRE, mean);
    const ceiling = T.key * 2 ** T.clipEv;
    expect(ceiling).toBeGreaterThan(0.65);
    expect(ceiling).toBeLessThan(0.75);
    expect(2 ** high * ratio).toBeCloseTo(ceiling, 1);
    expect(2 ** mean * ratio).toBeLessThan(T.key);
  });

  it('takes at most protectMaxEv from a lift, so a dark scene with a bright decile is still brightened', () => {
    const [ratio] = exposureOutput(targetTotalEv(KEY_EV - 3, DAY_PRE, KEY_EV + 3), DAY_PRE, KEY_EV - 3);
    expect(ratio).toBeCloseTo(2 ** (3 - T.protectMaxEv), 9);
  });
});

describe('night regime', () => {
  const preEvFor = (nits: number): number => Math.log2(0.25 / nits);

  it('weighs the astronomy estimate fully below nightBlendLoNits, not at all above nightBlendHiNits, and smoothly in between', () => {
    expect(nightWeight(preEvFor(T.nightBlendLoNits * 0.5))).toBe(1);
    expect(nightWeight(preEvFor(T.nightBlendLoNits))).toBeCloseTo(1, 12);
    expect(nightWeight(preEvFor(T.nightBlendHiNits))).toBeCloseTo(0, 12);
    expect(nightWeight(preEvFor(5))).toBe(0);
    let prev = 1;
    for (let l = T.nightBlendLoNits; l <= T.nightBlendHiNits; l *= 1.1) {
      const w = nightWeight(preEvFor(l));
      expect(w).toBeLessThanOrEqual(prev + 1e-12);
      prev = w;
    }
  });

  it('is derived from the CPU key: a pre-exposure of key / nits implies exactly those nits', () => {
    expect(EXPECTED_MEAN_EV).toBeCloseTo(-2, 12);
    expect(EXPECTED_MEAN_EV - preEvFor(0.01)).toBeCloseTo(Math.log2(0.01), 12);
  });

  it('ignores a dark or ordinary metered mean and the highlight protection when it is dark, and obeys them by day', () => {
    const night = 0.25 / 4e-4;
    const base = targetTotalEv(EXPECTED_MEAN_EV, night);
    for (const mean of [-12, -6, -2, EXPECTED_MEAN_EV + T.nightMarginEv]) expect(targetTotalEv(mean, night, mean + 6)).toBeCloseTo(base, 12);
    const day = 0.25 / 2000;
    expect(targetTotalEv(EXPECTED_MEAN_EV + 2, day)).toBeLessThan(targetTotalEv(EXPECTED_MEAN_EV, day) - 1);
    expect(targetTotalEv(EXPECTED_MEAN_EV, day, 8)).toBeLessThan(targetTotalEv(EXPECTED_MEAN_EV, day));
  });

  it('still lowers the exposure, one EV per EV, for a dark-estimate frame that is metered far brighter than the estimate (floodlit)', () => {
    const night = 0.25 / 4e-4;
    const base = targetTotalEv(EXPECTED_MEAN_EV, night);
    const lit = EXPECTED_MEAN_EV + T.nightMarginEv;
    expect(targetTotalEv(lit + 2, night)).toBeCloseTo(base - 2, 9);
    expect(targetTotalEv(lit + 5, night)).toBeCloseTo(base - 5, 9);
    expect(targetTotalEv(lit + 5, night)).toBeLessThan(base);
  });

  it('changes continuously with the pre-exposure through the blend range', () => {
    let prev = targetTotalEv(-4, 0.25 / 1);
    for (let l = 1; l > 1e-4; l *= 0.97) {
      const t = targetTotalEv(-4, 0.25 / l);
      expect(Math.abs(t - prev)).toBeLessThan(0.1);
      prev = t;
    }
  });

  it('has a key that is continuous at both knees and falls keySlope, then keyNightSlope, per EV of luminance', () => {
    const kneeEv = Math.log2(T.keyKneeNits), nightEv = Math.log2(T.keyNightKneeNits);
    expect(keyEvFor(kneeEv + 5)).toBeCloseTo(KEY_EV, 12);
    expect(keyEvFor(kneeEv)).toBeCloseTo(KEY_EV, 12);
    expect(keyEvFor(kneeEv - 1)).toBeCloseTo(KEY_EV - T.keySlope, 12);
    expect(keyEvFor(nightEv) - keyEvFor(nightEv - 4)).toBeCloseTo(4 * T.keyNightSlope, 12);
    expect(keyEvFor(nightEv + 1) - keyEvFor(nightEv)).toBeCloseTo(T.keySlope, 12);
  });
});

describe('topQuantileEv', () => {
  it('is null for an empty histogram and finds the bin the brightest decile starts in', () => {
    expect(topQuantileEv(new Float64Array(T.bins))).toBeNull();
    const h = histogramOf([{ l: 0.22, count: 850 }, { l: 2, count: 150 }]);
    expect(Math.abs((topQuantileEv(h) as number) - 1)).toBeLessThan(binWidthEv / 2);
  });

  it('moves continuously with the share of bright pixels instead of hopping a bin at a time', () => {
    const want = Math.ceil(T.clipFrac * 1000);
    let prev = topQuantileEv(histogramOf([{ l: 0.22, count: 1000 - 2 * want }, { l: 2, count: 2 * want }])) as number;
    let biggest = 0;
    for (let bright = 2 * want - 1; bright >= want; bright -= 11) {
      const q = topQuantileEv(histogramOf([{ l: 0.22, count: 1000 - bright }, { l: 2, count: bright }])) as number;
      biggest = Math.max(biggest, Math.abs(q - prev));
      expect(q).toBeLessThanOrEqual(prev + 1e-9);
      prev = q;
    }
    expect(biggest).toBeLessThan(binWidthEv / 2);
  });

  it('ignores a hot spot smaller than the fraction', () => {
    const h = histogramOf([{ l: 0.22, count: 970 }, { l: 6e4, count: 30 }]);
    expect(Math.abs((topQuantileEv(h) as number) - KEY_EV)).toBeLessThan(binWidthEv);
    const top = topQuantileEv(h, 0.01) as number;
    expect(top).toBeGreaterThan(binCenterEv(T.bins - 1) - binWidthEv / 2);
    expect(top).toBeLessThan(binCenterEv(T.bins - 1) + binWidthEv / 2);
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

  it('carries the night blend and the night key slope into the shader', () => {
    const d = exposureDefines();
    expect(d.NIGHT_SLOPE).toBe(T.keyNightSlope);
    expect(d.NIGHT_KNEE_EV).toBeCloseTo(Math.log2(T.keyNightKneeNits), 12);
    expect(d.NIGHT_BLEND_HI_EV).toBeCloseTo(Math.log2(T.nightBlendHiNits), 12);
    expect(d.NIGHT_BLEND_LO_EV).toBeCloseTo(Math.log2(T.nightBlendLoNits), 12);
    expect(d.EXPECTED_MEAN_EV).toBeCloseTo(-2, 12);
    expect(d.NIGHT_MARGIN_EV).toBe(T.nightMarginEv);
    expect(d.MAX_GAIN_EV).toBe(T.maxGainEv);
  });
});

describe('nightSkyScale', () => {
  const preFor = (nits: number): number => 0.25 / nits;

  it('is exactly 1 at every light level where the camera runs at or below skyHoldGainEv: day, dusk, twilight and a quarter moon', () => {
    for (const nits of [5000, 300, 5, 0.3, 0.03, 3e-3, 1e-3, 5e-4]) expect(nightSkyScale(preFor(nits))).toBe(1);
  });

  it('falls by one stop per EV of gain above skyHoldGainEv and settles at the gain cap on a moonless night', () => {
    const cap = 2 ** -(T.maxGainEv - T.skyHoldGainEv);
    for (const nits of [7e-5, 4.6e-5, 3e-5, 1e-7]) expect(nightSkyScale(preFor(nits))).toBeCloseTo(cap, 12);
    expect(nightSkyScale(preFor(2e-4))).toBeCloseTo(2 ** -(Math.log2(0.0277 / 2e-4) - DAY_TOTAL_EV - T.skyHoldGainEv), 2);
    let prev = 1;
    for (const nits of [5e-4, 3e-4, 2e-4, 1.5e-4, 1e-4, 7e-5, 3e-5]) {
      const k = nightSkyScale(preFor(nits));
      expect(k).toBeLessThanOrEqual(prev);
      prev = k;
    }
  });

  it('leaves the sky at the scene-linear level the exposure at skyHoldGainEv gave, so only the ground gains the extra EV', () => {
    for (const nits of [4.6e-5, 1e-4, 2e-4]) {
      const pre = preFor(nits);
      const total = targetTotalEv(EXPECTED_MEAN_EV, pre);
      expect(nightSkyScale(pre) * 2 ** total).toBeCloseTo(2 ** (DAY_TOTAL_EV + T.skyHoldGainEv), 9);
    }
  });

  it('leaves day, dusk, twilight and quarter-moon exposures independent of maxGainEv: they all sit under skyHoldGainEv', () => {
    for (const nits of [5000, 300, 5, 0.3, 0.03, 3e-3, 1e-3, 5e-4]) {
      expect(targetTotalEv(EXPECTED_MEAN_EV, preFor(nits)) - DAY_TOTAL_EV).toBeLessThan(T.skyHoldGainEv);
    }
  });

  it('never raises the sky (the gain cap is above the hold level) and keeps the hold level below the cap', () => {
    expect(T.skyHoldGainEv).toBeLessThan(T.maxGainEv);
    for (const nits of [1e-8, 3e-5, 1e-3, 1, 1e4]) expect(nightSkyScale(preFor(nits))).toBeLessThanOrEqual(1);
  });
});

describe('night exposure mirror in sky/night_light.wgsl', () => {
  const src = resolveShader('sky/night_light.wgsl', {});
  const c = (name: string): number => Number(src.match(new RegExp(`const ${name}\\s*:\\s*f32\\s*=\\s*([^;]+);`))?.[1]);

  it('carries the same key law and gain cap as the exposure stage', () => {
    expect(c('EXPOSURE_LOG2_KEY')).toBeCloseTo(KEY_EV, 9);
    expect(c('EXPOSURE_KEY_KNEE_EV')).toBeCloseTo(Math.log2(T.keyKneeNits), 9);
    expect(c('EXPOSURE_KEY_SLOPE')).toBe(T.keySlope);
    expect(c('EXPOSURE_NIGHT_KNEE_EV')).toBeCloseTo(Math.log2(T.keyNightKneeNits), 9);
    expect(c('EXPOSURE_NIGHT_SLOPE')).toBe(T.keyNightSlope);
    expect(c('EXPOSURE_MAX_TOTAL_EV')).toBeCloseTo(DAY_TOTAL_EV + T.skyHoldGainEv, 3);
    expect(c('EXPOSURE_CPU_KEY_EV')).toBeCloseTo(EXPECTED_MEAN_EV, 12);
  });

  it('computes, from the pre-exposure alone, the exposure sky pixels settle on (the stage total, held at the sky-hold gain) for a scene metered at the CPU estimate', () => {
    const mirror = (pre: number): number => {
      const lumEv = c('EXPOSURE_CPU_KEY_EV') - Math.log2(pre);
      const keyEv = c('EXPOSURE_LOG2_KEY') + c('EXPOSURE_KEY_SLOPE') * Math.min(lumEv - c('EXPOSURE_KEY_KNEE_EV'), 0)
        + (c('EXPOSURE_NIGHT_SLOPE') - c('EXPOSURE_KEY_SLOPE')) * Math.min(lumEv - c('EXPOSURE_NIGHT_KNEE_EV'), 0);
      return 2 ** Math.min(keyEv - lumEv, c('EXPOSURE_MAX_TOTAL_EV'));
    };
    for (let pre = 1e-5; pre <= 1e3; pre *= 1.7) expect(Math.log2(mirror(pre))).toBeCloseTo(Math.min(targetTotalEv(EXPECTED_MEAN_EV, pre), DAY_TOTAL_EV + T.skyHoldGainEv), 2);
  });
});

describe('daylight scenes (pre-exposed luminance, grey card = 0.25, grass of albedo 0.09 = 0.125)', () => {
  const W = 96, H = 54;
  type Pixel = (u: number, v: number, r: number) => number;
  const scene = (pixel: Pixel, pre: number, scale = 1): { ratioEv: number; at: (lum: number) => number } => {
    const h = new Float64Array(T.bins);
    let seed = 99;
    const rnd = (): number => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) accumulate(h, pixel((i + 0.5) / W, (j + 0.5) / H, rnd()) * scale, (i + 0.5) / W, (j + 0.5) / H);
    const total = targetTotalEv(meteredMeanEv(h, pre) as number, pre, topQuantileEv(h) as number);
    const ratioEv = total - Math.log2(pre);
    return { ratioEv, at: (lum) => lum * scale * 2 ** ratioEv };
  };
  // Scene-linear value of the displayed key colours: 0.2 is display code ~110, 0.36 code ~150, 0.02 code ~25.
  const sunnyForest: Pixel = (u, v, r) => (v < 0.35 ? 0.1 + 0.12 * v / 0.35 : r < 0.45 ? 0.025 : r < 0.7 ? 0.1 : 0.125);
  const denseForest: Pixel = (u, v, r) => (v < 0.12 ? 0.15 : r < 0.6 ? 0.025 : 0.1);
  const meadow: Pixel = (u, v, r) => (v < 0.5 ? 0.1 + 0.12 * v / 0.5 : r < 0.2 ? 0.045 : 0.125);

  it('keeps sunlit grass at a mid display level in a forest or meadow frame instead of washing it out (it used to land near code 200)', () => {
    for (const p of [sunnyForest, meadow]) {
      const s = scene(p, DAY_PRE);
      expect(s.at(0.125)).toBeGreaterThan(0.18);
      expect(s.at(0.125)).toBeLessThan(0.38);
    }
  });

  it('opens the camera for a forest that is 60% shade, but not so far that the sunlit grass passes display code ~175', () => {
    const s = scene(denseForest, DAY_PRE);
    expect(s.ratioEv).toBeGreaterThan(scene(sunnyForest, DAY_PRE).ratioEv);
    expect(s.at(0.1)).toBeLessThan(0.5);
  });

  it('keeps the shade readable: a forest shade pixel ends above scene-linear 0.02 (code ~25)', () => {
    expect(scene(sunnyForest, DAY_PRE).at(0.025)).toBeGreaterThan(0.02);
    expect(scene(denseForest, DAY_PRE).at(0.025)).toBeGreaterThan(0.02);
  });

  it('still brightens an overcast frame (all light 2.5 EV down) until the grass is back at a mid level', () => {
    for (const p of [sunnyForest, meadow]) {
      const s = scene(p, DAY_PRE, 2 ** -2.5);
      expect(s.ratioEv).toBeGreaterThan(1.5);
      expect(s.at(0.125)).toBeGreaterThan(0.18);
      expect(s.at(0.125)).toBeLessThan(0.38);
    }
  });

  it('puts the sky of a clear day between the grass level and the highlight ceiling: it never lands above scene-linear 0.9', () => {
    const s = scene(meadow, DAY_PRE);
    expect(s.at(0.22)).toBeLessThan(0.9);
    expect(s.at(0.22)).toBeGreaterThan(s.at(0.125));
  });

  it('lowers the exposure for a very bright sky near a low sun instead of clipping it', () => {
    const sunset: Pixel = (u, v, r) => (v < 0.45 ? 0.7 + 3 * Math.max(0, 1 - Math.abs(u - 0.5) * 3) * r : 0.125 * (r < 0.3 ? 0.4 : 1));
    const s = scene(sunset, DAY_PRE);
    expect(s.ratioEv).toBeLessThan(-0.3);
    expect(s.at(0.7)).toBeLessThan(0.6);
  });
});

describe('sky and ground metering', () => {
  const frame = (groundEv: number, skyEv: number, groundCount: number, skyCount: number): { ground: Float64Array; sky: Float64Array } => {
    const ground = new Float64Array(T.bins), sky = new Float64Array(T.bins);
    for (let i = 0; i < groundCount; i++) accumulate(ground, 2 ** groundEv, 0.5, 0.5);
    for (let i = 0; i < skyCount; i++) accumulate(sky, 2 ** skyEv, 0.5, 0.5);
    return { ground, sky };
  };
  const sum = (h: ArrayLike<number>): number => Array.from({ length: T.bins }, (_, i) => h[i]).reduce((a, b) => a + b, 0);
  const DAY = DAY_PRE;

  it('folds the sky above the cap onto it, keeps every other bin and conserves the weight', () => {
    const { ground, sky } = frame(-5, 3, 40, 30);
    for (let i = 0; i < 25; i++) accumulate(sky, 2 ** -7, 0.5, 0.5);
    const out = new Float64Array(T.bins);
    foldSky(ground, sky, -1, out);
    expect(sum(out)).toBeCloseTo(sum(ground) + sum(sky), 9);
    let above = 0, aboveEv = 0;
    for (let i = 0; i < T.bins; i++) if (binCenterEv(i) > -1 + 1e-9 && out[i] !== ground[i] + sky[i]) { above += out[i]; aboveEv += out[i] * binCenterEv(i); }
    const lo = Math.floor(((-7 - T.evMin) / (T.evMax - T.evMin)) * T.bins);
    expect(out[lo] + out[lo + 1]).toBeCloseTo(ground[lo] + ground[lo + 1] + sky[lo] + sky[lo + 1], 9);
    expect(aboveEv / Math.max(above, 1)).toBeLessThan(-0.5);
    expect(topQuantileEv(out, 0.3) as number).toBeLessThan(-0.6);
    foldSky(ground, sky, 50, out);
    for (let i = 0; i < T.bins; i++) expect(out[i]).toBe(ground[i] + sky[i]);
  });

  it('keeps the metered value moving smoothly with the cap level instead of hopping a bin at a time', () => {
    const { ground, sky } = frame(-5, 3, 60, 40);
    const a = new Float64Array(T.bins), b = new Float64Array(T.bins);
    let prev = trimmedMeanEv(ground.map((v, i) => v + sky[i]), 0.05) as number;
    for (let cap = -2; cap <= -1; cap += binWidthEv / 8) {
      foldSky(ground, sky, cap, a);
      const m = trimmedMeanEv(a, 0.05) as number;
      if (cap > -2) {
        expect(m).toBeGreaterThanOrEqual(prev - 1e-12);
        expect(m - prev).toBeLessThan(0.08);
      }
      prev = m;
    }
    foldSky(ground, sky, -1.3, a);
    foldSky(ground, sky, -1.3 + binWidthEv, b);
    expect((trimmedMeanEv(b, 0.05) as number) - (trimmedMeanEv(a, 0.05) as number)).toBeGreaterThan(0);
  });

  it('puts the cap skyCapEv over the ground mean, and lifts it away as the ground share falls below skyGroundHi', () => {
    const full = frame(-4, 0, 70, 30);
    const groundMean = meteredMeanEv(full.ground, DAY) as number;
    expect(skyCapLevelEv(full.ground, full.sky, DAY)).toBeCloseTo(groundMean + T.skyCapEv, 9);
    let prev = Infinity;
    for (const g of [0.2, 0.12, 0.1, 0.07, 0.04, 0.03, 0.01]) {
      const f = frame(-4, 0, Math.round(g * 1000), Math.round((1 - g) * 1000));
      const cap = skyCapLevelEv(f.ground, f.sky, DAY);
      expect(cap).toBeGreaterThanOrEqual(prev === Infinity ? -Infinity : prev - 1e-9);
      prev = cap;
    }
    expect(prev).toBeGreaterThan(30);
    expect(skyCapLevelEv(new Float64Array(T.bins), full.sky, DAY)).toBeGreaterThan(30);
  });

  it('meters a daylight frame exactly as one histogram of everything: the sky 1.5 EV over the grass is under the cap', () => {
    const f = frame(-3, -1.5, 650, 350);
    const all = f.ground.map((v, i) => v + f.sky[i]);
    const m = meterFrame(f.ground, f.sky, DAY) as { meanEv: number; highEv: number };
    expect(m.meanEv).toBeCloseTo(meteredMeanEv(all, DAY) as number, 9);
    expect(m.highEv).toBeCloseTo(topQuantileEv(all) as number, 9);
  });

  it('lets the ground set the exposure at dusk: a sky 6 EV over the ground opens the camera, a frame that is all sky is still metered', () => {
    const dusk = frame(-5, 1, 650, 350);
    const all = dusk.ground.map((v, i) => v + dusk.sky[i]);
    const pre = 6e-4;
    const m = meterFrame(dusk.ground, dusk.sky, pre) as { meanEv: number; highEv: number };
    const old = targetTotalEv(meteredMeanEv(all, pre) as number, pre, topQuantileEv(all) as number);
    const now = targetTotalEv(m.meanEv, pre, m.highEv);
    expect(now - old).toBeGreaterThan(1.2);
    expect(m.highEv).toBeLessThan(topQuantileEv(all) as number);
    const up = frame(-5, 1, 5, 995);
    const upAll = up.ground.map((v, i) => v + up.sky[i]);
    const mu = meterFrame(up.ground, up.sky, pre) as { meanEv: number; highEv: number };
    expect(mu.meanEv).toBeCloseTo(meteredMeanEv(upAll, pre) as number, 9);
    expect(mu.highEv).toBeCloseTo(topQuantileEv(upAll) as number, 9);
  });

  it('holds the grass of a real dusk frame (sun 5 degrees up: grass 0.03, shade 0.015, sky 0.6 pre-exposed) near display code 60 instead of 30', () => {
    const pre = 6.7e-4;
    const ground = new Float64Array(T.bins), sky = new Float64Array(T.bins);
    for (let j = 0; j < 40; j++) for (let i = 0; i < 64; i++) {
      const u = (i + 0.5) / 64, v = (j + 0.5) / 40;
      accumulate(ground, (i * 7 + j * 3) % 10 < 3 ? 0.015 : 0.03, u, v * 0.4 + 0.6);
    }
    for (let j = 0; j < 20; j++) for (let i = 0; i < 64; i++) accumulate(sky, 0.5 + 0.2 * Math.sin(i), (i + 0.5) / 64, j / 40);
    const all = ground.map((v, i) => v + sky[i]);
    const ratioOf = (mean: number, high: number): number => 2 ** (targetTotalEv(mean, pre, high) - Math.log2(pre));
    const m = meterFrame(ground, sky, pre) as { meanEv: number; highEv: number };
    const now = ratioOf(m.meanEv, m.highEv);
    const old = ratioOf(meteredMeanEv(all, pre) as number, topQuantileEv(all) as number);
    expect(now / old).toBeGreaterThan(2);
    expect(0.03 * now).toBeGreaterThan(0.07);
    expect(0.03 * now).toBeLessThan(0.2);
  });

  it('reports no frame for empty histograms', () => {
    expect(meterFrame(new Float64Array(T.bins), new Float64Array(T.bins), DAY)).toBeNull();
  });
});

describe('highlight knee', () => {
  const frame = (groundCount: number, skyCount: number): { ground: Float64Array; sky: Float64Array } => {
    const ground = new Float64Array(T.bins), sky = new Float64Array(T.bins);
    for (let i = 0; i < groundCount; i++) accumulate(ground, 2 ** -4, 0.5, 0.5);
    for (let i = 0; i < skyCount; i++) accumulate(sky, 2 ** 1, 0.5, 0.5);
    return { ground, sky };
  };

  it('sits hlKneeEv over the ground mean by day', () => {
    const f = frame(700, 300);
    expect(highlightKneeEv(f.ground, f.sky, DAY_PRE)).toBeCloseTo((meteredMeanEv(f.ground, DAY_PRE) as number) + T.hlKneeEv, 9);
  });

  it('is off with the camera looking up and in the dark, where the sky is the picture', () => {
    const up = frame(5, 995);
    expect(highlightKneeEv(up.ground, up.sky, DAY_PRE)).toBeGreaterThan(30);
    const f = frame(700, 300);
    expect(highlightKneeEv(f.ground, f.sky, 250)).toBeGreaterThan(30);
    expect(highlightKneeEv(f.ground, f.sky, 1e3)).toBeGreaterThan(30);
  });

  it('applies the roll-off with the sky-over-ground gap: none in daylight, full at dusk, monotone between', () => {
    const at = (gapEv: number, skyCount = 300): number => {
      const f = frame(700, skyCount);
      const sky = new Float64Array(T.bins);
      for (let i = 0; i < skyCount; i++) accumulate(sky, 2 ** (-4 + gapEv), 0.5, 0.5);
      return highlightRoll(f.ground, sky, DAY_PRE);
    };
    const groundMean = meteredMeanEv(frame(700, 0).ground, DAY_PRE) as number;
    expect(groundMean).toBeCloseTo(-4, 0);
    expect(at(1.5)).toBe(0);
    expect(at(T.hlGapHi + 1.2)).toBe(1);
    let prev = -1;
    for (let g = 1; g <= 7; g += 0.25) {
      const r = at(g);
      expect(r).toBeGreaterThanOrEqual(prev);
      prev = r;
    }
    expect(at(0, 0)).toBe(0);
  });

  it('uses the sky median, so a bright patch of the sky does not switch it on', () => {
    const f = frame(700, 0);
    const sky = new Float64Array(T.bins);
    for (let i = 0; i < 280; i++) accumulate(sky, 2 ** -3, 0.5, 0.5);
    for (let i = 0; i < 20; i++) accumulate(sky, 2 ** 3, 0.5, 0.5);
    expect(highlightRoll(f.ground, sky, DAY_PRE)).toBe(0);
    expect(highlightRoll(new Float64Array(T.bins), sky, DAY_PRE)).toBe(0);
  });

  it('smooths in EV with an exponential that cannot overshoot and a capped dt', () => {
    expect(adaptHighlight(2, 2, 0.1)).toBe(2);
    expect(adaptHighlight(0, 4, 0.2)).toBeCloseTo(4 * (1 - Math.exp(-0.2 / T.hlTau)), 9);
    expect(adaptHighlight(0, 4, 1e3)).toBeCloseTo(adaptHighlight(0, 4, T.maxDt), 12);
    expect(adaptHighlight(0, 4, -1)).toBe(0);
    expect(adaptHighlight(40, 3, 0.2)).toBeGreaterThan(3);
  });
});

describe('exposure shader depth split', () => {
  it('bins ground and sky apart by the G-buffer depth, 128 bins in all', () => {
    const code = resolveShader('post/histogram.wgsl', exposureDefines());
    expect(code).toContain('texture_depth_2d');
    expect(code).toContain('array<atomic<u32>, 128>');
    expect(code).toContain('textureLoad(depthTex');
    expect(code).toContain('array<f32, 8>');
    const d = exposureDefines();
    expect(d.SKY_CAP_EV).toBe(T.skyCapEv);
    expect(d.HL_KNEE_EV).toBe(T.hlKneeEv);
    expect(d.SKY_GROUND_LO).toBe(T.skyGroundLo);
  });
});
