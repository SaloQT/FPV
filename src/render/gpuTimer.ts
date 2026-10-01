/** Frame sections timed individually; section i runs from mark i to mark i + 1. */
export const PASS_NAMES = ['pre', 'gbuffer', 'rt', 'lighting', 'sky+fwd', 'post'] as const;
export type PassName = (typeof PASS_NAMES)[number];

const MARKS = PASS_NAMES.length + 1;
const RING = 3;
const BYTES = MARKS * 8;

/** Mark indices: FrameBegin, then the end of each section in PASS_NAMES order. */
export const MARK = { FrameBegin: 0, PreEnd: 1, GBufferEnd: 2, RtEnd: 3, LightingEnd: 4, OverlayEnd: 5, FrameEnd: 6 } as const;
export type Mark = (typeof MARK)[keyof typeof MARK];

/**
 * GPU frame timing with timestamp queries. Marks are empty compute passes (the portable way to stamp between passes of any kind); the
 * results are resolved into a ring of 3 mappable buffers and read asynchronously, so a value is typically 2-3 frames old and the CPU
 * never stalls. Every method is a no-op and all results stay null/NaN when the device lacks `timestamp-query`. Browsers coarsen
 * timestamps (about 100 us) unless developer features are on, and a GPU may overlap neighbouring passes, so a section's time is a
 * close estimate, not an exact figure.
 */
export class GpuTimer {
  gpuMs: number | null = null;
  rtMs: number | null = null;
  /** Milliseconds per section (PASS_NAMES order), NaN until the first readback. */
  readonly passMs: number[] = PASS_NAMES.map(() => NaN);
  private readonly querySet: GPUQuerySet | null = null;
  private readonly resolveBuffer: GPUBuffer | null = null;
  private readonly readback: GPUBuffer[] = [];
  private readonly busy: boolean[] = [];
  private pending = -1;
  private disposed = false;

  constructor(private readonly device: GPUDevice, enabled: boolean) {
    if (!enabled) return;
    this.querySet = device.createQuerySet({ label: 'frame timestamps', type: 'timestamp', count: MARKS });
    this.resolveBuffer = device.createBuffer({ label: 'timestamp resolve', size: BYTES, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC });
    for (let i = 0; i < RING; i++) {
      this.readback.push(device.createBuffer({ label: `timestamp readback ${i}`, size: BYTES, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }));
      this.busy.push(false);
    }
  }

  get enabled(): boolean { return this.querySet !== null; }

  mark(enc: GPUCommandEncoder, mark: Mark): void {
    if (!this.querySet) return;
    enc.beginComputePass({ timestampWrites: { querySet: this.querySet, endOfPassWriteIndex: mark } }).end();
  }

  /** Stamps the frame end and queues the copy into a free ring slot (skipped when all slots are still in flight). */
  resolve(enc: GPUCommandEncoder): void {
    if (!this.querySet || !this.resolveBuffer) return;
    this.mark(enc, MARK.FrameEnd);
    this.pending = this.busy.indexOf(false);
    if (this.pending < 0) return;
    enc.resolveQuerySet(this.querySet, 0, MARKS, this.resolveBuffer, 0);
    enc.copyBufferToBuffer(this.resolveBuffer, 0, this.readback[this.pending], 0, BYTES);
  }

  /** Call right after queue.submit of the encoder passed to resolve(). */
  afterSubmit(): void {
    const slot = this.pending;
    if (slot < 0) return;
    this.pending = -1;
    this.busy[slot] = true;
    const buf = this.readback[slot];
    buf.mapAsync(GPUMapMode.READ).then(() => {
      if (this.disposed) return;
      const t = new BigUint64Array(buf.getMappedRange().slice(0));
      buf.unmap();
      this.busy[slot] = false;
      this.store(t);
    }, () => { this.busy[slot] = false; });
  }

  destroy(): void {
    this.disposed = true;
    this.querySet?.destroy();
    this.resolveBuffer?.destroy();
    for (const b of this.readback) b.destroy();
  }

  private store(t: BigUint64Array): void {
    this.gpuMs = sectionMs(t, MARK.FrameBegin, MARK.FrameEnd);
    this.rtMs = sectionMs(t, MARK.GBufferEnd, MARK.RtEnd);
    for (let i = 0; i < PASS_NAMES.length; i++) this.passMs[i] = sectionMs(t, i, i + 1) ?? NaN;
  }
}

/** Time between two timestamps in ms; null when the clock went backwards (a timestamp that was not written reads as 0). */
export function sectionMs(t: ArrayLike<bigint>, a: number, b: number): number | null {
  return t[b] > t[a] && t[a] > 0n ? Number(t[b] - t[a]) / 1e6 : null;
}
