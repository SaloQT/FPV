/** Creates the motor voice bank: the AudioWorklet synth when available, the OscillatorNode fallback otherwise. */
import { buildWavetableSet, motorHarmonicAmplitude, type WavetableSet } from './dsp';
import { createFallbackMotorSynth } from './motorFallback';
import { MOTOR_PARAM_SPECS } from './motorParams';
import { WORKLET_NAME, WORKLET_SOURCE, type WorkletOptions } from './worklet';

export interface MotorSynth {
  readonly kind: 'worklet' | 'oscillator';
  /** Stereo (worklet) or mono-upmixed (fallback) node carrying all motor, whoosh and rumble sound. */
  readonly output: AudioNode;
  /** Indexed like `MOTOR_PARAM_SPECS`; null where the back end has no such parameter. */
  readonly params: readonly (AudioParam | null)[];
  dispose(): void;
}

export interface MotorSynthOptions {
  forceFallback?: boolean;
  seed?: number;
}

const tableCache = new Map<number, WavetableSet>();
const moduleLoads = new WeakMap<BaseAudioContext, Promise<void>>();

function tablesFor(sampleRate: number): WavetableSet {
  let set = tableCache.get(sampleRate);
  if (!set) {
    set = buildWavetableSet((h) => motorHarmonicAmplitude(h), sampleRate);
    tableCache.set(sampleRate, set);
  }
  return set;
}

export function workletSupported(ctx: BaseAudioContext): boolean {
  return typeof AudioWorkletNode !== 'undefined' && !!ctx.audioWorklet && typeof Blob !== 'undefined' && typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function';
}

function loadModule(ctx: BaseAudioContext): Promise<void> {
  let load = moduleLoads.get(ctx);
  if (!load) {
    const url = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'text/javascript' }));
    load = ctx.audioWorklet.addModule(url).finally(() => URL.revokeObjectURL(url));
    moduleLoads.set(ctx, load);
    load.catch(() => moduleLoads.delete(ctx));
  }
  return load;
}

function createWorkletMotorSynth(ctx: BaseAudioContext, set: WavetableSet, seed: number): MotorSynth {
  const processorOptions: WorkletOptions = { tables: set.data, size: set.size, levels: set.levels, fMin: set.fMin, seed };
  const node = new AudioWorkletNode(ctx, WORKLET_NAME, { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2], processorOptions });
  return {
    kind: 'worklet',
    output: node,
    params: MOTOR_PARAM_SPECS.map((s) => node.parameters.get(s.name) ?? null),
    dispose() { node.disconnect(); node.port.close(); },
  };
}

/** Never rejects: a failing worklet load or construction drops back to the oscillator synth. */
export async function createMotorSynth(ctx: BaseAudioContext, opts: MotorSynthOptions = {}): Promise<MotorSynth> {
  const set = tablesFor(ctx.sampleRate);
  if (!opts.forceFallback && workletSupported(ctx)) {
    try {
      await loadModule(ctx);
      return createWorkletMotorSynth(ctx, set, opts.seed ?? 1);
    } catch {
      // fall through to the stock-node synth
    }
  }
  return createFallbackMotorSynth(ctx, set);
}
