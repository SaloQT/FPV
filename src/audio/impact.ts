/** Ground and crash sounds: surface scrape, prop-wash rustle, tumble clacks, prop-strike ticks and the crash itself. */
import { loopSource, noiseBuffer, toAudioBuffer } from './audioBuffer';
import { clamp, smoothstep } from './dsp';
import { Rng } from './noise';
import { renderClack, renderCrash, renderTick } from './sampleSynth';

export type TerrainKind = 'grass' | 'dirt' | 'rock' | 'sand';

/** Calibration of the one-shot samples (peak 0.9-0.95) and of the continuous ground noise. */
export const IMPACT_SCALE = 0.8;
export const SCRAPE_SCALE = 0.35;
export const WASH_SCALE = 0.12;
const MAX_VOICES = 24;
const PARAM_TC = 0.03;
const SCRAPE_MIN_SPEED = 0.3;

export interface ScrapeProfile {
  hissHz: number;
  hissQ: number;
  hiss: number;
  gritHz: number;
  grit: number;
}

/** How each surface sounds under a dragged frame: grass swishes, dirt scuffs, rock grinds, sand hisses. */
export const SCRAPE_PROFILES: Record<TerrainKind, ScrapeProfile> = {
  grass: { hissHz: 2800, hissQ: 0.5, hiss: 0.5, gritHz: 1500, grit: 0.15 },
  dirt: { hissHz: 900, hissQ: 0.6, hiss: 0.6, gritHz: 1800, grit: 0.35 },
  rock: { hissHz: 3500, hissQ: 0.7, hiss: 0.35, gritHz: 3200, grit: 0.7 },
  sand: { hissHz: 5000, hissQ: 0.4, hiss: 0.6, gritHz: 4000, grit: 0.1 },
};

/** Crash loudness from the closing speed in m/s. */
export function impactGain(speed: number): number {
  const s = Number.isFinite(speed) ? speed : 0;
  return 0.1 + 0.9 * smoothstep(2, 25, s);
}

/** 0..1 level of the ground scrape; silent unless the frame is on the ground and sliding faster than 0.3 m/s. */
export function scrapeLevel(speed: number, onGround: boolean): number {
  if (!onGround || !(speed > SCRAPE_MIN_SPEED)) return 0;
  return smoothstep(SCRAPE_MIN_SPEED, 0.8, speed) * (0.15 + 0.85 * smoothstep(0.5, 10, speed));
}

/** 0..1 level of the grass being blown about by the props: needs grass, low altitude and spinning motors. */
export function washLevel(agl: number, meanRatio: number, grassness: number): number {
  if (!(agl >= 0) || !(grassness > 0)) return 0;
  return clamp(grassness, 0, 1) * smoothstep(3.5, 0.4, agl) * smoothstep(0.15, 0.6, meanRatio);
}

/** Playback-rate of the crackle loop: faster sliding produces more grains per second. */
export function grainRate(speed: number): number {
  return 0.6 + 1.0 * smoothstep(0.3, 14, speed);
}

function bank<T>(n: number, make: (i: number) => T): T[] {
  return Array.from({ length: n }, (_, i) => make(i));
}

export class ImpactSynth {
  private readonly crashes: AudioBuffer[];
  private readonly clacks: AudioBuffer[];
  private readonly ticks: AudioBuffer[];
  private readonly rng = new Rng(0x7a11);
  private readonly last = { crash: -1, clack: -1, tick: -1 };
  private readonly hiss: BiquadFilterNode;
  private readonly grit: BiquadFilterNode;
  private readonly hissGain: GainNode;
  private readonly gritGain: GainNode;
  private readonly washGain: GainNode;
  private readonly grainSrc: AudioBufferSourceNode;
  private readonly nodes: AudioNode[] = [];
  private readonly sources: AudioBufferSourceNode[] = [];
  private active = 0;

  constructor(private readonly ctx: BaseAudioContext, private readonly out: AudioNode) {
    const sr = ctx.sampleRate;
    this.crashes = bank(3, (i) => toAudioBuffer(ctx, renderCrash(sr, 100 + i)));
    this.clacks = bank(4, (i) => toAudioBuffer(ctx, renderClack(sr, 200 + i)));
    this.ticks = bank(3, (i) => toAudioBuffer(ctx, renderTick(sr, 300 + i)));

    this.hiss = this.filter('bandpass', 2800, 0.5);
    this.grit = this.filter('bandpass', 1500, 0.7);
    this.hissGain = this.gain();
    this.gritGain = this.gain();
    this.play(loopSource(ctx, noiseBuffer(ctx, 'pink', 3, 41)), 0).connect(this.hiss).connect(this.hissGain).connect(out);
    this.grainSrc = this.play(loopSource(ctx, noiseBuffer(ctx, 'crackle', 3, 42)), 0.4);
    this.grainSrc.connect(this.grit).connect(this.gritGain).connect(out);

    const wash = this.filter('bandpass', 3400, 0.6);
    this.washGain = this.gain();
    this.play(loopSource(ctx, noiseBuffer(ctx, 'pink', 3, 43), 1.03), 1.1).connect(wash).connect(this.washGain).connect(out);
  }

  /** Continuous ground sounds; `scrape` and `wash` are 0..1 levels (see scrapeLevel and washLevel). */
  update(kind: TerrainKind, scrape: number, wash: number, speed: number): void {
    const now = this.ctx.currentTime;
    const p = SCRAPE_PROFILES[kind];
    this.hiss.frequency.setTargetAtTime(p.hissHz, now, PARAM_TC * 3);
    this.hiss.Q.setTargetAtTime(p.hissQ, now, PARAM_TC * 3);
    this.grit.frequency.setTargetAtTime(p.gritHz, now, PARAM_TC * 3);
    this.hissGain.gain.setTargetAtTime(SCRAPE_SCALE * scrape * p.hiss, now, PARAM_TC);
    this.gritGain.gain.setTargetAtTime(SCRAPE_SCALE * scrape * p.grit, now, PARAM_TC);
    this.grainSrc.playbackRate.setTargetAtTime(grainRate(speed), now, PARAM_TC * 2);
    this.washGain.gain.setTargetAtTime(WASH_SCALE * wash, now, PARAM_TC * 2);
  }

  crash(speed: number, propStrike: boolean): void {
    const g = IMPACT_SCALE * impactGain(speed);
    this.shot(this.crashes, 'crash', g, 0.06, 0);
    if (!propStrike) return;
    const n = 3 + Math.floor(this.rng.next() * 3);
    for (let i = 0; i < n; i++) this.shot(this.ticks, 'tick', g * this.rng.range(0.35, 0.7), 0.12, 0.02 + i * this.rng.range(0.025, 0.06));
  }

  /** One clack of the frame tumbling; `level` 0..1. */
  clack(level: number): void {
    this.shot(this.clacks, 'clack', IMPACT_SCALE * (0.15 + 0.6 * clamp(level, 0, 1)), 0.1, 0);
  }

  /** A gentle touchdown: a dull, low-pitched clack. */
  landing(level: number): void {
    this.shot(this.clacks, 'clack', IMPACT_SCALE * (0.12 + 0.4 * clamp(level, 0, 1)), 0, 0, 0.8);
  }

  /** A single prop tick (a grazed blade). */
  tick(level: number): void {
    this.shot(this.ticks, 'tick', IMPACT_SCALE * (0.2 + 0.5 * clamp(level, 0, 1)), 0.1, 0);
  }

  dispose(): void {
    for (const s of this.sources) {
      try { s.stop(); } catch { /* not started */ }
    }
    for (const n of this.nodes) n.disconnect();
  }

  private shot(buffers: AudioBuffer[], key: 'crash' | 'clack' | 'tick', gain: number, rateVar: number, delay: number, rate = 1): void {
    if (this.active >= MAX_VOICES || !(gain > 0)) return;
    const n = buffers.length;
    const pick = (this.last[key] + 1 + Math.floor(this.rng.next() * (n - 1))) % n;
    this.last[key] = pick;
    const src = this.ctx.createBufferSource();
    src.buffer = buffers[pick];
    src.playbackRate.value = rate * (1 + this.rng.range(-rateVar, rateVar));
    const g = this.ctx.createGain();
    g.gain.value = gain;
    src.connect(g).connect(this.out);
    this.active++;
    src.onended = () => {
      this.active--;
      src.disconnect();
      g.disconnect();
    };
    src.start(this.ctx.currentTime + delay);
  }

  private play(src: AudioBufferSourceNode, offset: number): AudioBufferSourceNode {
    src.start(0, offset);
    this.sources.push(src);
    this.nodes.push(src);
    return src;
  }

  private filter(type: BiquadFilterType, hz: number, q: number): BiquadFilterNode {
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = hz;
    f.Q.value = q;
    this.nodes.push(f);
    return f;
  }

  private gain(): GainNode {
    const g = this.ctx.createGain();
    g.gain.value = 0;
    this.nodes.push(g);
    return g;
  }
}
