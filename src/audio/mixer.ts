/** The output graph: source buses, the pilot (ground listener) and onboard (camera microphone) branches, master, limiter and soft clip. */
import { clamp, softClipCurve } from './dsp';

export interface Volumes {
  master: number;
  motors: number;
  wind: number;
  effects: number;
}

export const DEFAULT_VOLUMES: Volumes = { master: 0.8, motors: 1, wind: 1, effects: 1 };

/** Slider position 0..1 to linear gain: a square law feels roughly linear in loudness. */
export function volumeGain(v: number): number {
  const c = clamp(Number.isFinite(v) ? v : 0, 0, 1);
  return c * c;
}

/** Calibration: level of the airframe at the reference distance for the pilot, and at the camera for onboard. */
export const PILOT_GAIN = 2.2;
export const ONBOARD_GAIN = 1.1;
/** Distance within which the pilot hears the quad at full level (1/d roll-off beyond). */
export const REFERENCE_DISTANCE = 4;
const ONBOARD_MIC_HZ = 7000;
/** Linear Q of the air-absorption low-pass; WebAudio takes the Q of a low-pass in dB. */
const PILOT_LP_Q = 0.5;
const MODE_TC = 0.06;
const PILOT_TC = 0.02;
/** Limiter threshold: leaves the soft clipper only the rare transient. */
const LIMITER_DB = -10;
/** Feeds the soft clipper so that its unity-gain region covers the whole limited signal (see softClipCurve). */
const CLIP_PRE_GAIN = 0.5;

export class Mixer {
  /** Airframe sounds (motors, impacts, quad beeps) before they are placed in the scene. */
  readonly quadBus: GainNode;
  readonly motors: GainNode;
  readonly effects: GainNode;
  /** Race-UI tones: not part of the scene, heard as they are. */
  readonly uiBus: GainNode;
  /** Onboard-camera wind noise; only passes while the listener sits on the quad. */
  readonly micIn: GainNode;
  /** Scene wind. */
  readonly windIn: GainNode;
  private readonly wind: GainNode;
  private readonly pilotLP: BiquadFilterNode;
  private readonly panner: PannerNode;
  private readonly pilotGain: GainNode;
  private readonly onboardGain: GainNode;
  private readonly master: GainNode;
  private readonly nodes: AudioNode[] = [];

  constructor(private readonly ctx: BaseAudioContext, volumes: Volumes = DEFAULT_VOLUMES) {
    const mix = this.track(ctx.createGain());
    this.quadBus = this.track(ctx.createGain());
    this.motors = this.track(ctx.createGain());
    this.effects = this.track(ctx.createGain());
    this.uiBus = this.track(ctx.createGain());
    this.micIn = this.track(ctx.createGain());
    this.windIn = this.track(ctx.createGain());
    this.wind = this.track(ctx.createGain());
    this.motors.connect(this.quadBus);
    this.effects.connect(this.quadBus);
    this.uiBus.connect(mix);
    this.micIn.gain.value = 0;
    this.micIn.connect(this.wind);
    this.windIn.connect(this.wind);
    this.wind.connect(mix);

    this.pilotLP = this.track(ctx.createBiquadFilter());
    this.pilotLP.type = 'lowpass';
    this.pilotLP.Q.value = 20 * Math.log10(PILOT_LP_Q);
    this.pilotLP.frequency.value = 20000;
    this.panner = this.track(ctx.createPanner());
    this.panner.panningModel = 'HRTF';
    this.panner.distanceModel = 'inverse';
    this.panner.refDistance = REFERENCE_DISTANCE;
    this.panner.rolloffFactor = 1;
    this.panner.maxDistance = 10000;
    this.pilotGain = this.track(ctx.createGain());
    this.pilotGain.gain.value = PILOT_GAIN;
    this.quadBus.connect(this.pilotLP).connect(this.panner).connect(this.pilotGain).connect(mix);

    const mic = this.track(ctx.createBiquadFilter());
    mic.type = 'lowpass';
    mic.frequency.value = ONBOARD_MIC_HZ;
    mic.Q.value = 0.5;
    this.onboardGain = this.track(ctx.createGain());
    this.onboardGain.gain.value = 0;
    this.quadBus.connect(mic).connect(this.onboardGain).connect(mix);

    this.master = this.track(ctx.createGain());
    const limiter = this.track(ctx.createDynamicsCompressor());
    limiter.threshold.value = LIMITER_DB;
    limiter.knee.value = 6;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.1;
    const pre = this.track(ctx.createGain());
    pre.gain.value = CLIP_PRE_GAIN;
    const clip = this.track(ctx.createWaveShaper());
    clip.curve = softClipCurve() as Float32Array<ArrayBuffer>;
    clip.oversample = '2x';
    mix.connect(this.master).connect(limiter).connect(pre).connect(clip).connect(ctx.destination);

    this.setVolumes(volumes);
  }

  setVolumes(v: Volumes): void {
    const now = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(volumeGain(v.master), now, 0.02);
    this.motors.gain.setTargetAtTime(volumeGain(v.motors), now, 0.02);
    this.wind.gain.setTargetAtTime(volumeGain(v.wind), now, 0.02);
    const fx = volumeGain(v.effects);
    this.effects.gain.setTargetAtTime(fx, now, 0.02);
    this.uiBus.gain.setTargetAtTime(fx, now, 0.02);
  }

  /** Crossfades between standing on the ground and riding on the quad. */
  setOnboard(on: boolean): void {
    const now = this.ctx.currentTime;
    this.pilotGain.gain.setTargetAtTime(on ? 0 : PILOT_GAIN, now, MODE_TC);
    this.onboardGain.gain.setTargetAtTime(on ? ONBOARD_GAIN : 0, now, MODE_TC);
    this.micIn.gain.setTargetAtTime(on ? 1 : 0, now, MODE_TC);
  }

  /** Air-absorption cutoff and the quad's position in listener coordinates (the AudioListener stays at the origin). */
  setPilotScene(cutoff: number, x: number, y: number, z: number): void {
    const now = this.ctx.currentTime;
    this.pilotLP.frequency.setTargetAtTime(cutoff, now, 0.05);
    const p = this.panner;
    if (p.positionX) {
      p.positionX.setTargetAtTime(x, now, PILOT_TC);
      p.positionY.setTargetAtTime(y, now, PILOT_TC);
      p.positionZ.setTargetAtTime(z, now, PILOT_TC);
    } else {
      p.setPosition(x, y, z);
    }
  }

  dispose(): void {
    for (const n of this.nodes) n.disconnect();
  }

  private track<T extends AudioNode>(n: T): T {
    this.nodes.push(n);
    return n;
  }
}
