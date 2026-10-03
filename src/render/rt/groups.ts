import type { RenderContext } from '../contracts';
import type { RtLayouts } from './layouts';
import { ATROUS_ITERATIONS, SIGNALS, type Signal } from './pipelines';
import type { ProbeGrid } from './probes';
import type { SceneBuffers } from './sceneBuffers';
import type { History, RtTextures } from './textures';

/** Two entries per resource pair: index p is the bind group used on frames of parity p (cur = p, prev = p ^ 1, probes read set p ^ 1). */
type Pair = [GPUBindGroup, GPUBindGroup];

export interface RtGroups {
  aux: Pair;
  probe: Pair;
  probePlan: Pair | null;
  probeCompact: Pair | null;
  latch: GPUBindGroup;
  trace: Partial<Record<Signal, Pair>>;
  temporal: Partial<Record<Signal, Pair>>;
  /** [parity][iteration] */
  atrous: Partial<Record<Signal, [GPUBindGroup[], GPUBindGroup[]]>>;
}

export interface GroupSources {
  rc: RenderContext;
  layouts: RtLayouts;
  tex: RtTextures;
  probes: ProbeGrid;
  buffers: SceneBuffers;
  params: GPUBuffer;
  prevPre: GPUBuffer;
  probeSampler: GPUSampler;
  /** Top-down cloud shadow map (r = sun, g = moon transmittance). */
  cloud: GPUTextureView;
}

const buf = (binding: number, buffer: GPUBuffer): GPUBindGroupEntry => ({ binding, resource: { buffer } });
const view = (binding: number, resource: GPUTextureView): GPUBindGroupEntry => ({ binding, resource });

function both<T>(make: (parity: number) => T): [T, T] {
  return [make(0), make(1)];
}

export function buildGroups(s: GroupSources): RtGroups {
  const { rc, layouts: L, tex, probes, buffers } = s;
  const d = rc.device;
  const g = rc.gbuf;
  const v = g.views;
  const signalView: Record<Signal, GPUTextureView> = { shadow: v.sunShadow, gi: v.giDiffuse, spec: v.giSpecular };
  const history: Record<Signal, History | null> = { shadow: tex.shadow, gi: tex.gi, spec: tex.spec };

  const aux = both((p) => d.createBindGroup({
    label: `rt aux ${p}`, layout: L.aux,
    entries: [buf(0, s.params), view(1, v.depth), view(2, v.normal), view(3, v.misc), view(4, tex.auxDepth[p].view), view(5, tex.auxNormal[p].view)],
  }));
  const probe = both((p) => {
    const read = probes.sets[p], write = probes.sets[p ^ 1];
    return d.createBindGroup({
      label: `rt probes ${p}`, layout: L.probe,
      entries: [
        buf(0, s.params), buf(1, buffers.nodes), buf(2, buffers.prims),
        view(3, read.r.view), view(4, read.g.view), view(5, read.b.view),
        view(6, write.r.view), view(7, write.g.view), view(8, write.b.view),
        buf(9, s.prevPre), { binding: 10, resource: s.probeSampler }, view(11, s.cloud),
      ],
    });
  });
  const latch = d.createBindGroup({ label: 'rt latch', layout: L.latch, entries: [buf(0, s.params), buf(1, s.prevPre)] });

  const probePlan = probes.work ? both((p) => {
    const read = probes.sets[p], write = probes.sets[p ^ 1];
    return d.createBindGroup({
      label: `rt probe plan ${p}`, layout: L.probePlan,
      entries: [buf(0, s.params), view(3, read.r.view), view(4, read.g.view), view(5, read.b.view),
        view(6, write.r.view), view(7, write.g.view), view(8, write.b.view), buf(9, s.prevPre), buf(12, probes.work!.ids), buf(13, probes.work!.args)],
    });
  }) : null;
  const probeCompact = probes.work ? both((p) => {
    const read = probes.sets[p], write = probes.sets[p ^ 1];
    return d.createBindGroup({
      label: `rt probes compact ${p}`, layout: L.probeCompact,
      entries: [buf(0, s.params), buf(1, buffers.nodes), buf(2, buffers.prims),
        view(3, read.r.view), view(4, read.g.view), view(5, read.b.view),
        view(6, write.r.view), view(7, write.g.view), view(8, write.b.view),
        buf(9, s.prevPre), { binding: 10, resource: s.probeSampler }, view(11, s.cloud), buf(12, probes.work!.ids)],
    });
  }) : null;

  const groups: RtGroups = { aux, probe, probePlan, probeCompact, latch, trace: {}, temporal: {}, atrous: {} };
  for (const sig of SIGNALS) {
    const h = history[sig];
    if (!h) continue;
    const out1 = tex.raw1.view;
    groups.trace[sig] = both((p) => {
      const lit = probes.sets[p ^ 1];
      return d.createBindGroup({
        label: `rt ${sig} trace ${p}`, layout: L.trace,
        entries: [
          buf(0, s.params), buf(1, buffers.nodes), buf(2, buffers.prims),
          view(3, lit.r.view), view(4, lit.g.view), view(5, lit.b.view),
          view(6, tex.auxDepth[p].view), view(7, tex.auxNormal[p].view),
          view(8, tex.raw0.view), view(9, out1), { binding: 10, resource: s.probeSampler }, view(11, s.cloud),
        ],
      });
    });
    groups.temporal[sig] = both((p) => d.createBindGroup({
      label: `rt ${sig} temporal ${p}`, layout: L.temporal,
      entries: [
        buf(0, s.params), view(1, tex.auxDepth[p].view), view(2, tex.auxNormal[p].view),
        view(3, tex.auxDepth[p ^ 1].view), view(4, tex.auxNormal[p ^ 1].view), view(5, v.motion),
        view(6, tex.raw0.view), view(7, out1), view(8, h.hist[p ^ 1].view), view(9, h.mom[p ^ 1].view),
        buf(10, s.prevPre), view(11, h.hist[p].view), view(12, h.mom[p].view),
      ],
    }));
    const finalLayout = sig === 'shadow' ? L.atrousR32 : L.atrousRgba;
    groups.atrous[sig] = both((p) => Array.from({ length: ATROUS_ITERATIONS }, (_, i) => {
      const src = i === 0 ? h.hist[p].view : i === 1 ? tex.tmpA.view : tex.tmpB.view;
      const dst = i === 0 ? tex.tmpA.view : i === 1 ? tex.tmpB.view : signalView[sig];
      return d.createBindGroup({
        label: `rt ${sig} atrous ${i} ${p}`, layout: i === ATROUS_ITERATIONS - 1 ? finalLayout : L.atrousRgba,
        entries: [buf(0, s.params), view(1, tex.auxDepth[p].view), view(2, tex.auxNormal[p].view), view(3, src), view(4, h.mom[p].view), view(5, dst)],
      });
    }));
  }
  return groups;
}
