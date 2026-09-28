/** Test harness that runs the worklet source string in Node against fake AudioWorklet globals. */
import { buildWavetableSet, motorHarmonicAmplitude, type WavetableSet } from './dsp';
import { MOTOR_PARAM_SPECS, P_AMP, P_FREQ } from './motorParams';
import { WORKLET_SOURCE } from './worklet';

interface Processor {
  process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean;
}

type ProcessorClass = (new (options: { processorOptions: unknown }) => Processor) & { parameterDescriptors: { name: string; automationRate: string }[] };

export interface Rendered {
  left: Float32Array;
  right: Float32Array;
}

export class WorkletHarness {
  readonly proc: Processor;
  readonly descriptors: { name: string; automationRate: string }[];
  readonly registeredName: string;
  readonly set: WavetableSet;
  readonly values: Float64Array;

  constructor(readonly sampleRate = 48000, seed = 1) {
    class FakeBase {}
    let registered: ProcessorClass | null = null;
    let name = '';
    const register = (n: string, c: ProcessorClass): void => { registered = c; name = n; };
    new Function('AudioWorkletProcessor', 'registerProcessor', 'sampleRate', WORKLET_SOURCE)(FakeBase, register, sampleRate);
    if (!registered) throw new Error('worklet did not register a processor');
    const ctor: ProcessorClass = registered;
    this.registeredName = name;
    this.descriptors = ctor.parameterDescriptors;
    this.set = buildWavetableSet((h) => motorHarmonicAmplitude(h), sampleRate);
    const opts = { tables: this.set.data, size: this.set.size, levels: this.set.levels, fMin: this.set.fMin, seed };
    this.proc = new ctor({ processorOptions: opts });
    this.values = new Float64Array(MOTOR_PARAM_SPECS.length);
    MOTOR_PARAM_SPECS.forEach((s, i) => { this.values[i] = s.def; });
  }

  set1(name: string, value: number): void {
    const i = MOTOR_PARAM_SPECS.findIndex((s) => s.name === name);
    if (i < 0) throw new Error(`no param ${name}`);
    this.values[i] = value;
  }

  setMotor(m: number, freq: number, amp: number): void {
    this.values[P_FREQ + m] = freq;
    this.values[P_AMP + m] = amp;
  }

  /** Renders `blocks` render quanta; `each` may change the parameter values before block k. */
  render(blocks: number, each?: (block: number, h: WorkletHarness) => void): Rendered {
    const left = new Float32Array(blocks * 128), right = new Float32Array(blocks * 128);
    const bl = new Float32Array(128), br = new Float32Array(128);
    const params: Record<string, Float32Array> = {};
    for (const s of MOTOR_PARAM_SPECS) params[s.name] = new Float32Array(1);
    for (let b = 0; b < blocks; b++) {
      each?.(b, this);
      MOTOR_PARAM_SPECS.forEach((s, i) => { params[s.name][0] = this.values[i]; });
      this.proc.process([], [[bl, br]], params);
      left.set(bl, b * 128);
      right.set(br, b * 128);
    }
    return { left, right };
  }

  seconds(s: number): number {
    return Math.ceil((s * this.sampleRate) / 128);
  }

  /** Amplitude of harmonic `h` in the stored table at mip level `level` (direct DFT bin). */
  tableHarmonic(level: number, h: number): number {
    const t = this.set.data.subarray(level * (this.set.size + 1), level * (this.set.size + 1) + this.set.size);
    let re = 0, im = 0;
    for (let i = 0; i < t.length; i++) {
      const a = (2 * Math.PI * h * i) / t.length;
      re += t[i] * Math.cos(a);
      im += t[i] * Math.sin(a);
    }
    return (2 * Math.hypot(re, im)) / t.length;
  }
}
