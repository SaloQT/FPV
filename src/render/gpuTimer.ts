/** Frame sections timed individually; section i runs from mark i to mark i + 1. */
export const PASS_NAMES = ['pre', 'gbuffer', 'rt', 'lighting', 'sky+fwd', 'post'] as const;
export type PassName = (typeof PASS_NAMES)[number];

/** Stable diagnostic intervals. RT intervals preserve the production dispatch order. */
export const DETAIL_NAMES = ['rtAux', 'probes', 'shadowRays', 'shadowDenoise', 'giRays', 'giDenoise', 'specularRays', 'specularDenoise', 'rtLatch', 'clouds'] as const;
export type DetailName = (typeof DETAIL_NAMES)[number];
export type DetailTimes = Record<DetailName, number | null>;
const MARKS = PASS_NAMES.length + 1;
const RING = 3;

/** Mark indices: FrameBegin, then the end of each section in PASS_NAMES order. */
export const MARK = { FrameBegin: 0, PreEnd: 1, GBufferEnd: 2, RtEnd: 3, LightingEnd: 4, OverlayEnd: 5, FrameEnd: 6 } as const;
export type Mark = (typeof MARK)[keyof typeof MARK];

export interface GpuProfiler {
  /** False for unsupported devices and capture re-encodes. Never split passes unless true. */
  readonly active: boolean;
  computePass(label: string, section: DetailName): GPUComputePassDescriptor;
}

export interface GpuTimingSample {
  /** Monotonic submission identity within this timer/device generation. */
  sequence: number;
  frameIndex: number;
  status: 'measured' | 'dropped' | 'failed';
  gpuMs: number | null;
  passMs: readonly number[];
  detailMs: DetailTimes | null;
  /** Bit i says DETAIL_NAMES[i] was encoded; an unwritten interval is skipped, never stale. */
  detailWritten: number;
}
export type GpuTimingListener = (sample: GpuTimingSample) => void;
interface PendingSample { sequence: number; frameIndex: number; capture: boolean; marks: number; details: number; listener: GpuTimingListener | null }

/**
 * Seven portable empty-pass marks and a three-buffer asynchronous readback ring. Detailed profiling is opt-in: it adds query pairs
 * to existing/split pass descriptors. No synchronous GPU waits occur in rendering. The normal GPU command path is unchanged.
 */
export class GpuTimer implements GpuProfiler {
  gpuMs: number | null = null;
  rtMs: number | null = null;
  readonly passMs: number[] = PASS_NAMES.map(() => NaN);
  readonly detailed: boolean;
  private readonly querySet: GPUQuerySet | null = null;
  private readonly resolveBuffer: GPUBuffer | null = null;
  private readonly readback: GPUBuffer[] = [];
  private readonly busy: boolean[] = [];
  private readonly inFlight = new Set<Promise<void>>();
  private readonly count: number;
  private readonly bytes: number;
  private pending = -1;
  private pendingSample: PendingSample | null = null;
  private disposed = false;
  private sequence = 0;
  private latestSequence = -1;
  private frameIndex = -1;
  private capture = false;
  private marks = 0;
  private details = 0;
  private listener: GpuTimingListener | null = null;

  constructor(device: GPUDevice, enabled: boolean, detailed = false) {
    this.detailed = enabled && detailed;
    this.count = MARKS + (this.detailed ? DETAIL_NAMES.length * 2 : 0);
    this.bytes = this.count * 8;
    if (!enabled) return;
    this.querySet = device.createQuerySet({ label: 'frame timestamps', type: 'timestamp', count: this.count });
    this.resolveBuffer = device.createBuffer({ label: 'timestamp resolve', size: this.bytes, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC });
    for (let i = 0; i < RING; i++) {
      this.readback.push(device.createBuffer({ label: `timestamp readback ${i}`, size: this.bytes, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }));
      this.busy.push(false);
    }
  }

  get enabled(): boolean { return this.querySet !== null && !this.disposed; }
  get active(): boolean { return this.enabled && this.detailed && !this.capture; }

  /** Unsubscribe stops future submissions; already-submitted samples still deliver during drain(). */
  listen(listener: GpuTimingListener): () => void {
    this.listener = listener;
    return () => { if (this.listener === listener) this.listener = null; };
  }

  beginFrame(frameIndex: number, capture = false): void {
    this.abortFrame();
    this.frameIndex = frameIndex;
    this.capture = capture;
    this.marks = 0;
    this.details = 0;
  }

  computePass(label: string, section: DetailName): GPUComputePassDescriptor {
    if (!this.active) return { label };
    const index = DETAIL_NAMES.indexOf(section);
    this.details |= 1 << index;
    return { label, timestampWrites: { querySet: this.querySet!, beginningOfPassWriteIndex: MARKS + 2 * index, endOfPassWriteIndex: MARKS + 2 * index + 1 } };
  }

  mark(enc: GPUCommandEncoder, mark: Mark): void {
    if (!this.enabled) return;
    this.marks |= 1 << mark;
    enc.beginComputePass({ timestampWrites: { querySet: this.querySet!, endOfPassWriteIndex: mark } }).end();
  }

  /** Stamps the frame end and queues a copy into a free ring slot, dropping a sample rather than blocking when full. */
  resolve(enc: GPUCommandEncoder): void {
    if (!this.enabled || !this.resolveBuffer) return;
    this.mark(enc, MARK.FrameEnd);
    const sample: PendingSample = { sequence: this.sequence++, frameIndex: this.frameIndex, capture: this.capture, marks: this.marks, details: this.details, listener: this.listener };
    this.pending = this.busy.indexOf(false);
    if (this.pending < 0) { this.publish(sample, 'dropped'); return; }
    this.busy[this.pending] = true;
    this.pendingSample = sample;
    enc.resolveQuerySet(this.querySet!, 0, this.count, this.resolveBuffer, 0);
    enc.copyBufferToBuffer(this.resolveBuffer, 0, this.readback[this.pending], 0, this.bytes);
  }

  /** Call only after queue.submit of the encoder passed to resolve(). */
  afterSubmit(): void {
    const slot = this.pending, sample = this.pendingSample;
    if (slot < 0 || !sample) return;
    this.pending = -1;
    this.pendingSample = null;
    const buf = this.readback[slot];
    // Calling mapAsync after submit is essential: the buffer cannot be copied while mapping/mapped.
    let task: Promise<void>;
    task = Promise.resolve().then(() => buf.mapAsync(GPUMapMode.READ)).then(() => {
      try {
        if (this.disposed) return;
        const t = new BigUint64Array(buf.getMappedRange().slice(0));
        this.store(t, sample);
      } finally { if (!this.disposed) buf.unmap(); }
    }).catch(() => { if (!this.disposed) this.publish(sample, 'failed'); }).finally(() => {
      this.busy[slot] = false;
      this.inFlight.delete(task);
    });
    this.inFlight.add(task);
  }

  /** Release a reservation when encoding or submission failed. */
  abortFrame(): void {
    if (this.pending >= 0) {
      this.busy[this.pending] = false;
      if (this.pendingSample) this.publish(this.pendingSample, 'failed');
    }
    this.pending = -1;
    this.pendingSample = null;
  }

  /** Benchmark-only drain, outside the measured window. A timeout is reported as incomplete, never filled with stale samples. */
  async drain(timeoutMs = 5000): Promise<boolean> {
    const pending = [...this.inFlight];
    if (!pending.length) return true;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        Promise.all(pending).then(() => true),
        new Promise<boolean>((resolve) => { timeout = setTimeout(() => resolve(false), Math.max(0, timeoutMs)); }),
      ]);
    } finally { if (timeout !== undefined) clearTimeout(timeout); }
  }

  destroy(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.listener = null;
    this.pending = -1;
    this.pendingSample = null;
    this.querySet?.destroy();
    this.resolveBuffer?.destroy();
    for (const b of this.readback) b.destroy();
  }

  private publish(s: PendingSample, status: 'dropped' | 'failed'): void {
    if (!s.capture && !this.disposed) this.deliver(s.listener, { sequence: s.sequence, frameIndex: s.frameIndex, status, gpuMs: null, passMs: [], detailMs: null, detailWritten: s.details });
  }

  private deliver(listener: GpuTimingListener | null, sample: GpuTimingSample): void {
    try { listener?.(sample); } catch (e) { console.warn('GPU timing listener failed', e); }
  }

  private store(t: BigUint64Array, s: PendingSample): void {
    // Capture timings keep their legacy latest-value behavior only in the normal path; never enter benchmark samples.
    if (s.capture && this.detailed) return;
    const interval = (a: number, b: number): number | null => (s.marks & (1 << a)) && (s.marks & (1 << b)) ? measuredMs(t, a, b) : null;
    if (s.sequence > this.latestSequence) {
      this.latestSequence = s.sequence;
      // Retain the existing controller's handling of quantized-zero intervals; exports distinguish them from missing data.
      this.gpuMs = sectionMs(t, MARK.FrameBegin, MARK.FrameEnd);
      this.rtMs = sectionMs(t, MARK.GBufferEnd, MARK.RtEnd);
      for (let i = 0; i < PASS_NAMES.length; i++) this.passMs[i] = sectionMs(t, i, i + 1) ?? NaN;
    }
    if (!s.listener || s.capture) return;
    const gpuMs = interval(MARK.FrameBegin, MARK.FrameEnd);
    const passes = PASS_NAMES.map((_, i) => interval(i, i + 1) ?? NaN);
    const detailMs = this.detailed ? Object.fromEntries(DETAIL_NAMES.map((name, i) => [name, s.details & (1 << i) ? measuredMs(t, MARKS + 2 * i, MARKS + 2 * i + 1) : null])) as DetailTimes : null;
    this.deliver(s.listener, { sequence: s.sequence, frameIndex: s.frameIndex, status: 'measured', gpuMs, passMs: passes, detailMs, detailWritten: s.details });
  }
}

/** Requires a written-query mask at the call site; equal timestamps are valid quantized zero-duration samples. */
export function measuredMs(t: ArrayLike<bigint>, a: number, b: number): number | null {
  return t[a] > 0n && t[b] >= t[a] ? Number(t[b] - t[a]) / 1e6 : null;
}

/** Legacy latest-value semantics retained for the dynamic-resolution controller. */
export function sectionMs(t: ArrayLike<bigint>, a: number, b: number): number | null {
  return t[b] > t[a] && t[a] > 0n ? Number(t[b] - t[a]) / 1e6 : null;
}
