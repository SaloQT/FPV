import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FrameInfo, RenderContext } from '../contracts';
import { qualityProfile } from '../contracts';
import { SceneRegistry } from '../rtRegistry';
import { resolveShader } from '../shaderLib';
import { createRTModule } from './index';

function fixture(sampledTextures: number, giRays: number) {
  const textures: (GPUTextureDescriptor & { destroy: ReturnType<typeof vi.fn>; view: object })[] = [];
  const calls: { label: string; groups: number[]; code: string }[] = [];
  const bindings = new Map<number, GPUBindGroupDescriptor>();
  const device = {
    limits: { maxSampledTexturesPerShaderStage: sampledTextures, maxComputeWorkgroupsPerDimension: 65535,
      maxStorageBufferBindingSize: 128 * 1024 * 1024, maxBufferSize: 256 * 1024 * 1024 },
    queue: { writeBuffer() {}, writeTexture() {} },
    createBuffer(d: GPUBufferDescriptor) { return { ...d, destroy() {}, getMappedRange: () => new ArrayBuffer(d.size), unmap() {} }; },
    createTexture(d: GPUTextureDescriptor) {
      const texture = { ...d, view: { label: d.label }, destroy: vi.fn(), createView() { return this.view; } };
      textures.push(texture); return texture;
    },
    createSampler: () => ({}),
    createBindGroupLayout: (d: GPUBindGroupLayoutDescriptor) => d,
    createPipelineLayout: (d: GPUPipelineLayoutDescriptor) => d,
    createBindGroup(d: GPUBindGroupDescriptor) {
      const layout = d.layout as unknown as GPUBindGroupLayoutDescriptor;
      expect([...d.entries].map(e => e.binding).sort((a, b) => a - b)).toEqual([...layout.entries].map(e => e.binding).sort((a, b) => a - b));
      return d;
    },
    createComputePipelineAsync: async (d: GPUComputePipelineDescriptor) => d,
  } as unknown as GPUDevice;
  const rc = {
    device, quality: { ...qualityProfile('high'), giRays, rtSpecular: false },
    frame: { layout: {}, group: {} }, world: { layout: {}, group: {} },
    gbuf: { width: 13, height: 11, rtWidth: 13, rtHeight: 11, views: {} }, rt: new SceneRegistry(),
    module: (path: string, defines: Record<string, string | number | boolean>) => ({ code: resolveShader(path, defines) }),
  } as unknown as RenderContext;
  let pipeline: GPUComputePipelineDescriptor;
  const pass = {
    setPipeline(p: GPUComputePipelineDescriptor) { pipeline = p; },
    setBindGroup(i: number, g: GPUBindGroupDescriptor) { bindings.set(i, g); },
    dispatchWorkgroups(x: number, y = 1, z = 1) {
      const label = pipeline.label!;
      if (/^rt gi( hits| visibility| shade)?$/.test(label)) {
        const layouts = (pipeline.layout as unknown as GPUPipelineLayoutDescriptor).bindGroupLayouts;
        expect(bindings.get(2)?.layout).toBe([...layouts][2]);
        const code = (pipeline.compute.module as unknown as { code: string }).code;
        calls.push({ label, groups: [x, y, z], code });
      }
    },
    dispatchWorkgroupsIndirect() {}, end() {},
  };
  const enc = { beginComputePass: () => pass, clearBuffer() {} } as unknown as GPUCommandEncoder;
  const frame = { frameIndex: 0, camera: { pos: [0, 0, 0] } } as FrameInfo;
  return { rc, enc, frame, calls, textures };
}

beforeEach(() => {
  vi.stubGlobal('GPUShaderStage', { COMPUTE: 4 });
  vi.stubGlobal('GPUBufferUsage', { STORAGE: 128, UNIFORM: 64, COPY_DST: 8, INDIRECT: 256 });
  vi.stubGlobal('GPUTextureUsage', { TEXTURE_BINDING: 4, STORAGE_BINDING: 8, COPY_SRC: 1, COPY_DST: 2 });
});
afterEach(() => vi.unstubAllGlobals());

describe('GI pipeline compatibility and resources', () => {
  it.each([16, 17, 19].flatMap(limit => [0, 1, 2].map(rays => [limit, rays])))('supports %i sampled textures with %i GI rays', async (limit, rays) => {
    const f = fixture(limit, rays), mod = createRTModule();
    await mod.init(f.rc); mod.encodeRT!(f.enc, f.rc, f.frame);
    const split = limit >= 17 && rays === 2;
    expect(f.calls.map(c => c.label)).toEqual(split ? ['rt gi hits', ...(limit >= 19 ? ['rt gi visibility'] : []), 'rt gi shade'] : ['rt gi']);
    for (const call of f.calls) {
      const match = call.code.match(/@workgroup_size\((\d+),\s*(\d+)(?:,\s*(\d+))?\)/)!;
      expect(match).not.toBeNull();
      // Dispatch and compiled shader must agree, including partial edge tiles.
      expect(call.groups).toEqual([Math.ceil(13 / Number(match[1])), Math.ceil(11 / Number(match[2])), 1]);
      expect(call.code.match(/fn main\(/g)).toHaveLength(1);
    }
    const extra = f.textures.filter(t => /^rt gi (hit|visibility) [01]$/.test(t.label!));
    expect(extra).toHaveLength(split ? (limit >= 19 ? 4 : 2) : 0);
    for (const t of extra) {
      expect(t.size).toEqual([13, 11]);
      expect(t.format).toBe(t.label!.includes('visibility') ? 'r32float' : 'rg32float');
    }
    mod.destroy!();
    for (const t of extra) expect(t.destroy).toHaveBeenCalledExactlyOnceWith();
  });

  it('allocates split intermediates once on a quality change and replaces them on resize', async () => {
    const f = fixture(19, 1), mod = createRTModule();
    await mod.init(f.rc); mod.encodeRT!(f.enc, f.rc, f.frame);
    expect(f.textures.some(t => t.label === 'rt gi hit 0')).toBe(false);
    f.rc.quality.giRays = 2;
    mod.encodeRT!(f.enc, f.rc, f.frame); mod.encodeRT!(f.enc, f.rc, f.frame);
    const first = f.textures.filter(t => /^rt gi (hit|visibility) [01]$/.test(t.label!));
    expect(first).toHaveLength(4);
    f.rc.quality.giRays = 1;
    f.calls.length = 0; mod.encodeRT!(f.enc, f.rc, f.frame);
    expect(f.calls.map(c => c.label)).toEqual(['rt gi']);
    f.rc.gbuf = { ...f.rc.gbuf, width: 25, height: 19, rtWidth: 25, rtHeight: 19 };
    mod.resize!(f.rc);
    for (const t of first) expect(t.destroy).toHaveBeenCalledExactlyOnceWith();
    f.rc.quality.giRays = 2;
    mod.encodeRT!(f.enc, f.rc, f.frame);
    const second = f.textures.filter(t => /^rt gi (hit|visibility) [01]$/.test(t.label!)).slice(4);
    expect(second).toHaveLength(4);
    for (const t of second) expect(t.size).toEqual([25, 19]);
    mod.destroy!();
    for (const t of [...first, ...second]) expect(t.destroy).toHaveBeenCalledExactlyOnceWith();
  });
});
