import type { RenderQuality } from '../contracts';

/** What the F3 overlay shows besides frame times; the app fills it from the renderer, the session and the adapter. */
export interface PerfSample {
  cpuMs: number;
  /** GPU time of the last frame, or NaN when the device has no timestamp queries. */
  gpuMs: number;
  renderWidth: number;
  renderHeight: number;
  /** Width of the output (canvas) in pixels, to show how much of it is rendered; 0 when unknown. */
  outWidth: number;
  /** Dynamic resolution factor in 0..1 (1 is the full render scale). */
  scale: number;
  physicsMs: number;
  physicsSteps: number;
  quality: RenderQuality;
  adapter: string;
  /** 'Performance 240' preset on top of `quality`. */
  performance240: boolean;
  /** Display refresh rate measured at startup in Hz; 0 when it was not measured. */
  refreshHz: number;
  /** The frame rate dynamic resolution aims at. */
  targetFps: number;
  /** Frame cap in fps; 0 means none. */
  frameCap: number;
  /** What the dynamic-resolution controller decides on. */
  driver: 'gpu' | 'frame-time' | 'off';
  /** GPU milliseconds per frame section (NaN when not measured), named by `PERF_PASSES`. */
  passMs: number[];
  /** Every GPU, shader and module error so far. */
  errors: number;
  /** The adapter is a software rasteriser. */
  software: boolean;
}

/** Frame sections in the order of `GpuTimer.passMs`, with the names the overlay shows. */
export const PERF_PASSES: readonly string[] = ['Pre (LUTs, culling)', 'G-buffer', 'Ray tracing', 'Lighting', 'Sky and forward', 'Post'];

export interface PerfSource {
  /** Writes the current numbers into `out`; called a few times a second, never per frame. */
  sample(out: PerfSample): void;
}

export function newPerfSample(): PerfSample {
  return {
    cpuMs: 0, gpuMs: NaN, renderWidth: 0, renderHeight: 0, outWidth: 0, scale: 1, physicsMs: 0, physicsSteps: 0, quality: 'high', adapter: '',
    performance240: false, refreshHz: 0, targetFps: 0, frameCap: 0, driver: 'off', passMs: PERF_PASSES.map(() => NaN), errors: 0, software: false,
  };
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

export const PERF_LABELS: readonly string[] = ['FPS', 'Frame', 'CPU', 'GPU', 'Render', 'Display', 'Target', 'Physics', 'Quality', 'Adapter', 'Errors'];

function ms(v: number): string {
  return `${v.toFixed(v < 10 ? 2 : 1)} ms`;
}

/** "960 x 540, 50% of output" plus the dynamic-resolution factor while it is below 100%. */
function renderText(s: PerfSample): string {
  const size = `${s.renderWidth} x ${s.renderHeight}`;
  const share = s.outWidth > 0 ? `, ${Math.round((s.renderWidth / s.outWidth) * 100)}% of output` : '';
  const dyn = s.scale < 0.995 ? `, dynamic ${Math.round(s.scale * 100)}%` : '';
  return size + share + dyn;
}

const DRIVER_TEXT: Record<PerfSample['driver'], string> = { gpu: 'GPU timed', 'frame-time': 'frame timed', off: 'dynamic res off' };

/** Fills `out` with one display string per `PERF_LABELS` entry. */
export function formatPerf(s: PerfSample, f: FrameSummary, out: string[]): string[] {
  out[0] = f.avgFps > 0 ? `${Math.round(f.avgFps)} avg, ${Math.round(f.lowFps)} 1% low` : '-';
  out[1] = f.avgMs > 0 ? `${ms(f.avgMs)} (worst ${ms(f.worstMs)})` : '-';
  out[2] = ms(s.cpuMs);
  out[3] = Number.isFinite(s.gpuMs) ? ms(s.gpuMs) : 'not measured (no timestamp-query)';
  out[4] = renderText(s);
  const display = s.refreshHz > 0 ? `${Math.round(s.refreshHz)} Hz measured` : 'not measured';
  out[5] = s.frameCap > 0 ? `${display}, cap ${s.frameCap}` : display;
  out[6] = s.targetFps > 0 ? `${Math.round(s.targetFps)} fps, ${DRIVER_TEXT[s.driver]}` : '-';
  out[7] = `${ms(s.physicsMs)}, ${s.physicsSteps} ${s.physicsSteps === 1 ? 'step' : 'steps'}`;
  out[8] = s.performance240 ? `${s.quality} + Performance 240` : s.quality;
  out[9] = s.adapter.length > 0 ? (s.software ? `${s.adapter} (software)` : s.adapter) : 'unknown';
  out[10] = String(s.errors);
  return out;
}

/** Per-section GPU times for the overlay table: `text[i]` is "1.23 ms", `share[i]` the section's fraction of the measured total (0..1). Returns false when nothing was measured. */
export function formatPasses(passMs: readonly number[], text: string[], share: number[]): boolean {
  let total = 0;
  for (const v of passMs) if (Number.isFinite(v)) total += v;
  for (let i = 0; i < passMs.length; i++) {
    const v = passMs[i];
    const ok = Number.isFinite(v);
    text[i] = ok ? ms(v) : '-';
    share[i] = ok && total > 0 ? v / total : 0;
  }
  return total > 0;
}
