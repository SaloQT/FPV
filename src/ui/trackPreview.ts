import type { TrackData } from '../contracts';
import { el, setHidden, setText } from './dom';
import {
  buildPreview, describePreview, GATE_COLORS, GATE_KIND_LABELS, idlePreview, niceScaleBar, previewStats, type PreviewModel, type PreviewState,
} from './trackPreviewModel';
import './flow.css';

const LOW = [59, 130, 246] as const;
const HIGH = [255, 177, 77] as const;
const MAX_LABELLED_GATES = 24;

function heightColor(t: number): string {
  const c = (i: 0 | 1 | 2): number => Math.round(LOW[i] + (HIGH[i] - LOW[i]) * t);
  return `rgb(${c(0)},${c(1)},${c(2)})`;
}

/**
 * The top-down map of the generated course on a 2D canvas: the centreline coloured by height, every gate as a bar across the
 * line of flight in its kind's colour, numbered, the start pad with its heading, a scale bar and north. A progress bar covers
 * it while the next course is being built; the old course stays visible underneath.
 */
export class TrackPreview {
  readonly root: HTMLElement;
  private readonly canvas = el('canvas', 'fpv-map-canvas');
  private readonly status = el('div', 'fpv-map-status');
  private readonly stage = el('span', 'fpv-map-stage');
  private readonly bar = el('div', 'fpv-map-bar-fill');
  private readonly summary = el('p', 'fpv-map-summary');
  private readonly summaryTime = el('span', 'fpv-map-summary-time');
  private readonly summaryCourse = el('span', '');
  private readonly legend = el('div', 'fpv-map-legend');
  private state: PreviewState = idlePreview(null);
  private model: PreviewModel | null = null;
  private modelKey = '';
  private modelTrack: TrackData | null = null;
  private frame = 0;
  private observer: ResizeObserver | null = null;

  constructor() {
    this.canvas.setAttribute('role', 'img');
    this.canvas.setAttribute('aria-label', 'Top-down map of the track');
    this.status.append(this.stage, el('div', 'fpv-map-bar', this.bar));
    this.status.setAttribute('role', 'status');
    this.status.hidden = true;
    this.summary.append(this.summaryCourse, this.summaryTime);
    this.root = el('div', 'fpv-map', el('div', 'fpv-map-frame', this.canvas, this.status), this.summary, this.legend);
    if (typeof ResizeObserver !== 'undefined') {
      this.observer = new ResizeObserver(() => this.schedule());
      this.observer.observe(this.canvas);
    }
  }

  setState(state: PreviewState): void {
    const trackChanged = state.track !== this.state.track;
    this.state = state;
    if (trackChanged) this.paintSummary(state.track);
    this.paintStatus();
    this.schedule();
  }

  /** Draws now when the map is on screen (the start screen shows it again after other panels). */
  refresh(): void {
    this.schedule();
  }

  dispose(): void {
    cancelAnimationFrame(this.frame);
    this.observer?.disconnect();
    this.root.remove();
  }

  private paintStatus(): void {
    const s = this.state;
    const busy = s.status === 'working';
    const failed = s.status === 'error';
    setHidden(this.status, !busy && !failed);
    this.status.classList.toggle('fpv-map-status--error', failed);
    this.canvas.classList.toggle('fpv-map-canvas--busy', busy);
    setText(this.stage, failed ? s.message : `${s.stage || 'Working'}  ${Math.round(s.progress * 100)}%`);
    this.bar.style.width = `${Math.round(Math.min(Math.max(s.progress, 0), 1) * 100)}%`;
    setHidden(this.bar.parentElement as HTMLElement, failed);
  }

  private paintSummary(track: TrackData | null): void {
    if (track === null) {
      setText(this.summaryCourse, 'No track yet');
      setText(this.summaryTime, '');
      this.legend.replaceChildren();
      return;
    }
    const text = describePreview(previewStats(track));
    setText(this.summaryCourse, text.course);
    setText(this.summaryTime, text.time);
    const kinds = Array.from(new Set(track.gates.map((g) => g.kind)));
    this.legend.replaceChildren(
      ...kinds.map((k) => {
        const dot = el('i', 'fpv-map-dot');
        dot.style.background = GATE_COLORS[k];
        return el('span', 'fpv-map-key', dot, GATE_KIND_LABELS[k]);
      }),
    );
  }

  private schedule(): void {
    if (this.frame !== 0) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.draw();
    });
  }

  private draw(): void {
    const c = this.canvas;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(c.clientWidth * dpr);
    const h = Math.round(c.clientHeight * dpr);
    if (w < 2 || h < 2) return;
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    const g = c.getContext('2d');
    if (g === null) return;
    g.clearRect(0, 0, w, h);
    const track = this.state.track;
    if (track === null) return;
    const key = `${w}x${h}`;
    if (this.model === null || this.modelKey !== key || this.modelTrack !== track) {
      this.model = buildPreview(track, { width: w, height: h, padding: Math.round(26 * dpr) });
      this.modelKey = key;
      this.modelTrack = track;
    }
    this.drawMap(g, this.model, track, dpr, w, h);
  }

  private drawMap(g: CanvasRenderingContext2D, m: PreviewModel, track: TrackData, dpr: number, w: number, h: number): void {
    this.drawGrid(g, m, dpr, w, h);
    this.drawPath(g, m, dpr);
    this.drawGates(g, m, track, dpr);
    this.drawStart(g, m, dpr);
    this.drawScale(g, m, dpr, w, h);
  }

  private drawGrid(g: CanvasRenderingContext2D, m: PreviewModel, dpr: number, w: number, h: number): void {
    const step = niceScaleBar(m.scale, w).px;
    g.strokeStyle = 'rgba(255,255,255,0.05)';
    g.lineWidth = dpr;
    g.beginPath();
    for (let x = w / 2 % step; x < w; x += step) {
      g.moveTo(x, 0);
      g.lineTo(x, h);
    }
    for (let y = h / 2 % step; y < h; y += step) {
      g.moveTo(0, y);
      g.lineTo(w, y);
    }
    g.stroke();
  }

  private drawPath(g: CanvasRenderingContext2D, m: PreviewModel, dpr: number): void {
    const n = m.path.length / 2;
    if (n < 2) return;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    const seg = (i: number, j: number): void => {
      g.moveTo(m.path[2 * i], m.path[2 * i + 1]);
      g.lineTo(m.path[2 * j], m.path[2 * j + 1]);
    };
    g.beginPath();
    for (let i = 0; i < n - 1; i++) seg(i, i + 1);
    if (m.closed) seg(n - 1, 0);
    g.strokeStyle = 'rgba(0,0,0,0.55)';
    g.lineWidth = 6 * dpr;
    g.stroke();
    g.lineWidth = 3 * dpr;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      if (j === 0 && !m.closed) break;
      g.beginPath();
      seg(i, j);
      g.strokeStyle = heightColor((m.heights[i] + m.heights[j]) / 2);
      g.stroke();
    }
    this.drawArrows(g, m, dpr, n);
  }

  private drawArrows(g: CanvasRenderingContext2D, m: PreviewModel, dpr: number, n: number): void {
    const every = Math.max(8, Math.round(n / 7));
    g.fillStyle = 'rgba(255,255,255,0.85)';
    for (let i = every >> 1; i < n - 1; i += every) {
      const dx = m.path[2 * i + 2] - m.path[2 * i];
      const dy = m.path[2 * i + 3] - m.path[2 * i + 1];
      const len = Math.hypot(dx, dy);
      if (len < 1e-3) continue;
      this.triangle(g, m.path[2 * i], m.path[2 * i + 1], dx / len, dy / len, 4.5 * dpr);
    }
  }

  private triangle(g: CanvasRenderingContext2D, x: number, y: number, dx: number, dy: number, r: number): void {
    g.beginPath();
    g.moveTo(x + dx * r * 1.3, y + dy * r * 1.3);
    g.lineTo(x - dx * r - dy * r, y - dy * r + dx * r);
    g.lineTo(x - dx * r + dy * r, y - dy * r - dx * r);
    g.closePath();
    g.fill();
  }

  private drawGates(g: CanvasRenderingContext2D, m: PreviewModel, track: TrackData, dpr: number): void {
    const label = track.gates.length <= MAX_LABELLED_GATES;
    g.font = `600 ${Math.round(10.5 * dpr)}px system-ui, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const gate of m.gates) {
      const nx = -gate.dy, ny = gate.dx;
      const ax = gate.x + nx * gate.half, ay = gate.y + ny * gate.half;
      const bx = gate.x - nx * gate.half, by = gate.y - ny * gate.half;
      g.lineCap = 'butt';
      g.beginPath();
      g.moveTo(ax, ay);
      g.lineTo(bx, by);
      g.strokeStyle = 'rgba(0,0,0,0.7)';
      g.lineWidth = 6.5 * dpr;
      g.stroke();
      g.strokeStyle = gate.color;
      g.lineWidth = 3.5 * dpr;
      g.stroke();
      if (!label && gate.index !== 0 && gate.index !== m.gates.length - 1) continue;
      const lx = gate.x + gate.dx * 11 * dpr;
      const ly = gate.y + gate.dy * 11 * dpr;
      g.fillStyle = 'rgba(255,255,255,0.92)';
      g.strokeStyle = 'rgba(0,0,0,0.75)';
      g.lineWidth = 3 * dpr;
      g.strokeText(String(gate.index + 1), lx, ly);
      g.fillText(String(gate.index + 1), lx, ly);
    }
  }

  private drawStart(g: CanvasRenderingContext2D, m: PreviewModel, dpr: number): void {
    const s = m.start;
    g.fillStyle = GATE_COLORS.start;
    g.strokeStyle = 'rgba(0,0,0,0.8)';
    g.lineWidth = 2 * dpr;
    const r = 7 * dpr;
    g.beginPath();
    g.moveTo(s.x + s.dx * r * 1.4, s.y + s.dy * r * 1.4);
    g.lineTo(s.x - s.dx * r - s.dy * r, s.y - s.dy * r + s.dx * r);
    g.lineTo(s.x - s.dx * r + s.dy * r, s.y - s.dy * r - s.dx * r);
    g.closePath();
    g.stroke();
    g.fill();
  }

  private drawScale(g: CanvasRenderingContext2D, m: PreviewModel, dpr: number, w: number, h: number): void {
    const bar = niceScaleBar(m.scale, w);
    const x = 14 * dpr, y = h - 14 * dpr;
    g.strokeStyle = 'rgba(255,255,255,0.8)';
    g.lineWidth = 2 * dpr;
    g.beginPath();
    g.moveTo(x, y - 4 * dpr);
    g.lineTo(x, y);
    g.lineTo(x + bar.px, y);
    g.lineTo(x + bar.px, y - 4 * dpr);
    g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.8)';
    g.font = `600 ${Math.round(10.5 * dpr)}px system-ui, sans-serif`;
    g.textAlign = 'left';
    g.textBaseline = 'bottom';
    g.fillText(`${bar.meters} m`, x + 2 * dpr, y - 6 * dpr);
    g.textAlign = 'right';
    g.textBaseline = 'top';
    g.fillText('N', w - 14 * dpr, 12 * dpr);
    g.beginPath();
    g.moveTo(w - 20 * dpr, 34 * dpr);
    g.lineTo(w - 20 * dpr, 24 * dpr);
    g.stroke();
  }
}
