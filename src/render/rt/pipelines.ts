import type { RenderContext } from '../contracts';
import type { RtLayouts } from './layouts';

export type Signal = 'shadow' | 'gi' | 'spec';
export const SIGNALS: readonly Signal[] = ['shadow', 'gi', 'spec'];
export const ATROUS_ITERATIONS = 3;

/** History length caps (frames): the shadow signal is binary and noisy, so it averages longest; specular reacts fastest. */
const HISTORY_CAP: Record<Signal, string> = { shadow: '16.0', gi: '12.0', spec: '8.0' };
const SIGNAL_DEFINE: Record<Signal, string> = { shadow: 'SHADOW', gi: 'GI', spec: 'SPEC' };

export interface RtPipelines {
  aux: GPUComputePipeline;
  latch: GPUComputePipeline;
  probe: GPUComputePipeline;
  probePlan: GPUComputePipeline;
  probeCompact: GPUComputePipeline;
  trace: Record<Signal, GPUComputePipeline>;
  temporal: Record<Signal, GPUComputePipeline>;
  atrous: Record<Signal, GPUComputePipeline[]>;
}

type Defines = Record<string, string | number | boolean>;

/** Every pipeline is created asynchronously so shader or layout errors reject init() (which disables the module and reports them). */
export async function createPipelines(rc: RenderContext, L: RtLayouts): Promise<RtPipelines> {
  const d = rc.device;
  const worldLayout = (group: GPUBindGroupLayout) => d.createPipelineLayout({ bindGroupLayouts: [rc.frame.layout, rc.world.layout, group] });
  const localLayout = (group: GPUBindGroupLayout) => d.createPipelineLayout({ bindGroupLayouts: [rc.frame.layout, group] });
  const make = (label: string, path: string, defines: Defines, layout: GPUPipelineLayout) =>
    d.createComputePipelineAsync({ label: `rt ${label}`, layout, compute: { module: rc.module(`rt/${path}.wgsl`, defines), entryPoint: 'main' } });

  const traceLayout = worldLayout(L.trace);
  const trace = SIGNALS.map((s) => make(s, s, { GRP: 2 }, traceLayout));
  const temporal = SIGNALS.map((s) =>
    make(`${s} temporal`, 'temporal', { GRP: 1, [SIGNAL_DEFINE[s]]: true, CAP: HISTORY_CAP[s] }, localLayout(L.temporal)));
  const atrous = SIGNALS.map((s) => Array.from({ length: ATROUS_ITERATIONS }, (_, i) => {
    const last = i === ATROUS_ITERATIONS - 1;
    const toR32 = s === 'shadow' && last;
    const defines: Defines = { GRP: 1, [SIGNAL_DEFINE[s]]: true, ITER: `${i}.0`, OUTFMT: toR32 ? 'r32float' : 'rgba16float', FINAL: last };
    // Only the first iteration computes the neighbourhood moment sum; the rest read it back (see shaders/rt/atrous.wgsl).
    if (i === 0) defines.VARSTORE = true;
    return make(`${s} atrous ${i}`, 'atrous', defines, localLayout(toR32 ? L.atrousR32 : L.atrousRgba));
  }));
  const [aux, latch, probe, probePlan, probeCompact, ...rest] = await Promise.all([
    make('aux', 'aux', { GRP: 1 }, localLayout(L.aux)),
    make('latch', 'latch', { GRP: 1 }, localLayout(L.latch)),
    make('probe update', 'probe_update', { GRP: 2 }, worldLayout(L.probe)),
    make('probe plan', 'probe_plan', { GRP: 1 }, localLayout(L.probePlan)),
    make('probe compact update', 'probe_update', { GRP: 2, COMPACT: true }, worldLayout(L.probeCompact)),
    ...trace, ...temporal, ...atrous.flat(),
  ]);
  const at = (i: number) => rest.slice(i, i + ATROUS_ITERATIONS);
  return {
    aux, latch, probe, probePlan, probeCompact,
    trace: { shadow: rest[0], gi: rest[1], spec: rest[2] },
    temporal: { shadow: rest[3], gi: rest[4], spec: rest[5] },
    atrous: { shadow: at(6), gi: at(9), spec: at(12) },
  };
}

export function createTestPipeline(rc: RenderContext, L: RtLayouts): Promise<GPUComputePipeline> {
  const layout = rc.device.createPipelineLayout({ bindGroupLayouts: [rc.frame.layout, rc.world.layout, L.test] });
  return rc.device.createComputePipelineAsync({ label: 'rt selftest', layout, compute: { module: rc.module('rt/test.wgsl', { GRP: 2 }), entryPoint: 'main' } });
}
