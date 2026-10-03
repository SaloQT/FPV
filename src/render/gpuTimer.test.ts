import { describe, expect, it } from 'vitest';
import { MARK, PASS_NAMES, sectionMs } from './gpuTimer';

describe('GPU timer sections', () => {
  it('has one mark per section boundary in frame order', () => {
    expect(PASS_NAMES.length + 1).toBe(Object.keys(MARK).length);
    const order = [MARK.FrameBegin, MARK.PreEnd, MARK.GBufferEnd, MARK.RtEnd, MARK.LightingEnd, MARK.OverlayEnd, MARK.FrameEnd];
    expect(order).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('converts nanosecond timestamps to milliseconds', () => {
    const t = [1_000_000_000n, 1_500_000n + 1_000_000_000n, 1_000_000_000n + 4_500_000n];
    expect(sectionMs(t, 0, 1)).toBeCloseTo(1.5, 6);
    expect(sectionMs(t, 0, 2)).toBeCloseTo(4.5, 6);
  });

  it('rejects a section whose clock went backwards or was never written', () => {
    expect(sectionMs([5n, 3n], 0, 1)).toBeNull();
    expect(sectionMs([0n, 9n], 0, 1)).toBeNull();
    expect(sectionMs([7n, 7n], 0, 1)).toBeNull();
  });
});

import { afterEach, beforeEach, vi } from 'vitest';
import { DETAIL_NAMES, GpuTimer, measuredMs, type GpuTimingSample } from './gpuTimer';

function timerFixture(detailed = false, enabled = true) {
  const commands: unknown[][] = [], buffers: any[] = [], queries: any[] = [];
  const device = {
    createQuerySet(d: GPUQuerySetDescriptor) { const q = { ...d, destroy: vi.fn() }; queries.push(q); return q; },
    createBuffer(d: GPUBufferDescriptor) {
      let resolve!: () => void, reject!: (e: Error) => void;
      const b = { ...d, data: new BigUint64Array(Number(d.size) / 8), mapAsync: vi.fn(() => new Promise<void>((res, rej) => { resolve = res; reject = rej; })),
        getMappedRange() { return this.data.buffer; }, unmap: vi.fn(), destroy: vi.fn(), finish: () => resolve(), fail: () => reject(new Error('mapping failed')) };
      buffers.push(b); return b;
    },
  } as unknown as GPUDevice;
  const encoder = {
    beginComputePass(d: GPUComputePassDescriptor) { commands.push(['pass', d]); return { end() {} }; },
    resolveQuerySet(_q: GPUQuerySet, start: number, count: number) { commands.push(['resolve', start, count]); },
    copyBufferToBuffer(_a: GPUBuffer, _b: number, out: GPUBuffer, _d: number, size: number) { commands.push(['copy', out.label, size]); },
  } as unknown as GPUCommandEncoder;
  const timer = new GpuTimer(device, enabled, detailed), samples: GpuTimingSample[] = [];
  timer.listen(s => samples.push(s));
  const frame = (id: number, capture = false, detail = true) => {
    timer.beginFrame(id, capture);
    for (let i = 0; i < 6; i++) timer.mark(encoder, i as 0);
    if (detail) timer.computePass('clouds', 'clouds');
    timer.resolve(encoder); timer.afterSubmit();
  };
  const complete = async (slot: number, offset = 0n) => {
    await Promise.resolve();
    const b = buffers[slot + 1];
    for (let i = 0; i < b.data.length; i++) b.data[i] = 1_000_000n + BigInt(i) * 1_000_000n + offset;
    b.finish(); await timer.drain();
  };
  return { timer, samples, commands, buffers, queries, frame, complete };
}

beforeEach(() => {
  vi.stubGlobal('GPUBufferUsage', { QUERY_RESOLVE: 1, COPY_SRC: 2, MAP_READ: 4, COPY_DST: 8 });
  vi.stubGlobal('GPUMapMode', { READ: 1 });
});
afterEach(() => vi.unstubAllGlobals());

describe('optional GPU profiling and readback lifecycle', () => {
  it('retains exactly seven queries, seven empty marks and a 56-byte copy by default', async () => {
    const f = timerFixture(); f.frame(9); await f.complete(0);
    expect(f.queries[0].count).toBe(7);
    expect(f.buffers.map(b => b.size)).toEqual([56, 56, 56, 56]);
    expect(f.commands.filter(c => c[0] === 'pass')).toHaveLength(7);
    expect(f.commands.at(-2)).toEqual(['resolve', 0, 7]);
    expect(f.commands.at(-1)).toEqual(['copy', 'timestamp readback 0', 56]);
    expect(f.samples[0]).toMatchObject({ sequence: 0, frameIndex: 9, status: 'measured', gpuMs: 6, detailMs: null });
  });

  it('has no resources or commands when timestamp-query is unsupported', async () => {
    const f = timerFixture(true, false); f.frame(0);
    expect(f.timer.active).toBe(false); expect(f.buffers).toEqual([]); expect(f.commands).toEqual([]); expect(f.samples).toEqual([]);
    expect(await f.timer.drain()).toBe(true);
  });

  it('records fresh intervals and masks skipped slots even when their old values remain', async () => {
    const f = timerFixture(true); f.frame(10); await f.complete(0);
    expect(f.queries[0].count).toBe(7 + 2 * DETAIL_NAMES.length);
    expect(f.samples[0].detailMs?.clouds).toBe(1);
    f.frame(11, false, false); await f.complete(0);
    expect(f.samples[1].detailMs?.clouds).toBeNull(); expect(f.samples[1].detailWritten).toBe(0);
  });

  it.each([false, true])('excludes capture callbacks with detailed=%s', async detailed => {
    const f = timerFixture(detailed); f.frame(4, true);
    expect(f.timer.active).toBe(false); await f.complete(0);
    expect(f.samples).toEqual([]);
    f.frame(5); await f.complete(0);
    expect(f.samples).toHaveLength(1); expect(f.samples[0]).toMatchObject({ sequence: 1, frameIndex: 5 });
  });

  it('drops when all three slots are busy and releases mapping failures for reuse', async () => {
    const f = timerFixture(true);
    f.frame(1); f.frame(2); f.frame(3); f.frame(4);
    expect(f.samples).toEqual([expect.objectContaining({ frameIndex: 4, status: 'dropped' })]);
    await Promise.resolve(); f.buffers[1].fail(); f.buffers[2].fail(); f.buffers[3].fail();
    expect(await f.timer.drain()).toBe(true);
    expect(f.samples.filter(s => s.status === 'failed')).toHaveLength(3);
    f.frame(5); await f.complete(0); expect(f.samples.at(-1)?.frameIndex).toBe(5);
  });

  it('does not replace a newer latest value when mappings complete out of order', async () => {
    const f = timerFixture(); f.frame(10); f.frame(11); await Promise.resolve();
    const a = f.buffers[1], b = f.buffers[2];
    a.data.set([1n, 2n, 3n, 4n, 5n, 6n, 7n]); b.data.set([1n, 3n, 5n, 7n, 9n, 11n, 13n]);
    b.finish(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    a.finish(); await f.timer.drain();
    expect(f.samples.map(s => s.frameIndex)).toEqual([11, 10]); expect(f.timer.gpuMs).toBe(12 / 1e6);
  });

  it('reports an unfinished drain and ignores late callbacks after destruction', async () => {
    const f = timerFixture(); f.frame(1); await Promise.resolve();
    expect(await f.timer.drain(0)).toBe(false);
    f.timer.destroy(); f.timer.destroy(); f.buffers[1].finish(); await f.timer.drain();
    expect(f.samples).toEqual([]); expect(f.timer.enabled).toBe(false);
    expect(f.buffers.every(b => b.destroy.mock.calls.length === 1)).toBe(true);
  });

  it('cancels a reserved buffer when encoding/submission fails', () => {
    const f = timerFixture(); f.timer.beginFrame(5);
    expect(() => f.timer.resolve({ beginComputePass: () => ({ end() {} }), resolveQuerySet() { throw new Error('encode'); } } as unknown as GPUCommandEncoder)).toThrow('encode');
    f.timer.abortFrame(); expect(f.samples[0]).toMatchObject({ frameIndex: 5, status: 'failed' });
    f.frame(6); expect(f.commands.at(-1)).toEqual(['copy', 'timestamp readback 0', 56]);
  });

  it('keeps measured quantized zero distinct from missing/invalid timestamps', () => {
    expect(measuredMs([7n, 7n], 0, 1)).toBe(0);
    expect(measuredMs([7n, 6n], 0, 1)).toBeNull();
  });
});


describe('timing listener isolation', () => {
  it('does not turn a throwing listener into a failed map or duplicate callback', async () => {
    const f = timerFixture(); const listener = vi.fn(() => { throw new Error('listener'); });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    f.timer.listen(listener); f.frame(1); await f.complete(0);
    expect(listener).toHaveBeenCalledTimes(1); expect(await f.timer.drain()).toBe(true);
    expect(f.buffers[1].unmap).toHaveBeenCalledOnce();
    vi.restoreAllMocks();
  });

  it('unsubscribes future frames but drains submitted frames into their original listener', async () => {
    const f = timerFixture(); const first: GpuTimingSample[] = [], second: GpuTimingSample[] = [];
    const stop = f.timer.listen(s => first.push(s)); f.frame(1); stop();
    f.timer.listen(s => second.push(s)); await f.complete(0);
    f.frame(2); await f.complete(0);
    expect(first.map(s => s.frameIndex)).toEqual([1]); expect(second.map(s => s.frameIndex)).toEqual([2]);
  });
});
