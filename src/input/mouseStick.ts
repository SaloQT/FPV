import { clamp } from './curves';

/** Mouse travel in pixels for full stick deflection at sensitivity 1. */
export const FULL_DEFLECTION_PX = 300;
/** Spring natural frequency at `centering` 1 (1/omega = 0.15 s); it scales linearly down to 0 = no spring. */
export const MAX_SPRING_OMEGA = 1 / 0.15;

/**
 * A virtual gimbal driven by mouse deltas. Pixels move the stick directly (no smoothing, so no added latency); between
 * movements it returns to centre along a critically damped spring, or stays put when `centering` is 0 like a real gimbal held
 * by the thumb. Sign convention matches StickInput: right = roll > 0, mouse down = pitch > 0 (nose down).
 */
export class MouseStick {
  x = 0;
  y = 0;
  private vx = 0;
  private vy = 0;
  private pendingX = 0;
  private pendingY = 0;

  addPixels(dx: number, dy: number): void {
    this.pendingX += dx;
    this.pendingY += dy;
  }

  reset(): void {
    this.x = this.y = this.vx = this.vy = this.pendingX = this.pendingY = 0;
  }

  /** Spring first, then this frame's mouse travel, so the output always reflects the newest movement in full. */
  update(dt: number, centering: number, sensitivity: number, invertY: boolean): void {
    if (centering > 0 && dt > 0) this.spring(dt, MAX_SPRING_OMEGA * centering);
    const k = sensitivity / FULL_DEFLECTION_PX;
    if (this.pendingX !== 0) {
      this.x = clamp(this.x + this.pendingX * k, -1, 1);
      this.vx = 0;
    }
    if (this.pendingY !== 0) {
      this.y = clamp(this.y + (invertY ? -this.pendingY : this.pendingY) * k, -1, 1);
      this.vy = 0;
    }
    this.pendingX = this.pendingY = 0;
  }

  /** Exact critically damped step: x(t) = (x0 + (v0 + w x0) t) e^(-w t). */
  private spring(dt: number, w: number): void {
    const e = Math.exp(-w * dt);
    const bx = this.vx + w * this.x;
    const by = this.vy + w * this.y;
    this.x = e * (this.x + bx * dt);
    this.y = e * (this.y + by * dt);
    this.vx = e * (this.vx - w * bx * dt);
    this.vy = e * (this.vy - w * by * dt);
  }
}
