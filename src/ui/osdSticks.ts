import type { HudModel } from './hud';
import type { Painter } from './osdPainter';
import type { OsdContext } from './osdTypes';

export interface StickBox {
  x: number;
  y: number;
  size: number;
}

/** Share of the canvas height one stick box takes. */
const BOX_HEIGHT_SHARE = 0.07;
export function dotSize(box: StickBox): number {
  return Math.max(5, Math.round(box.size * 0.16));
}

/** The two boxes sit above the bottom text row, left stick (yaw, throttle) on the left and right stick (roll, pitch) on the right. */
export function stickBoxes(p: Painter): { left: StickBox; right: StickBox } {
  const size = Math.max(24, Math.round(p.height * BOX_HEIGHT_SHARE));
  const bottom = p.height - p.marginY - p.main * 0.25;
  const y = Math.round(bottom - p.line * 2.35 - size);
  return { left: { x: p.marginX, y, size }, right: { x: p.width - p.marginX - size, y, size } };
}

/** Where the dot goes for a stick position in -1..1 on each axis (up is positive here, so pass the forward-positive value). */
export function dotCenter(box: StickBox, x: number, up: number): [number, number] {
  const half = box.size / 2;
  // Full deflection puts the dot's outline against the frame, never over it.
  const k = half - dotSize(box) / 2 - 2;
  const cx = box.x + half;
  const cy = box.y + half;
  return [cx + Math.min(Math.max(x, -1), 1) * k, cy - Math.min(Math.max(up, -1), 1) * k];
}

/** Stick and throttle indicator: what the flight controller is being sent, drawn as two gimbal boxes with a dot each. */
export class StickGauge {
  draw(_g: OsdContext, p: Painter, m: HudModel): void {
    const s = m.sticks;
    if (!s.visible) return;
    const { left, right } = stickBoxes(p);
    for (const b of [left, right]) this.box(p, b);
    // Throttle is 0..1 with the stick at the bottom for zero: map it onto the box's -1..1 height. Pitch forward is up, as on a radio.
    this.dot(p, left, s.yaw, s.throttle * 2 - 1);
    this.dot(p, right, s.roll, s.pitch);
  }

  private box(p: Painter, b: StickBox): void {
    const t = Math.max(1, Math.round(p.unit * 1.5));
    const cx = b.x + b.size / 2, cy = b.y + b.size / 2, tick = b.size * 0.08;
    p.alpha(0.5);
    p.fillRect(b.x, b.y, b.size, b.size, 'rgba(8,10,14,0.5)');
    p.alpha(0.8);
    p.fillRect(b.x, b.y, b.size, t, '#fff');
    p.fillRect(b.x, b.y + b.size - t, b.size, t, '#fff');
    p.fillRect(b.x, b.y, t, b.size, '#fff');
    p.fillRect(b.x + b.size - t, b.y, t, b.size, '#fff');
    p.fillRect(cx - tick, cy - t / 2, tick * 2, t, '#fff');
    p.fillRect(cx - t / 2, cy - tick, t, tick * 2, '#fff');
    p.alpha(1);
  }

  private dot(p: Painter, box: StickBox, x: number, up: number): void {
    const [cx, cy] = dotCenter(box, x, up);
    const d = dotSize(box);
    p.fillRect(cx - d / 2 - 1, cy - d / 2 - 1, d + 2, d + 2, 'rgba(0,0,0,0.85)');
    p.fillRect(cx - d / 2, cy - d / 2, d, d, '#62f58a');
  }
}
