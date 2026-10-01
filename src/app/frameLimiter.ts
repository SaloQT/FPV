/**
 * Frame cap on top of requestAnimationFrame. The loop still wakes at every display refresh; the limiter says whether this wake-up
 * should produce a frame. Deadlines advance by whole cap periods (not from the time of the last frame), so a 60 fps cap on a 144 Hz
 * display averages 60 fps with 2-3 refreshes between frames instead of settling on a slower beat.
 */
export class FrameLimiter {
  private next = 0;

  /** `now` is the rAF timestamp in ms; `capHz` 0 means uncapped; `displayPeriodMs` is the refresh period (0 when unknown). */
  allow(now: number, capHz: number, displayPeriodMs: number): boolean {
    if (!(capHz > 0)) {
      this.next = 0;
      return true;
    }
    const period = 1000 / capHz;
    // A cap at or above the refresh rate cannot throttle anything: every wake-up is already at most one frame.
    if (period <= displayPeriodMs * 1.05) {
      this.next = 0;
      return true;
    }
    // After a long stall start over instead of racing to catch up with deadlines that are far in the past.
    if (this.next === 0 || now > this.next + period * 2) this.next = now;
    // Half a refresh of slack: a wake-up that lands just before the deadline would otherwise wait a whole refresh.
    if (now + displayPeriodMs * 0.5 < this.next) return false;
    this.next += period;
    return true;
  }

  reset(): void {
    this.next = 0;
  }
}

/** Frame caps the menu offers; 0 is "follow the display". */
export const FRAME_CAPS: readonly number[] = [0, 240, 144, 120, 60, 30];
