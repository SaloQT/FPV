import { describe, expect, it } from 'vitest';
import { FrameHistory, PERF_LABELS, formatPerf, newFrameSummary, newPerfSample } from './perfModel';

function fill(h: FrameHistory, ms: number, count: number): void {
  for (let i = 0; i < count; i++) h.push(ms);
}

describe('FrameHistory', () => {
  it('summarises an empty history as zeros', () => {
    const s = new FrameHistory(8).summarize(newFrameSummary());
    expect(s).toEqual({ avgMs: 0, avgFps: 0, lowFps: 0, worstMs: 0 });
  });

  it('averages the frames pushed so far', () => {
    const h = new FrameHistory(8);
    h.push(4);
    h.push(6);
    const s = h.summarize(newFrameSummary());
    expect(s.avgMs).toBeCloseTo(5, 5);
    expect(s.avgFps).toBeCloseTo(200, 3);
    expect(s.worstMs).toBe(6);
  });

  it('keeps only the newest frames, oldest first', () => {
    const h = new FrameHistory(4);
    for (let i = 1; i <= 6; i++) h.push(i);
    expect(h.length).toBe(4);
    expect([0, 1, 2, 3].map((i) => h.at(i))).toEqual([3, 4, 5, 6]);
  });

  it('reads the 1% low from the slowest frames of the window', () => {
    const h = new FrameHistory(200);
    fill(h, 4, 198);
    h.push(20);
    h.push(20);
    const s = h.summarize(newFrameSummary());
    expect(s.lowFps).toBeCloseTo(50, 3);
    expect(s.worstMs).toBe(20);
    expect(s.avgFps).toBeGreaterThan(s.lowFps);
  });

  it('uses a single frame for the 1% low of a short history', () => {
    const h = new FrameHistory(240);
    fill(h, 5, 10);
    h.push(25);
    expect(h.summarize(newFrameSummary()).lowFps).toBeCloseTo(40, 3);
  });

  it('ignores values that are not frame times', () => {
    const h = new FrameHistory(8);
    for (const v of [0, -3, NaN, Infinity]) h.push(v);
    expect(h.length).toBe(0);
  });

  it('forgets everything on clear', () => {
    const h = new FrameHistory(8);
    fill(h, 10, 8);
    h.clear();
    expect(h.length).toBe(0);
    fill(h, 2, 3);
    expect(h.summarize(newFrameSummary()).avgMs).toBeCloseTo(2, 5);
  });
});

describe('formatPerf', () => {
  it('writes one line per label', () => {
    const sample = { ...newPerfSample(), cpuMs: 1.234, gpuMs: 2.5, renderWidth: 1920, renderHeight: 1080, scale: 0.85, physicsMs: 0.1, physicsSteps: 4, quality: 'ultra' as const, adapter: 'Test GPU' };
    const h = new FrameHistory(8);
    fill(h, 4, 8);
    const lines = formatPerf(sample, h.summarize(newFrameSummary()), []);
    expect(lines).toHaveLength(PERF_LABELS.length);
    expect(lines[0]).toBe('250 avg, 250 1% low');
    expect(lines[2]).toBe('1.23 ms');
    expect(lines[3]).toBe('2.50 ms');
    expect(lines[4]).toBe('1920 x 1080 at 85%');
    expect(lines[5]).toBe('0.10 ms, 4 steps');
    expect(lines[6]).toBe('ultra');
    expect(lines[7]).toBe('Test GPU');
  });

  it('degrades gracefully without data', () => {
    const lines = formatPerf(newPerfSample(), newFrameSummary(), []);
    expect(lines[0]).toBe('-');
    expect(lines[3]).toBe('not measured');
    expect(lines[7]).toBe('unknown');
    expect(lines[5]).toContain('0 steps');
  });

  it('writes into the array it is given', () => {
    const out: string[] = [];
    expect(formatPerf(newPerfSample(), newFrameSummary(), out)).toBe(out);
  });
});
