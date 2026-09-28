import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FORMATS } from './contracts';
import { createGBuffer, destroyGBuffer, renderSize, rtSize } from './gbuffer';

// Node has no WebGPU globals; these are the values from the WebGPU spec.
const USAGE = { COPY_SRC: 1, COPY_DST: 2, TEXTURE_BINDING: 4, STORAGE_BINDING: 8, RENDER_ATTACHMENT: 16 };

interface FakeTexture { label: string; format: string; size: number[]; usage: number; destroyed: boolean; views: (GPUTextureViewDescriptor | undefined)[] }

function fakeDevice() {
  const textures: FakeTexture[] = [];
  const passes: { view: unknown; clearValue: unknown; loadOp: string }[] = [];
  let submits = 0;
  const device = {
    createTexture(d: { label: string; format: string; size: number[]; usage: number }) {
      const t: FakeTexture = { label: d.label, format: d.format, size: d.size, usage: d.usage, destroyed: false, views: [] };
      textures.push(t);
      return { ...t, createView: (v?: GPUTextureViewDescriptor) => { t.views.push(v); return { of: t.label }; }, destroy: () => { t.destroyed = true; } };
    },
    createCommandEncoder: () => ({
      beginRenderPass: (d: { colorAttachments: { view: unknown; clearValue: unknown; loadOp: string }[] }) => { passes.push(d.colorAttachments[0]); return { end() {} }; },
      finish: () => ({}),
    }),
    queue: { submit: () => { submits++; } },
  };
  return { device: device as unknown as GPUDevice, textures, passes, submits: () => submits };
}

describe('gbuffer sizes', () => {
  it('render size is round(out * renderScale * dynamicScale), even and >= 64', () => {
    expect(renderSize(1920, 1080, 1, 1)).toEqual({ width: 1920, height: 1080 });
    expect(renderSize(1920, 1080, 0.75, 0.9)).toEqual({ width: 1296, height: 730 });
    expect(renderSize(100, 60, 0.25, 0.42)).toEqual({ width: 64, height: 64 });
    for (const [w, h, rs, ds] of [[1281, 721, 0.9, 0.7], [2559, 1439, 1, 0.42], [641, 361, 0.5, 0.6]]) {
      const s = renderSize(w, h, rs, ds);
      expect(s.width % 2).toBe(0);
      expect(s.height % 2).toBe(0);
    }
  });

  it('RT size is ceil(size / divisor)', () => {
    expect(rtSize(1296, 730, 2)).toEqual({ width: 648, height: 365 });
    expect(rtSize(641, 361, 4)).toEqual({ width: 161, height: 91 });
    expect(rtSize(640, 360, 1)).toEqual({ width: 640, height: 360 });
  });
});

describe('createGBuffer', () => {
  beforeEach(() => { vi.stubGlobal('GPUTextureUsage', USAGE); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('allocates every target with the contract formats at render or RT size', () => {
    const f = fakeDevice();
    const g = createGBuffer(f.device, 1296, 730, 2);
    const by = Object.fromEntries(f.textures.map((t) => [t.label, t]));
    expect(f.textures).toHaveLength(9);
    for (const [label, format] of [['gDepth', FORMATS.depth], ['gAlbedo', FORMATS.gAlbedo], ['gNormal', FORMATS.gNormal], ['gMisc', FORMATS.gMisc],
      ['gMotion', FORMATS.gMotion], ['hdr', FORMATS.hdr], ['giDiffuse', FORMATS.giDiffuse], ['giSpecular', FORMATS.giSpecular], ['sunShadow', FORMATS.sunShadow]]) {
      expect(by[label].format).toBe(format);
    }
    for (const l of ['gDepth', 'gAlbedo', 'gNormal', 'gMisc', 'gMotion', 'hdr']) expect(by[l].size).toEqual([1296, 730]);
    for (const l of ['giDiffuse', 'giSpecular', 'sunShadow']) expect(by[l].size).toEqual([648, 365]);
    expect([g.width, g.height, g.rtWidth, g.rtHeight]).toEqual([1296, 730, 648, 365]);
  });

  it('gives each target the usages its passes need', () => {
    const f = fakeDevice();
    createGBuffer(f.device, 640, 360, 1);
    const usage = (label: string) => f.textures.find((t) => t.label === label)!.usage;
    const has = (label: string, bits: number) => (usage(label) & bits) === bits;
    for (const l of ['gDepth', 'gAlbedo', 'gNormal', 'gMisc', 'gMotion']) expect(has(l, USAGE.RENDER_ATTACHMENT | USAGE.TEXTURE_BINDING)).toBe(true);
    expect(has('hdr', USAGE.STORAGE_BINDING | USAGE.RENDER_ATTACHMENT | USAGE.TEXTURE_BINDING)).toBe(true);
    for (const l of ['giDiffuse', 'giSpecular', 'sunShadow']) expect(has(l, USAGE.STORAGE_BINDING | USAGE.TEXTURE_BINDING)).toBe(true);
    expect(has('sunShadow', USAGE.RENDER_ATTACHMENT)).toBe(true);
    expect(has('gAlbedo', USAGE.STORAGE_BINDING)).toBe(false);
  });

  it('views the depth texture depth-only and clears the sun shadow to fully lit', () => {
    const f = fakeDevice();
    const g = createGBuffer(f.device, 640, 360, 2);
    expect(f.textures.find((t) => t.label === 'gDepth')!.views).toEqual([{ aspect: 'depth-only' }]);
    expect(f.passes).toHaveLength(1);
    expect(f.passes[0].view).toBe(g.views.sunShadow);
    expect(f.passes[0]).toMatchObject({ clearValue: [1, 1, 1, 1], loadOp: 'clear' });
    expect(f.submits()).toBe(1);
  });

  it('destroyGBuffer releases all nine textures', () => {
    const f = fakeDevice();
    destroyGBuffer(createGBuffer(f.device, 640, 360, 1));
    expect(f.textures.every((t) => t.destroyed)).toBe(true);
  });
});
