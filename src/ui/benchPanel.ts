import { el, setHidden, setText } from './dom';
import './panels.css';

/** What the panel needs from a finished run; `BenchResult` (app/benchModel.ts) satisfies it. */
export interface BenchRows {
  avgFps: number;
  p1LowFps: number;
  avgGpuMs: number | null;
  perPassMs: Record<string, number> | null;
  renderScale: number;
  renderWidth: number;
  renderHeight: number;
  outWidth: number;
  outHeight: number;
  quality: string;
  refreshHz: number;
  frames: number;
  seconds: number;
  device: { vendor: string; architecture: string; description: string; software: boolean };
}

export interface BenchActions {
  onRerun(): void;
  onClose(): void;
  /** The result as pretty JSON, for the Copy button. */
  json(): string;
}

const PASS_LABELS: Record<string, string> = { pre: 'Pre (LUTs, culling)', gbuffer: 'G-buffer', rt: 'Ray tracing', lighting: 'Lighting', 'sky+fwd': 'Sky and forward', post: 'Post' };

function row(label: string, value: string): HTMLTableRowElement {
  return el('tr', '', el('th', '', label), el('td', '', value));
}

function deviceText(d: BenchRows['device']): string {
  const parts = [d.vendor, d.architecture].filter((p) => p.length > 0);
  const name = parts.length > 0 ? parts.join(' ') : d.description || 'unknown device';
  return d.software ? `${name} (software)` : name;
}

/** The benchmark's progress pill and its results dialog. */
export class BenchPanel {
  private readonly pill = el('div', 'fpv-bench fpv-bench--pill');
  private readonly dialog = el('section', 'fpv-bench');

  constructor(root: HTMLElement) {
    this.pill.style.cssText = 'top:14px;transform:translateX(-50%);width:auto;padding:6px 14px;border-radius:999px;pointer-events:none;font-size:13px';
    this.pill.hidden = true;
    this.dialog.setAttribute('role', 'dialog');
    this.dialog.setAttribute('aria-label', 'Benchmark results');
    this.dialog.hidden = true;
    root.append(this.pill, this.dialog);
  }

  progress(elapsedS: number, totalS: number, warmingUp: boolean): void {
    setHidden(this.pill, false);
    const done = Math.min(totalS, Math.floor(elapsedS));
    setText(this.pill, warmingUp ? `Benchmark warming up (${done} of ${Math.round(totalS)} s)` : `Benchmark running (${done} of ${Math.round(totalS)} s)`);
  }

  show(r: BenchRows, verdict: string, actions: BenchActions): void {
    setHidden(this.pill, true);
    const table = el('table', 'fpv-bench-table');
    const gpu = r.avgGpuMs === null ? 'not measured (no timestamp-query)' : `${r.avgGpuMs.toFixed(2)} ms`;
    table.append(
      row('Average', `${r.avgFps.toFixed(1)} fps`),
      row('1% low', `${r.p1LowFps.toFixed(1)} fps`),
      row('GPU time', gpu),
    );
    if (r.perPassMs) for (const [name, ms] of Object.entries(r.perPassMs)) table.append(row(`  ${PASS_LABELS[name] ?? name}`, `${ms.toFixed(2)} ms`));
    table.append(
      row('Render', `${r.renderWidth} x ${r.renderHeight} (${Math.round(r.renderScale * 100)}% of ${r.outWidth} x ${r.outHeight})`),
      row('Quality', r.quality),
      row('Display', r.refreshHz > 0 ? `${Math.round(r.refreshHz)} Hz` : 'not measured'),
      row('Device', deviceText(r.device)),
      row('Measured', `${r.frames} frames in ${r.seconds.toFixed(1)} s`),
    );
    const copy = el('button', 'fpv-btn', 'Copy JSON');
    copy.type = 'button';
    copy.addEventListener('click', () => {
      void navigator.clipboard?.writeText(actions.json()).then(() => setText(copy, 'Copied'), () => setText(copy, 'Copy failed'));
    });
    const again = el('button', 'fpv-btn fpv-btn--primary', 'Run again');
    again.type = 'button';
    again.addEventListener('click', actions.onRerun);
    const close = el('button', 'fpv-btn', 'Close');
    close.type = 'button';
    close.addEventListener('click', () => {
      this.dialog.hidden = true;
      actions.onClose();
    });
    this.dialog.replaceChildren(
      el('h2', 'fpv-bench-title', 'Benchmark results'),
      el('p', r.device.software ? 'fpv-bench-warn' : 'fpv-bench-note', verdict),
      table,
      el('div', 'fpv-bench-buttons', again, copy, close),
    );
    this.dialog.hidden = false;
    again.focus();
  }
}
