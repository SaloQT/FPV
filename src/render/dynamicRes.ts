/** Pure dynamic-resolution controller (no GPU/DOM access). Time is accumulated from the frame deltas it is fed. */

export const SCALE_STEPS: readonly number[] = [1.0, 0.9, 0.8, 0.7, 0.6, 0.5, 0.42];

const DOWN_WINDOW = 4;
const UP_WINDOW = 120;
const DOWN_FACTOR = 1.02;
const UP_FACTOR_GPU = 0.75;
// Without GPU timestamps frame time is pinned at the display period, so headroom is unobservable: probe upward when on budget.
const UP_FACTOR_PROBE = 1.05;
const MIN_FRAMES_BETWEEN_DOWN = 20;
const MIN_MS_BETWEEN_UP = 3000;
const FAIL_MEMORY_MS = 10000;
const MAX_VALID_SAMPLE_MS = 1000;
const BUCKET_MS = 250;
const BUCKETS = 12;

class MeanWindow {
  private readonly buf: Float64Array;
  private n = 0;
  private head = 0;
  private sum = 0;
  constructor(readonly size: number) { this.buf = new Float64Array(size); }
  push(v: number): void {
    if (this.n === this.size) this.sum -= this.buf[this.head]; else this.n++;
    this.buf[this.head] = v;
    this.sum += v;
    this.head = (this.head + 1) % this.size;
  }
  get full(): boolean { return this.n === this.size; }
  get mean(): number { return this.n ? this.sum / this.n : 0; }
  clear(): void { this.n = 0; this.head = 0; this.sum = 0; }
}

/** Estimates the display refresh period from rAF deltas: median of per-250ms minima over ~3 s, then lightly smoothed. */
export class DisplayPeriodEstimator {
  private readonly minima = new Float64Array(BUCKETS).fill(Infinity);
  private readonly scratch = new Float64Array(BUCKETS);
  private bucket = 0;
  private bucketMs = 0;
  private est = 0;

  get periodMs(): number { return this.est; }

  push(frameMs: number): void {
    if (frameMs > MAX_VALID_SAMPLE_MS || frameMs <= 0) return;
    if (frameMs < this.minima[this.bucket]) this.minima[this.bucket] = frameMs;
    this.bucketMs += frameMs;
    if (this.bucketMs < BUCKET_MS) return;
    this.bucketMs = 0;
    let n = 0;
    for (let i = 0; i < BUCKETS; i++) if (this.minima[i] !== Infinity) this.scratch[n++] = this.minima[i];
    const view = this.scratch.subarray(0, n).sort();
    const median = view[n >> 1];
    this.est = this.est === 0 ? median : this.est + (median - this.est) * 0.2;
    this.bucket = (this.bucket + 1) % BUCKETS;
    this.minima[this.bucket] = Infinity;
  }
}

export class DynamicResolutionController {
  private index = 0;
  private clock = 0;
  private sinceChangeFrames = 0;
  private lastUpMs = -Infinity;
  private readonly failedAt = new Float64Array(SCALE_STEPS.length).fill(-Infinity);
  private readonly fast = new MeanWindow(DOWN_WINDOW);
  private readonly slow = new MeanWindow(UP_WINDOW);
  private readonly display = new DisplayPeriodEstimator();

  get scale(): number { return SCALE_STEPS[this.index]; }
  get stepIndex(): number { return this.index; }
  get displayPeriodMs(): number { return this.display.periodMs; }

  budgetMs(targetFps: number): number {
    return Math.max(1000 / Math.max(targetFps, 1), this.display.periodMs);
  }

  reset(): void {
    this.index = 0;
    this.sinceChangeFrames = 0;
    this.lastUpMs = -Infinity;
    this.failedAt.fill(-Infinity);
    this.fast.clear();
    this.slow.clear();
  }

  /** Feed one frame; returns the scale to render the NEXT frame at. */
  update(gpuMs: number | null, frameMs: number, targetFps: number, enabled: boolean): number {
    if (!enabled) {
      if (this.index !== 0) this.reset();
      return 1;
    }
    if (!(frameMs > 0) || frameMs > MAX_VALID_SAMPLE_MS) return this.scale;
    this.clock += frameMs;
    this.display.push(frameMs);
    const usingGpu = gpuMs !== null && gpuMs > 0;
    const sample = usingGpu ? Math.min(gpuMs as number, MAX_VALID_SAMPLE_MS) : frameMs;
    this.fast.push(sample);
    this.slow.push(sample);
    this.sinceChangeFrames++;
    const budget = this.budgetMs(targetFps);
    const last = SCALE_STEPS.length - 1;

    if (this.index < last && this.sinceChangeFrames >= MIN_FRAMES_BETWEEN_DOWN && this.fast.full && this.fast.mean > budget * DOWN_FACTOR) {
      this.failedAt[this.index] = this.clock;
      this.change(this.index + 1);
    } else if (
      this.index > 0 && this.slow.full && this.clock - this.lastUpMs >= MIN_MS_BETWEEN_UP &&
      this.slow.mean < budget * (usingGpu ? UP_FACTOR_GPU : UP_FACTOR_PROBE) &&
      this.clock - this.failedAt[this.index - 1] >= FAIL_MEMORY_MS
    ) {
      this.change(this.index - 1);
      this.lastUpMs = this.clock;
    }
    return this.scale;
  }

  private change(to: number): void {
    this.index = to;
    this.sinceChangeFrames = 0;
    this.fast.clear();
    this.slow.clear();
  }
}

/** Render-target size for an output size: round(out * renderScale * dynamicScale), even, >= 64. */
export function scaledSize(outPx: number, renderScale: number, dynamicScale: number): number {
  const v = Math.round(outPx * renderScale * dynamicScale);
  return Math.max(64, v + (v & 1));
}
