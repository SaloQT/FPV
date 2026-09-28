import type { RenderQuality } from '../contracts';

/** What the F3 overlay shows besides frame times; the app fills it from the renderer, the session and the adapter. */
export interface PerfSample {
  cpuMs: number;
  /** GPU time of the last frame, or NaN when the device has no timestamp queries. */
  gpuMs: number;
  renderWidth: number;
  renderHeight: number;
  /** Dynamic resolution factor in 0..1 (1 is the full render scale). */
  scale: number;
  physicsMs: number;
  physicsSteps: number;
  quality: RenderQuality;
  adapter: string;
}

export interface PerfSource {
  /** Writes the current numbers into `out`; called a few times a second, never per frame. */
  sample(out: PerfSample): void;
}

export function newPerfSample(): PerfSample {
  return { cpuMs: 0, gpuMs: NaN, renderWidth: 0, renderHeight: 0, scale: 1, physicsMs: 0, physicsSteps: 0, quality: 'high', adapter: '' };
}

export interface FrameSummary {
  avgMs: number;
  avgFps: number;
  /** Frame rate of the slowest 1% of frames in the window ("1% low"). */
  lowFps: number;
  worstMs: number;
}

export function newFrameSummary(): FrameSummary {
  return { avgMs: 0, avgFps: 0, lowFps: 0, worstMs: 0 };
}

/** The last `capacity` frame times in a fixed ring; pushing never allocates. */
export class FrameHistory {
  private readonly ring: Float32Array;
  private readonly scratch: Float32Array;
  private head = 0;
  private n = 0;

  constructor(readonly capacity = 240) {
    this.ring = new Float32Array(capacity);
    this.scratch = new Float32Array(capacity);
  }

  get length(): number {
    return this.n;
  }

  /** Records one frame time in milliseconds; a pause or a bad reading (zero, negative, NaN) is not a frame. */
  push(ms: number): void {
    if (!(ms > 0) || !Number.isFinite(ms)) return;
    this.ring[this.head] = ms;
    this.head = (this.head + 1) % this.capacity;
    if (this.n < this.capacity) this.n++;
  }

  /** The i-th sample, 0 being the oldest. */
  at(i: number): number {
    return this.ring[(this.head - this.n + i + this.capacity * 2) % this.capacity];
  }

  clear(): void {
    this.ring.fill(0);
    this.head = 0;
    this.n = 0;
  }

  summarize(out: FrameSummary): FrameSummary {
    if (this.n === 0) {
      out.avgMs = out.avgFps = out.lowFps = out.worstMs = 0;
      return out;
    }
    let sum = 0;
    for (let i = 0; i < this.n; i++) sum += this.ring[i];
    // Slots past `n` are still zero, so sorting the whole copy leaves the slowest frames at the end.
    this.scratch.set(this.ring);
    this.scratch.sort();
    const k = Math.max(1, Math.ceil(this.n * 0.01));
    let worst = 0;
    for (let i = 0; i < k; i++) worst += this.scratch[this.capacity - 1 - i];
    out.avgMs = sum / this.n;
    out.avgFps = 1000 / out.avgMs;
    out.lowFps = 1000 / (worst / k);
    out.worstMs = this.scratch[this.capacity - 1];
    return out;
  }
}

export const PERF_LABELS: readonly string[] = ['FPS', 'Frame', 'CPU', 'GPU', 'Render', 'Physics', 'Quality', 'Adapter'];

function ms(v: number): string {
  return `${v.toFixed(v < 10 ? 2 : 1)} ms`;
}

/** Fills `out` with one display string per `PERF_LABELS` entry. */
export function formatPerf(s: PerfSample, f: FrameSummary, out: string[]): string[] {
  out[0] = f.avgFps > 0 ? `${Math.round(f.avgFps)} avg, ${Math.round(f.lowFps)} 1% low` : '-';
  out[1] = f.avgMs > 0 ? `${ms(f.avgMs)} (worst ${ms(f.worstMs)})` : '-';
  out[2] = ms(s.cpuMs);
  out[3] = Number.isFinite(s.gpuMs) ? ms(s.gpuMs) : 'not measured';
  out[4] = `${s.renderWidth} x ${s.renderHeight} at ${Math.round(s.scale * 100)}%`;
  out[5] = `${ms(s.physicsMs)}, ${s.physicsSteps} ${s.physicsSteps === 1 ? 'step' : 'steps'}`;
  out[6] = s.quality;
  out[7] = s.adapter.length > 0 ? s.adapter : 'unknown';
  return out;
}
