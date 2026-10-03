import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FrameInfo, RenderContext, SceneData } from '../contracts';
import { qualityProfile } from '../contracts';
import { resolveShader } from '../shaderLib';
import { createRTModule } from './index';
import { canCompactProbes, ProbeGrid } from './probes';

const limits = { maxComputeWorkgroupsPerDimension: 65535, maxStorageBufferBindingSize: 128 * 1024 * 1024, maxBufferSize: 256 * 1024 * 1024 };
type Command = (string | number)[];
function fixture(deviceLimits = limits) {
  const commands: Command[] = [], buffers: (GPUBufferDescriptor & { data: ArrayBuffer; destroy: ReturnType<typeof vi.fn> })[] = [];
  const groups: GPUBindGroupDescriptor[] = [], writes: Uint32Array[] = [];
  const device = {
    limits: deviceLimits,
    queue: {
      writeBuffer(b: { label: string }, _offset: number, data: ArrayBuffer) { if (b.label === 'rt params') writes.push(new Uint32Array(data.slice(0))); },
      writeTexture() {},
    },
    createBuffer(d: GPUBufferDescriptor) {
      const b = { ...d, data: new ArrayBuffer(d.size), destroy: vi.fn(), getMappedRange() { return this.data; }, unmap() {} };
      buffers.push(b); return b;
    },
    createTexture(d: GPUTextureDescriptor) { return { destroy() {}, createView: () => ({ label: d.label }) }; },
    createSampler: () => ({}),
    createBindGroup(d: GPUBindGroupDescriptor) { groups.push(d); return d; },
    createBindGroupLayout: (d: GPUBindGroupLayoutDescriptor) => d,
    createPipelineLayout: (d: GPUPipelineLayoutDescriptor) => d,
    createComputePipelineAsync: async (d: GPUComputePipelineDescriptor) => d,
  } as unknown as GPUDevice;
  const rc = {
    device, quality: qualityProfile('low'),
    frame: { group: { label: 'frame' }, layout: {} }, world: { group: { label: 'world' }, layout: {} },
    gbuf: { rtWidth: 9, rtHeight: 7, width: 36, height: 28, views: Object.fromEntries(['sunShadow', 'giDiffuse', 'giSpecular', 'depth', 'normal', 'misc', 'motion'].map(label => [label, { label }])) },
    rt: { version: 0, allStatic: () => [], allDynamic: () => [] }, module: () => ({}),
  } as unknown as RenderContext;
  const enc = {
    clearBuffer(b: GPUBuffer, offset: number, size: number) { commands.push(['clear', b.label, offset, size]); },
    beginComputePass(d: GPUComputePassDescriptor) {
      commands.push(['begin', d.label!]);
      return {
        setPipeline(p: GPUComputePipeline) { commands.push(['pipeline', p.label]); },
        setBindGroup(i: number, g: GPUBindGroup) { commands.push(['group', i, g.label]); },
        dispatchWorkgroups(x: number, y = 1, z = 1) { commands.push(['dispatch', x, y, z]); },
        dispatchWorkgroupsIndirect(b: GPUBuffer, offset: number) { commands.push(['indirect', b.label, offset]); },
        end() { commands.push(['end']); },
      };
    },
  } as unknown as GPUCommandEncoder;
  const frame = (frameIndex: number) => ({ frameIndex, camera: { pos: [-11, 5, 13] } }) as FrameInfo;
  return { device, rc, enc, frame, commands, buffers, groups, writes };
}

beforeEach(() => {
  vi.stubGlobal('GPUShaderStage', { COMPUTE: 4 });
  vi.stubGlobal('GPUBufferUsage', { STORAGE: 128, UNIFORM: 64, COPY_DST: 8, COPY_SRC: 4, INDIRECT: 256 });
  vi.stubGlobal('GPUTextureUsage', { STORAGE_BINDING: 8, TEXTURE_BINDING: 4, COPY_SRC: 1, COPY_DST: 2 });
});
afterEach(() => vi.unstubAllGlobals());

describe('bounded compact probe capacity', () => {
  it('admits stock grids and the exact dispatch/buffer boundary without clipping', () => {
    for (const tier of ['low', 'medium', 'high', 'ultra'] as const) {
      const d = qualityProfile(tier).probes.dim;
      expect(canCompactProbes(d[0] * d[1] * d[2], limits)).toBe(true);
    }
    expect(canCompactProbes(65535, limits)).toBe(true);
    expect(canCompactProbes(65536, limits)).toBe(false);
    expect(canCompactProbes(100, { ...limits, maxStorageBufferBindingSize: 400 })).toBe(true);
    expect(canCompactProbes(101, { ...limits, maxStorageBufferBindingSize: 400 })).toBe(false);
    expect(canCompactProbes(101, { ...limits, maxBufferSize: 400 })).toBe(false);
    expect(canCompactProbes(1, { ...limits, maxStorageBufferBindingSize: 12 })).toBe(false);
    expect(canCompactProbes(1, { ...limits, maxBufferSize: 12 })).toBe(false);
    expect(canCompactProbes(1, { ...limits, maxBufferSize: 16, maxStorageBufferBindingSize: 16 })).toBe(true);
    for (const n of [0, -1, 1.5, NaN, Infinity, 2 ** 31, Number.MAX_SAFE_INTEGER + 1]) expect(canCompactProbes(n, limits)).toBe(false);
  });

  it('initializes reusable indirect arguments and accounts for/destructs both scratch buffers', () => {
    const f = fixture(), p = new ProbeGrid(f.device, qualityProfile('high').probes);
    const work = f.buffers.filter(b => String(b.label).startsWith('rt active probe'));
    expect(work.map(b => b.size)).toEqual([16384 * 4, 16]);
    expect(Array.from(new Uint32Array(work[1].data))).toEqual([0, 1, 1, 0]);
    expect(p.bytes).toBe(16384 * 52 + 16);
    expect(p.useCompact).toBe(false);
    p.plan(0, 0, 0); p.commit(); p.plan(0, 0, 0); expect(p.useCompact).toBe(true);
    p.reset(); p.plan(0, 0, 0); expect(p.useCompact).toBe(false);
    p.destroy(); for (const b of work) expect(b.destroy).toHaveBeenCalledOnce();
  });

  it('retains direct execution for stride one or unsupported allocation limits', () => {
    const f = fixture(), q = qualityProfile('high').probes;
    const p = new ProbeGrid(f.device, q, { rayBudget: 1e12, maxStride: 16 });
    p.plan(0, 0, 0); p.commit(); p.plan(0, 0, 0); expect(p.useCompact).toBe(false);
    expect(p.work).toBeNull(); expect(p.bytes).toBe(p.total * 48); expect(f.buffers).toHaveLength(0);
    const limited = fixture({ ...limits, maxComputeWorkgroupsPerDimension: 1024 });
    const d = new ProbeGrid(limited.device, q);
    expect(d.work).toBeNull(); expect(d.bytes).toBe(d.total * 48);
    expect(limited.buffers).toHaveLength(0);
  });
});

describe('compact probe command encoding', () => {
  it('uses direct first frames, resets every compact encode including capture, and preserves window/seed/parity', async () => {
    const f = fixture(), m = createRTModule(); await m.init(f.rc);
    const encode = (i: number) => { f.commands.length = 0; m.encodeRT!(f.enc, f.rc, f.frame(i)); return f.commands.slice(); };
    const first = encode(10);
    expect(first).toContainEqual(['pipeline', 'rt probe update']);
    expect(first.some(c => c[0] === 'clear' || c[0] === 'indirect')).toBe(false);
    expect(encode(10)).toEqual(first);
    const next = encode(11), capture = encode(11);
    expect(capture).toEqual(next);
    expect(next.slice(0, 2)).toEqual([['clear', 'rt active probe dispatch', 0, 4], ['begin', 'rt']]);
    const at = next.findIndex(c => c[0] === 'pipeline' && c[1] === 'rt probe plan');
    expect(next.slice(at, at + 7)).toEqual([
      ['pipeline', 'rt probe plan'], ['group', 1, 'rt probe plan 0'], ['dispatch', 4, 2, 4],
      ['pipeline', 'rt probe compact update'], ['group', 1, 'world'], ['group', 2, 'rt probes compact 0'], ['indirect', 'rt active probe dispatch', 0],
    ]);
    expect(next.slice(-4)).toEqual([['pipeline', 'rt latch'], ['group', 1, 'rt latch'], ['dispatch', 1, 1, 1], ['end']]);
    expect(f.writes[2]).toEqual(f.writes[3]);
    expect(f.writes[2][23]).toBe(0); expect(f.writes[2][15]).toBe(11 % m.stats().probeStride);
    expect(f.writes[0][23]).toBe(1);
    m.setScene!(f.rc, { sampler: null } as unknown as SceneData);
    expect(encode(12)).toContainEqual(['pipeline', 'rt probe update']);
    m.destroy!();
  });

  it('ceil-dispatches odd dimensions and rebuilds/destroys work resources on quality changes', async () => {
    const f = fixture(), m = createRTModule(); await m.init(f.rc);
    m.encodeRT!(f.enc, f.rc, f.frame(1));
    const old = f.buffers.filter(b => String(b.label).startsWith('rt active probe'));
    f.rc.quality = { ...f.rc.quality, probes: { dim: [5, 3, 7], raysPerProbe: 64, spacing: 5 } };
    m.setOptions({ probeRayBudget: 1 });
    m.encodeRT!(f.enc, f.rc, f.frame(2));
    for (const b of old) expect(b.destroy).toHaveBeenCalledOnce();
    f.commands.length = 0; m.encodeRT!(f.enc, f.rc, f.frame(3));
    expect(f.commands).toContainEqual(['dispatch', 2, 1, 2]);
    const compactGroups = f.groups.filter(g => String(g.label).startsWith('rt probes compact'));
    const current = compactGroups.at(-1)!;
    expect(Array.from(current.entries).find(e => e.binding === 12)?.resource).toEqual({ buffer: f.buffers.filter(b => b.label === 'rt active probe ids').at(-1) });
    f.rc.quality = { ...f.rc.quality, probes: { dim: [41, 41, 41], raysPerProbe: 64, spacing: 5 } };
    m.encodeRT!(f.enc, f.rc, f.frame(4));
    f.commands.length = 0; m.encodeRT!(f.enc, f.rc, f.frame(5));
    expect(f.commands).toContainEqual(['pipeline', 'rt probe update']);
    expect(f.commands.some(c => c[0] === 'clear' || c[0] === 'indirect')).toBe(false);
    m.destroy!();
  });

  it('only changes compact cell acquisition; keeps the ray body and reduction text identical', () => {
    const direct = resolveShader('rt/probe_update.wgsl', { GRP: 2 });
    const compact = resolveShader('rt/probe_update.wgsl', { GRP: 2, COMPACT: true });
    const marker = '  let lattice = rp.probeLo.xyz + posmod3(cell - rp.probeLo.xyz, dim);';
    expect(compact.slice(compact.indexOf(marker))).toBe(direct.slice(direct.indexOf(marker)));
    const planner = resolveShader('rt/probe_plan.wgsl', { GRP: 1 });
    expect(planner).toContain('if (any(gid >= rp.probeDim.xyz)) { return; }');
    expect(planner).toContain('let doTrace = fresh || (id % max(rp.dbg.z, 1u)) == rp.dbg.w;');
    expect(planner).not.toContain('traceScene');
  });
});
