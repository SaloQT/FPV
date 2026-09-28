import { horizonOffsetPx } from './hudFormat';
import type { OsdContext } from './osdTypes';

const RUNG_STEP = Math.PI / 18;
const RUNGS = 3;
const HORIZON_GAP = 0.05;
const MAX_SEGMENTS = 32;

/** Line segments collected once and stroked twice, dark and wide first, so thin lines stay readable over any picture. */
export class SegmentBatch {
  private readonly xy = new Float64Array(MAX_SEGMENTS * 4);
  private count = 0;

  clear(): void {
    this.count = 0;
  }

  add(x0: number, y0: number, x1: number, y1: number): void {
    if (this.count >= MAX_SEGMENTS) return;
    const i = this.count++ * 4;
    this.xy[i] = x0;
    this.xy[i + 1] = y0;
    this.xy[i + 2] = x1;
    this.xy[i + 3] = y1;
  }

  stroke(g: OsdContext, unit: number, alpha: number): void {
    if (this.count === 0) return;
    g.globalAlpha = alpha;
    this.pass(g, 'rgba(0,0,0,0.85)', Math.max(3, 5 * unit));
    this.pass(g, '#fff', Math.max(1.5, 2 * unit));
    g.globalAlpha = 1;
  }

  private pass(g: OsdContext, color: string, width: number): void {
    g.beginPath();
    for (let i = 0; i < this.count * 4; i += 4) {
      g.moveTo(this.xy[i], this.xy[i + 1]);
      g.lineTo(this.xy[i + 2], this.xy[i + 3]);
    }
    g.strokeStyle = color;
    g.lineWidth = width;
    g.stroke();
  }
}

export interface AttitudeView {
  cx: number;
  cy: number;
  width: number;
  height: number;
  /** Pixels per design unit (1 at 1080p). */
  unit: number;
  /** Camera pitch above level, rad. */
  cameraPitch: number;
  /** Right wing down positive, rad. */
  roll: number;
  fovY: number;
}

/** Fixed aiming cross at the middle of the picture, where the camera looks. */
export function addCrosshair(batch: SegmentBatch, cx: number, cy: number, unit: number): void {
  const a = 10 * unit, b = 26 * unit;
  batch.add(cx - b, cy, cx - a, cy);
  batch.add(cx + a, cy, cx + b, cy);
  batch.add(cx, cy + a, cx, cy + b);
  batch.add(cx - unit, cy, cx + unit, cy);
}

/**
 * Artificial horizon that lies on the real one in the picture: the offset comes from the camera's pitch and field of
 * view, the tilt from the roll, plus faint rungs every 10 degrees with ticks pointing at the horizon.
 */
export function addHorizon(batch: SegmentBatch, v: AttitudeView): void {
  const dx = Math.cos(v.roll), dy = -Math.sin(v.roll);
  const nx = -dy, ny = dx;
  const half = v.width * 0.11;
  const gap = v.width * HORIZON_GAP;
  const limit = v.height * 0.46;
  for (let i = -RUNGS; i <= RUNGS; i++) {
    const off = horizonOffsetPx(v.cameraPitch - i * RUNG_STEP, v.fovY, v.height);
    if (Math.abs(off) > limit) continue;
    const bx = v.cx + nx * off, by = v.cy + ny * off;
    const inner = i === 0 ? gap : gap * 0.6;
    const outer = i === 0 ? half : half * 0.45;
    batch.add(bx - dx * outer, by - dy * outer, bx - dx * inner, by - dy * inner);
    batch.add(bx + dx * inner, by + dy * inner, bx + dx * outer, by + dy * outer);
    if (i === 0) continue;
    const tick = 7 * v.unit * (i > 0 ? 1 : -1);
    batch.add(bx - dx * outer, by - dy * outer, bx - dx * outer + nx * tick, by - dy * outer + ny * tick);
    batch.add(bx + dx * outer, by + dy * outer, bx + dx * outer + nx * tick, by + dy * outer + ny * tick);
  }
}
