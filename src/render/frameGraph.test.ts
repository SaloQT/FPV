import { describe, expect, it } from 'vitest';
import type { FrameInfo, GBuffer, PostProcessor, RenderContext, RenderModule } from './contracts';
import { FrameGraph } from './frameGraph';
import { MARK, type GpuTimer } from './gpuTimer';
import type { DeferredLighting } from './lighting';
import { ModuleHost } from './moduleHost';

function gbuffer(width = 640, height = 360): GBuffer {
  return { width, height, views: Object.fromEntries(['albedo', 'normal', 'misc', 'motion', 'depth', 'hdr'].map(k => [k, { label: k }])) } as unknown as GBuffer;
}

async function harness(merge = false, sky = true, forward = true, throws = false) {
  const calls: unknown[][] = [];
  const descriptors: GPURenderPassDescriptor[] = [];
  const passes: GPURenderPassEncoder[] = [];
  const rc = { frame: { group: { label: 'frame' } }, world: { group: { label: 'world' } }, gbuf: gbuffer() } as unknown as RenderContext;
  let active = false;
  const enc = {
    beginRenderPass(d: GPURenderPassDescriptor) {
      expect(active).toBe(false);
      active = true;
      const index = passes.length;
      descriptors.push(d);
      calls.push(['begin', d.label]);
      const pass = {
        setBindGroup: (...args: unknown[]) => calls.push(['bind', index, ...args]),
        setViewport: (...args: unknown[]) => calls.push(['viewport', ...args]),
        setScissorRect: (...args: unknown[]) => calls.push(['scissor', ...args]),
        setBlendConstant: (...args: unknown[]) => calls.push(['blend', ...args]),
        setStencilReference: (...args: unknown[]) => calls.push(['stencil', ...args]),
        end() { expect(active).toBe(true); active = false; calls.push(['end', d.label]); },
      } as unknown as GPURenderPassEncoder;
      passes.push(pass);
      return pass;
    },
  } as unknown as GPUCommandEncoder;
  const m: RenderModule = {
    name: 'test', sharedOverlayPass: merge, init() {},
    encodePre() { expect(active).toBe(false); calls.push(['pre']); },
    encodeGBuffer(p) { expect(active).toBe(true); calls.push(['gbuffer', passes.indexOf(p)]); },
    encodeRT() { expect(active).toBe(false); calls.push(['rt']); },
    ...(sky ? { encodeSky(p: GPURenderPassEncoder) {
      expect(active).toBe(true); calls.push(['sky', passes.indexOf(p)]);
      if (throws) throw new Error('sky failure');
    } } : {}),
    ...(forward ? { encodeForward(p: GPURenderPassEncoder) { expect(active).toBe(true); calls.push(['forward', passes.indexOf(p)]); } } : {}),
  };
  const reports: string[] = [];
  const host = new ModuleHost([m], s => reports.push(s));
  await host.init(rc);
  const graph = new FrameGraph();
  graph.bind(rc.gbuf);
  const encode = () => graph.encode(enc, rc, host,
    { encode() { expect(active).toBe(false); calls.push(['lighting']); } } as unknown as DeferredLighting,
    { encode() { expect(active).toBe(false); calls.push(['post']); } } as unknown as PostProcessor,
    { mark(_enc: GPUCommandEncoder, mark: number) { expect(active).toBe(false); calls.push(['mark', mark]); } } as unknown as GpuTimer,
    {} as FrameInfo, {} as GPUTextureView,
    { outWidth: 640, outHeight: 360, preExposure: 1, prevPreExposure: 1 });
  return { calls, descriptors, passes, rc, graph, encode, reports, host };
}

describe('FrameGraph overlay batching', () => {
  it('keeps separate sky/forward passes by default for custom modules', async () => {
    const h = await harness();
    h.encode();
    expect(h.descriptors.map(d => d.label)).toEqual(['gbuffer', 'sky', 'forward']);
    expect(h.calls.filter(c => ['sky', 'forward'].includes(c[0] as string))).toEqual([['sky', 1], ['forward', 2]]);
    expect(h.calls.filter(c => c[0] === 'viewport')).toEqual([]);
    expect(h.calls.filter(c => c[0] === 'bind')).toHaveLength(6);
  });

  it('merges audited overlays without changing stage order or timer boundaries', async () => {
    const h = await harness(true);
    h.encode();
    expect(h.descriptors.map(d => d.label)).toEqual(['gbuffer', 'sky + forward']);
    expect(h.calls.filter(c => ['pre', 'gbuffer', 'rt', 'lighting', 'sky', 'forward', 'post'].includes(c[0] as string)))
      .toEqual([['pre'], ['gbuffer', 0], ['rt'], ['lighting'], ['sky', 1], ['forward', 1], ['post']]);
    expect(h.calls.filter(c => c[0] === 'mark').map(c => c[1])).toEqual([
      MARK.FrameBegin, MARK.PreEnd, MARK.GBufferEnd, MARK.RtEnd, MARK.LightingEnd, MARK.OverlayEnd,
    ]);
    expect(h.descriptors[1].colorAttachments).toEqual([{ view: h.rc.gbuf.views.hdr, loadOp: 'load', storeOp: 'store' }]);
    expect(h.descriptors[1].depthStencilAttachment).toEqual({ view: h.rc.gbuf.views.depth, depthReadOnly: true });
    const sky = h.calls.findIndex(c => c[0] === 'sky');
    expect(h.calls.slice(sky + 1, sky + 8)).toEqual([
      ['viewport', 0, 0, 640, 360, 0, 1], ['scissor', 0, 0, 640, 360],
      ['blend', [0, 0, 0, 0]], ['stencil', 0],
      ['bind', 1, 0, h.rc.frame.group], ['bind', 1, 1, h.rc.world.group], ['forward', 1],
    ]);
  });

  it.each([[false, false, []], [true, false, ['sky']], [false, true, ['forward']]] as const)(
    'handles sky=%s forward=%s without empty overlay passes', async (sky, forward, labels) => {
      const h = await harness(true, sky, forward);
      h.encode();
      expect(h.descriptors.map(d => d.label)).toEqual(['gbuffer', ...labels]);
      expect(h.calls.filter(c => c[0] === 'viewport')).toEqual([]);
    });

  it('rebinds attachment views and reset dimensions after resize', async () => {
    const h = await harness(true);
    h.encode();
    const old = h.descriptors[1];
    const next = gbuffer(853, 479);
    h.rc.gbuf = next;
    h.graph.bind(next);
    h.encode();
    const resized = h.descriptors[3];
    expect(resized).not.toBe(old);
    expect([...resized.colorAttachments][0]?.view).toBe(next.views.hdr);
    expect(resized.depthStencilAttachment?.view).toBe(next.views.depth);
    expect(h.calls.filter(c => c[0] === 'viewport').at(-1)).toEqual(['viewport', 0, 0, 853, 479, 0, 1]);
    expect(h.calls.filter(c => c[0] === 'scissor').at(-1)).toEqual(['scissor', 0, 0, 853, 479]);
  });

  it('preserves failure isolation and closes a merged pass when the sky hook fails', async () => {
    const h = await harness(true, true, true, true);
    h.encode();
    expect(h.host.drawsSky).toBe(false);
    h.encode();
    expect(h.reports).toHaveLength(1);
    expect(h.descriptors.map(d => d.label)).toEqual(['gbuffer', 'sky + forward', 'gbuffer', 'forward']);
    expect(h.calls.filter(c => c[0] === 'forward')).toHaveLength(2);
    expect(h.calls.filter(c => c[0] === 'end')).toHaveLength(4);
  });

  it('reuses bound descriptors on subsequent frames', async () => {
    const h = await harness(true);
    h.encode(); h.encode();
    expect(h.descriptors[2]).toBe(h.descriptors[0]);
    expect(h.descriptors[3]).toBe(h.descriptors[1]);
  });
});
