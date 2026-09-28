import { describe, expect, it } from 'vitest';
import { DisplayPeriodEstimator, DynamicResolutionController, SCALE_STEPS, scaledSize } from './dynamicRes';

function run(c: DynamicResolutionController, frames: number, gpuMs: number | null, frameMs: number, target = 240, enabled = true): number {
  let s = c.scale;
  for (let i = 0; i < frames; i++) s = c.update(gpuMs, frameMs, target, enabled);
  return s;
}

describe('DisplayPeriodEstimator', () => {
  it('recovers the refresh period despite occasional short catch-up frames and long hitches', () => {
    const e = new DisplayPeriodEstimator();
    for (let i = 0; i < 1500; i++) {
      let dt = 1000 / 144 + ((i * 7) % 5) * 0.05;
      if (i % 97 === 0) dt = 1.2;
      if (i % 211 === 0) dt = 60;
      e.push(dt);
    }
    expect(e.periodMs).toBeGreaterThan(6.9);
    expect(e.periodMs).toBeLessThan(7.3);
  });

  it('ignores absurd samples (tab switch)', () => {
    const e = new DisplayPeriodEstimator();
    for (let i = 0; i < 400; i++) e.push(i % 50 === 0 ? 5000 : 16.67);
    expect(e.periodMs).toBeCloseTo(16.67, 1);
  });
});

describe('DynamicResolutionController', () => {
  it('steps down when the GPU exceeds the budget and respects the 20-frame minimum spacing', () => {
    const c = new DynamicResolutionController();
    expect(c.scale).toBe(1);
    run(c, 19, 8, 4.17);
    expect(c.scale).toBe(1);
    run(c, 1, 8, 4.17);
    expect(c.scale).toBe(0.9);
    run(c, 19, 8, 4.17);
    expect(c.scale).toBe(0.9);
    run(c, 1, 8, 4.17);
    expect(c.scale).toBe(0.8);
  });

  it('holds scale while under budget', () => {
    const c = new DynamicResolutionController();
    run(c, 2000, 3.0, 4.17, 240);
    expect(c.scale).toBe(1);
  });

  it('never goes below the last step', () => {
    const c = new DynamicResolutionController();
    run(c, 5000, 50, 4.17, 240);
    expect(c.scale).toBe(SCALE_STEPS[SCALE_STEPS.length - 1]);
  });

  it('budget follows a slow display: 60 Hz caps the target', () => {
    const c = new DynamicResolutionController();
    run(c, 600, 12, 16.67, 240);
    expect(c.displayPeriodMs).toBeCloseTo(16.67, 1);
    expect(c.budgetMs(240)).toBeCloseTo(16.67, 1);
    expect(c.scale).toBe(1);
  });

  it('steps back up only after 3 s of headroom, and not into a scale that failed in the last 10 s', () => {
    const c = new DynamicResolutionController();
    run(c, 20, 12, 8.33, 120);
    expect(c.scale).toBe(0.9);
    // 2 ms vs an 8.33 ms budget is plenty of headroom, but 1.0 failed <10 s ago.
    run(c, 1000, 2, 8.33, 120);
    expect(c.scale).toBe(0.9);
    run(c, 300, 2, 8.33, 120);
    expect(c.scale).toBe(1);
  });

  it('does not thrash under a borderline load: switches stay rare', () => {
    const c = new DynamicResolutionController();
    let changes = 0, last = c.scale;
    for (let i = 0; i < 6000; i++) {
      // GPU cost proportional to scale^2, with a little jitter; full-res cost 10 ms vs 8.33 ms budget.
      const cost = 10 * c.scale * c.scale * (1 + 0.03 * Math.sin(i * 1.7));
      const s = c.update(cost, 8.33, 120, true);
      if (s !== last) { changes++; last = s; }
    }
    expect(c.scale).toBeLessThan(1);
    expect(changes).toBeLessThan(12);
  });

  it('frame-time-only mode (no timestamp queries) steps down on misses and probes back up when on budget', () => {
    const c = new DynamicResolutionController();
    // 60 Hz display, but most frames miss vsync (25 ms); the occasional 16.67 ms frame reveals the display period.
    for (let i = 0; i < 300; i++) c.update(null, i % 6 === 0 ? 16.67 : 25, 60, true);
    expect(c.scale).toBeLessThan(1);
    for (let i = 0; i < 3000; i++) c.update(null, 16.67, 60, true);
    expect(c.scale).toBe(1);
  });

  it('is inert and resets when disabled', () => {
    const c = new DynamicResolutionController();
    run(c, 40, 50, 4.17, 240);
    expect(c.scale).toBeLessThan(1);
    expect(run(c, 10, 50, 4.17, 240, false)).toBe(1);
    expect(c.scale).toBe(1);
  });

  it('ignores invalid frame times', () => {
    const c = new DynamicResolutionController();
    run(c, 100, 50, 0, 240);
    run(c, 100, 50, 5000, 240);
    expect(c.scale).toBe(1);
  });
});

describe('scaledSize', () => {
  it('rounds, forces even and clamps to >= 64', () => {
    expect(scaledSize(1920, 1, 1)).toBe(1920);
    expect(scaledSize(1921, 1, 1)).toBe(1922);
    expect(scaledSize(1080, 0.5, 0.42)).toBe(228);
    expect(scaledSize(100, 0.25, 0.42)).toBe(64);
  });
});
