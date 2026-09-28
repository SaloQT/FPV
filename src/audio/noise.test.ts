import { describe, expect, it } from 'vitest';
import { bandLevel, rms } from './analysis';
import { fillBrown, fillCrackle, fillPink, fillWhite, makeLoopSeamless, noiseLoop, Rng } from './noise';

const SR = 24000;

describe('Rng', () => {
  it('is deterministic per seed and uniform in [0, 1)', () => {
    const a = new Rng(7), b = new Rng(7), c = new Rng(8);
    let same = true, differs = false, sum = 0;
    for (let i = 0; i < 10000; i++) {
      const x = a.next();
      if (x !== b.next()) same = false;
      if (x !== c.next()) differs = true;
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
      sum += x;
    }
    expect(same).toBe(true);
    expect(differs).toBe(true);
    expect(sum / 10000).toBeCloseTo(0.5, 1);
  });

  it('a zero seed still produces a live sequence', () => {
    const r = new Rng(0);
    expect(r.next()).not.toBe(r.next());
  });
});

describe('noise colour', () => {
  const n = SR * 2;
  const white = new Float32Array(n), pink = new Float32Array(n), brown = new Float32Array(n);
  fillWhite(white, new Rng(1));
  fillPink(pink, new Rng(2));
  fillBrown(brown, new Rng(3));
  const tilt = (x: Float32Array): number => 20 * Math.log10(bandLevel(x, SR, 150, 350, 32) / bandLevel(x, SR, 3000, 5000, 32));

  it('white is flat, pink tilts about 3 dB per octave, brown about 6', () => {
    // Band centres are 250 Hz and 4 kHz: 4 octaves apart.
    expect(Math.abs(tilt(white))).toBeLessThan(2);
    expect(tilt(pink)).toBeGreaterThan(8);
    expect(tilt(pink)).toBeLessThan(16);
    expect(tilt(brown)).toBeGreaterThan(18);
    expect(tilt(brown)).toBeLessThan(30);
  });

  it('has no meaningful DC', () => {
    for (const x of [white, pink]) {
      let s = 0;
      for (let i = 0; i < x.length; i++) s += x[i];
      expect(Math.abs(s / x.length)).toBeLessThan(0.05 * rms(x));
    }
  });
});

describe('crackle', () => {
  it('is sparse: most of the energy sits in a small fraction of the samples', () => {
    const x = new Float32Array(SR * 2);
    fillCrackle(x, new Rng(5), SR, 90);
    const sq = Array.from(x, (v) => v * v).sort((a, b) => b - a);
    const total = sq.reduce((a, b) => a + b, 0);
    const top = sq.slice(0, Math.floor(sq.length * 0.1)).reduce((a, b) => a + b, 0);
    expect(top / total).toBeGreaterThan(0.6);
  });
});

describe('seamless loops', () => {
  it('the join between the last and first sample is no bigger than ordinary steps', () => {
    for (const kind of ['white', 'pink', 'brown', 'crackle'] as const) {
      const x = noiseLoop(kind, SR, 2, 11);
      expect(x.length).toBe(SR * 2);
      expect(rms(x)).toBeCloseTo(1, 5);
      let steps = 0;
      for (let i = 1; i < x.length; i++) steps += Math.abs(x[i] - x[i - 1]);
      const meanStep = steps / (x.length - 1);
      expect(Math.abs(x[0] - x[x.length - 1])).toBeLessThan(meanStep * 12);
    }
  });

  it('crossfade reproduces the source after the fade and the continuation at the seam', () => {
    const src = new Float32Array(20);
    for (let i = 0; i < 20; i++) src[i] = i;
    const out = makeLoopSeamless(src, 4);
    expect(out.length).toBe(16);
    expect(out[8]).toBe(8);
    expect(out[0]).toBeCloseTo(src[16], 0);
    expect(out[15]).toBe(15);
  });
});
