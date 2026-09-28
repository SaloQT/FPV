export const DEFAULT_PHYSICS_HZ = 4000;
/** At most this much simulated time is caught up in one frame; the rest is dropped (a stall must not snowball). */
export const MAX_CATCHUP_S = 0.05;
export const MIN_PHYSICS_HZ = 250;
export const MAX_PHYSICS_HZ = 16000;

/** Fixed-timestep accumulator: turns variable frame times into a whole number of equal physics steps. */
export class FixedStepper {
  dt = 1 / DEFAULT_PHYSICS_HZ;
  /** Simulated seconds owed but not yet stepped, always in [0, dt) after `advance`. */
  accumulator = 0;
  /** Steps discarded by the catch-up cap since the last `resetStats`. */
  droppedSteps = 0;

  constructor(hz = DEFAULT_PHYSICS_HZ) {
    this.setRate(hz);
  }

  get hz(): number {
    return 1 / this.dt;
  }

  /** Position between the last two states, in [0, 1): what `renderState` blends by. */
  get alpha(): number {
    const a = this.accumulator / this.dt;
    return a < 0 ? 0 : a >= 1 ? 1 - 1e-12 : a;
  }

  setRate(hz: number): void {
    const clamped = Number.isFinite(hz) ? Math.min(Math.max(hz, MIN_PHYSICS_HZ), MAX_PHYSICS_HZ) : DEFAULT_PHYSICS_HZ;
    if (1 / clamped !== this.dt) this.dt = 1 / clamped;
  }

  /** Adds `realDt` and returns how many `dt` steps to run now. */
  advance(realDt: number): number {
    if (!(realDt > 0)) return 0;
    let acc = this.accumulator + realDt;
    if (acc > MAX_CATCHUP_S) {
      this.droppedSteps += Math.floor((acc - MAX_CATCHUP_S) / this.dt + 1e-9);
      acc = MAX_CATCHUP_S;
    }
    // The epsilon keeps e.g. 60 frames of 1/60 s from landing one step short of 4000 through float error.
    const steps = Math.floor(acc / this.dt + 1e-9);
    this.accumulator = Math.max(acc - steps * this.dt, 0);
    return steps;
  }

  reset(): void {
    this.accumulator = 0;
  }
}
