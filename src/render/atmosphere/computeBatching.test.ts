import { beforeAll, describe, expect, it } from 'vitest';
import type { RenderContext } from '../contracts';
import type { CloudNoise } from './cloudNoise';
import { AtmosphereLuts } from './lutPasses';
import { CloudLayer } from './clouds';
import { AP_SLICES, MULTISCATTER_SIZE, SKYVIEW_SIZE, TRANSMITTANCE_SIZE } from './physics';
import { CLOUD_SHADOW_SIZE } from './cloudModel';

beforeAll(() => {
  Object.assign(globalThis, {
    GPUShaderStage: { COMPUTE: 4 }, GPUTextureUsage: { TEXTURE_BINDING: 4, STORAGE_BINDING: 8 },
    GPUBufferUsage: { UNIFORM: 64, COPY_DST: 8 },
  });
});

function fixture() {
  let id = 0;
  const texture = () => ({ id: id++, createView: () => ({ id: id++ }), destroy() {} });
  const device = {
    createTexture: texture, createBuffer: () => ({ destroy() {} }), createSampler: () => ({}),
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
  return { rc, passes, encoder, texture };
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
    expect(labels(passes)).toEqual(Array.from({ length: 3 }, () => ['cloud march', 'cloud resolve', 'cloud shadow']));
    for (const p of passes) {
      expect(p.map(d => d.size)).toEqual([[5, 3], [5, 3], [CLOUD_SHADOW_SIZE / 8, CLOUD_SHADOW_SIZE / 8]]);
      for (const d of p) expect(d.groups[0]).toBe(rc.frame.group);
    }
    expect(passes[0][1].groups[1]).toBe(passes[2][1].groups[1]);
    expect(passes[0][1].groups[1]).not.toBe(passes[1][1].groups[1]);
  });

  it('restarts cloud history and disabled clearing after resize', () => {
    const { rc, passes, encoder } = fixture();
    const clouds = new CloudLayer(rc, { shapeView: {}, detailView: {} } as CloudNoise, {} as GPUBuffer);
    clouds.encode(encoder, false); clouds.encode(encoder, false);
    rc.gbuf.width = 129; rc.gbuf.height = 73;
    clouds.prepare(); expect(clouds.historyValid).toBe(false);
    clouds.encode(encoder, false); expect(passes).toHaveLength(2);
    expect(passes[1].map(d => d.size)).toEqual([[9, 5], [9, 5], [CLOUD_SHADOW_SIZE / 8, CLOUD_SHADOW_SIZE / 8]]);
    expect(passes[1][1].groups[1]).not.toBe(passes[0][1].groups[1]);
  });
});
