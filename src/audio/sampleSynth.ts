/** Pure renderers for the one-shot impact samples: modal ringing, noise bursts and thuds mixed into Float32Arrays. */
import { TWO_PI } from './dsp';
import { Rng } from './noise';

export interface Mode {
  freq: number;
  /** Time in seconds for the ring to fall 60 dB. */
  t60: number;
  amp: number;
}

/** Carbon plate (arm/frame) ringing, from a tap test of a 3 mm plate: three dominant modes. */
export const CARBON_PLATE_MODES: readonly Mode[] = [
  { freq: 1200, t60: 0.3, amp: 0.5 },
  { freq: 2900, t60: 0.16, amp: 0.35 },
  { freq: 5100, t60: 0.09, amp: 0.25 },
];

/** Adds decaying sinusoids that start at `start` seconds; `detune` scales every mode frequency. */
export function addModalRing(out: Float32Array, sampleRate: number, modes: readonly Mode[], start: number, gain: number, detune = 1): void {
  const s0 = Math.round(start * sampleRate);
  for (const m of modes) {
    const w = (TWO_PI * m.freq * detune) / sampleRate;
    const decay = Math.exp(-6.9078 / (m.t60 * sampleRate));
    const a0 = m.amp * gain;
    let env = a0;
    for (let i = s0; i < out.length && env > 1e-5; i++) {
      out[i] += env * Math.sin(w * (i - s0));
      env *= decay;
    }
  }
}

/** Adds a high-passed (first difference) noise burst with exponential decay `tau` seconds: the contact click. */
export function addClick(out: Float32Array, sampleRate: number, rng: Rng, start: number, tau: number, gain: number): void {
  const s0 = Math.round(start * sampleRate);
  const decay = Math.exp(-1 / (tau * sampleRate));
  let env = gain;
  let prev = 0;
  for (let i = s0; i < out.length && env > 1e-5; i++) {
    const w = rng.signed();
    out[i] += (w - prev) * 0.5 * env;
    prev = w;
    env *= decay;
  }
}

/** Adds a low-passed noise burst (one-pole at `cutoff` Hz) with decay `tau`: body thump and crunch. */
export function addSoftBurst(out: Float32Array, sampleRate: number, rng: Rng, start: number, tau: number, cutoff: number, gain: number): void {
  const s0 = Math.round(start * sampleRate);
  const decay = Math.exp(-1 / (tau * sampleRate));
  const a = 1 - Math.exp((-TWO_PI * cutoff) / sampleRate);
  const makeup = Math.sqrt((2 - a) / a) * 0.6;
  let env = gain;
  let y = 0;
  for (let i = s0; i < out.length && env > 1e-5; i++) {
    y += a * (rng.signed() - y);
    out[i] += y * makeup * env;
    env *= decay;
  }
}

/** Adds a sine that falls exponentially from f0 to f1 while its level decays with `tau`: the frame's low thud. */
export function addThud(out: Float32Array, sampleRate: number, start: number, f0: number, f1: number, tau: number, gain: number): void {
  const s0 = Math.round(start * sampleRate);
  const decay = Math.exp(-1 / (tau * sampleRate));
  const sweep = Math.exp(Math.log(f1 / f0) / (tau * 3 * sampleRate));
  let f = f0;
  let phase = 0;
  let env = gain;
  for (let i = s0; i < out.length && env > 1e-5; i++) {
    out[i] += env * Math.sin(phase);
    phase += (TWO_PI * f) / sampleRate;
    if (f > f1) f *= sweep;
    env *= decay;
  }
}

function normalise(out: Float32Array, peak: number): Float32Array {
  let m = 0;
  for (let i = 0; i < out.length; i++) m = Math.max(m, Math.abs(out[i]));
  const k = m > 0 ? peak / m : 1;
  for (let i = 0; i < out.length; i++) out[i] *= k;
  return out;
}

/** One small frame/plastic tap (0.18 s): used for bounces and tumbling. */
export function renderClack(sampleRate: number, seed: number): Float32Array {
  const rng = new Rng(seed);
  const out = new Float32Array(Math.round(0.18 * sampleRate));
  const detune = rng.range(0.9, 1.12);
  addClick(out, sampleRate, rng, 0, 0.0008, 1);
  addModalRing(out, sampleRate, [{ freq: 2200, t60: 0.06, amp: 0.4 }, { freq: 4100, t60: 0.035, amp: 0.25 }], 0, 1, detune);
  addSoftBurst(out, sampleRate, rng, 0, 0.012, 900, 0.7);
  return normalise(out, 0.9);
}

/** A hard crash (1.1 s): click, carbon-plate ring, body thud, then a decaying bounce of rattling parts. */
export function renderCrash(sampleRate: number, seed: number): Float32Array {
  const rng = new Rng(seed);
  const out = new Float32Array(Math.round(1.1 * sampleRate));
  const detune = rng.range(0.94, 1.07);
  addClick(out, sampleRate, rng, 0, 0.0012, 1.2);
  addModalRing(out, sampleRate, CARBON_PLATE_MODES, 0.0005, 0.9, detune);
  addSoftBurst(out, sampleRate, rng, 0, 0.03, 700, 1.1);
  addThud(out, sampleRate, 0, 115 * detune, 52, 0.05, 1.3);
  let t = 0.1;
  let gap = rng.range(0.1, 0.14);
  let g = 0.55;
  for (let k = 0; k < 7 && t < 1; k++) {
    addClick(out, sampleRate, rng, t, 0.001, g);
    addModalRing(out, sampleRate, CARBON_PLATE_MODES, t, g * 0.5, detune * rng.range(0.96, 1.05));
    addSoftBurst(out, sampleRate, rng, t, 0.015, 800, g * 0.6);
    t += gap;
    gap *= 0.72;
    g *= 0.72;
  }
  return normalise(out, 0.95);
}

/** A carbon prop tip striking something (45 ms): a very short high tick. */
export function renderTick(sampleRate: number, seed: number): Float32Array {
  const rng = new Rng(seed);
  const out = new Float32Array(Math.round(0.045 * sampleRate));
  addClick(out, sampleRate, rng, 0, 0.0006, 1);
  addModalRing(out, sampleRate, [{ freq: rng.range(3800, 5200), t60: 0.012, amp: 0.7 }, { freq: rng.range(7000, 9000), t60: 0.006, amp: 0.3 }], 0, 1);
  return normalise(out, 0.9);
}
