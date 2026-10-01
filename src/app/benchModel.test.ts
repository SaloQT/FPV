import { describe, expect, it } from 'vitest';
import { BenchRecorder, benchVerdict, type BenchMeta, type BenchResult } from './benchModel';

const NAMES = ['pre', 'gbuffer', 'rt'];
const META: BenchMeta = {
  device: { vendor: 'acme', architecture: 'gen9', description: 'Acme GPU', software: false },
  renderWidth: 1920, renderHeight: 1080, outWidth: 1920, outHeight: 1080, quality: 'high', refreshHz: 144,
};

function feed(r: BenchRecorder, frames: number, ms: number, gpu = NaN, pass: number[] = [NaN, NaN, NaN], scale = 1): void {
  for (let i = 0; i < frames; i++) r.push(ms, gpu, pass, scale);
}

describe('BenchRecorder', () => {
  it('skips the warm-up and measures the rest', () => {
    const r = new BenchRecorder(NAMES, 1, 0.5, 5);
    feed(r, 50, 10);
    expect(r.frames).toBe(0);
    expect(r.warmingUp).toBe(false);
    feed(r, 100, 10);
    expect(r.frames).toBe(100);
    expect(r.done).toBe(true);
  });

  it('computes the average and the 1% low', () => {
    const r = new BenchRecorder(NAMES, 1, 0, 5);
    feed(r, 197, 5);
    feed(r, 3, 50);
    const res = r.result(META);
    expect(res.frames).toBe(200);
    expect(res.seconds).toBeCloseTo((197 * 5 + 150) / 1000, 9);
    expect(res.avgFps).toBeCloseTo(200 / res.seconds, 6);
    // 1% of 200 frames is 2: both slowest frames are 50 ms.
    expect(res.p1LowFps).toBeCloseTo(20, 6);
    expect(res.avgFps).toBeGreaterThan(res.p1LowFps);
  });

  it('does not end before the minimum number of frames, however long they took', () => {
    const r = new BenchRecorder(NAMES, 3, 0, 5);
    expect(r.push(1000, NaN, [], 1)).toBe(false);
    r.push(1000, NaN, [], 1);
    expect(r.push(1000, NaN, [], 1)).toBe(false);
    r.push(1000, NaN, [], 1);
    expect(r.push(1000, NaN, [], 1)).toBe(true);
  });

  it('averages GPU time and per-section times over the frames that have them', () => {
    const r = new BenchRecorder(NAMES, 0.01, 0, 1);
    r.push(5, 2, [1, 0.5, 0.5], 1);
    r.push(5, 4, [3, 0.5, NaN], 1);
    r.push(5, NaN, [NaN, NaN, NaN], 1);
    const res = r.result(META);
    expect(res.avgGpuMs).toBeCloseTo(3, 9);
    expect(res.perPassMs).toEqual({ pre: 2, gbuffer: 0.5, rt: 0.5 });
  });

  it('reports null GPU numbers when the device has no timestamp queries', () => {
    const r = new BenchRecorder(NAMES, 0.01, 0, 1);
    feed(r, 10, 5);
    const res = r.result(META);
    expect(res.avgGpuMs).toBeNull();
    expect(res.perPassMs).toBeNull();
  });

  it('averages the dynamic scale and keeps the device and size it is given', () => {
    const r = new BenchRecorder(NAMES, 0.01, 0, 1);
    r.push(5, NaN, [], 1);
    r.push(5, NaN, [], 0.5);
    const res = r.result(META);
    expect(res.renderScale).toBeCloseTo(0.75, 9);
    expect(res.device.vendor).toBe('acme');
    expect(res.refreshHz).toBe(144);
  });

  it('ignores impossible frame times', () => {
    const r = new BenchRecorder(NAMES, 0.01, 0, 1);
    r.push(0, NaN, [], 1);
    r.push(-4, NaN, [], 1);
    r.push(NaN, NaN, [], 1);
    expect(r.frames).toBe(0);
  });

  it('an empty run gives zeros, not NaN', () => {
    const res = new BenchRecorder(NAMES).result(META);
    expect(res).toMatchObject({ avgFps: 0, p1LowFps: 0, frames: 0, renderScale: 1 });
  });
});

describe('benchVerdict', () => {
  const base: BenchResult = { ...new BenchRecorder(NAMES, 0, 0, 0).result(META), avgFps: 144, avgGpuMs: 2 };

  it('says software rendering proves nothing about GPUs', () => {
    expect(benchVerdict({ ...base, device: { ...META.device, software: true } })).toMatch(/Software rendering/);
  });

  it('a result at the refresh rate is display-limited and shows the GPU headroom', () => {
    const v = benchVerdict(base);
    expect(v).toContain('144 Hz');
    expect(v).toContain('500 fps');
  });

  it('a result below the refresh rate says the GPU is the limit', () => {
    expect(benchVerdict({ ...base, avgFps: 90 })).toMatch(/GPU could not keep up/);
  });
});
