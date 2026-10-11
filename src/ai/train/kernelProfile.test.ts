import { describe, expect, it } from 'vitest';
import { decodeKernelTimes } from './kernelProfile';

describe('training kernel timestamp decoding', () => {
  it('keeps nanosecond differences precise above Number integer precision and sums repeated kernels', () => {
    const origin = 2n ** 60n;
    const r = decodeKernelTimes(new BigUint64Array([origin, origin + 1000000n, origin + 2000000n, origin + 4000000n, origin + 5000000n, origin + 8000000n]), ['physics', 'network', 'physics']);
    expect(r.totalMs).toBe(6);
    expect(r.spanMs).toBe(8);
    expect(r.kernels.find(k => k.name === 'physics')).toMatchObject({dispatches: 2, validSamples: 2, totalMs: 4});
  });
  it('reports missing, unwritten and reversed timestamps without presenting them as zero cost', () => {
    const r = decodeKernelTimes(new BigUint64Array([0n, 3n, 20n, 10n]), ['unwritten', 'reversed', 'missing']);
    expect(r.totalMs).toBeNull();
    expect(r.spanMs).toBeNull();
    expect(r.kernels.every(k => k.invalidSamples === 1 && k.totalMs === null)).toBe(true);
  });
  it('retains quantised zero intervals and mixed invalid sample counts', () => {
    const r = decodeKernelTimes(new BigUint64Array([10n, 10n, 0n, 0n, 30n, 1000030n]), ['tiny', 'mixed', 'mixed']);
    expect(r.kernels[0]).toMatchObject({zeroSamples: 1, validSamples: 1, totalMs: 0});
    expect(r.kernels[1]).toMatchObject({invalidSamples: 1, validSamples: 1, totalMs: 1});
    expect(r.totalMs).toBe(1);
  });
});

describe('profiling query capacity', () => {
  it('rejects a workload that exceeds the portable query limit before allocating GPU resources', async () => {
    const { KernelProfiler } = await import('./kernelProfile');
    const fake = { createQuerySet: () => { throw new Error('unexpected allocation'); } } as unknown as GPUDevice;
    expect(() => new KernelProfiler(fake, 4097)).toThrow('limit 8192');
  });
});
