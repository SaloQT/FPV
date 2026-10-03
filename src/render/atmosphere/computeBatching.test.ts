import { beforeAll, describe, expect, it } from 'vitest';
import type { RenderContext } from '../contracts';
import type { CloudNoise } from './cloudNoise';
import { AtmosphereLuts } from './lutPasses';
import { CLOUD_FRAME_BYTES, CloudLayer } from './clouds';
import { AP_SLICES, MULTISCATTER_SIZE, SKYVIEW_SIZE, TRANSMITTANCE_SIZE } from './physics';
import { CLOUD_SHADOW_SIZE } from './cloudModel';

beforeAll(() => {
  Object.assign(globalThis, {
    GPUShaderStage: { COMPUTE: 4 }, GPUTextureUsage: { TEXTURE_BINDING: 4, STORAGE_BINDING: 8 },
    GPUBufferUsage: { UNIFORM: 64, COPY_DST: 8, STORAGE: 128 },
  });
});

function fixture() {
  let id = 0;
  const buffers: { size: number; usage: number; destroyed: boolean; destroy(): void }[] = [];
  const texture = () => ({ id: id++, createView: () => ({ id: id++ }), destroy() {} });
  const device = {
    createTexture: texture, createBuffer: (desc: { size: number; usage: number }) => {
      const buffer = { ...desc, destroyed: false, destroy() { this.destroyed = true; } };
      buffers.push(buffer); return buffer;
    }, createSampler: () => ({}),
    createBindGroupLayout: (desc: unknown) => desc, createPipelineLayout: (desc: unknown) => desc,
    createComputePipeline: (desc: unknown) => desc, createBindGroup: (desc: unknown) => desc,
  };
  const rc = {
    device, frame: { layout: {}, group: {} }, module: (path: string) => path,
    world: { tex: { transmittance: texture(), multiScatter: texture(), skyView: texture(), aerialPerspective: texture() }, samplers: { linearClamp: {} } },
    gbuf: { width: 65, height: 37 }, quality: { tier: 'high' },
  } as unknown as RenderContext;
  type Dispatch = { label: string; groups: unknown[]; size: number[] };
  const passes: Dispatch[][] = [];
  const encoder = {
    beginComputePass() {
      const calls: Dispatch[] = []; passes.push(calls);
      let label = ''; const groups: unknown[] = [];
      return {
        setPipeline(p: { label: string }) { label = p.label; },
        setBindGroup(i: number, g: unknown) { groups[i] = g; },
        dispatchWorkgroups(...size: number[]) { calls.push({ label, groups: [...groups], size }); },
        end() {},
      };
    },
  } as unknown as GPUCommandEncoder;
  return { rc, passes, encoder, texture, buffers };
}

const labels = (passes: { label: string }[][]) => passes.map(p => p.map(d => d.label));

describe('compute pass batching retains dispatch contracts', () => {
  it('bakes once in order, then preserves moon inactive and active stages', () => {
    const { rc, passes, encoder } = fixture(); const luts = new AtmosphereLuts(rc);
    luts.bake(encoder); luts.bake(encoder); luts.encode(encoder, false); luts.encode(encoder, true);
    expect(labels(passes)).toEqual([
      ['atmosphere transmittance', 'atmosphere multi-scatter'],
      ['atmosphere sky-view sun', 'atmosphere aerial'],
      ['atmosphere sky-view moon', 'atmosphere sky-view sun', 'atmosphere aerial'],
    ]);
    expect(passes[0].map(d => d.size)).toEqual([[TRANSMITTANCE_SIZE.width / 8, TRANSMITTANCE_SIZE.height / 8], [MULTISCATTER_SIZE, MULTISCATTER_SIZE]]);
    expect(passes[2].map(d => d.size)).toEqual([[Math.ceil(SKYVIEW_SIZE.width / 8), Math.ceil(SKYVIEW_SIZE.height / 8)], [Math.ceil(SKYVIEW_SIZE.width / 8), Math.ceil(SKYVIEW_SIZE.height / 8)], [AP_SLICES / 8, AP_SLICES / 8]]);
    for (const d of passes.flat()) { expect(d.groups[0]).toBe(rc.frame.group); expect(d.groups[1]).toBeDefined(); }
    expect(new Set(passes[2].map(d => d.groups[1])).size).toBe(3);
  });

  it('rebinds replaced LUTs without changing the dispatch order or count', () => {
    const { rc, passes, encoder, texture } = fixture(); const luts = new AtmosphereLuts(rc);
    luts.encode(encoder, true);
    rc.world.tex.skyView = texture() as unknown as GPUTexture;
    luts.encode(encoder, true);
    expect(labels(passes)[1]).toEqual(labels(passes)[0]);
    for (let i = 0; i < 3; i++) expect(passes[1][i].groups[1]).not.toBe(passes[0][i].groups[1]);
  });

  it('preserves cloud ping-pong, disabled clear, idle skip, and reenable behavior', () => {
    const { rc, passes, encoder } = fixture();
    const clouds = new CloudLayer(rc, { shapeView: {}, detailView: {} } as CloudNoise, {} as GPUBuffer);
    const initialView = clouds.resolvedView();
    clouds.encode(encoder, true); expect(clouds.resolvedView()).toBe(initialView);
    expect(clouds.historyValid).toBe(true); expect(clouds.frameIndex).toBe(1);
    clouds.encode(encoder, false); expect(clouds.resolvedView()).not.toBe(initialView);
    expect(clouds.historyValid).toBe(false); expect(clouds.frameIndex).toBe(2);
    clouds.encode(encoder, false); expect(passes).toHaveLength(2); expect(clouds.frameIndex).toBe(2);
    clouds.encode(encoder, true); expect(clouds.resolvedView()).toBe(initialView);
    expect(clouds.historyValid).toBe(true); expect(clouds.frameIndex).toBe(3);
    expect(labels(passes)).toEqual(Array.from({ length: 3 }, () => ['cloud lighting precompute', 'cloud march', 'cloud resolve', 'cloud shadow']));
    for (const p of passes) {
      expect(p.map(d => d.size)).toEqual([[1, 1], [5, 3], [5, 3], [CLOUD_SHADOW_SIZE / 8, CLOUD_SHADOW_SIZE / 8]]);
      for (const d of p) expect(d.groups[0]).toBe(rc.frame.group);
    }
    expect(passes[0][2].groups[1]).toBe(passes[2][2].groups[1]);
    expect(passes[0][2].groups[1]).not.toBe(passes[1][2].groups[1]);
  });

  it('restarts cloud history and disabled clearing after resize', () => {
    const { rc, passes, encoder } = fixture();
    const clouds = new CloudLayer(rc, { shapeView: {}, detailView: {} } as CloudNoise, {} as GPUBuffer);
    clouds.encode(encoder, false); clouds.encode(encoder, false);
    rc.gbuf.width = 129; rc.gbuf.height = 73;
    clouds.prepare(); expect(clouds.historyValid).toBe(false);
    clouds.encode(encoder, false); expect(passes).toHaveLength(2);
    expect(passes[1].map(d => d.size)).toEqual([[1, 1], [9, 5], [9, 5], [CLOUD_SHADOW_SIZE / 8, CLOUD_SHADOW_SIZE / 8]]);
    expect(passes[1][2].groups[1]).not.toBe(passes[0][2].groups[1]);
  });

  it('recomputes the f32 lighting block for every encode, rebinds replaced LUTs, and releases it', () => {
    const { rc, passes, encoder, texture, buffers } = fixture();
    const clouds = new CloudLayer(rc, { shapeView: {}, detailView: {} } as CloudNoise, {} as GPUBuffer);
    expect(buffers).toHaveLength(1);
    expect(buffers[0]).toMatchObject({ size: CLOUD_FRAME_BYTES, usage: GPUBufferUsage.STORAGE });
    clouds.encode(encoder, true); clouds.encode(encoder, true);
    type Group = { entries: GPUBindGroupEntry[]; layout: { entries: GPUBindGroupLayoutEntry[] } };
    const group = (frame: number, stage: number) => passes[frame][stage].groups[1] as Group;
    const entry = (g: Group, binding: number) => g.entries.find(e => e.binding === binding)!.resource;
    expect(passes[0][0].size).toEqual([1, 1]); expect(passes[1][0].size).toEqual([1, 1]);
    expect(entry(group(0, 0), 11)).toEqual({ buffer: buffers[0] });
    expect(entry(group(0, 1), 11)).toEqual({ buffer: buffers[0] });
    expect(group(0, 0).layout.entries.find(e => e.binding === 11)?.buffer).toEqual({ type: 'storage', minBindingSize: CLOUD_FRAME_BYTES });
    expect(group(0, 1).layout.entries.find(e => e.binding === 11)?.buffer).toEqual({ type: 'read-only-storage', minBindingSize: CLOUD_FRAME_BYTES });
    for (const key of ['skyView', 'transmittance', 'aerialPerspective'] as const) {
      const before = passes.length - 1;
      rc.world.tex[key] = texture() as unknown as GPUTexture;
      clouds.encode(encoder, true);
      expect(group(before + 1, 0)).not.toBe(group(before, 0));
      expect(group(before + 1, 1)).not.toBe(group(before, 1));
      expect(entry(group(before + 1, 0), 11)).toEqual({ buffer: buffers[0] });
    }
    clouds.destroy(); expect(buffers[0].destroyed).toBe(true);
  });
});
