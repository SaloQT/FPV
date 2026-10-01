/** Pure dynamic-resolution controller (no GPU/DOM access). Time is accumulated from the frame deltas it is fed. */

export const SCALE_STEPS: readonly number[] = [1.0, 0.9, 0.8, 0.7, 0.6, 0.5, 0.42];

const DOWN_WINDOW = 6;
const UP_WINDOW = 120;
const DOWN_FACTOR = 1.02;
/** Scale up only when the cost predicted at the next step (GPU time x area ratio) stays this far under the budget: the dead band. */
const UP_PREDICT_FACTOR = 0.85;
/** A frame this much longer than the budget missed a display refresh (frame times are quantised to refresh periods without GPU timing). */
const MISS_FACTOR = 1.3;
const MISS_WINDOW = 90;
const MISS_RATE_DOWN = 0.15;
const OVERSHOOT_TWO_STEPS = 1.6;
const MIN_FRAMES_BETWEEN_DOWN = 20;
const MIN_FRAMES_BETWEEN_DOWN_FRAME_MODE = 30;
const MIN_MS_BETWEEN_UP = 3000;
/** A step that was left again soon after reaching it is not tried again for this long; the wait doubles with every such failure. */
const FAIL_MEMORY_MS = 8000;
const MAX_FAIL_DOUBLINGS = 3;
const QUIET_RESET_MS = 60000;
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

/** The frame rate the controller aims at: the explicit target, or the measured display refresh when it is 0, never above the frame cap. */
export function resolveTargetFps(targetFps: number, displayHz: number, frameCap: number): number {
  let t = targetFps > 0 ? targetFps : displayHz > 0 ? displayHz : 60;
  if (frameCap > 0) t = Math.min(t, frameCap);
  return t;
}

export class DynamicResolutionController {
  private index = 0;
  private clock = 0;
  private sinceChangeFrames = 0;
  private lastChangeMs = 0;
  private lastUpMs = -Infinity;
  private cleanMs = 0;
  private failDoublings = 0;
  private usingGpu = false;
  private measuredPeriodMs = 0;
  private missCount = 0;
  private missHead = 0;
  private missFill = 0;
  private readonly misses = new Uint8Array(MISS_WINDOW);
  private readonly failedAt = new Float64Array(SCALE_STEPS.length).fill(-Infinity);
  private readonly fast = new MeanWindow(DOWN_WINDOW);
  private readonly slow = new MeanWindow(UP_WINDOW);
  private readonly display = new DisplayPeriodEstimator();

  get scale(): number { return SCALE_STEPS[this.index]; }
  get stepIndex(): number { return this.index; }
  /**
   * The display refresh period: the startup measurement when there is one, lowered if frames ever arrive faster than it. Frame times
   * alone cannot tell a slow display from a slow GPU (every frame of a GPU-bound app looks like a refresh), so the measurement leads.
   */
  get displayPeriodMs(): number {
    const est = this.display.periodMs;
    if (this.measuredPeriodMs <= 0) return est;
    return est > 0 ? Math.min(this.measuredPeriodMs, est) : this.measuredPeriodMs;
  }

  /** The refresh rate measured at startup (0 forgets it). */
  setMeasuredRefreshHz(hz: number): void {
    this.measuredPeriodMs = hz > 0 ? 1000 / hz : 0;
  }
  /** True while decisions come from GPU timestamps, false while they come from frame times. */
  get gpuDriven(): boolean { return this.usingGpu; }

  budgetMs(targetFps: number): number {
    return Math.max(1000 / Math.max(targetFps, 1), this.displayPeriodMs);
  }

  reset(): void {
    this.index = 0;
    this.lastUpMs = -Infinity;
    this.failDoublings = 0;
    this.failedAt.fill(-Infinity);
    this.lastChangeMs = this.clock;
    this.clearWindows();
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
    const gpu = gpuMs !== null && gpuMs > 0;
    if (gpu !== this.usingGpu) {
      this.usingGpu = gpu;
      this.clearWindows();
    }
    this.sinceChangeFrames++;
    const budget = this.budgetMs(targetFps);
    if (this.clock - this.lastChangeMs >= QUIET_RESET_MS) this.failDoublings = 0;
    if (gpu) this.updateGpu(Math.min(gpuMs as number, MAX_VALID_SAMPLE_MS), budget);
    else this.updateFrameTime(frameMs, budget);
    return this.scale;
  }

  private updateGpu(gpuMs: number, budget: number): void {
    this.fast.push(gpuMs);
    this.slow.push(gpuMs);
    const last = SCALE_STEPS.length - 1;
    if (this.index < last && this.sinceChangeFrames >= MIN_FRAMES_BETWEEN_DOWN && this.fast.full && this.fast.mean > budget * DOWN_FACTOR) {
      this.stepDown(this.fast.mean > budget * OVERSHOOT_TWO_STEPS ? 2 : 1);
      return;
    }
    if (this.index === 0 || !this.slow.full || !this.upAllowed()) return;
    const ratio = SCALE_STEPS[this.index - 1] / SCALE_STEPS[this.index];
    if (this.slow.mean * ratio * ratio < budget * UP_PREDICT_FACTOR) this.stepUp();
  }

  private updateFrameTime(frameMs: number, budget: number): void {
    const miss = frameMs > budget * MISS_FACTOR ? 1 : 0;
    if (this.missFill === MISS_WINDOW) this.missCount -= this.misses[this.missHead]; else this.missFill++;
    this.misses[this.missHead] = miss;
    this.missCount += miss;
    this.missHead = (this.missHead + 1) % MISS_WINDOW;
    this.cleanMs = miss ? 0 : this.cleanMs + frameMs;
    const rate = this.missCount / this.missFill;
    const last = SCALE_STEPS.length - 1;
    if (this.index < last && this.sinceChangeFrames >= MIN_FRAMES_BETWEEN_DOWN_FRAME_MODE && rate > MISS_RATE_DOWN) {
      this.stepDown(rate > 0.5 ? 2 : 1);
      return;
    }
    if (this.index > 0 && this.cleanMs >= MIN_MS_BETWEEN_UP * (1 << this.failDoublings) && this.upAllowed()) this.stepUp();
  }

  private upAllowed(): boolean {
    return this.clock - this.lastUpMs >= MIN_MS_BETWEEN_UP && this.clock - this.failedAt[this.index - 1] >= FAIL_MEMORY_MS * (1 << this.failDoublings);
  }

  private stepDown(steps: number): void {
    const from = this.index;
    const justProbed = this.clock - this.lastUpMs < FAIL_MEMORY_MS;
    this.failedAt[from] = this.clock;
    if (justProbed && this.failDoublings < MAX_FAIL_DOUBLINGS) this.failDoublings++;
    this.index = Math.min(SCALE_STEPS.length - 1, from + steps);
    this.changed();
  }

  private stepUp(): void {
    this.index--;
    this.lastUpMs = this.clock;
    this.changed();
  }

  private changed(): void {
    this.lastChangeMs = this.clock;
    this.clearWindows();
  }

  private clearWindows(): void {
    this.sinceChangeFrames = 0;
    this.cleanMs = 0;
    this.fast.clear();
    this.slow.clear();
    this.misses.fill(0);
    this.missCount = 0;
    this.missHead = 0;
    this.missFill = 0;
  }
}

/** Render-target size for an output size: round(out * renderScale * dynamicScale), even, >= 64. */
export function scaledSize(outPx: number, renderScale: number, dynamicScale: number): number {
  const v = Math.round(outPx * renderScale * dynamicScale);
  return Math.max(64, v + (v & 1));
}
