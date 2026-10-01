/** Seconds of "get ready" before the first number. */
export const COUNTDOWN_LEAD_S = 1;
/** The count starts at this number and ends with GO. */
export const COUNTDOWN_FROM = 3;
export const COUNTDOWN_STEP_S = 1;
/** How long GO stays on screen after the arming lock is lifted. */
export const COUNTDOWN_GO_HOLD_S = 1;

/** What the HUD needs: `value` is 3, 2, 1 while counting, 0 on GO and -1 otherwise. */
export interface CountdownSnapshot {
  active: boolean;
  /** Arming and throttle are refused until GO. */
  locked: boolean;
  value: number;
  /** 0..1 through the current number, for the pulse. */
  fraction: number;
}

export function createCountdownSnapshot(): CountdownSnapshot {
  return { active: false, locked: false, value: -1, fraction: 0 };
}

const GO_SEGMENT = COUNTDOWN_FROM + 1;
const END_S = COUNTDOWN_LEAD_S + COUNTDOWN_FROM * COUNTDOWN_STEP_S + COUNTDOWN_GO_HOLD_S;

/** Segment 0 is the lead-in, 1..FROM the numbers, FROM+1 is GO. */
function segmentAt(t: number): number {
  return t < COUNTDOWN_LEAD_S ? 0 : Math.min(GO_SEGMENT, 1 + Math.floor((t - COUNTDOWN_LEAD_S) / COUNTDOWN_STEP_S));
}

/** The 3-2-1-GO sequence of a race start. Time only moves through `advance`, so the sim decides when it runs. */
export class StartCountdown {
  private t = 0;
  private running = false;

  get active(): boolean {
    return this.running;
  }

  /** Still counting: the pilot may not arm yet. */
  get locked(): boolean {
    return this.running && segmentAt(this.t) < GO_SEGMENT;
  }

  start(): void {
    this.t = 0;
    this.running = true;
  }

  cancel(): void {
    this.running = false;
  }

  /** Moves the clock on; returns the number to beep for (3, 2, 1, 0 for GO) when one just came up, otherwise -1. */
  advance(dt: number): number {
    if (!this.running || !(dt > 0)) return -1;
    const before = segmentAt(this.t);
    this.t += dt;
    if (this.t >= END_S) {
      this.running = false;
      return before < GO_SEGMENT ? 0 : -1;
    }
    const after = segmentAt(this.t);
    return after > before && after >= 1 ? GO_SEGMENT - after : -1;
  }

  snapshot(out: CountdownSnapshot): CountdownSnapshot {
    out.active = this.running;
    if (!this.running) {
      out.locked = false;
      out.value = -1;
      out.fraction = 0;
      return out;
    }
    const seg = segmentAt(this.t);
    out.locked = seg < GO_SEGMENT;
    out.value = seg === 0 ? -1 : GO_SEGMENT - seg;
    const start = seg === 0 ? 0 : COUNTDOWN_LEAD_S + (seg - 1) * COUNTDOWN_STEP_S;
    const len = seg === 0 ? COUNTDOWN_LEAD_S : seg === GO_SEGMENT ? COUNTDOWN_GO_HOLD_S : COUNTDOWN_STEP_S;
    out.fraction = Math.min(Math.max((this.t - start) / len, 0), 1);
    return out;
  }
}
