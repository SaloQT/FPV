import type { RenderContext } from '../contracts';
import { DEPTH_STATE, GBUFFER_TARGETS } from '../contracts';
import { BLADE_BYTES, CHUNK_BYTES, grassBudget, type GrassBudget } from './params';

const COUNTER_BYTES = 32;
const LODS = [
  { nseg: 7, tip: true },
  { nseg: 3, tip: true },
  { nseg: 1, tip: false },
] as const;

export interface GrassCounters {
  /** Blades appended per LOD in the last sampled frame (before the capacity clamp) and patches that survived culling. */
  lod: [number, number, number];
  patches: number;
  chunks: number;
}

/** Bind-group layouts, shader modules and pipelines of the grass passes: independent of the scene and the quality budget, built once and shared by every GrassSystem. */
export class GrassPipelines {
  readonly genLayout: GPUBindGroupLayout;
  readonly finLayout: GPUBindGroupLayout;
  readonly drawLayout: GPUBindGroupLayout;
  readonly patchesPipe: GPUComputePipeline;
  readonly bladesPipe: GPUComputePipeline;
  readonly finDispatchPipe: GPUComputePipeline;
  readonly finDrawPipe: GPUComputePipeline;
  readonly drawPipes: GPURenderPipeline[] = [];

  constructor(rc: RenderContext) {
    const dev = rc.device;
    const C = GPUShaderStage.COMPUTE;
    const storage = (binding: number, type: GPUBufferBindingType = 'storage'): GPUBindGroupLayoutEntry => ({ binding, visibility: C, buffer: { type } });
    const uniform: GPUBindGroupLayoutEntry = { binding: 0, visibility: C, buffer: { type: 'uniform' } };
    this.genLayout = dev.createBindGroupLayout({ label: 'grass-gen', entries: [uniform, storage(1), storage(2), storage(3)] });
    this.finLayout = dev.createBindGroupLayout({ label: 'grass-fin', entries: [uniform, storage(1), storage(2), storage(3)] });
    const VF = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT;
    this.drawLayout = dev.createBindGroupLayout({
      label: 'grass-draw',
      entries: [{ binding: 0, visibility: VF, buffer: { type: 'uniform' } }, { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } }],
    });
    const layouts = (l: GPUBindGroupLayout): GPUPipelineLayout => dev.createPipelineLayout({ bindGroupLayouts: [rc.frame.layout, rc.world.layout, l] });
    const genPipeLayout = layouts(this.genLayout), finPipeLayout = layouts(this.finLayout), drawPipeLayout = layouts(this.drawLayout);
    const cull = rc.module('vegetation/grass_cull.wgsl');
    const fin = rc.module('vegetation/grass_finalize.wgsl');
    const compute = (label: string, layout: GPUPipelineLayout, module: GPUShaderModule, entryPoint: string): GPUComputePipeline =>
      dev.createComputePipeline({ label, layout, compute: { module, entryPoint } });
    this.patchesPipe = compute('grass-patches', genPipeLayout, cull, 'patches');
    this.bladesPipe = compute('grass-blades', genPipeLayout, cull, 'blades_main');
    this.finDispatchPipe = compute('grass-fin-dispatch', finPipeLayout, fin, 'fin_dispatch');
    this.finDrawPipe = compute('grass-fin-draw', finPipeLayout, fin, 'fin_draw');
    for (let i = 0; i < 3; i++) {
      const module = rc.module('vegetation/grass.wgsl', { NSEG: LODS[i].nseg, HAS_TIP: LODS[i].tip });
      this.drawPipes.push(dev.createRenderPipeline({
        label: `grass-lod${i}`,
        layout: drawPipeLayout,
        vertex: { module, entryPoint: 'vs' },
        fragment: { module, entryPoint: 'fs', targets: GBUFFER_TARGETS },
        primitive: { topology: 'triangle-strip', cullMode: 'none' },
        depthStencil: DEPTH_STATE,
      }));
    }
  }
}

/**
 * GPU-driven grass: encodePre culls patches, generates and thins blades and writes indirect arguments (compute only, no readback);
 * encodeGBuffer issues three indirect draws, one per blade LOD.
 */
export class GrassSystem {
  readonly budget: GrassBudget;
  private readonly device: GPUDevice;
  private readonly counters: GPUBuffer;
  private readonly chunks: GPUBuffer;
  private readonly blades: GPUBuffer;
  private readonly dispatchArgs: GPUBuffer;
  private readonly drawArgs: GPUBuffer;
  private readonly genGroup: GPUBindGroup;
  private readonly finGroup: GPUBindGroup;
  private readonly drawGroups: GPUBindGroup[] = [];
  private readonly staging: GPUBuffer | null;
  private copyQueued = false;
  private mapping = false;
  private sinceSample = 0;
  readonly counts: GrassCounters = { lod: [0, 0, 0], patches: 0, chunks: 0 };
  /** True once a counter readback has completed. */
  sampled = false;

  constructor(rc: RenderContext, private readonly pipes: GrassPipelines, params: GPUBuffer, readback: boolean) {
    const dev = rc.device;
    this.device = dev;
    const maxBytes = Math.min(dev.limits.maxStorageBufferBindingSize, dev.limits.maxBufferSize);
    this.budget = grassBudget(rc.quality, maxBytes);
    const b = this.budget;
    const S = GPUBufferUsage.STORAGE;
    this.counters = dev.createBuffer({ label: 'grass-counters', size: COUNTER_BYTES, usage: S | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST });
    this.chunks = dev.createBuffer({ label: 'grass-chunks', size: b.chunkCap * CHUNK_BYTES, usage: S });
    this.blades = dev.createBuffer({ label: 'grass-blades', size: b.bladeBytes, usage: S });
    this.dispatchArgs = dev.createBuffer({ label: 'grass-dispatch-args', size: 16, usage: S | GPUBufferUsage.INDIRECT });
    this.drawArgs = dev.createBuffer({ label: 'grass-draw-args', size: 48, usage: S | GPUBufferUsage.INDIRECT });
    this.staging = readback ? dev.createBuffer({ label: 'grass-counter-readback', size: COUNTER_BYTES, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }) : null;

    this.genGroup = dev.createBindGroup({
      label: 'grass-gen',
      layout: pipes.genLayout,
      entries: [{ binding: 0, resource: { buffer: params } }, { binding: 1, resource: { buffer: this.counters } }, { binding: 2, resource: { buffer: this.chunks } }, { binding: 3, resource: { buffer: this.blades } }],
    });
    this.finGroup = dev.createBindGroup({
      label: 'grass-fin',
      layout: pipes.finLayout,
      entries: [{ binding: 0, resource: { buffer: params } }, { binding: 1, resource: { buffer: this.counters } }, { binding: 2, resource: { buffer: this.dispatchArgs } }, { binding: 3, resource: { buffer: this.drawArgs } }],
    });
    for (let i = 0; i < 3; i++) {
      this.drawGroups.push(dev.createBindGroup({
        label: `grass-draw-lod${i}`,
        layout: pipes.drawLayout,
        entries: [{ binding: 0, resource: { buffer: params } }, { binding: 1, resource: { buffer: this.blades, offset: b.offsets[i], size: b.caps[i] * BLADE_BYTES } }],
      }));
    }
  }

  /** Call from update(): finishes the counter readback started by an earlier frame's encodePre, once that frame was submitted. */
  pollReadback(): void {
    const staging = this.staging;
    if (!staging || !this.copyQueued || this.mapping) return;
    this.copyQueued = false;
    this.mapping = true;
    staging.mapAsync(GPUMapMode.READ).then(() => {
      const c = new Uint32Array(staging.getMappedRange().slice(0));
      staging.unmap();
      this.counts.chunks = c[0];
      this.counts.lod[0] = c[1]; this.counts.lod[1] = c[2]; this.counts.lod[2] = c[3];
      this.counts.patches = c[4];
      this.sampled = true;
      this.mapping = false;
    }, () => { this.mapping = false; });
  }

  encodePre(enc: GPUCommandEncoder, rc: RenderContext): void {
    const b = this.budget;
    enc.clearBuffer(this.counters);
    const pass = enc.beginComputePass({ label: 'grass-cull' });
    pass.setBindGroup(0, rc.frame.group);
    pass.setBindGroup(1, rc.world.group);
    pass.setPipeline(this.pipes.patchesPipe);
    pass.setBindGroup(2, this.genGroup);
    pass.dispatchWorkgroups(Math.ceil((b.cellsPerSide * b.cellsPerSide) / 64));
    pass.setPipeline(this.pipes.finDispatchPipe);
    pass.setBindGroup(2, this.finGroup);
    pass.dispatchWorkgroups(1);
    pass.setPipeline(this.pipes.bladesPipe);
    pass.setBindGroup(2, this.genGroup);
    pass.dispatchWorkgroupsIndirect(this.dispatchArgs, 0);
    pass.setPipeline(this.pipes.finDrawPipe);
    pass.setBindGroup(2, this.finGroup);
    pass.dispatchWorkgroups(1);
    pass.end();
    if (this.staging && !this.copyQueued && !this.mapping && ++this.sinceSample >= 30) {
      this.sinceSample = 0;
      enc.copyBufferToBuffer(this.counters, 0, this.staging, 0, COUNTER_BYTES);
      this.copyQueued = true;
    }
  }

  encodeGBuffer(pass: GPURenderPassEncoder | GPURenderBundleEncoder): void {
    for (let i = 0; i < 3; i++) {
      pass.setPipeline(this.pipes.drawPipes[i]);
      pass.setBindGroup(2, this.drawGroups[i]);
      pass.drawIndirect(this.drawArgs, i * 16);
    }
  }

  destroy(): void {
    for (const buf of [this.counters, this.chunks, this.blades, this.dispatchArgs, this.drawArgs, this.staging]) buf?.destroy();
  }
}

