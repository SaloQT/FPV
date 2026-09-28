/** Wind sound: microphone wind noise of the onboard camera (grows with airspeed) and a very quiet ambient wind in trees. */
import { loopSource, noiseBuffer } from './audioBuffer';
import { clamp } from './dsp';

/** Calibration: mic wind RMS at the reference airspeed. */
export const WIND_MIC_SCALE = 0.11;
/** Calibration: ambient wind at 10 m/s. */
export const AMBIENT_WIND_SCALE = 0.04;
const MIC_REF_SPEED = 35;
const MIC_MAX_SPEED = 50;
const AMBIENT_MAX_WIND = 25;
const AMBIENT_FLOOR = 0.15;
const PARAM_TC = 0.15;
const GUST_HZ = [0.13, 0.31, 0.77] as const;
const GUST_WEIGHT = [0.5, 0.3, 0.2] as const;

/** Speed of the air over the camera: the flight speed combined with the (horizontal) wind. */
export function airspeedFrom(speed: number, windSpeed: number): number {
  const s = Number.isFinite(speed) ? speed : 0;
  const w = Number.isFinite(windSpeed) ? windSpeed : 0;
  return Math.hypot(s, w);
}

/** Low-pass cutoff of the mic wind: a dull rumble when slow, a hiss once fast. */
export function windMicCutoff(airspeed: number): number {
  return clamp(250 + 70 * airspeed, 250, 6000);
}

/** Wind-noise level of a microphone rises roughly with the 1.7th power of the airspeed. */
export function windMicGain(airspeed: number): number {
  return WIND_MIC_SCALE * (clamp(airspeed, 0, MIC_MAX_SPEED) / MIC_REF_SPEED) ** 1.7;
}

export function ambientWindGain(windSpeed: number): number {
  return AMBIENT_WIND_SCALE * (AMBIENT_FLOOR + (clamp(windSpeed, 0, AMBIENT_MAX_WIND) / 10) ** 1.3);
}

export class WindSynth {
  /** Onboard-camera wind noise; the engine mutes it when the listener stands on the ground. */
  readonly mic: GainNode;
  /** Scene wind; always audible, always quiet. */
  readonly ambient: GainNode;
  private readonly cutoff: BiquadFilterNode;
  private readonly nodes: AudioNode[] = [];
  private readonly sources: (OscillatorNode | AudioBufferSourceNode)[] = [];

  constructor(private readonly ctx: BaseAudioContext) {
    const pink = noiseBuffer(ctx, 'pink', 4, 31);
    const brown = noiseBuffer(ctx, 'brown', 4, 32);

    this.mic = this.track(ctx.createGain());
    this.mic.gain.value = 0;
    const micGust = this.track(ctx.createGain());
    micGust.connect(this.mic);
    this.cutoff = this.track(ctx.createBiquadFilter());
    this.cutoff.type = 'lowpass';
    this.cutoff.Q.value = 0.6;
    this.cutoff.frequency.value = 250;
    this.cutoff.connect(micGust);
    this.play(loopSource(ctx, pink), 0).connect(this.cutoff);

    const rumbleLow = this.track(ctx.createBiquadFilter());
    rumbleLow.type = 'lowpass';
    rumbleLow.frequency.value = 160;
    const rumbleTrim = this.track(ctx.createGain());
    rumbleTrim.gain.value = 0.6;
    this.play(loopSource(ctx, brown), 0.7).connect(rumbleLow).connect(rumbleTrim).connect(micGust);

    this.ambient = this.track(ctx.createGain());
    this.ambient.gain.value = ambientWindGain(0);
    const ambGust = this.track(ctx.createGain());
    ambGust.connect(this.ambient);
    const band = this.track(ctx.createBiquadFilter());
    band.type = 'bandpass';
    band.frequency.value = 450;
    band.Q.value = 0.35;
    band.connect(ambGust);
    this.play(loopSource(ctx, pink, 0.97), 2.1).connect(band);

    this.gusts(micGust.gain, 0.35, 1);
    this.gusts(ambGust.gain, 0.5, 0.8);
  }

  /** Targets are smoothed inside the audio thread, so this can run at frame rate. */
  update(airspeed: number, windSpeed: number): void {
    const now = this.ctx.currentTime;
    this.mic.gain.setTargetAtTime(windMicGain(airspeed), now, PARAM_TC);
    this.cutoff.frequency.setTargetAtTime(windMicCutoff(airspeed), now, PARAM_TC);
    this.ambient.gain.setTargetAtTime(ambientWindGain(windSpeed), now, PARAM_TC);
  }

  dispose(): void {
    for (const s of this.sources) {
      try { s.stop(); } catch { /* not started */ }
    }
    for (const n of this.nodes) n.disconnect();
  }

  /** Three incommensurate slow sines make an endless, non-repeating gust pattern around unity gain. */
  private gusts(target: AudioParam, depth: number, rate: number): void {
    target.value = 1;
    for (let i = 0; i < GUST_HZ.length; i++) {
      const osc = this.ctx.createOscillator();
      osc.frequency.value = GUST_HZ[i] * rate;
      const g = this.track(this.ctx.createGain());
      g.gain.value = depth * GUST_WEIGHT[i];
      osc.connect(g).connect(target);
      this.sources.push(osc);
      osc.start();
      this.nodes.push(osc);
    }
  }

  private play(src: AudioBufferSourceNode, offset: number): AudioBufferSourceNode {
    src.start(0, offset);
    this.sources.push(src);
    this.nodes.push(src);
    return src;
  }

  private track<T extends AudioNode>(n: T): T {
    this.nodes.push(n);
    return n;
  }
}
