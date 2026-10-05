// One metric chart on a canvas: raw values faint, EMA-smoothed line on top, a shared x range (iterations) with Ctrl/Shift + wheel zoom, drag
// pan and double-click reset, a crosshair synced across every chart, click to scrub, legend toggles and a log-y switch.
import { SERIES_COLORS, decimate, fmt, logTicks, niceTicks } from './series.js';

const M = { l: 50, r: 10, t: 8, b: 20 };
const INK = { grid: '#2c2c2a', axis: '#383835', muted: '#898781', text: '#c3c2b7', strong: '#ffffff', surface: '#1a1a19', cursor: '#c3c2b7' };

export class Chart {
  /** app: { store, view: {x0,x1}|null, hover, scrub, setView(v), setHover(it, chart), scrubTo(it) }. */
  constructor(parent, def, app) {
    this.def = def;
    this.app = app;
    this.hidden = new Set();
    this.logY = false;
    this.pointer = null;
    this.el = document.createElement('section');
    this.el.className = 'chart';
    const head = document.createElement('header');
    const title = document.createElement('h3');
    title.textContent = def.title;
    if (def.unit) {
      const u = document.createElement('span');
      u.className = 'unit';
      u.textContent = ` (${def.unit})`;
      title.append(u);
    }
    this.legend = document.createElement('div');
    this.legend.className = 'legend';
    this.items = def.series.map((s, k) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'key';
      b.title = def.series.length > 1 ? `Show or hide ${s.label}` : s.label;
      const sw = document.createElement('i');
      sw.style.background = SERIES_COLORS[k % SERIES_COLORS.length];
      const label = document.createElement('span');
      label.textContent = s.label;
      const value = document.createElement('b');
      value.textContent = '–';
      b.append(sw, value, label);
      b.addEventListener('click', () => {
        if (this.hidden.has(s.key)) this.hidden.delete(s.key);
        else if (this.hidden.size < def.series.length - 1) this.hidden.add(s.key);
        b.classList.toggle('off', this.hidden.has(s.key));
        this.app.requestDraw();
      });
      this.legend.append(b);
      return { s, b, value, color: SERIES_COLORS[k % SERIES_COLORS.length], last: '' };
    });
    const log = document.createElement('button');
    log.type = 'button';
    log.className = 'log';
    log.textContent = 'log';
    log.title = 'Logarithmic y axis';
    log.addEventListener('click', () => {
      this.logY = !this.logY;
      log.classList.toggle('on', this.logY);
      this.app.requestDraw();
    });
    head.append(title, log);
    this.canvas = document.createElement('canvas');
    this.el.append(head, this.legend, this.canvas);
    parent.append(this.el);
    this.ctx = this.canvas.getContext('2d');
    this.bind();
  }

  /** x range in iterations: the shared zoom, or everything. */
  domain() {
    const st = this.app.store;
    if (this.app.view) return [this.app.view.x0, this.app.view.x1];
    if (!st.length) return [0, 1];
    const a = st.iters.a[0], b = st.iters.a[st.length - 1];
    return a === b ? [a - 1, b + 1] : [a, b];
  }

  plotWidth() { return Math.max(this.canvas.clientWidth - M.l - M.r, 10); }

  iterAt(px) {
    const [x0, x1] = this.domain();
    return x0 + ((px - M.l) / this.plotWidth()) * (x1 - x0);
  }

  bind() {
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture(e.pointerId);
      this.pointer = { x: e.offsetX, dom: this.domain(), moved: false };
    });
    c.addEventListener('pointermove', (e) => {
      const p = this.pointer;
      if (p && (p.moved || Math.abs(e.offsetX - p.x) > 3)) {
        p.moved = true;
        const span = p.dom[1] - p.dom[0];
        const shift = -((e.offsetX - p.x) / this.plotWidth()) * span;
        this.app.setView(this.clamp(p.dom[0] + shift, p.dom[1] + shift));
        return;
      }
      this.mouse = { x: e.offsetX, y: e.offsetY };
      const i = this.app.store.nearest(this.iterAt(e.offsetX));
      this.app.setHover(i >= 0 ? this.app.store.iters.a[i] : null, this);
    });
    c.addEventListener('pointerup', () => {
      const p = this.pointer;
      this.pointer = null;
      this.dragged = !!p?.moved;
    });
    // Scrub on 'click', whose detail counts the clicks (a pointerup's detail is always 0). The second click of a double-click
    // scrubs nothing, and the dblclick handler undoes the first one's scrub.
    c.addEventListener('click', (e) => {
      if (this.dragged || e.detail >= 2) return;
      const i = this.app.store.nearest(this.iterAt(e.offsetX));
      if (i < 0) return;
      this.beforeClick = this.app.playbackState();
      this.app.scrubTo(this.app.store.iters.a[i]);
    });
    c.addEventListener('pointerleave', () => { this.mouse = null; this.app.setHover(null, this); });
    c.addEventListener('dblclick', () => {
      if (this.beforeClick) this.app.restorePlayback(this.beforeClick);
      this.beforeClick = null;
      this.app.setView(null);
    });
    // A plain wheel scrolls the chart list; Ctrl or Shift + wheel (or a trackpad pinch, which arrives as Ctrl + wheel) zooms.
    c.addEventListener('wheel', (e) => {
      if (!e.ctrlKey && !e.shiftKey) return;
      e.preventDefault();
      const delta = e.deltaY || e.deltaX; // Shift + wheel arrives as a horizontal delta in most browsers
      const [x0, x1] = this.domain();
      const at = this.iterAt(e.offsetX);
      const k = Math.exp(Math.sign(delta) * Math.min(Math.abs(delta), 200) * 0.0025);
      this.app.setView(this.clamp(at - (at - x0) * k, at + (x1 - at) * k));
    }, { passive: false });
  }

  /** Keeps a range inside the data (and at least 4 iterations wide); the whole data range means "no zoom". */
  clamp(x0, x1) {
    const st = this.app.store;
    if (!st.length) return null;
    const lo = st.iters.a[0], hi = st.iters.a[st.length - 1];
    let span = Math.max(x1 - x0, Math.min(4, hi - lo));
    if (span >= hi - lo) return null;
    if (x0 < lo) { x0 = lo; x1 = lo + span; }
    if (x1 > hi) { x1 = hi; x0 = hi - span; }
    return { x0, x1 };
  }

  draw() {
    const c = this.canvas;
    const dpr = window.devicePixelRatio || 1;
    const W = c.clientWidth, H = c.clientHeight;
    if (W === 0 || H === 0) return;
    if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
    const g = this.ctx;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    g.font = '11px system-ui, -apple-system, "Segoe UI", sans-serif';
    const st = this.app.store;
    const smooth = st.weight > 0;
    const [x0, x1] = this.domain();
    const pw = W - M.l - M.r, ph = H - M.t - M.b;
    const n = st.length;
    const a = Math.max(0, st.lowerBound(x0) - 1);
    const b = Math.min(n - 1, st.lowerBound(x1));
    const ty = this.logY ? (v) => (v > 0 ? Math.log10(v) : NaN) : (v) => v;
    const shown = this.items.filter((it) => !this.hidden.has(it.s.key));
    let lo = Infinity, hi = -Infinity;
    for (const it of shown) {
      const raw = st.raw.get(it.s.key).a, sm = st.sm.get(it.s.key).a;
      for (let i = a; i <= b; i++) {
        const iter = st.iters.a[i];
        if (iter < x0 || iter > x1) continue;
        for (const v of [ty(raw[i]), ty(sm[i])]) if (!Number.isNaN(v)) { if (v < lo) lo = v; if (v > hi) hi = v; }
      }
    }
    const X = (it) => M.l + ((it - x0) / (x1 - x0 || 1)) * pw;
    // Axes and grid
    g.strokeStyle = INK.grid;
    g.fillStyle = INK.muted;
    g.lineWidth = 1;
    g.textAlign = 'center';
    g.textBaseline = 'top';
    for (const t of niceTicks(x0, x1, Math.max(2, Math.floor(pw / 90)))) {
      if (!Number.isInteger(t)) continue;
      const x = Math.round(X(t)) + 0.5;
      g.beginPath(); g.moveTo(x, M.t); g.lineTo(x, M.t + ph); g.stroke();
      g.fillText(fmt(t), x, M.t + ph + 4);
    }
    if (!Number.isFinite(lo)) {
      this.updateLegend(-1);
      g.fillStyle = INK.muted;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(n ? 'no values in range' : 'waiting for the first iteration', M.l + pw / 2, M.t + ph / 2);
      return;
    }
    if (hi - lo < 1e-12) { const d = Math.abs(hi) * 0.05 || (this.logY ? 0.5 : 1); lo -= d; hi += d; }
    const padY = (hi - lo) * 0.06;
    const dataLo = lo;
    lo -= padY; hi += padY;
    // Values that never go below zero keep zero as the floor of the axis.
    if (!this.logY && dataLo >= 0 && lo < 0) lo = 0;
    const Y = (v) => M.t + ph - ((v - lo) / (hi - lo)) * ph;
    g.textAlign = 'right';
    g.textBaseline = 'middle';
    const ticks = this.logY ? logTicks(lo, hi) : niceTicks(lo, hi, Math.max(2, Math.floor(ph / 40)));
    for (const t of ticks) {
      const y = Math.round(Y(t)) + 0.5;
      g.strokeStyle = INK.grid;
      g.beginPath(); g.moveTo(M.l, y); g.lineTo(M.l + pw, y); g.stroke();
      g.fillText(fmt(this.logY ? 10 ** t : t), M.l - 6, y);
    }
    g.strokeStyle = INK.axis;
    g.beginPath(); g.moveTo(M.l + 0.5, M.t); g.lineTo(M.l + 0.5, M.t + ph); g.lineTo(M.l + pw, M.t + ph + 0.5); g.stroke();

    g.save();
    g.beginPath(); g.rect(M.l, M.t, pw, ph); g.clip();
    const dense = b - a > pw * 1.5;
    for (const it of shown) {
      const raw = st.raw.get(it.s.key).a, sm = st.sm.get(it.s.key).a;
      const both = smooth && it.s.smooth !== false;
      g.strokeStyle = it.color;
      if (dense) {
        const cols = decimate(st.iters.a, raw, sm, a, b, x0, x1, pw);
        g.globalAlpha = both ? 0.28 : 0.5;
        g.lineWidth = 1;
        g.beginPath();
        for (const col of cols) {
          if (col.lo > col.hi) continue;
          const x = Math.round(M.l + col.c) + 0.5;
          const y0 = Y(ty(col.lo)), y1 = Y(ty(col.hi));
          if (Number.isNaN(y0) || Number.isNaN(y1)) continue;
          g.moveTo(x, y0); g.lineTo(x, Math.min(y1, y0 - 1));
        }
        g.stroke();
        g.globalAlpha = 1;
        g.lineWidth = 2;
        g.beginPath();
        let pen = false;
        for (const col of cols) {
          const y = Y(ty(both ? col.s : (col.lo + col.hi) / 2));
          if (Number.isNaN(y)) { pen = false; continue; }
          const x = M.l + col.c;
          if (pen) g.lineTo(x, y); else g.moveTo(x, y);
          pen = true;
        }
        g.stroke();
      } else {
        const line = (arr, width, alpha) => {
          g.globalAlpha = alpha;
          g.lineWidth = width;
          g.beginPath();
          let pen = false;
          for (let i = a; i <= b; i++) {
            const y = Y(ty(arr[i]));
            if (Number.isNaN(y)) { pen = false; continue; }
            const x = X(st.iters.a[i]);
            if (pen) g.lineTo(x, y); else g.moveTo(x, y);
            pen = true;
          }
          g.stroke();
          g.globalAlpha = 1;
        };
        if (both) { line(raw, 1, 0.3); line(sm, 2, 1); } else line(raw, 2, 1);
        if (b - a < pw / 8) {
          // Few points: mark each one so single values show.
          g.fillStyle = it.color;
          for (let i = a; i <= b; i++) {
            const y = Y(ty((both ? sm : raw)[i]));
            if (!Number.isNaN(y)) { g.beginPath(); g.arc(X(st.iters.a[i]), y, 2, 0, 2 * Math.PI); g.fill(); }
          }
        }
      }
    }
    // Scrub cursor
    if (this.app.scrub !== null && !this.app.live) {
      const x = Math.round(X(this.app.scrub)) + 0.5;
      g.strokeStyle = INK.cursor;
      g.setLineDash([3, 3]);
      g.lineWidth = 1;
      g.beginPath(); g.moveTo(x, M.t); g.lineTo(x, M.t + ph); g.stroke();
      g.setLineDash([]);
    }
    // Crosshair
    const hi_ = this.app.hover !== null ? st.nearest(this.app.hover) : -1;
    if (hi_ >= 0) {
      const x = Math.round(X(st.iters.a[hi_])) + 0.5;
      g.strokeStyle = INK.text;
      g.lineWidth = 1;
      g.beginPath(); g.moveTo(x, M.t); g.lineTo(x, M.t + ph); g.stroke();
      for (const it of shown) {
        const both = smooth && it.s.smooth !== false;
        const y = Y(ty(st.value(it.s.key, hi_, both)));
        if (Number.isNaN(y)) continue;
        g.fillStyle = INK.surface;
        g.beginPath(); g.arc(x, y, 5, 0, 2 * Math.PI); g.fill();
        g.fillStyle = it.color;
        g.beginPath(); g.arc(x, y, 3.5, 0, 2 * Math.PI); g.fill();
      }
    }
    g.restore();
    if (hi_ >= 0 && this.app.hoverChart === this && this.mouse) this.tooltip(g, hi_, shown, smooth, W, H);
    this.updateLegend(hi_ >= 0 ? hi_ : this.app.scrub !== null && !this.app.live ? st.nearest(this.app.scrub) : n - 1);
  }

  tooltip(g, i, shown, smooth, W, H) {
    const st = this.app.store;
    const rows = [[`iteration ${st.iters.a[i]}`, null, null]];
    for (const it of shown) rows.push([fmt(st.value(it.s.key, i, smooth && it.s.smooth !== false), 4), it.s.label, it.color]);
    g.font = '11px system-ui, -apple-system, "Segoe UI", sans-serif';
    const widths = rows.map(([v, l]) => g.measureText(v).width + (l ? g.measureText(l).width + 26 : 0));
    const w = Math.max(...widths) + 16, h = rows.length * 16 + 8;
    let x = this.mouse.x + 12, y = this.mouse.y - h - 8;
    if (x + w > W - 2) x = this.mouse.x - w - 12;
    if (y < 2) y = Math.min(this.mouse.y + 12, H - h - 2);
    g.fillStyle = 'rgba(13,13,13,0.94)';
    g.strokeStyle = 'rgba(255,255,255,0.10)';
    g.beginPath(); g.roundRect(x, y, w, h, 6); g.fill(); g.stroke();
    g.textBaseline = 'middle';
    g.textAlign = 'left';
    rows.forEach(([v, l, col], k) => {
      const yy = y + 12 + k * 16;
      if (!l) { g.fillStyle = INK.muted; g.fillText(v, x + 8, yy); return; }
      g.strokeStyle = col; g.lineWidth = 2;
      g.beginPath(); g.moveTo(x + 8, yy); g.lineTo(x + 18, yy); g.stroke();
      g.fillStyle = INK.strong;
      g.font = 'bold 11px system-ui, -apple-system, "Segoe UI", sans-serif';
      g.fillText(v, x + 24, yy);
      const vw = g.measureText(v).width;
      g.font = '11px system-ui, -apple-system, "Segoe UI", sans-serif';
      g.fillStyle = INK.text;
      g.fillText(l, x + 30 + vw, yy);
    });
  }

  updateLegend(i) {
    const st = this.app.store;
    for (const it of this.items) {
      const v = i >= 0 ? fmt(st.value(it.s.key, i, st.weight > 0 && it.s.smooth !== false), 4) : '–';
      if (v !== it.last) { it.value.textContent = v; it.last = v; }
    }
  }
}
