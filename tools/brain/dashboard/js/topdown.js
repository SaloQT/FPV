// Top-down map: one world (hillshaded terrain, colliders, obstacles, centreline, gates coloured by kind with direction ticks,
// the start pad, traced drones with fading trails and crash marks; wheel zoom, drag pan, double-click to fit) or every world as
// small multiples with their drones and per-world counts (click one to open it).
import { SERIES_COLORS } from './series.js';
import { hillshade, trackBounds } from './terrain.js';
import { BIT_CRASH, BIT_DONE, BIT_FINISH, crashMarks, dronePos, dronesInWorld, nextOf, trail, worldOf } from './trace.js';

const SPEED_RAMP = ['#184f95', '#1c5cab', '#2a78d6', '#3987e5', '#5598e7', '#86b6ef', '#b7d3f6', '#cde2fb'];
const CRITICAL = '#d03b3b';
const GOOD = '#0ca30c';
const NEUTRAL_DRONE = '#f2f1ec';

/** Drone colour by its rank among the drones of its world: categorical up to 8 drones, one neutral colour past that. */
export function droneColor(rank, count) {
  return count <= SERIES_COLORS.length ? SERIES_COLORS[rank] : NEUTRAL_DRONE;
}

/** Columns and rows for n small multiples in a W x H box: the biggest cells, then the fewest empty ones. */
export function gridFor(n, W, H) {
  let best = { cols: 1, rows: n, size: -1, empty: 0 };
  for (let cols = 1; cols <= Math.max(n, 1); cols++) {
    const rows = Math.ceil(n / cols);
    const size = Math.min(W / cols, H / rows);
    const empty = cols * rows - n;
    if (size > best.size + 0.5 || (Math.abs(size - best.size) <= 0.5 && empty < best.empty)) best = { cols, rows, size, empty };
  }
  return { cols: best.cols, rows: best.rows };
}

export function speedColor(mps) {
  const k = Math.min(SPEED_RAMP.length - 1, Math.max(0, Math.floor((mps / 32) * SPEED_RAMP.length)));
  return SPEED_RAMP[k];
}

export class TopDown {
  constructor(canvas, tip, app) {
    this.canvas = canvas;
    this.tip = tip;
    this.app = app;
    this.ctx = canvas.getContext('2d');
    this.images = new Map();
    this.cells = new Map();
    this.cams = new Map();
    this.layout = null;
    this.hoverCell = -1;
    this.mouse = null;
    this.bind();
  }

  terrainImage(w) {
    let img = this.images.get(w.index);
    if (!img) {
      const t = w.terrain;
      img = document.createElement('canvas');
      img.width = t.n; img.height = t.n;
      img.getContext('2d').putImageData(new ImageData(hillshade(t), t.n, t.n), 0, 0);
      this.images.set(w.index, img);
    }
    return img;
  }

  /** Camera that fits the track: centre and pixels per metre. */
  fit(w, W, H) {
    const b = trackBounds(w);
    return { cx: (b.x0 + b.x1) / 2, cz: (b.z0 + b.z1) / 2, s: Math.min(W / Math.max(b.x1 - b.x0, 1), H / Math.max(b.z1 - b.z0, 1)) };
  }

  cam(w) {
    let c = this.cams.get(w.index);
    if (!c) { c = this.fit(w, this.canvas.clientWidth || 600, this.canvas.clientHeight || 400); this.cams.set(w.index, c); }
    return c;
  }

  bind() {
    const c = this.canvas;
    let drag = null;
    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture(e.pointerId);
      drag = { x: e.offsetX, y: e.offsetY, moved: false };
    });
    c.addEventListener('pointermove', (e) => {
      this.mouse = { x: e.offsetX, y: e.offsetY };
      const w = this.app.selectedWorld();
      if (drag && (drag.moved || Math.hypot(e.offsetX - drag.x, e.offsetY - drag.y) > 3)) {
        drag.moved = true;
        if (w) {
          const cam = this.cam(w);
          cam.cx -= (e.offsetX - drag.x) / cam.s;
          cam.cz -= (e.offsetY - drag.y) / cam.s;
        }
        drag.x = e.offsetX; drag.y = e.offsetY;
      }
      this.hoverCell = w ? -1 : this.cellAt(e.offsetX, e.offsetY);
      this.app.requestMap();
    });
    c.addEventListener('pointerup', (e) => {
      if (drag && !drag.moved && !this.app.selectedWorld()) {
        const k = this.cellAt(e.offsetX, e.offsetY);
        if (k >= 0) this.app.selectWorld(k);
      }
      drag = null;
    });
    c.addEventListener('pointerleave', () => { this.mouse = null; this.hoverCell = -1; this.tip.hidden = true; this.app.requestMap(); });
    c.addEventListener('dblclick', () => {
      const w = this.app.selectedWorld();
      if (w) { this.cams.set(w.index, this.fit(w, c.clientWidth, c.clientHeight)); this.app.requestMap(); }
    });
    c.addEventListener('wheel', (e) => {
      const w = this.app.selectedWorld();
      if (!w) return;
      e.preventDefault();
      const cam = this.cam(w);
      const k = Math.exp(-Math.sign(e.deltaY) * Math.min(Math.abs(e.deltaY), 200) * 0.0025);
      const mx = cam.cx + (e.offsetX - c.clientWidth / 2) / cam.s;
      const mz = cam.cz + (e.offsetY - c.clientHeight / 2) / cam.s;
      cam.s = Math.min(Math.max(cam.s * k, 0.02), 80);
      cam.cx = mx - (e.offsetX - c.clientWidth / 2) / cam.s;
      cam.cz = mz - (e.offsetY - c.clientHeight / 2) / cam.s;
      this.app.requestMap();
    }, { passive: false });
  }

  cellAt(x, y) {
    const L = this.layout;
    if (!L) return -1;
    const i = Math.floor(x / L.cw), j = Math.floor(y / L.ch);
    const k = j * L.cols + i;
    return i >= 0 && i < L.cols && k >= 0 && k < this.app.worlds.length ? k : -1;
  }

  resize() {
    const c = this.canvas;
    const dpr = window.devicePixelRatio || 1;
    const W = c.clientWidth, H = c.clientHeight;
    if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return [W, H, dpr];
  }

  /** frame: { chain (consecutive traces, current last), next, t, trailSteps, tallies, hz, trailMode, layers }. */
  draw(frame) {
    const [W, H, dpr] = this.resize();
    if (!W || !H) return;
    const g = this.ctx;
    g.fillStyle = '#0d0d0d';
    g.fillRect(0, 0, W, H);
    const w = this.app.selectedWorld();
    if (w) this.drawWorld(g, w, frame, W, H);
    else this.drawOverview(g, frame, W, H, dpr);
  }

  drawWorld(g, w, frame, W, H) {
    const cam = this.cam(w);
    const X = (x) => (x - cam.cx) * cam.s + W / 2;
    const Y = (z) => (z - cam.cz) * cam.s + H / 2;
    const t = w.terrain;
    const img = this.terrainImage(w);
    g.imageSmoothingEnabled = true;
    const ext = (t.n - 1) * t.step;
    g.drawImage(img, X(t.origin[0] - t.step / 2), Y(t.origin[1] - t.step / 2), (ext + t.step) * cam.s, (ext + t.step) * cam.s);
    const L = frame.layers;
    if (L.colliders) {
      g.strokeStyle = 'rgba(255,255,255,0.28)';
      g.lineWidth = 1;
      for (const b of w.boxes) this.box(g, X, Y, cam.s, b.center[0], b.center[2], b.half[0], b.half[2], b.yaw, false);
    }
    if (L.obstacles) {
      g.fillStyle = 'rgba(196,190,180,0.75)';
      g.strokeStyle = 'rgba(13,13,13,0.8)';
      g.lineWidth = 1;
      for (const o of w.obstacles) {
        if (o.round) {
          g.beginPath(); g.arc(X(o.pos[0]), Y(o.pos[2]), Math.max(o.size[0] * cam.s, 1.5), 0, 2 * Math.PI); g.fill(); g.stroke();
        } else this.box(g, X, Y, cam.s, o.pos[0], o.pos[2], o.size[0] / 2, o.size[2] / 2, o.yaw, true);
      }
    }
    if (L.path && w.path.length > 1) {
      g.strokeStyle = 'rgba(242,241,236,0.55)';
      g.lineWidth = 1.5;
      g.setLineDash([6, 4]);
      g.beginPath();
      w.path.forEach((p, i) => (i ? g.lineTo(X(p[0]), Y(p[2])) : g.moveTo(X(p[0]), Y(p[2]))));
      if (w.closed) g.closePath();
      g.stroke();
      g.setLineDash([]);
    }
    // Start pad
    const sp = w.start.pos;
    g.strokeStyle = GOOD;
    g.lineWidth = 2;
    const pr = Math.max(1.5 * cam.s, 4);
    g.strokeRect(X(sp[0]) - pr, Y(sp[2]) - pr, 2 * pr, 2 * pr);
    for (const gt of w.gates) this.gate(g, X, Y, cam.s, gt);
    if (cam.s > 1.2) {
      g.font = '11px system-ui, -apple-system, "Segoe UI", sans-serif';
      g.textAlign = 'left';
      g.textBaseline = 'bottom';
      for (const gt of w.gates) {
        g.fillStyle = 'rgba(13,13,13,0.7)';
        const label = gt.feature ? `${gt.index} ${gt.feature}` : String(gt.index);
        const x = X(gt.pos[0]) + 6, y = Y(gt.pos[2]) - 6;
        g.fillRect(x - 2, y - 13, g.measureText(label).width + 4, 14);
        g.fillStyle = '#ffffff';
        g.fillText(label, x, y);
      }
    }
    this.drones(g, w, frame, X, Y);
    this.hover(w, frame, X, Y);
  }

  box(g, X, Y, s, cx, cz, hx, hz, yaw, fill) {
    g.save();
    g.translate(X(cx), Y(cz));
    // Box local (x, z) to world: dx = c*lx + s*lz, dz = -s*lx + c*lz, which is a canvas rotation by -yaw.
    g.rotate(-yaw);
    const w = Math.max(2 * hx * s, 1), h = Math.max(2 * hz * s, 1);
    if (fill) { g.fillRect(-w / 2, -h / 2, w, h); g.strokeRect(-w / 2, -h / 2, w, h); } else g.strokeRect(-w / 2, -h / 2, w, h);
    g.restore();
  }

  gate(g, X, Y, s, gt) {
    g.strokeStyle = gt.color;
    g.lineWidth = 2.5;
    g.lineJoin = 'round';
    g.beginPath();
    gt.outline.forEach((p, i) => (i ? g.lineTo(X(p[0]), Y(p[2])) : g.moveTo(X(p[0]), Y(p[2]))));
    g.closePath();
    g.stroke();
    const [fx, fy, fz] = gt.forward;
    const flat = Math.hypot(fx, fz);
    const cx = X(gt.pos[0]), cy = Y(gt.pos[2]);
    if (flat > 0.3) {
      // Direction tick: an arrow along the travel direction.
      const len = Math.max(gt.width * 0.7 * s, 9);
      const ux = fx / flat, uz = fz / flat;
      const ex = cx + ux * len, ey = cy + uz * len;
      g.beginPath();
      g.moveTo(cx, cy); g.lineTo(ex, ey);
      g.moveTo(ex - ux * 5 - uz * 4, ey - uz * 5 + ux * 4); g.lineTo(ex, ey); g.lineTo(ex - ux * 5 + uz * 4, ey - uz * 5 - ux * 4);
      g.stroke();
    } else {
      // Flown straight down (a cross, as into the page) or up (a dot).
      const r = Math.max(4, Math.min(gt.width * 0.25 * s, 10));
      g.beginPath();
      if (fy < 0) { g.moveTo(cx - r * 0.7, cy - r * 0.7); g.lineTo(cx + r * 0.7, cy + r * 0.7); g.moveTo(cx + r * 0.7, cy - r * 0.7); g.lineTo(cx - r * 0.7, cy + r * 0.7); g.stroke(); }
      else { g.fillStyle = gt.color; g.arc(cx, cy, 2.5, 0, 2 * Math.PI); g.fill(); }
    }
  }

  drones(g, w, frame, X, Y) {
    const cur = frame.chain[frame.chain.length - 1];
    if (!cur) return;
    const t = frame.t;
    const ids = dronesInWorld(cur, w.index, Math.floor(t));
    this.shown = [];
    ids.forEach((e, rank) => {
      const col = droneColor(rank, ids.length);
      const pts = trail(frame.chain, e, t, frame.trailSteps);
      const head = dronePos(cur, e, t, frame.next);
      g.lineWidth = 2;
      g.lineCap = 'round';
      for (let k = 1; k < pts.length; k++) {
        const a = pts[k - 1], b = pts[k];
        g.globalAlpha = Math.max(0.05, 1 - b[4] / frame.trailSteps);
        g.strokeStyle = frame.trailMode === 'speed' ? speedColor(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) * frame.hz) : col;
        g.beginPath(); g.moveTo(X(a[0]), Y(a[2])); g.lineTo(X(b[0]), Y(b[2])); g.stroke();
      }
      if (pts.length) {
        const a = pts[pts.length - 1];
        g.globalAlpha = 1;
        g.beginPath(); g.moveTo(X(a[0]), Y(a[2])); g.lineTo(X(head[0]), Y(head[2])); g.stroke();
      }
      g.globalAlpha = 1;
      for (const m of crashMarks(frame.chain, e, t, frame.trailSteps * 2)) {
        if (m[4] !== w.index) continue;
        g.globalAlpha = Math.max(0.15, 1 - m[3] / (frame.trailSteps * 2));
        this.cross(g, X(m[0]), Y(m[2]), 5, CRITICAL);
      }
      g.globalAlpha = 1;
      const hx = X(head[0]), hy = Y(head[2]);
      g.fillStyle = '#0d0d0d';
      g.beginPath(); g.arc(hx, hy, 6, 0, 2 * Math.PI); g.fill();
      g.fillStyle = col;
      g.beginPath(); g.arc(hx, hy, 4.5, 0, 2 * Math.PI); g.fill();
      if (head[3] & BIT_FINISH) { g.strokeStyle = GOOD; g.lineWidth = 2; g.beginPath(); g.arc(hx, hy, 9, 0, 2 * Math.PI); g.stroke(); }
      this.shown.push({ e, x: hx, y: hy, head, color: col });
    });
  }

  cross(g, x, y, r, color) {
    g.strokeStyle = color;
    g.lineWidth = 2.5;
    g.beginPath(); g.moveTo(x - r, y - r); g.lineTo(x + r, y + r); g.moveTo(x + r, y - r); g.lineTo(x - r, y + r); g.stroke();
  }

  /** Tooltip for the drone or gate under the pointer. */
  hover(w, frame, X, Y) {
    const tip = this.tip;
    if (!this.mouse) { tip.hidden = true; return; }
    const { x, y } = this.mouse;
    let best = null, bd = 14;
    for (const d of this.shown ?? []) {
      const dd = Math.hypot(d.x - x, d.y - y);
      if (dd < bd) { bd = dd; best = { drone: d }; }
    }
    if (!best) {
      for (const gt of w.gates) {
        const dd = Math.hypot(X(gt.pos[0]) - x, Y(gt.pos[2]) - y);
        if (dd < bd) { bd = dd; best = { gate: gt }; }
      }
    }
    if (!best) { tip.hidden = true; return; }
    const lines = [];
    if (best.drone) {
      const d = best.drone;
      const bits = d.head[3];
      lines.push([`Drone ${d.e}`, true], [`next gate ${nextOf(bits)} of ${w.gates.length}`], [`height ${d.head[1].toFixed(1)} m`]);
      if (bits & BIT_CRASH) lines.push(['crashed this step']);
      if (bits & BIT_DONE) lines.push(['episode ended this step']);
    } else {
      const gt = best.gate;
      lines.push([`Gate ${gt.index}: ${gt.kind}`, true], [`${gt.width} x ${gt.height} m, centre ${gt.pos[1].toFixed(1)} m up`]);
      if (gt.feature) lines.push([`part of ${gt.feature}`]);
      if (Math.abs(gt.pitch) > 0.01) lines.push([`pitch ${((gt.pitch * 180) / Math.PI).toFixed(0)}°`]);
      if (Math.abs(gt.roll) > 0.01) lines.push([`roll ${((gt.roll * 180) / Math.PI).toFixed(0)}°`]);
      if (gt.depth) lines.push([`sleeve ${gt.depth} m`]);
    }
    tip.replaceChildren(...lines.map(([text, strong]) => { const el = document.createElement(strong ? 'b' : 'div'); el.textContent = text; return el; }));
    tip.hidden = false;
    const r = this.canvas.getBoundingClientRect();
    tip.style.left = `${Math.min(x + 14, r.width - 200)}px`;
    tip.style.top = `${Math.max(y - 10, 0)}px`;
  }

  /** Static layer of one small multiple: terrain, centreline and gates, cached per cell size. */
  cellLayer(w, cw, ch, dpr) {
    const key = `${w.index}:${cw}x${ch}@${dpr}`;
    let c = this.cells.get(key);
    if (c) return c;
    c = document.createElement('canvas');
    c.width = Math.round(cw * dpr); c.height = Math.round(ch * dpr);
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cam = this.fit(w, cw - 8, ch - 24);
    const X = (x) => (x - cam.cx) * cam.s + cw / 2;
    const Y = (z) => (z - cam.cz) * cam.s + (ch + 14) / 2;
    const t = w.terrain;
    g.save();
    g.beginPath(); g.rect(0, 18, cw, ch - 18); g.clip();
    g.imageSmoothingEnabled = true;
    g.drawImage(this.terrainImage(w), X(t.origin[0] - t.step / 2), Y(t.origin[1] - t.step / 2), t.n * t.step * cam.s, t.n * t.step * cam.s);
    g.strokeStyle = 'rgba(242,241,236,0.6)';
    g.lineWidth = 1;
    g.beginPath();
    w.path.forEach((p, i) => (i ? g.lineTo(X(p[0]), Y(p[2])) : g.moveTo(X(p[0]), Y(p[2]))));
    if (w.closed) g.closePath();
    g.stroke();
    for (const gt of w.gates) { g.fillStyle = gt.color; g.fillRect(X(gt.pos[0]) - 1.5, Y(gt.pos[2]) - 1.5, 3, 3); }
    g.restore();
    c.cam = { X, Y };
    if (this.cells.size > 400) this.cells.clear();
    this.cells.set(key, c);
    return c;
  }

  drawOverview(g, frame, W, H, dpr) {
    const worlds = this.app.worlds;
    const N = worlds.length;
    if (!N) return;
    const { cols, rows } = gridFor(N, W, H);
    const cw = Math.floor(W / cols), ch = Math.floor(H / rows);
    this.layout = { cols, rows, cw, ch };
    const cur = frame.chain[frame.chain.length - 1];
    g.font = '11px system-ui, -apple-system, "Segoe UI", sans-serif';
    g.textBaseline = 'top';
    worlds.forEach((w, k) => {
      const ox = (k % cols) * cw, oy = Math.floor(k / cols) * ch;
      const layer = this.cellLayer(w, cw, ch, dpr);
      g.drawImage(layer, ox, oy, cw, ch);
      g.strokeStyle = k === this.hoverCell ? '#c3c2b7' : '#2c2c2a';
      g.lineWidth = 1;
      g.strokeRect(ox + 0.5, oy + 0.5, cw - 1, ch - 1);
      g.fillStyle = '#ffffff';
      g.textAlign = 'left';
      g.fillText(`${k} ${w.style}`, ox + 5, oy + 4);
      const tl = frame.tallies?.[k];
      if (tl) {
        g.textAlign = 'right';
        g.fillStyle = '#c3c2b7';
        const long = `${tl.drones} drones · ${tl.gates} gates · ${tl.crashes} crashes`;
        const fits = g.measureText(long).width + g.measureText(`${k} ${w.style}`).width + 24 < cw;
        g.fillText(fits ? long : `${tl.drones} · ${tl.gates} g · ${tl.crashes} x`, ox + cw - 5, oy + 4);
      }
    });
    if (!cur) return;
    // Drones: a short trail and the head in their world's cell.
    const t = frame.t;
    const T = cur.T, K = cur.K;
    const t0 = Math.min(Math.floor(t), T - 1);
    const short = Math.min(frame.trailSteps, 24);
    for (let e = 0; e < K; e++) {
      const wk = worldOf(cur.u[(t0 * K + e) * 4 + 3]);
      if (wk >= N) continue;
      const layer = this.cellLayer(worlds[wk], cw, ch, dpr);
      const ox = (wk % cols) * cw, oy = Math.floor(wk / cols) * ch;
      const { X, Y } = layer.cam;
      g.save();
      g.beginPath(); g.rect(ox, oy + 18, cw, ch - 18); g.clip();
      const pts = trail(frame.chain, e, t, short);
      g.strokeStyle = NEUTRAL_DRONE;
      g.lineWidth = 1.2;
      for (let q = 1; q < pts.length; q++) {
        g.globalAlpha = Math.max(0.08, 1 - pts[q][4] / short);
        g.beginPath(); g.moveTo(ox + X(pts[q - 1][0]), oy + Y(pts[q - 1][2])); g.lineTo(ox + X(pts[q][0]), oy + Y(pts[q][2])); g.stroke();
      }
      g.globalAlpha = 1;
      const head = dronePos(cur, e, t, frame.next);
      const crashed = head[3] & BIT_CRASH;
      g.fillStyle = crashed ? CRITICAL : NEUTRAL_DRONE;
      g.beginPath(); g.arc(ox + X(head[0]), oy + Y(head[2]), 2.5, 0, 2 * Math.PI); g.fill();
      g.restore();
    }
  }
}
