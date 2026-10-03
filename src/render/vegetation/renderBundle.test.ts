import { describe, expect, it, vi } from 'vitest';
import { DEPTH_STATE, GBUFFER_TARGETS, type RenderContext } from '../contracts';
import { VegetationRenderBundle } from './renderBundle';

function fixture() {
  const commands: unknown[][] = [];
  const bundle = {};
  const encoder = { setBindGroup: vi.fn(), finish: vi.fn(() => bundle) };
  const device = { createRenderBundleEncoder: vi.fn(() => encoder) };
  const rc = { device, frame: { group: {}, layout: {} }, world: { group: {}, layout: {} } } as unknown as RenderContext;
  const pass = {
    executeBundles: vi.fn((bundles: unknown) => commands.push(['execute', bundles])),
    setBindGroup: vi.fn((index: number, group: unknown) => commands.push(['bind', index, group])),
  } as unknown as GPURenderPassEncoder;
  const cache = new VegetationRenderBundle();
  const draw = vi.fn();
  return { rc, pass, cache, draw, device, encoder, bundle, commands };
}

describe('vegetation G-buffer render bundle', () => {
  it('records once, executes each frame and restores shared bindings after execution', () => {
    const f = fixture();
    f.cache.encode(f.pass, f.rc, f.draw);
    f.cache.encode(f.pass, f.rc, f.draw);
    expect(f.draw).toHaveBeenCalledTimes(1);
    expect(f.draw).toHaveBeenCalledWith(f.encoder);
    expect(f.device.createRenderBundleEncoder).toHaveBeenCalledWith({
      label: 'vegetation-gbuffer', colorFormats: GBUFFER_TARGETS.map(t => t.format),
      depthStencilFormat: DEPTH_STATE.format, sampleCount: 1,
    });
    expect(f.encoder.setBindGroup.mock.calls).toEqual([[0, f.rc.frame.group], [1, f.rc.world.group]]);
    expect(f.commands).toEqual(Array.from({ length: 2 }, () => [
      ['execute', [f.bundle]], ['bind', 0, f.rc.frame.group], ['bind', 1, f.rc.world.group],
    ]).flat());
  });

  it.each(['frame.group', 'world.group', 'frame.layout', 'world.layout', 'device'])('rebuilds when %s identity changes', key => {
    const f = fixture();
    f.cache.encode(f.pass, f.rc, f.draw);
    if (key === 'device') f.rc.device = { createRenderBundleEncoder: vi.fn(() => f.encoder) } as unknown as GPUDevice;
    else {
      const [owner, prop] = key.split('.') as ['frame' | 'world', 'group' | 'layout'];
      (f.rc[owner] as unknown as Record<string, unknown>)[prop] = {};
    }
    f.cache.encode(f.pass, f.rc, f.draw);
    expect(f.draw).toHaveBeenCalledTimes(2);
  });

  it('drops resource references and records new commands after explicit owner invalidation', () => {
    const f = fixture();
    f.cache.encode(f.pass, f.rc, f.draw);
    f.cache.invalidate();
    f.cache.encode(f.pass, f.rc, f.draw);
    expect(f.draw).toHaveBeenCalledTimes(2);
  });
});
