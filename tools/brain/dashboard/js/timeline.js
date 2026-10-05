// Timeline scrubber over every iteration of the run: the return as a sparkline, which iterations still have a drone trace (a
// solid band for the recent window, ticks for the older keyframes), the zoomed chart range and the playhead. Click or drag to
// scrub.
import { fmt } from './series.js';

const M = { l: 8, r: 8 };

export class Timeline {
  constructor(canvas, app) {
    this.canvas = canvas;
    this.app = app;
    this.ctx = canvas.getContext('2d');
    this.hoverX = null;
    let down = false;
    canvas.addEventListener('pointerdown', (e) => { canvas.setPointerCapture(e.pointerId); down = true; this.scrub(e.offsetX); });
    canvas.addEventListener('pointermove', (e) => { this.hoverX = e.offsetX; if (down) this.scrub(e.offsetX); else app.requestDraw(); });
    canvas.addEventListener('pointerup', () => { down = false; });
    canvas.addEventListener('pointerleave', () => { this.hoverX = null; app.requestDraw(); });
  }

  range() {
    const st = this.app.store;
    if (!st.length) return [0, 1];
    const a = st.iters.a[0], b = st.iters.a[st.length - 1];
    return a === b ? [a - 1, b + 1] : [a, b];
  }

  iterAt(x) {
    const [a, b] = this.range();
    const w = Math.max(this.canvas.clientWidth - M.l - M.r, 1);
    return a + ((x - M.l) / w) * (b - a);
  }

  scrub(x) {
    const st = this.app.store;
    const i = st.nearest(this.iterAt(x));
    if (i >= 0) this.app.scrubTo(st.iters.a[i]);
  }

  draw() {
    const c = this.canvas;
    const dpr = window.devicePixelRatio || 1;
    const W = c.clientWidth, H = c.clientHeight;
    if (!W || !H) return;
    if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
    const g = this.ctx;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#1a1a19';
    g.fillRect(0, 0, W, H);
    const st = this.app.store;
    const [a, b] = this.range();
    const pw = W - M.l - M.r;
    const X = (it) => M.l + ((it - a) / (b - a)) * pw;
    const band = 7;
    const sh = H - band - 4;
    // Chart zoom window
    if (this.app.view) {
      g.fillStyle = 'rgba(57,135,229,0.16)';
      g.fillRect(X(this.app.view.x0), 0, Math.max(X(this.app.view.x1) - X(this.app.view.x0), 1), H);
    }
    // Return sparkline: per pixel column, the last smoothed value.
    if (st.length > 1) {
      const vals = st.sm.get('ret').a;
      let lo = Infinity, hi = -Infinity;
      for (let i = 0; i < st.length; i++) { const v = vals[i]; if (!Number.isNaN(v)) { if (v < lo) lo = v; if (v > hi) hi = v; } }
      if (Number.isFinite(lo)) {
        if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
        g.strokeStyle = '#3987e5';
        g.lineWidth = 1.5;
        g.beginPath();
        let pen = false, lastCol = -1;
        for (let i = 0; i < st.length; i++) {
          const v = vals[i];
          if (Number.isNaN(v)) { pen = false; continue; }
          const x = X(st.iters.a[i]);
          const col = Math.floor(x);
          if (col === lastCol && i !== st.length - 1) continue;
          lastCol = col;
          const y = 3 + (1 - (v - lo) / (hi - lo)) * (sh - 6);
          if (pen) g.lineTo(x, y); else g.moveTo(x, y);
          pen = true;
        }
        g.stroke();
      }
    }
    // Kept traces
    g.fillStyle = '#c98500';
    let lastCol = -2;
    for (const it of this.app.traceList) {
      const col = Math.round(X(it));
      if (col === lastCol) continue;
      g.fillRect(col, H - band - 1, Math.max(1, col - lastCol === 1 ? 1 : 1.5), band);
      lastCol = col;
    }
    // Playhead
    const at = this.app.live ? (st.length ? st.iters.a[st.length - 1] : null) : this.app.scrub;
    if (at !== null && st.length) {
      const x = Math.round(X(at)) + 0.5;
      g.strokeStyle = '#ffffff';
      g.lineWidth = 2;
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke();
    }
    if (this.hoverX !== null && st.length) {
      const i = st.nearest(this.iterAt(this.hoverX));
      const x = Math.round(X(st.iters.a[i])) + 0.5;
      g.strokeStyle = 'rgba(195,194,183,0.6)';
      g.lineWidth = 1;
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke();
      g.font = '11px system-ui, -apple-system, "Segoe UI", sans-serif';
      g.fillStyle = '#ffffff';
      g.textBaseline = 'top';
      const label = `iteration ${st.iters.a[i]} · return ${fmt(st.value('ret', i))}`;
      const tw = g.measureText(label).width;
      g.textAlign = 'left';
      g.fillText(label, Math.min(Math.max(x + 6, 2), W - tw - 4), 2);
    }
  }
}
