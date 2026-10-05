// Side elevation of the selected world, so climbs, dives, split-S, loops and ladders read at a glance. Two projections: along
// the course (x = distance flown along the centreline, which unrolls a loop into a hump) and from the side (x = position along
// the track's long axis, which keeps a loop a loop). Gates are their opening outlines, manoeuvres are labelled bands, drones
// are dots. Wheel zoom, drag pan, double-click reset.
import { fmt, niceTicks } from './series.js';
import { BIT_CRASH, dronePos, dronesInWorld } from './trace.js';
import { droneColor } from './topdown.js';

const M = { l: 44, r: 10, t: 22, b: 18 };

/** Nearest centreline point to (x, y, z): index into path. */
export function nearestPathIndex(path, x, y, z) {
  let best = 0, bd = Infinity;
  for (let i = 0; i < path.length; i++) {
    const p = path[i];
    const d = (p[0] - x) ** 2 + (p[1] - y) ** 2 + (p[2] - z) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

/** Unit long axis of the path in the ground plane (principal component of x, z) and the centroid. */
export function longAxis(path) {
  let mx = 0, mz = 0;
  for (const p of path) { mx += p[0]; mz += p[2]; }
  mx /= path.length || 1; mz /= path.length || 1;
  let sxx = 0, szz = 0, sxz = 0;
  for (const p of path) { const dx = p[0] - mx, dz = p[2] - mz; sxx += dx * dx; szz += dz * dz; sxz += dx * dz; }
  const a = 0.5 * Math.atan2(2 * sxz, sxx - szz);
  return { cx: mx, cz: mz, ax: Math.cos(a), az: Math.sin(a) };
}

/**
 * The projection of one world: map(x, y, z) -> profile x, plus the path, ground, gate outlines and manoeuvre bands in profile
 * coordinates.
 */
export function projectWorld(w, mode) {
  const path = w.path;
  let map;
  if (mode === 'side') {
    const { cx, cz, ax, az } = longAxis(path);
    map = (x, _y, z) => (x - cx) * ax + (z - cz) * az;
  } else {
    // Distance along the centreline at the nearest point, plus the offset along the local direction of travel.
    map = (x, y, z) => {
      if (path.length < 2) return 0;
      const i = nearestPathIndex(path, x, y, z);
      const a = path[Math.max(i - 1, 0)], b = path[Math.min(i + 1, path.length - 1)];
      const hx = b[0] - a[0], hz = b[2] - a[2], hl = Math.hypot(hx, hz) || 1;
      return path[i][3] + ((x - path[i][0]) * hx + (z - path[i][2]) * hz) / hl;
    };
  }
  const px = path.map((p) => (mode === 'side' ? map(p[0], p[1], p[2]) : p[3]));
  const gates = w.gates.map((g) => {
    const cx = map(g.pos[0], g.pos[1], g.pos[2]);
    // Along the course the outline is laid out round the gate's own place on the course (one nearest-point search per gate,
    // so a gate never splits between two passes of the centreline that run close together).
    let dir = null;
    if (mode !== 'side' && path.length >= 2) {
      const i = nearestPathIndex(path, g.pos[0], g.pos[1], g.pos[2]);
      const a = path[Math.max(i - 1, 0)], b = path[Math.min(i + 1, path.length - 1)];
      const hl = Math.hypot(b[0] - a[0], b[2] - a[2]) || 1;
      dir = [(b[0] - a[0]) / hl, (b[2] - a[2]) / hl];
    }
    const outline = g.outline.map((q) => [dir ? cx + (q[0] - g.pos[0]) * dir[0] + (q[2] - g.pos[2]) * dir[1] : map(q[0], q[1], q[2]), q[1]]);
    return { g, x: cx, outline };
  });
  const bands = [];
  for (const pg of gates) {
    const f = pg.g.feature;
    const last = bands[bands.length - 1];
    if (f && last && last.feature === f && last.end === pg.g.index - 1) {
      last.x0 = Math.min(last.x0, pg.x); last.x1 = Math.max(last.x1, pg.x); last.end = pg.g.index;
    } else if (f) bands.push({ feature: f, x0: pg.x, x1: pg.x, end: pg.g.index });
  }
  return { mode, map, px, gates, bands };
}

export class Profile {
  constructor(canvas, app) {
    this.canvas = canvas;
    this.app = app;
    this.ctx = canvas.getContext('2d');
    this.mode = 'distance';
    this.cache = new Map();
    this.view = null;
    this.bind();
  }

  setMode(mode) { this.mode = mode; this.view = null; this.app.requestMap(); }

  proj(w) {
    const key = `${w.index}:${this.mode}`;
    let p = this.cache.get(key);
    if (!p) { p = projectWorld(w, this.mode); this.cache.set(key, p); }
    return p;
  }

  full(w) {
    const p = this.proj(w);
    let lo = Infinity, hi = -Infinity;
    for (const x of p.px) { if (x < lo) lo = x; if (x > hi) hi = x; }
    for (const g of p.gates) for (const [x] of g.outline) { if (x < lo) lo = x; if (x > hi) hi = x; }
    if (!Number.isFinite(lo)) return [0, 1];
    const pad = (hi - lo) * 0.02 + 1;
    return [lo - pad, hi + pad];
  }

  bind() {
    const c = this.canvas;
    let drag = null;
    c.addEventListener('pointerdown', (e) => { c.setPointerCapture(e.pointerId); drag = { x: e.offsetX }; });
    c.addEventListener('pointermove', (e) => {
      const w = this.app.selectedWorld();
      if (!drag || !w) return;
      const [x0, x1] = this.view ?? this.full(w);
      const d = ((e.offsetX - drag.x) / Math.max(c.clientWidth - M.l - M.r, 1)) * (x1 - x0);
      this.view = [x0 - d, x1 - d];
      drag.x = e.offsetX;
      this.app.requestMap();
    });
    c.addEventListener('pointerup', () => { drag = null; });
    c.addEventListener('dblclick', () => { this.view = null; this.app.requestMap(); });
    c.addEventListener('wheel', (e) => {
      const w = this.app.selectedWorld();
      if (!w) return;
      e.preventDefault();
      const [x0, x1] = this.view ?? this.full(w);
      const at = x0 + ((e.offsetX - M.l) / Math.max(c.clientWidth - M.l - M.r, 1)) * (x1 - x0);
      const k = Math.exp(Math.sign(e.deltaY) * Math.min(Math.abs(e.deltaY), 200) * 0.0025);
      this.view = [at - (at - x0) * k, at + (x1 - at) * k];
      this.app.requestMap();
    }, { passive: false });
  }

  draw(frame) {
    const c = this.canvas;
    const dpr = window.devicePixelRatio || 1;
    const W = c.clientWidth, H = c.clientHeight;
    if (!W || !H) return;
    if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
    const g = this.ctx;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#1a1a19';
    g.fillRect(0, 0, W, H);
    g.font = '11px system-ui, -apple-system, "Segoe UI", sans-serif';
    const w = this.app.selectedWorld();
    if (!w) {
      g.fillStyle = '#898781';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('Pick a world to see its elevation profile', W / 2, H / 2);
      return;
    }
    const p = this.proj(w);
    const [x0, x1] = this.view ?? this.full(w);
    let lo = Infinity, hi = -Infinity;
    const take = (x, y) => { if (x >= x0 && x <= x1) { if (y < lo) lo = y; if (y > hi) hi = y; } };
    w.path.forEach((q, i) => { take(p.px[i], q[1]); take(p.px[i], q[4]); });
    for (const pg of p.gates) for (const [x, y] of pg.outline) take(x, y);
    // Drones in profile coordinates; the height range covers them too, so one flying high stays in view.
    const cur = frame.chain[frame.chain.length - 1];
    const drones = [];
    if (cur) {
      const ids = dronesInWorld(cur, w.index, Math.floor(frame.t));
      ids.forEach((e, rank) => {
        const h = dronePos(cur, e, frame.t, frame.next);
        const d = { x: p.map(h[0], h[1], h[2]), y: h[1], crashed: (h[3] & BIT_CRASH) !== 0, color: droneColor(rank, ids.length) };
        drones.push(d);
        take(d.x, d.y);
      });
    }
    if (!Number.isFinite(lo)) { lo = w.terrain.min; hi = w.terrain.max; }
    const pad = Math.max((hi - lo) * 0.08, 2);
    lo -= pad; hi += pad;
    const pw = W - M.l - M.r, ph = H - M.t - M.b;
    const X = (x) => M.l + ((x - x0) / (x1 - x0)) * pw;
    const Y = (y) => M.t + ph - ((y - lo) / (hi - lo)) * ph;
    // Grid and axes
    g.strokeStyle = '#2c2c2a';
    g.lineWidth = 1;
    g.fillStyle = '#898781';
    g.textAlign = 'right';
    g.textBaseline = 'middle';
    for (const t of niceTicks(lo, hi, Math.max(2, Math.floor(ph / 30)))) {
      const y = Math.round(Y(t)) + 0.5;
      g.beginPath(); g.moveTo(M.l, y); g.lineTo(M.l + pw, y); g.stroke();
      g.fillText(`${fmt(t)} m`, M.l - 4, y);
    }
    g.textAlign = 'center';
    g.textBaseline = 'top';
    for (const t of niceTicks(x0, x1, Math.max(2, Math.floor(pw / 80)))) g.fillText(`${fmt(t)} m`, X(t), M.t + ph + 3);
    g.save();
    g.beginPath(); g.rect(M.l, 0, pw, H); g.clip();
    // Ground under the course
    if (p.mode === 'distance') {
      g.fillStyle = 'rgba(112,104,92,0.45)';
      g.beginPath();
      g.moveTo(X(p.px[0]), M.t + ph);
      w.path.forEach((q, i) => g.lineTo(X(p.px[i]), Y(q[4])));
      g.lineTo(X(p.px[p.px.length - 1]), M.t + ph);
      g.closePath();
      g.fill();
    } else {
      g.fillStyle = 'rgba(150,146,140,0.45)';
      w.path.forEach((q, i) => { if (i % 2 === 0) g.fillRect(X(p.px[i]) - 1, Y(q[4]) - 1, 2, 2); });
    }
    // Manoeuvre bands
    g.textBaseline = 'top';
    for (const b of p.bands) {
      const a = X(b.x0) - 6, z = X(b.x1) + 6;
      g.fillStyle = 'rgba(144,133,233,0.14)';
      g.fillRect(a, M.t, z - a, ph);
      g.fillStyle = '#c3c2b7';
      g.textAlign = 'center';
      g.fillText(b.feature, (a + z) / 2, 4);
    }
    // Course
    g.strokeStyle = '#f2f1ec';
    g.lineWidth = 1.5;
    g.beginPath();
    w.path.forEach((q, i) => (i ? g.lineTo(X(p.px[i]), Y(q[1])) : g.moveTo(X(p.px[i]), Y(q[1]))));
    g.stroke();
    for (const pg of p.gates) {
      g.strokeStyle = pg.g.color;
      g.lineWidth = 2.5;
      g.beginPath();
      pg.outline.forEach(([x, y], i) => (i ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y))));
      g.closePath();
      g.stroke();
    }
    for (const d of drones) {
      const x = X(d.x), y = Y(d.y);
      g.fillStyle = '#0d0d0d';
      g.beginPath(); g.arc(x, y, 5.5, 0, 2 * Math.PI); g.fill();
      g.fillStyle = d.crashed ? '#d03b3b' : d.color;
      g.beginPath(); g.arc(x, y, 4, 0, 2 * Math.PI); g.fill();
    }
    g.restore();
    g.fillStyle = '#898781';
    g.textAlign = 'left';
    g.textBaseline = 'top';
    g.fillText(p.mode === 'side' ? 'side view along the long axis' : 'distance along the course', M.l + 4, M.t + 2);
  }
}
