import { DETAIL_NAMES, type DetailName, type GpuTimingSample } from '../render/gpuTimer';

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
  device?: string;
  classification?: 'software' | 'unknown' | 'unverified';
}

export interface ProfileMode { requested: boolean; supported: boolean; mode: 'coarse' | 'detailed' | 'unsupported' }
export const PROFILE_CATEGORIES = ['probes', 'screenRays', 'denoise', 'clouds', 'post', 'rtAux', 'rtLatch'] as const;
export type ProfileCategory = (typeof PROFILE_CATEGORIES)[number];
const CATEGORY_INTERVALS: Record<Exclude<ProfileCategory, 'post'>, readonly DetailName[]> = {
  probes: ['probes'], screenRays: ['shadowRays', 'giRays', 'specularRays'], denoise: ['shadowDenoise', 'giDenoise', 'specularDenoise'],
  clouds: ['clouds'], rtAux: ['rtAux'], rtLatch: ['rtLatch'],
};
export interface BenchResult {
  schemaVersion: 2;
  provenance?: Record<string, unknown>;
  incompleteReason?: string | null;
  gpuTiming: { received: number; measured: number; dropped: number; failed: number; invalid: number; pending: number; firstFrame: number | null; lastFrame: number | null };
  profile: ProfileMode & { perCategoryMs: Record<ProfileCategory, number | null>; samples: Record<ProfileCategory, number>; skipped: Record<ProfileCategory, number>; invalid: Record<ProfileCategory, number>; overhead: string };
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
  profiling?: ProfileMode;
  provenance?: Record<string, unknown>;
  incompleteReason?: string | null;
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
  private readonly acceptedFrames = new Set<number>();
  private readonly receivedSamples = new Set<number>();
  private dropped = 0;
  private failed = 0;
  private invalid = 0;
  private firstFrame: number | null = null;
  private lastFrame: number | null = null;
  private readonly detailSum = new Float64Array(PROFILE_CATEGORIES.length);
  private readonly detailN = new Int32Array(PROFILE_CATEGORIES.length);
  private readonly detailSkipped = new Int32Array(PROFILE_CATEGORIES.length);
  private readonly detailInvalid = new Int32Array(PROFILE_CATEGORIES.length);

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
  push(frameMs: number, gpuMs: number, passMs: ArrayLike<number>, scale: number, frameIndex?: number): boolean {
    if (!(frameMs > 0) || !Number.isFinite(frameMs)) return this.done;
    const dt = frameMs / 1000;
    const wasWarm = this.elapsedS < this.warmupS;
    this.elapsedS += dt;
    if (wasWarm) return false;
    this.measuredS += dt;
    this.frameMs.push(frameMs);
    if (frameIndex !== undefined) {
      this.acceptedFrames.add(frameIndex);
      this.firstFrame ??= frameIndex;
      this.lastFrame = frameIndex;
    }
    this.scaleSum += scale;
    this.addTimes(gpuMs, passMs);
    return this.done;
  }

  private addTimes(gpuMs: number, passMs: ArrayLike<number>): void {
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
  }

  /** Called once per asynchronous completion, after its source frame was admitted (never from latest renderer stats). */
  recordGpu(sample: GpuTimingSample): void {
    if (!this.acceptedFrames.has(sample.frameIndex) || this.receivedSamples.has(sample.sequence)) return;
    this.receivedSamples.add(sample.sequence);
    if (sample.status === 'dropped') { this.dropped++; return; }
    if (sample.status === 'failed') { this.failed++; return; }
    if (sample.gpuMs === null) this.invalid++;
    this.addTimes(sample.gpuMs ?? NaN, sample.passMs);
    if (!sample.detailMs) return;
    for (let i = 0; i < PROFILE_CATEGORIES.length; i++) {
      const name = PROFILE_CATEGORIES[i];
      let value: number | null = null;
      let written = false;
      if (name === 'post') {
        written = true;
        const ms = sample.passMs[this.passNames.indexOf('post')];
        value = Number.isFinite(ms) ? ms : null;
      } else {
        const intervals = CATEGORY_INTERVALS[name].filter(key => sample.detailWritten & (1 << DETAIL_NAMES.indexOf(key)));
        written = intervals.length > 0;
        if (written && intervals.every(key => sample.detailMs![key] !== null)) value = intervals.reduce((sum, key) => sum + sample.detailMs![key]!, 0);
      }
      if (!written) this.detailSkipped[i]++;
      else if (value === null) this.detailInvalid[i]++;
      else { this.detailSum[i] += value; this.detailN[i]++; }
    }
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
    const profile = meta.profiling ?? { requested: false, supported: this.gpuN > 0, mode: this.gpuN > 0 ? 'coarse' as const : 'unsupported' as const };
    const categoryRecord = <T>(value: (i: number) => T): Record<ProfileCategory, T> => Object.fromEntries(PROFILE_CATEGORIES.map((name, i) => [name, value(i)])) as Record<ProfileCategory, T>;
    const { profiling: _profiling, ...metadata } = meta;
    return {
      schemaVersion: 2,
      gpuTiming: { received: this.receivedSamples.size, measured: this.gpuN, dropped: this.dropped, failed: this.failed, invalid: this.invalid,
        pending: profile.supported ? Math.max(0, this.acceptedFrames.size - this.receivedSamples.size) : 0, firstFrame: this.firstFrame, lastFrame: this.lastFrame },
      profile: { ...profile,
        perCategoryMs: categoryRecord(i => this.detailN[i] ? this.detailSum[i] / this.detailN[i] : null),
        samples: categoryRecord(i => this.detailN[i]), skipped: categoryRecord(i => this.detailSkipped[i]), invalid: categoryRecord(i => this.detailInvalid[i]),
        overhead: profile.mode === 'detailed' ? 'Diagnostic timings include profiling-only RT pass segmentation and timestamp overhead. Compare throughput with gpuProfile off.' : profile.mode === 'unsupported' ? 'Timestamp queries unavailable; GPU timing is not measured and no profiling-only segmentation is performed.' : 'Existing coarse timestamp markers only; no profiling-only pass segmentation.',
      },
      avgFps: this.measuredS > 0 ? n / this.measuredS : 0,
      p1LowFps: n > 0 ? 1000 / (worst / Math.min(k, n)) : 0,
      avgGpuMs: this.gpuN > 0 ? this.gpuSum / this.gpuN : null,
      perPassMs: anyPass ? perPass : null,
      renderScale: n > 0 ? this.scaleSum / n : 1,
      frames: n,
      seconds: this.measuredS,
      ...metadata,
    };
  }
}

/** One-line explanation shown with the numbers: what limits the result. */
export function benchVerdict(r: BenchResult): string {
  if (r.incompleteReason) return `Incomplete benchmark: ${r.incompleteReason}`;
  if (r.device.software) return 'Software rendering: these numbers validate the pipeline, not physical-GPU performance.';
  if (r.device.classification === 'unknown' || !(r.device.vendor || r.device.architecture || r.device.description)) return 'Unknown adapter: hardware performance is unverified.';
  if (r.profile.mode === 'detailed') return 'Diagnostic run: RT pass segmentation adds overhead. Use profiling-off runs to compare throughput.';
  if (r.refreshHz > 0 && r.avgFps > r.refreshHz * 0.97) return `The observed frame rate is near the ${Math.round(r.refreshHz)} Hz refresh setting; it may be presentation-limited.`;
  return 'Observed frame timing includes CPU, GPU and browser scheduling. It does not establish which one limits throughput.';
}
