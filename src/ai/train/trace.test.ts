import { describe, expect, it } from 'vitest';
import { checkTraceEnvs, envShader, DEFAULT_ENV } from '../gpu/envKernel';
import { DEFAULT_RATES } from '../../sim/fc/rates';
import { QUAD_5IN_6S } from '../../sim/presets';
import { packTraceWord, tracePoint, type IterationTrace } from './trace';

describe('dashboard trace', () => {
  it('packs world, next gate and flags the way env.wgsl does', () => {
    const K = 16, T = 2;
    const data = new Float32Array(K * T * 4);
    const u = new Uint32Array(data.buffer);
    data.set([1.5, 2.5, -3.5], (1 * K + 3) * 4);
    u[(1 * K + 3) * 4 + 3] = packTraceWord(47, 13, true, false, true);
    const p = tracePoint({ K, T, data } satisfies IterationTrace, 1, 3);
    expect(p).toEqual({ x: 1.5, y: 2.5, z: -3.5, world: 47, next: 13, crashed: true, finished: false, done: true });
    // The gate index saturates at 12 bits
    const w = packTraceWord(4095, 99999, false, true, false);
    expect(w & 0xfff).toBe(4095);
    expect((w >>> 12) & 0xfff).toBe(4095);
    expect(w >>> 24).toBe(2);
  });

  it('accepts multiples of 16 up to the env count', () => {
    expect(() => checkTraceEnvs(0, 256)).not.toThrow();
    expect(() => checkTraceEnvs(256, 256)).not.toThrow();
    expect(() => checkTraceEnvs(24, 256)).toThrow();
    expect(() => checkTraceEnvs(512, 256)).toThrow();
  });

  it('declares the trace binding only when tracing', () => {
    const o = { envs: 256, worlds: 4, quad: QUAD_5IN_6S, rates: DEFAULT_RATES, env: DEFAULT_ENV };
    const off = envShader(o);
    const on = envShader({ ...o, traceEnvs: 64 });
    expect(off).not.toContain('@binding(7)');
    expect(off).toContain('const TRACE_K : u32 = 0u;');
    expect(on).toContain('@group(0) @binding(7) var<storage, read_write> trace : array<vec4f>;');
    expect(on).toContain('const TRACE_K : u32 = 64u;');
    // The world pick draws its random number either way, so tracing does not shift the stream
    expect(on).toContain('ev.world = select(anyWorld, e % N_WORLDS, e < TRACE_K);');
  });
});
