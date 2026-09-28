/** Faster-than-real-time renders of the motor synth and of the whole engine (OfflineAudioContext), for checks and calibration. */
import type { QuadState } from '../contracts';
import { AudioEngine, type AudioEngineOptions, type AudioUpdateContext } from './engine';
import { MOTOR_COUNT, P_AMP, P_FREQ } from './motorParams';
import { createMotorSynth } from './motorSynth';

/** OfflineAudioContext can only be suspended on render-quantum boundaries. */
const QUANTUM = 128;
const DEFAULT_RATE = 48000;

export interface Rendered {
  left: Float32Array;
  right: Float32Array;
  sampleRate: number;
  synth: 'worklet' | 'oscillator' | 'none';
  /** Audio time between two engine updates. */
  frameSeconds: number;
}

export interface RampOptions {
  seconds: number;
  /** Mechanical frequency (Hz) at the start, and at `rampSeconds` after which it holds. */
  fromHz: number;
  toHz: number;
  rampSeconds: number;
  /** Gain of each of the four motors. */
  amp: number;
  sampleRate?: number;
}

export type Script = (time: number, state: QuadState, ctx: AudioUpdateContext, engine: AudioEngine) => void;

export interface EngineRenderOptions {
  seconds: number;
  /** Called before every engine update to move the quad; frames are `frameQuanta` render quanta apart. */
  script: Script;
  engine?: AudioEngineOptions;
  frameQuanta?: number;
  sampleRate?: number;
}

const quantise = (samples: number): number => Math.ceil(samples / QUANTUM) * QUANTUM;

export function idleQuadState(): QuadState {
  return {
    time: 0, pos: [0, 0.05, 0], vel: [0, 0, 0], quat: [0, 0, 0, 1], angVel: [0, 0, 0], motorOmega: [0, 0, 0, 0], motorCmd: [0, 0, 0, 0],
    batteryVoltage: 25.2, batteryCurrent: 0, batteryMah: 0, gForce: [0, 1, 0], armed: false, onGround: true, crashed: false, impactSpeed: 0,
  };
}

/** The bare motor synth (no mixer): all four motors at one frequency, ramped, through the same node the game uses. */
export async function renderMotorRamp(o: RampOptions): Promise<Rendered> {
  const sampleRate = o.sampleRate ?? DEFAULT_RATE;
  const ctx = new OfflineAudioContext(2, quantise(o.seconds * sampleRate), sampleRate);
  const synth = await createMotorSynth(ctx);
  synth.output.connect(ctx.destination);
  for (let i = 0; i < MOTOR_COUNT; i++) {
    const freq = synth.params[P_FREQ + i];
    freq?.setValueAtTime(o.fromHz, 0);
    freq?.linearRampToValueAtTime(o.toHz, o.rampSeconds);
    synth.params[P_AMP + i]?.setValueAtTime(o.amp, 0);
  }
  const buffer = await ctx.startRendering();
  synth.dispose();
  return { left: buffer.getChannelData(0), right: buffer.getChannelData(1), sampleRate, synth: synth.kind, frameSeconds: 0 };
}

/** Runs an AudioEngine against a scripted flight. The engine sees the same update calls as in the game, one per frame. */
export async function renderEngine(o: EngineRenderOptions): Promise<Rendered> {
  const sampleRate = o.sampleRate ?? DEFAULT_RATE;
  const total = quantise(o.seconds * sampleRate);
  const ctx = new OfflineAudioContext(2, total, sampleRate);
  const engine = new AudioEngine({ ...o.engine, contextFactory: () => ctx });
  await engine.start();

  const stride = (o.frameQuanta ?? 6) * QUANTUM;
  const frameSeconds = stride / sampleRate;
  const state = idleQuadState();
  const uctx: AudioUpdateContext = { speed: 0, agl: 0, dt: frameSeconds, cameraMode: 'chase', windSpeed: 0 };
  const frame = (t: number): void => {
    o.script(t, state, uctx, engine);
    state.time = t;
    engine.update(state, uctx);
  };
  frame(0);
  for (let at = stride; at < total; at += stride) {
    void ctx.suspend(at / sampleRate).then(() => {
      frame(at / sampleRate);
      return ctx.resume();
    });
  }
  const buffer = await ctx.startRendering();
  const synth = engine.synthKind;
  engine.dispose();
  return { left: buffer.getChannelData(0), right: buffer.getChannelData(1), sampleRate, synth, frameSeconds };
}
