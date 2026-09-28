/** Deterministic noise sources for procedurally generated loops and one-shot sample buffers. */

/** xorshift32: tiny, fast and seedable, so generated buffers are reproducible. */
export class Rng {
  private s: number;

  constructor(seed: number) {
    this.s = (seed | 0) || 0x9e3779b9;
  }

  /** Uniform in [0, 1). */
  next(): number {
    let s = this.s;
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    this.s = s;
    return (s >>> 0) / 4294967296;
  }

  /** Uniform in [-1, 1). */
  signed(): number {
    return this.next() * 2 - 1;
  }

  range(lo: number, hi: number): number {
    return lo + (hi - lo) * this.next();
  }
}

export function fillWhite(out: Float32Array, rng: Rng): void {
  for (let i = 0; i < out.length; i++) out[i] = rng.signed();
}

/** Pink (-3 dB/octave) noise: Paul Kellet's three-pole filter over white noise. */
export function fillPink(out: Float32Array, rng: Rng): void {
  let b0 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < out.length; i++) {
    const w = rng.signed();
    b0 = 0.99765 * b0 + w * 0.099046;
    b1 = 0.963 * b1 + w * 0.2965164;
    b2 = 0.57 * b2 + w * 1.0526913;
    out[i] = b0 + b1 + b2 + w * 0.1848;
  }
}

/** Brown (-6 dB/octave) noise from a leaky integrator, the bulk of low wind rumble. */
export function fillBrown(out: Float32Array, rng: Rng): void {
  let y = 0;
  for (let i = 0; i < out.length; i++) {
    y = (y + 0.02 * rng.signed()) / 1.02;
    out[i] = y;
  }
}

/** Gravel/dry-grass crunch: sparse random grains of decaying noise; `density` is grains per second. */
export function fillCrackle(out: Float32Array, rng: Rng, sampleRate: number, density: number): void {
  const p = density / sampleRate;
  const decay = Math.exp(-1 / (0.002 * sampleRate));
  let env = 0;
  let prev = 0;
  for (let i = 0; i < out.length; i++) {
    if (rng.next() < p) env = 0.3 + 0.7 * rng.next();
    const w = rng.signed() * env;
    out[i] = w - prev * 0.6;
    prev = w;
    env *= decay;
  }
}

export function scaleToRms(out: Float32Array, target: number): void {
  let s = 0;
  for (let i = 0; i < out.length; i++) s += out[i] * out[i];
  const k = s > 0 ? target / Math.sqrt(s / out.length) : 1;
  for (let i = 0; i < out.length; i++) out[i] *= k;
}

/**
 * Turns `src` (length loop + fade) into a click-free loop of length `loop`: the head is crossfaded (equal power) with the
 * `fade` samples that follow the loop end, so the last sample runs straight into the first.
 */
export function makeLoopSeamless(src: Float32Array, fade: number): Float32Array {
  const loop = src.length - fade;
  const out = src.slice(0, loop);
  for (let i = 0; i < fade; i++) {
    const a = ((i + 0.5) / fade) * (Math.PI / 2);
    out[i] = src[i] * Math.sin(a) + src[loop + i] * Math.cos(a);
  }
  return out;
}

export type NoiseKind = 'white' | 'pink' | 'brown' | 'crackle';

/** A seamless, unit-RMS noise loop of `seconds` seconds. */
export function noiseLoop(kind: NoiseKind, sampleRate: number, seconds: number, seed: number): Float32Array {
  const fade = Math.round(0.05 * sampleRate);
  const raw = new Float32Array(Math.round(seconds * sampleRate) + fade);
  const rng = new Rng(seed);
  if (kind === 'white') fillWhite(raw, rng);
  else if (kind === 'pink') fillPink(raw, rng);
  else if (kind === 'brown') fillBrown(raw, rng);
  else fillCrackle(raw, rng, sampleRate, 90);
  const out = makeLoopSeamless(raw, fade);
  scaleToRms(out, 1);
  return out;
}
