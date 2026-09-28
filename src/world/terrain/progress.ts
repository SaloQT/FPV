import type { ProgressFn } from '../../contracts';

/**
 * Maps per-step fractions onto one monotonic overall fraction using a cost estimate for every step, and thins the calls to
 * `fn` to at most one per 1% (plus every stage change), so worker messages stay cheap.
 */
export class ProgressTracker {
  private readonly total: number;
  private done = 0;
  private lastFraction = -1;
  private lastStage = '';

  constructor(
    private readonly fn: ProgressFn | undefined,
    costs: readonly number[],
  ) {
    this.total = costs.reduce((a, b) => a + b, 0);
  }

  /** Returns the reporter for a step of the given cost; call `finish` on it once the step is complete. */
  step(stage: string, cost: number): { report: (fraction: number) => void; finish: () => void } {
    const start = this.done;
    return {
      report: (fraction) => this.emit(stage, (start + cost * fraction) / this.total),
      finish: () => {
        this.done = start + cost;
      },
    };
  }

  complete(stage: string): void {
    this.lastFraction = -1;
    this.emit(stage, 1);
  }

  private emit(stage: string, overall: number): void {
    if (this.fn === undefined) return;
    const f = overall < 0 ? 0 : overall > 1 ? 1 : overall;
    if (stage === this.lastStage && f < 1 && f - this.lastFraction < 0.01) return;
    this.lastStage = stage;
    this.lastFraction = f;
    this.fn(stage, f);
  }
}
