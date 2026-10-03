import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FrameInfo, RenderContext } from '../contracts';
import { qualityProfile } from '../contracts';
import { SceneRegistry } from '../rtRegistry';
import { resolveShader } from '../shaderLib';
import { createRTModule } from './index';

interface Dispatch { label: string; size: number[] }

function context(width: number, height: number, specular: boolean): RenderContext {
  const resource = (desc: { label?: string; size?: number } = {}) => ({ ...desc, destroy() {}, createView: () => ({}) });
  const device = {
    queue: { writeBuffer() {}, writeTexture() {} },
    createBuffer: resource,
    createTexture: resource,
    createSampler: resource,
    createBindGroupLayout: resource,
    createPipelineLayout: resource,
    createBindGroup: resource,
    createComputePipelineAsync: async (desc: { label: string }) => ({ label: desc.label }),
  } as unknown as GPUDevice;
  return {
    device,
    quality: { ...qualityProfile('high'), rtSpecular: specular },
    frame: { layout: {}, group: {} },
    world: { layout: {}, group: {} },
    gbuf: { width, height, rtWidth: width, rtHeight: height, views: {} },
    rt: new SceneRegistry(),
    module: () => ({}),
  } as unknown as RenderContext;
}

describe('RT dispatch dimensions', () => {
  beforeEach(() => {
    vi.stubGlobal('GPUShaderStage', { COMPUTE: 4 });
    vi.stubGlobal('GPUBufferUsage', { STORAGE: 128, UNIFORM: 64, COPY_DST: 8 });
    vi.stubGlobal('GPUTextureUsage', { TEXTURE_BINDING: 4, STORAGE_BINDING: 8, COPY_SRC: 1, COPY_DST: 2 });
  });
  afterEach(() => vi.unstubAllGlobals());

  it.each([[1, 1, false], [960, 540, false], [1920, 1080, true]] as const)(
    'latches once after every signal at %ix%i (specular=%s)', async (width, height, specular) => {
      const rc = context(width, height, specular);
      const mod = createRTModule();
      await mod.init(rc);
      const calls: Dispatch[] = [];
      let label = '';
      const pass = {
        setPipeline(p: { label: string }) { label = p.label; },
        setBindGroup() {},
        dispatchWorkgroups(x: number, y = 1, z = 1) { calls.push({ label, size: [x, y, z] }); },
        end() {},
      };
      const enc = { beginComputePass: () => pass } as unknown as GPUCommandEncoder;
      const f = { frameIndex: 0, camera: { pos: [0, 0, 0] } } as FrameInfo;
      mod.encodeRT!(enc, rc, f);
      expect(calls.filter((c) => c.label === 'rt latch')).toEqual([{ label: 'rt latch', size: [1, 1, 1] }]);
      expect(calls.at(-1)?.label).toBe('rt latch');
      expect(calls.at(-2)?.label).toBe(specular ? 'rt spec atrous 2' : 'rt gi atrous 2');
      expect(calls[0]).toEqual({ label: 'rt aux', size: [Math.ceil(width / 8), Math.ceil(height / 8), 1] });
      expect(calls.filter((c) => /^(rt (shadow|gi|spec)( temporal| atrous [0-2])?)$/.test(c.label))).toHaveLength(specular ? 15 : 10);
      // A capture re-encode still latches exactly once at the same point.
      calls.length = 0;
      mod.encodeRT!(enc, rc, f);
      expect(calls.filter((c) => c.label === 'rt latch')).toEqual([{ label: 'rt latch', size: [1, 1, 1] }]);
      expect(calls.at(-1)?.label).toBe('rt latch');
      mod.destroy!();
    },
  );

  it('retains the one-invocation shader and exact pre-exposure scalar assignment', () => {
    const shader = resolveShader('rt/latch.wgsl', { GRP: 1 });
    expect(shader).toMatch(/@compute\s+@workgroup_size\(1\)\s+fn main\(\)\s*\{\s*prevPre\[0\] = frame\.params\.y;\s*\}/);
  });
});
