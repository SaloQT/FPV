/** The benchmark's numbers: a recorder fed once per presented frame and the result it summarises into. Pure; no DOM, no GPU. */

export const BENCH_DEFAULT_SECONDS = 20;
export const BENCH_DEFAULT_WARMUP_S = 2;
/** The run does not end before this many frames were measured, so a very slow device still yields a usable average. */
export const BENCH_MIN_FRAMES = 5;

export interface BenchDevice {
  vendor: string;
  architecture: string;
  description: string;
  software: boolean;
}

export interface BenchResult {
  /** Frames measured divided by the time they took. */
  avgFps: number;
  /** Frame rate of the slowest 1% of the measured frames. */
  p1LowFps: number;
  /** Mean GPU time per frame from timestamp queries; null when the device has none. */
  avgGpuMs: number | null;
  /** Mean GPU time per frame section (names of `PASS_NAMES`); null without timestamp queries. */
  perPassMs: Record<string, number> | null;
  /** Mean share of the output width that was rendered: the render-scale setting times the dynamic-resolution factor. */
  renderScale: number;
  device: BenchDevice;
  frames: number;
  seconds: number;
  renderWidth: number;
  renderHeight: number;
  outWidth: number;
  outHeight: number;
  quality: string;
  refreshHz: number;
}

export interface BenchMeta {
  device: BenchDevice;
  renderWidth: number;
  renderHeight: number;
  outWidth: number;
  outHeight: number;
  quality: string;
  refreshHz: number;
}

/** Collects frames after a warm-up and says when enough were seen. `passNames` names the entries of each `passMs` sample. */
export class BenchRecorder {
  private readonly frameMs: number[] = [];
  private readonly passSum: Float64Array;
  private readonly passN: Int32Array;
  private elapsedS = 0;
  private measuredS = 0;
  private gpuSum = 0;
  private gpuN = 0;
  private scaleSum = 0;

  constructor(
    readonly passNames: readonly string[],
    readonly durationS: number = BENCH_DEFAULT_SECONDS,
    readonly warmupS: number = BENCH_DEFAULT_WARMUP_S,
    readonly minFrames: number = BENCH_MIN_FRAMES,
  ) {
    this.passSum = new Float64Array(passNames.length);
    this.passN = new Int32Array(passNames.length);
  }

  get frames(): number {
    return this.frameMs.length;
  }

  /** Seconds of the whole run so far, warm-up included. */
  get elapsed(): number {
    return this.elapsedS;
  }

  get total(): number {
    return this.warmupS + this.durationS;
  }

  get warmingUp(): boolean {
    return this.elapsedS < this.warmupS;
  }

  get done(): boolean {
    return this.measuredS >= this.durationS && this.frameMs.length >= this.minFrames;
  }

  /** One presented frame. Returns true once the run is complete. */
  /** `scale` is the rendered share of the output width this frame. */
  push(frameMs: number, gpuMs: number, passMs: ArrayLike<number>, scale: number): boolean {
    if (!(frameMs > 0) || !Number.isFinite(frameMs)) return this.done;
    const dt = frameMs / 1000;
    const wasWarm = this.elapsedS < this.warmupS;
    this.elapsedS += dt;
    if (wasWarm) return false;
    this.measuredS += dt;
    this.frameMs.push(frameMs);
    this.scaleSum += scale;
    if (Number.isFinite(gpuMs)) {
      this.gpuSum += gpuMs;
      this.gpuN++;
    }
    for (let i = 0; i < this.passSum.length; i++) {
      const v = passMs[i];
      if (Number.isFinite(v)) {
        this.passSum[i] += v;
        this.passN[i]++;
      }
    }
    return this.done;
  }

  result(meta: BenchMeta): BenchResult {
    const n = this.frameMs.length;
    const sorted = [...this.frameMs].sort((a, b) => b - a);
    const k = Math.max(1, Math.ceil(n * 0.01));
    let worst = 0;
    for (let i = 0; i < k && i < n; i++) worst += sorted[i];
    const perPass: Record<string, number> = {};
    let anyPass = false;
    for (let i = 0; i < this.passNames.length; i++) {
      if (this.passN[i] === 0) continue;
      perPass[this.passNames[i]] = this.passSum[i] / this.passN[i];
      anyPass = true;
    }
    return {
      avgFps: this.measuredS > 0 ? n / this.measuredS : 0,
      p1LowFps: n > 0 ? 1000 / (worst / Math.min(k, n)) : 0,
      avgGpuMs: this.gpuN > 0 ? this.gpuSum / this.gpuN : null,
      perPassMs: anyPass ? perPass : null,
      renderScale: n > 0 ? this.scaleSum / n : 1,
      frames: n,
      seconds: this.measuredS,
      ...meta,
    };
  }
}

/** One-line explanation shown with the numbers: what limits the result. */
export function benchVerdict(r: BenchResult): string {
  if (r.device.software) return 'Software rendering: the numbers only prove the pipeline runs, they say nothing about real GPUs.';
  if (r.refreshHz > 0 && r.avgFps > r.refreshHz * 0.97) {
    const gpu = r.avgGpuMs === null ? '' : ` The GPU needed ${r.avgGpuMs.toFixed(2)} ms per frame, so it could run up to about ${Math.floor(1000 / r.avgGpuMs)} fps with a faster display.`;
    return `The frame rate is pinned to the ${Math.round(r.refreshHz)} Hz display refresh (browsers cannot render faster than the display).${gpu}`;
  }
  return 'The GPU could not keep up with the display refresh at these settings: lower the quality, pick Performance 240, or lower the render scale.';
}
