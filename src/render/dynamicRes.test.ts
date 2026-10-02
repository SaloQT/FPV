import { describe, expect, it } from 'vitest';
import { DisplayPeriodEstimator, DynamicResolutionController, resolveTargetFps, SCALE_STEPS, scaledSize } from './dynamicRes';

function run(c: DynamicResolutionController, frames: number, gpuMs: number | null, frameMs: number, target = 240, enabled = true): number {
  let s = c.scale;
  for (let i = 0; i < frames; i++) s = c.update(gpuMs, frameMs, target, enabled);
  return s;
}

/** A failed up-probe may cost at most this many missed refreshes: PROBE_MISSES of the first few frames, plus a frame or two of lag. */
const PROBE_FRAME_BUDGET = 8;

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

  it('does not mistake a struggling device for a slow display: frames slower than 10 Hz are no estimate', () => {
    const e = new DisplayPeriodEstimator();
    for (let i = 0; i < 400; i++) e.push(300);
    expect(e.periodMs).toBe(0);
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
    run(c, 19, 5, 4.17);
    expect(c.scale).toBe(1);
    run(c, 1, 5, 4.17);
    expect(c.scale).toBe(0.9);
    run(c, 19, 5, 4.17);
    expect(c.scale).toBe(0.9);
    run(c, 1, 5, 4.17);
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

  it('steps back up only after 3 s of headroom, and not into a scale that failed in the last 8 s', () => {
    const c = new DynamicResolutionController();
    run(c, 20, 12, 8.33, 120);
    expect(c.scale).toBe(0.9);
    // 2 ms vs an 8.33 ms budget is plenty of headroom, but 1.0 failed <8 s ago.
    run(c, 700, 2, 8.33, 120);
    expect(c.scale).toBe(0.9);
    run(c, 400, 2, 8.33, 120);
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

  it('ignores frame times that are not positive numbers', () => {
    const c = new DynamicResolutionController();
    run(c, 100, 50, 0, 240);
    run(c, 100, 50, -3, 240);
    run(c, 100, 50, NaN, 240);
    expect(c.scale).toBe(1);
  });
});

describe('DynamicResolutionController stalls (frames longer than a second)', () => {
  it('a tab that was in the background for a minute (one huge frame) does not move the scale', () => {
    const gpu = new DynamicResolutionController();
    run(gpu, 400, 2, 4.17, 240);
    gpu.update(2, 60000, 240, true);
    run(gpu, 400, 2, 4.17, 240);
    expect(gpu.scale).toBe(1);
    const frame = new DynamicResolutionController();
    run(frame, 400, null, 4.17, 240);
    frame.update(null, 60000, 240, true);
    run(frame, 400, null, 4.17, 240);
    expect(frame.scale).toBe(1);
  });

  it('a device under 1 fps still reduces the resolution, with GPU timing', () => {
    const c = new DynamicResolutionController();
    let frames = 0;
    while (c.scale > SCALE_STEPS[SCALE_STEPS.length - 1] && frames < 200) {
      c.update(900 * c.scale * c.scale, 1300 * c.scale * c.scale, 60, true);
      frames++;
    }
    expect(c.scale).toBe(SCALE_STEPS[SCALE_STEPS.length - 1]);
    // About a second a frame: it has to get there in minutes, not hours.
    expect(frames).toBeLessThan(60);
  });

  it('a device under 1 fps still reduces the resolution, from frame times alone', () => {
    const c = new DynamicResolutionController();
    let frames = 0;
    while (c.scale > SCALE_STEPS[SCALE_STEPS.length - 1] && frames < 200) {
      c.update(null, 1200 + 400 * c.scale, 60, true);
      frames++;
    }
    expect(c.scale).toBe(SCALE_STEPS[SCALE_STEPS.length - 1]);
    expect(frames).toBeLessThan(60);
  });

  it('a very long GPU time is capped, not trusted blindly: it still steps down but never past the last step', () => {
    const c = new DynamicResolutionController();
    run(c, 500, 600000, 700000, 60);
    expect(c.scale).toBe(SCALE_STEPS[SCALE_STEPS.length - 1]);
  });
});

describe('DynamicResolutionController frame-time probing', () => {
  /** Full resolution cannot make the refresh (9.5 ms of GPU work vs a 6.94 ms period); every step below it can. */
  function failingProbes(seconds: number): { probes: number; missedFrames: number; missedPerProbe: number[] } {
    const c = new DynamicResolutionController();
    c.setMeasuredRefreshHz(144);
    const period = 1000 / 144;
    let t = 0, last = c.scale, probes = 0, missedFrames = 0, missesThisProbe = 0;
    const missedPerProbe: number[] = [];
    while (t < seconds * 1000) {
      const frame = Math.max(period, 9.5 * c.scale * c.scale);
      t += frame;
      if (frame > period * 1.3) { missedFrames++; missesThisProbe++; }
      const s = c.update(null, frame, 144, true);
      if (s < last && last === 1 && probes > 0) { missedPerProbe.push(missesThisProbe); }
      if (s === 1 && last < 1) { probes++; missesThisProbe = 0; }
      last = s;
    }
    return { probes, missedFrames, missedPerProbe };
  }

  it('a probe of a step that keeps failing is abandoned within a few frames', () => {
    const r = failingProbes(1200);
    expect(r.missedPerProbe.length).toBeGreaterThan(3);
    for (const n of r.missedPerProbe) expect(n).toBeLessThanOrEqual(PROBE_FRAME_BUDGET);
  });

  it('the back-off grows: twenty minutes of a failing full resolution hold a handful of probes, not one a minute', () => {
    const r = failingProbes(1200);
    expect(r.probes).toBeLessThanOrEqual(10);
    expect(r.probes).toBeGreaterThanOrEqual(5);
    // Under a tenth of a percent of the frames missed (172,800 frames at 144 Hz).
    expect(r.missedFrames / (1200 * 144)).toBeLessThan(0.001);
  });

  it('a probe that works is kept, and the back-off is forgotten after a quiet spell', () => {
    const c = new DynamicResolutionController();
    c.setMeasuredRefreshHz(144);
    const period = 1000 / 144;
    // Heavy scene first (full resolution fails), then a light one (everything fits).
    for (let i = 0; i < 40 * 144; i++) c.update(null, Math.max(period, 9.5 * c.scale * c.scale), 144, true);
    expect(c.scale).toBeLessThan(1);
    for (let i = 0; i < 600 * 144; i++) c.update(null, period, 144, true);
    expect(c.scale).toBe(1);
  });
});

describe('DynamicResolutionController robustness', () => {
  it('a big overshoot (more than 1.6x the budget) drops two steps at once', () => {
    const c = new DynamicResolutionController();
    run(c, 20, 8, 4.17);
    expect(c.scale).toBe(0.8);
  });

  it('decides on GPU time when it is available: a frame time pinned at a slow display does not matter', () => {
    const c = new DynamicResolutionController();
    run(c, 600, 2, 16.67, 240);
    expect(c.gpuDriven).toBe(true);
    expect(c.scale).toBe(1);
    const d = new DynamicResolutionController();
    run(d, 100, null, 16.67, 240);
    expect(d.gpuDriven).toBe(false);
  });

  it('is CPU-bound proof: long frames with a cheap GPU never lower the resolution', () => {
    const c = new DynamicResolutionController();
    run(c, 3000, 1.5, 12, 120);
    expect(c.scale).toBe(1);
  });

  it('steps up only when the cost predicted at the next step fits with margin (dead band)', () => {
    // At 0.9 the area ratio to 1.0 is 1/0.81: 3.0 ms -> 3.7 ms predicted, over 0.85 x 4.17 = 3.54 ms.
    const stay = new DynamicResolutionController();
    run(stay, 20, 5, 4.17, 240);
    expect(stay.scale).toBe(0.9);
    run(stay, 4000, 3.0, 4.17, 240);
    expect(stay.scale).toBe(0.9);
    const go = new DynamicResolutionController();
    run(go, 20, 5, 4.17, 240);
    run(go, 4000, 2.6, 4.17, 240);
    expect(go.scale).toBe(1);
  });

  it('one missed refresh in thirty does not move the scale in frame-time mode (240 Hz)', () => {
    const c = new DynamicResolutionController();
    let s = 1;
    for (let i = 0; i < 6000; i++) s = c.update(null, i % 30 === 0 ? 8.33 : 4.17, 240, true);
    expect(s).toBe(1);
  });

  it('frame-time mode drops when a fifth of the refreshes are missed', () => {
    const c = new DynamicResolutionController();
    for (let i = 0; i < 400; i++) c.update(null, i % 5 === 0 ? 8.33 : 4.17, 240, true);
    expect(c.scale).toBeLessThan(1);
  });

  it('converges instead of oscillating: a plant whose full-resolution cost misses the budget settles', () => {
    // Frame time without GPU timing: the display period unless the (area-proportional) cost exceeds it.
    const c = new DynamicResolutionController();
    c.setMeasuredRefreshHz(144);
    const period = 1000 / 144;
    const changes: number[] = [];
    let last = c.scale;
    let t = 0;
    let lateFrames = 0, lateAtFull = 0;
    const total = 20000;
    for (let i = 0; i < total; i++) {
      const cost = 9.5 * c.scale * c.scale;
      const frame = Math.max(period, cost) + (i % 7 === 0 ? 0.3 : 0);
      t += frame;
      const s = c.update(null, frame, 144, true);
      if (s !== last) { changes.push(t); last = s; }
      if (i > total * (2 / 3)) { lateFrames++; if (s === 1) lateAtFull++; }
    }
    // Failed probes back off, so the time spent back at the failing full resolution is a tiny share.
    expect(lateAtFull / lateFrames).toBeLessThan(0.03);
    expect(changes.length).toBeLessThan(16);
    expect(c.scale).toBeGreaterThanOrEqual(0.8);
  });

  it('a settled scale is held for a minute without a single change when the GPU time is steady', () => {
    const c = new DynamicResolutionController();
    for (let i = 0; i < 3000; i++) c.update(10 * c.scale * c.scale, 8.33, 120, true);
    const settled = c.scale;
    let changes = 0;
    for (let i = 0; i < 7200; i++) if (c.update(10 * c.scale * c.scale, 8.33, 120, true) !== settled) { changes++; break; }
    expect(changes).toBe(0);
  });

  it('without a measured refresh a GPU-bound app looks like a slow display and is not scaled; with one it is', () => {
    const blind = new DynamicResolutionController();
    for (let i = 0; i < 2000; i++) blind.update(null, 9.5, 144, true);
    expect(blind.scale).toBe(1);
    const informed = new DynamicResolutionController();
    informed.setMeasuredRefreshHz(144);
    for (let i = 0; i < 2000; i++) informed.update(null, 9.5, 144, true);
    expect(informed.scale).toBeLessThan(1);
  });

  it('a measured refresh is lowered when frames arrive faster than it (window moved to a faster monitor)', () => {
    const c = new DynamicResolutionController();
    c.setMeasuredRefreshHz(60);
    for (let i = 0; i < 1500; i++) c.update(null, 1000 / 240, 240, true);
    expect(c.displayPeriodMs).toBeLessThan(5);
  });

  it('reset restores full resolution and forgets failed steps', () => {
    const c = new DynamicResolutionController();
    run(c, 100, 8, 4.17);
    expect(c.scale).toBeLessThan(1);
    c.reset();
    expect(c.scale).toBe(1);
  });
});

describe('resolveTargetFps', () => {
  it('0 means the measured display refresh, a value means that value', () => {
    expect(resolveTargetFps(0, 144, 0)).toBe(144);
    expect(resolveTargetFps(240, 144, 0)).toBe(240);
  });
  it('falls back to 60 when the refresh is unknown', () => {
    expect(resolveTargetFps(0, 0, 0)).toBe(60);
  });
  it('never aims above the frame cap', () => {
    expect(resolveTargetFps(0, 240, 60)).toBe(60);
    expect(resolveTargetFps(144, 240, 120)).toBe(120);
    expect(resolveTargetFps(60, 240, 120)).toBe(60);
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
