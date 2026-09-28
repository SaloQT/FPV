import { el, setHidden, setText } from './dom';
import { FrameHistory, PERF_LABELS, formatPerf, newFrameSummary, newPerfSample, type PerfSource } from './perfModel';
import './ui.css';

export interface PerfOptions {
  /** The `#ui` element the overlay is appended to. */
  root: HTMLElement;
  source: PerfSource;
  /** Samples kept for the graph; the default is four seconds at 60 Hz. */
  history?: number;
}

const REFRESH_MS = 250;
const GRAPH_W = 264;
const GRAPH_H = 56;
const LINE = '#4db4ff';
const SPIKE = '#ffb14d';
const GUIDE = 'rgba(255, 255, 255, 0.22)';

/** The F3 overlay: frame-time graph and the numbers behind it. It never takes input and repaints about four times a second. */
export class PerfOverlay {
  readonly element: HTMLElement;
  private readonly history: FrameHistory;
  private readonly summary = newFrameSummary();
  private readonly sample = newPerfSample();
  private readonly lines: string[] = [];
  private readonly values: HTMLElement[] = [];
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly scale: number;
  private lastPaint = -Infinity;

  constructor(private readonly opts: PerfOptions) {
    this.history = new FrameHistory(opts.history ?? 240);
    const list = el('dl', 'fpv-perf-list');
    for (const label of PERF_LABELS) {
      const value = el('dd', 'fpv-perf-value');
      this.values.push(value);
      list.append(el('dt', '', label), value);
    }
    const canvas = el('canvas', 'fpv-perf-graph');
    this.scale = Math.max(1, window.devicePixelRatio || 1);
    canvas.width = GRAPH_W * this.scale;
    canvas.height = GRAPH_H * this.scale;
    this.ctx = canvas.getContext('2d');
    this.element = el('aside', 'fpv-perf', el('h2', 'fpv-perf-title', 'Performance'), list, canvas);
    this.element.setAttribute('aria-label', 'Performance');
    this.element.hidden = true;
    opts.root.append(this.element);
  }

  get visible(): boolean {
    return !this.element.hidden;
  }

  show(): void {
    if (this.visible) return;
    setHidden(this.element, false);
    this.lastPaint = -Infinity;
  }

  hide(): void {
    setHidden(this.element, true);
  }

  toggle(): void {
    if (this.visible) this.hide();
    else this.show();
  }

  /** Once per rendered frame: `frameMs` is the time since the previous frame, `nowMs` any monotonic clock. */
  frame(frameMs: number, nowMs: number): void {
    this.history.push(frameMs);
    if (!this.visible || nowMs - this.lastPaint < REFRESH_MS) return;
    this.lastPaint = nowMs;
    this.opts.source.sample(this.sample);
    this.history.summarize(this.summary);
    formatPerf(this.sample, this.summary, this.lines);
    for (let i = 0; i < this.values.length; i++) setText(this.values[i], this.lines[i]);
    this.drawGraph();
  }

  dispose(): void {
    this.element.remove();
  }

  private drawGraph(): void {
    const ctx = this.ctx;
    const n = this.history.length;
    if (ctx === null) return;
    const s = this.scale;
    ctx.clearRect(0, 0, GRAPH_W * s, GRAPH_H * s);
    if (n < 2) return;
    const avg = this.summary.avgMs;
    const top = Math.max(8, Math.min(this.summary.worstMs, avg * 4));
    const y = (ms: number): number => (GRAPH_H - 3 - Math.min(ms / top, 1) * (GRAPH_H - 6)) * s;
    const dx = (GRAPH_W * s) / (this.history.capacity - 1);
    const x0 = (this.history.capacity - n) * dx;
    ctx.lineWidth = s;
    ctx.strokeStyle = GUIDE;
    ctx.beginPath();
    ctx.moveTo(0, y(avg));
    ctx.lineTo(GRAPH_W * s, y(avg));
    ctx.stroke();
    ctx.strokeStyle = LINE;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const px = x0 + i * dx;
      if (i === 0) ctx.moveTo(px, y(this.history.at(i)));
      else ctx.lineTo(px, y(this.history.at(i)));
    }
    ctx.stroke();
    ctx.fillStyle = SPIKE;
    for (let i = 0; i < n; i++) {
      const ms = this.history.at(i);
      if (ms > avg * 2 && ms > 8) ctx.fillRect(x0 + i * dx - s, y(ms) - s, 2 * s, 2 * s);
    }
  }
}
