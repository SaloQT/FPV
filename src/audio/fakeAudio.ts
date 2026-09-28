/** Test double for BaseAudioContext: records the graph and every AudioParam write so wiring can be checked in Node. */

export interface ParamCall {
  kind: 'target' | 'set' | 'linear' | 'exp' | 'cancel' | 'curve';
  value: number;
  time: number;
  tc: number;
}

export class FakeParam {
  value: number;
  readonly calls: ParamCall[] = [];

  constructor(initial = 0) {
    this.value = initial;
  }

  setTargetAtTime(value: number, time: number, tc: number): this {
    this.calls.push({ kind: 'target', value, time, tc });
    return this;
  }

  setValueAtTime(value: number, time: number): this {
    this.calls.push({ kind: 'set', value, time, tc: 0 });
    return this;
  }

  linearRampToValueAtTime(value: number, time: number): this {
    this.calls.push({ kind: 'linear', value, time, tc: 0 });
    return this;
  }

  exponentialRampToValueAtTime(value: number, time: number): this {
    this.calls.push({ kind: 'exp', value, time, tc: 0 });
    return this;
  }

  setValueCurveAtTime(): this {
    this.calls.push({ kind: 'curve', value: 0, time: 0, tc: 0 });
    return this;
  }

  cancelScheduledValues(time: number): this {
    this.calls.push({ kind: 'cancel', value: 0, time, tc: 0 });
    return this;
  }

  cancelAndHoldAtTime(time: number): this {
    return this.cancelScheduledValues(time);
  }

  /** The most recent value this param was steered to, whichever way. */
  get last(): number {
    for (let i = this.calls.length - 1; i >= 0; i--) if (this.calls[i].kind !== 'cancel') return this.calls[i].value;
    return this.value;
  }

  get targets(): ParamCall[] {
    return this.calls.filter((c) => c.kind === 'target');
  }
}

const PARAMS: Record<string, readonly string[]> = {
  gain: ['gain'],
  biquad: ['frequency', 'Q', 'gain', 'detune'],
  oscillator: ['frequency', 'detune'],
  bufferSource: ['playbackRate', 'detune'],
  panner: ['positionX', 'positionY', 'positionZ', 'orientationX', 'orientationY', 'orientationZ'],
  compressor: ['threshold', 'knee', 'ratio', 'attack', 'release'],
  waveShaper: [],
  destination: [],
  constant: ['offset'],
};

export class FakeNode {
  [key: string]: unknown;
  readonly outputs: FakeNode[] = [];
  connected = true;
  started = 0;
  stopped = false;
  startArgs: unknown[] = [];
  onended: (() => void) | null = null;

  constructor(readonly kind: string) {
    for (const p of PARAMS[kind] ?? []) this[p] = new FakeParam(p === 'gain' ? 1 : 0);
  }

  param(name: string): FakeParam {
    return this[name] as FakeParam;
  }

  connect<T>(dest: T): T {
    this.outputs.push(dest as unknown as FakeNode);
    return dest;
  }

  disconnect(): void {
    this.connected = false;
  }

  start(...args: unknown[]): void {
    this.started++;
    this.startArgs = args;
  }

  stop(): void {
    this.stopped = true;
  }

  setPeriodicWave(): void {}

  /** Simulates the playback end the browser would signal. */
  finish(): void {
    this.onended?.();
  }
}

export class FakeBuffer {
  readonly duration: number;
  private readonly channels: Float32Array[];

  constructor(readonly numberOfChannels: number, readonly length: number, readonly sampleRate: number) {
    this.duration = length / sampleRate;
    this.channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }

  getChannelData(c: number): Float32Array {
    return this.channels[c];
  }
}

export class FakeContext {
  readonly nodes: FakeNode[] = [];
  readonly buffers: FakeBuffer[] = [];
  readonly destination = new FakeNode('destination');
  readonly listener = {
    positionX: new FakeParam(), positionY: new FakeParam(), positionZ: new FakeParam(),
    forwardX: new FakeParam(0), forwardY: new FakeParam(0), forwardZ: new FakeParam(-1),
    upX: new FakeParam(0), upY: new FakeParam(1), upZ: new FakeParam(0),
  };
  currentTime = 0;
  state: 'running' | 'suspended' | 'closed' = 'running';
  audioWorklet: undefined = undefined;

  constructor(readonly sampleRate = 48000) {}

  private make(kind: string): FakeNode {
    const n = new FakeNode(kind);
    this.nodes.push(n);
    return n;
  }

  of(kind: string): FakeNode[] {
    return this.nodes.filter((n) => n.kind === kind);
  }

  createGain(): GainNode { return this.make('gain') as unknown as GainNode; }
  createBiquadFilter(): BiquadFilterNode { return this.make('biquad') as unknown as BiquadFilterNode; }
  createOscillator(): OscillatorNode { return this.make('oscillator') as unknown as OscillatorNode; }
  createBufferSource(): AudioBufferSourceNode { return this.make('bufferSource') as unknown as AudioBufferSourceNode; }
  createPanner(): PannerNode { return this.make('panner') as unknown as PannerNode; }
  createDynamicsCompressor(): DynamicsCompressorNode { return this.make('compressor') as unknown as DynamicsCompressorNode; }
  createWaveShaper(): WaveShaperNode { return this.make('waveShaper') as unknown as WaveShaperNode; }
  createConstantSource(): ConstantSourceNode { return this.make('constant') as unknown as ConstantSourceNode; }
  createPeriodicWave(): PeriodicWave { return {} as PeriodicWave; }

  createBuffer(channels: number, length: number, sampleRate: number): AudioBuffer {
    const b = new FakeBuffer(channels, length, sampleRate);
    this.buffers.push(b);
    return b as unknown as AudioBuffer;
  }

  resume(): Promise<void> { this.state = 'running'; return Promise.resolve(); }
  suspend(): Promise<void> { this.state = 'suspended'; return Promise.resolve(); }
  close(): Promise<void> { this.state = 'closed'; return Promise.resolve(); }
}

export const asContext = (c: FakeContext): BaseAudioContext => c as unknown as BaseAudioContext;
