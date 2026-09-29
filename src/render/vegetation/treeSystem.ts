import type { RenderContext } from '../contracts';
import type { PackedInstances } from './instanceData';
import { ARGS_BYTES, ARGS_WORDS, type TreeAssets } from './treeAssets';
import { DRAW_COUNT, FIRST_ROCK, LOD_COUNT, VARIANT_COUNT } from './variants';

const COUNT_BYTES = DRAW_COUNT * 4;
const SAMPLE_INTERVAL = 30;

export interface TreeCounters {
  /** Instances that survived culling in the last sampled frame, per LOD, for trees and bushes and for rocks. */
  plantLod: [number, number, number];
  rockLod: [number, number, number];
}

/**
 * GPU-driven trees, bushes and rocks for one instance set: encodePre culls every slot against the frustum and the pixel-size limit,
 * picks a LOD and appends into per-(variant, LOD) lists whose counts become indirect draw arguments (no readback);
 * encodeGBuffer issues one indexed indirect draw per non-empty (variant, LOD).
 */
export class TreeSystem {
  readonly slots: number;
  readonly instanceBytes: number;
  readonly bufferBytes: number;
  readonly counts: TreeCounters = { plantLod: [0, 0, 0], rockLod: [0, 0, 0] };
  /** True once a counter readback has completed. */
  sampled = false;
  private readonly instances: GPUBuffer;
  private readonly variantTable: GPUBuffer;
  private readonly counters: GPUBuffer;
  private readonly visible: GPUBuffer;
  private readonly args: GPUBuffer;
  private readonly staging: GPUBuffer | null;
  private readonly cullGroup: GPUBindGroup;
  private readonly finalizeGroup: GPUBindGroup;
  private readonly draws: { k: number; group: GPUBindGroup }[] = [];
  private copyQueued = false;
  private mapping = false;
  private sinceSample = 0;

  constructor(rc: RenderContext, private readonly assets: TreeAssets, params: GPUBuffer, packed: PackedInstances, readback: boolean) {
    const dev = rc.device;
    const S = GPUBufferUsage.STORAGE;
    this.slots = packed.slots;
    this.instanceBytes = packed.instances.byteLength;
    const visibleBytes = Math.max(packed.slots * LOD_COUNT * 4, 256);
    this.bufferBytes = this.instanceBytes + packed.variants.byteLength + visibleBytes + COUNT_BYTES + ARGS_BYTES;
    this.instances = dev.createBuffer({ label: 'tree-instances', size: this.instanceBytes, usage: S | GPUBufferUsage.COPY_DST });
    dev.queue.writeBuffer(this.instances, 0, packed.instances);
    this.variantTable = dev.createBuffer({ label: 'tree-variants', size: packed.variants.byteLength, usage: S | GPUBufferUsage.COPY_DST });
    dev.queue.writeBuffer(this.variantTable, 0, packed.variants);
    this.counters = dev.createBuffer({ label: 'tree-counts', size: COUNT_BYTES, usage: S | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST });
    this.visible = dev.createBuffer({ label: 'tree-visible', size: visibleBytes, usage: S });
    this.args = dev.createBuffer({ label: 'tree-args', size: ARGS_BYTES, usage: S | GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST });
    dev.queue.writeBuffer(this.args, 0, assets.argsTemplate);
    this.staging = readback ? dev.createBuffer({ label: 'tree-count-readback', size: COUNT_BYTES, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }) : null;

    const entry = (binding: number, buffer: GPUBuffer): GPUBindGroupEntry => ({ binding, resource: { buffer } });
    this.cullGroup = dev.createBindGroup({
      label: 'tree-cull',
      layout: assets.cullLayout,
      entries: [entry(0, params), entry(1, this.instances), entry(2, this.variantTable), entry(3, this.counters), entry(4, this.visible)],
    });
    this.finalizeGroup = dev.createBindGroup({
      label: 'tree-finalize',
      layout: assets.finalizeLayout,
      entries: [entry(0, params), entry(1, this.counters), entry(2, this.args)],
    });
    for (let v = 0; v < VARIANT_COUNT; v++) {
      if (packed.count[v] === 0) continue;
      for (let lod = 0; lod < LOD_COUNT; lod++) {
        const k = v * LOD_COUNT + lod;
        this.draws.push({
          k,
          group: dev.createBindGroup({
            label: `tree-draw-${k}`,
            layout: assets.drawLayout,
            entries: [
              entry(0, params), entry(1, this.instances),
              { binding: 2, resource: { buffer: this.visible, offset: 4 * (lod * packed.slots + packed.first[v]) } },
              entry(3, this.variantTable),
              { binding: 4, resource: assets.atlasView },
            ],
          }),
        });
      }
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
      this.counts.plantLod.fill(0);
      this.counts.rockLod.fill(0);
      for (let k = 0; k < DRAW_COUNT; k++) {
        const into = Math.floor(k / LOD_COUNT) >= FIRST_ROCK ? this.counts.rockLod : this.counts.plantLod;
        into[k % LOD_COUNT] += c[k];
      }
      this.sampled = true;
      this.mapping = false;
    }, () => { this.mapping = false; });
  }

  encodePre(enc: GPUCommandEncoder, rc: RenderContext): void {
    if (this.slots === 0) return;
    enc.clearBuffer(this.counters);
    const pass = enc.beginComputePass({ label: 'tree-cull' });
    pass.setBindGroup(0, rc.frame.group);
    pass.setBindGroup(1, rc.world.group);
    pass.setPipeline(this.assets.cullPipe);
    pass.setBindGroup(2, this.cullGroup);
    pass.dispatchWorkgroups(Math.ceil(this.slots / 64));
    pass.setPipeline(this.assets.finalizePipe);
    pass.setBindGroup(2, this.finalizeGroup);
    pass.dispatchWorkgroups(1);
    pass.end();
    if (this.staging && !this.copyQueued && !this.mapping && ++this.sinceSample >= SAMPLE_INTERVAL) {
      this.sinceSample = 0;
      enc.copyBufferToBuffer(this.counters, 0, this.staging, 0, COUNT_BYTES);
      this.copyQueued = true;
    }
  }

  encodeGBuffer(pass: GPURenderPassEncoder): void {
    if (this.slots === 0) return;
    pass.setVertexBuffer(0, this.assets.vertexBuffer);
    pass.setIndexBuffer(this.assets.indexBuffer, 'uint32');
    let rock: boolean | null = null;
    for (const d of this.draws) {
      const isRock = this.assets.isRockDraw(d.k);
      if (isRock !== rock) {
        pass.setPipeline(isRock ? this.assets.rockPipe : this.assets.treePipe);
        rock = isRock;
      }
      pass.setBindGroup(2, d.group);
      pass.drawIndexedIndirect(this.args, d.k * ARGS_WORDS * 4);
    }
  }

  destroy(): void {
    for (const buf of [this.instances, this.variantTable, this.counters, this.visible, this.args, this.staging]) buf?.destroy();
  }
}
