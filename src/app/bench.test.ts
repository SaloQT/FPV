import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GpuTimingSample } from '../render/gpuTimer';
import { PASS_NAMES } from '../render/gpuTimer';
import { startBench } from './bench';
import { parsePerfParams } from './perfParams';
import type { AppCtx } from './state';
import type { Loop } from './loop';

vi.mock('../ui/benchPanel', () => ({ BenchPanel: class { progress() {} show() {} } }));

function fixture(options: { warmup?: number; supported?: boolean; detailed?: boolean; initialErrors?: number } = {}) {
  let listener: ((s: GpuTimingSample) => void) | null = null;
  let resolveDrain!: (value: boolean) => void;
  const drain = new Promise<boolean>(resolve => { resolveDrain = resolve; });
  const settings = { quality: 'high', performance240: false, renderScale: 1 };
  const renderer = {
    stats: { frameIndex: 0, renderWidth: 640, renderHeight: 360, outWidth: 640, outHeight: 360, displayHz: 60, displaySource: 'measured', errorCount: 0 },
    adapter: { vendor: '', architecture: '', device: '', description: '', software: false },
    gpuProfiling: { requested: options.detailed ?? false, supported: options.supported ?? true, mode: options.supported === false ? 'unsupported' : options.detailed ? 'detailed' : 'coarse' },
    qualityProfile: { tier: 'high' }, totalErrorCount: options.initialErrors ?? 0, lost: null as string | null,
    listenGpuTimings: vi.fn((fn: (s: GpuTimingSample) => void) => { listener = fn; return vi.fn(); }),
    drainGpuTimings: vi.fn(() => drain), onLost: vi.fn() as ((reason: string, message: string) => void) | null,
  };
  const previousLost = renderer.onLost;
  const ctx = { renderer, store: { get: () => settings }, root: {}, params: { scenario: 'hover' }, world: { seed: 1337, terrainSeed: 1337, request: {} } } as unknown as AppCtx;
  const loop = { onFrame: null } as unknown as Loop;
  const promise = startBench(ctx, loop, parsePerfParams(`?bench=1&benchSeconds=1&benchWarmup=${options.warmup ?? 0}`));
  const frame = (id: number, ms = 200) => { renderer.stats.frameIndex = id; loop.onFrame?.(ms, id * ms); };
  const emit = (id: number, sequence = id, gpuMs: number | null = 2, status: GpuTimingSample['status'] = 'measured') => listener?.({
    frameIndex: id, sequence, gpuMs, status, passMs: PASS_NAMES.map(() => gpuMs ?? NaN), detailMs: null, detailWritten: 0,
  });
  return { ctx, loop, renderer, previousLost, promise, frame, emit, resolveDrain };
}

beforeEach(() => {
  vi.stubGlobal('window', { __fpv: {}, devicePixelRatio: 1 });
  vi.stubGlobal('navigator', { userAgent: 'mock browser' });
  vi.stubGlobal('location', { href: 'http://localhost/?bench=1', reload: vi.fn() });
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('benchmark attribution and asynchronous completion', () => {
  it('buffers synchronous drops before admission, excludes warmup, accepts final delayed samples once, and waits for drain', async () => {
    const f = fixture({ warmup: 0.1 });
    f.frame(1, 100); f.frame(2); f.emit(1, 1, 99); f.emit(2, 2, 1);
    f.emit(3, 3, null, 'dropped'); f.frame(3); // drop occurs inside render before onFrame
    f.frame(4); f.frame(5); f.emit(5, 5, 0); f.emit(4, 4, 3); f.emit(4, 4, 3);
    f.frame(6); // end measured window; frame6 query is still pending
    expect(window.__fpv.bench).toBeUndefined(); expect(f.loop.onFrame).toBeNull();
    f.emit(6, 6, 4); f.resolveDrain(true);
    const result = await f.promise;
    expect(result.frames).toBe(5); expect(result.avgGpuMs).toBe(2);
    expect(result.gpuTiming).toMatchObject({ received: 5, measured: 4, dropped: 1, pending: 0, firstFrame: 2, lastFrame: 6 });
    expect(result.incompleteReason).toBeNull(); expect(window.__fpv.bench).toBe(result);
    expect(f.renderer.onLost).toBe(f.previousLost);
  });

  it('exports timed-out pending samples and ignores late callbacks after finalization', async () => {
    const f = fixture(); for (let i = 1; i <= 5; i++) f.frame(i);
    f.resolveDrain(false); const result = await f.promise;
    expect(result.incompleteReason).toMatch(/timed out/); expect(result.gpuTiming.pending).toBe(5);
    const exported = JSON.stringify(result); f.emit(5, 5, 2); expect(JSON.stringify(window.__fpv.bench)).toBe(exported);
  });

  it('finishes on device loss even when the recovery handler stops the loop', async () => {
    const f = fixture({ detailed: true }); f.frame(1); f.emit(1);
    f.renderer.lost = 'unknown: test'; f.renderer.onLost?.('unknown', 'test');
    expect(f.previousLost).toHaveBeenCalledWith('unknown', 'test'); expect(f.loop.onFrame).toBeNull();
    f.resolveDrain(true); const result = await f.promise;
    expect(result.incompleteReason).toMatch(/device lost/); expect(result.profile.supported).toBe(true);
    expect(result.profile.mode).toBe('detailed');
  });

  it('does not merge a replacement renderer generation into the original run', async () => {
    const f = fixture(); f.frame(1); f.emit(1);
    (f.ctx as { renderer: unknown }).renderer = { stats: { frameIndex: 1 } };
    f.frame(2); f.resolveDrain(true); const result = await f.promise;
    expect(result.frames).toBe(1); expect(result.incompleteReason).toMatch(/renderer changed/);
  });

  it('completes on unsupported adapters with null GPU values and no falsely pending timestamps', async () => {
    const f = fixture({ supported: false, detailed: true });
    for (let i = 1; i <= 5; i++) f.frame(i);
    f.resolveDrain(true); const result = await f.promise;
    expect(result.avgGpuMs).toBeNull(); expect(result.perPassMs).toBeNull(); expect(result.gpuTiming.pending).toBe(0);
    expect(result.profile).toMatchObject({ requested: true, supported: false, mode: 'unsupported' });
    expect(result.device.classification).toBe('unknown'); expect(result.incompleteReason).toBeNull();
  });

  it('freezes measured dimensions and detects errors surfaced during the drain', async () => {
    const f = fixture(); for (let i = 1; i <= 5; i++) f.frame(i);
    f.renderer.stats.renderWidth = 320; f.renderer.totalErrorCount = 21;
    f.resolveDrain(true); const result = await f.promise;
    expect(result.renderWidth).toBe(640); expect(result.incompleteReason).toMatch(/asynchronous drain/);
    expect(result.provenance?.rendererErrorCount).toBe(21);
  });

  it('marks a run with pre-existing renderer failures incomplete instead of benchmarking degraded rendering as valid', async () => {
    const f = fixture({ initialErrors: 1 }); for (let i = 1; i <= 5; i++) f.frame(i);
    f.resolveDrain(true); const result = await f.promise;
    expect(result.incompleteReason).toMatch(/already had errors/);
    expect(result.provenance?.errorsAtMeasurementStart).toBe(1);
  });

});
