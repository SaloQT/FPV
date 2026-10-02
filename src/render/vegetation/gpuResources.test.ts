import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTerrainSampler } from '../../world/terrain';
import type { RenderContext, SceneData } from '../contracts';
import { resolveQuality } from '../qualityPresets';
import { createVegetationModule } from './index';
import { testScene } from './testScene';
import { DEFAULT_SETTINGS } from '../../contracts';

/** A GPUDevice stand-in that only counts what is created. */
function countingContext(): { rc: RenderContext; made: Record<string, number> } {
  const made: Record<string, number> = {};
  const note = (kind: string): void => { made[kind] = (made[kind] ?? 0) + 1; };
  const object = (): Record<string, unknown> => ({ destroy: () => undefined, createView: () => ({}) });
  const device = new Proxy({ limits: { maxStorageBufferBindingSize: 1 << 30, maxBufferSize: 1 << 30 }, queue: { writeBuffer: () => undefined, writeTexture: () => undefined } }, {
    get(target, key: string) {
      if (key in target) return (target as Record<string, unknown>)[key];
      if (key.startsWith('create')) return () => { note(key); return object(); };
      return undefined;
    },
  }) as unknown as GPUDevice;
  const rc = {
    device,
    quality: resolveQuality({ quality: 'low', performance240: false }),
    settings: DEFAULT_SETTINGS,
    frame: { layout: {}, group: {} },
    world: { layout: {}, group: {} },
    rt: { setStatic: () => undefined },
    module: () => { note('module'); return {}; },
  } as unknown as RenderContext;
  return { rc, made };
}

describe('vegetation GPU objects across scenes', () => {
  beforeEach(() => {
    vi.stubGlobal('GPUShaderStage', { COMPUTE: 4, VERTEX: 1, FRAGMENT: 2 });
    vi.stubGlobal('GPUBufferUsage', { STORAGE: 128, UNIFORM: 64, COPY_DST: 8, COPY_SRC: 4, INDIRECT: 256, VERTEX: 32, INDEX: 16, MAP_READ: 1 });
    vi.stubGlobal('GPUTextureUsage', { TEXTURE_BINDING: 4, COPY_DST: 2 });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('builds pipelines, layouts and shader modules once in init and reuses them for every scene', async () => {
    const { rc, made } = countingContext();
    const mod = createVegetationModule();
    await mod.init(rc);
    const afterInit = { pipelines: (made.createRenderPipeline ?? 0) + (made.createComputePipeline ?? 0), layouts: made.createBindGroupLayout, modules: made.module };
    expect(afterInit.pipelines).toBeGreaterThan(8);
    const { terrain, track } = testScene();
    const scene: SceneData = { terrain, sampler: createTerrainSampler(terrain), track };
    mod.setScene!(rc, scene);
    const buffersAfterFirst = made.createBuffer;
    mod.setScene!(rc, { ...scene, track: null });
    mod.setScene!(rc, scene);
    expect((made.createRenderPipeline ?? 0) + (made.createComputePipeline ?? 0)).toBe(afterInit.pipelines);
    expect(made.createBindGroupLayout).toBe(afterInit.layouts);
    expect(made.module).toBe(afterInit.modules);
    expect(mod.stats().farCards).toBeGreaterThan(0);
    expect(made.createBuffer).toBeGreaterThan(buffersAfterFirst);
  }, 120000);
});
