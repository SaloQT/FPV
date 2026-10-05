import type { QuadState, Vec3 } from '../contracts';

/** A brain-flown quad is stuck when it has not moved this far from where it was STUCK_S ago (or it is disarmed). */
export const STUCK_MOVE_M = 2;
export const STUCK_S = 3;

/**
 * Tells a properly crashed and stuck quad (lying on the ground, wedged against a wall, disarmed) from one that hit something and
 * is still flying, so brains get to recover from a knock instead of being respawned at once.
 */
export class StuckWatch {
  private readonly anchor: Vec3 = [0, 0, 0];
  private since = 0;
  private armed = false;

  /** Starts watching from the quad's current position (after a respawn or a reset). */
  reset(s: QuadState): void {
    this.anchor[0] = s.pos[0];
    this.anchor[1] = s.pos[1];
    this.anchor[2] = s.pos[2];
    this.since = 0;
    this.armed = s.armed;
  }

  /** Advances by dt seconds; true once the quad is stuck (call reset after acting on it). */
  update(s: QuadState, dt: number): boolean {
    // Disarmed after flying: the motors are off and nothing will move it again.
    if (this.armed && !s.armed) return true;
    this.armed = s.armed;
    const dx = s.pos[0] - this.anchor[0];
    const dy = s.pos[1] - this.anchor[1];
    const dz = s.pos[2] - this.anchor[2];
    if (dx * dx + dy * dy + dz * dz > STUCK_MOVE_M * STUCK_MOVE_M) {
      this.reset(s);
      return false;
    }
    this.since += dt;
    return this.since >= STUCK_S;
  }
}
