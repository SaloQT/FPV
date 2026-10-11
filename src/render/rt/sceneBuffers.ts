import type { RTPrimitive, RTSceneRegistry } from '../contracts';
import { BvhBuilder, NODE_BYTES, NODE_WORDS, NO_ROOT, type BvhTarget } from './bvh';
import { PRIM_BYTES, PRIM_WORDS } from './prims';

/** Initial dynamic capacity; it grows to fit every moving ride and guest. The static tree follows it. */
export const DYNAMIC_MAX_PRIMS = 64;
const MIN_STATIC_PRIMS = 64;

export interface SceneStats {
  staticPrims: number;
  dynamicPrims: number;
  nodes: number;
  bufferBytes: number;
  staticRebuilds: number;
}

export interface PrimSlot { dynamic: boolean; index: number }

/** Static trees rebuild on scene changes; large dynamic trees refit between periodic topology rebuilds. */
export class SceneBuffers {
  nodes!: GPUBuffer;
  prims!: GPUBuffer;
  staticRoot = NO_ROOT;
  dynamicRoot = NO_ROOT;
  /** Bumps when the GPU buffers were replaced, so cached bind groups must be rebuilt. */
  generation = 0;
  staticRebuilds = 0;
  private target!: BvhTarget;
  private staticCap = 0;
  private readonly staticBuilder = new BvhBuilder();
  private readonly dynamicBuilder = new BvhBuilder();
  private staticCount = 0;
  private dynamicCount = 0;
  private staticNodeCount = 0;
  private dynamicNodeCount = 0;
  private staticKey = -1;
  private version = -1;
  private dynamicCap = DYNAMIC_MAX_PRIMS;
  private dynamicAge = 0;

  constructor(private readonly device: GPUDevice) {
    this.allocate(MIN_STATIC_PRIMS);
  }

  private allocate(staticCap: number): void {
    this.staticCap = staticCap;
    const nodeWords = (2 * this.dynamicCap + 2 * staticCap) * NODE_WORDS;
    const primWords = (this.dynamicCap + staticCap) * PRIM_WORDS;
    const nodeData = new ArrayBuffer(nodeWords * 4);
    const primData = new ArrayBuffer(primWords * 4);
    this.target = { nodesF: new Float32Array(nodeData), nodesU: new Uint32Array(nodeData), primsF: new Float32Array(primData), primsU: new Uint32Array(primData) };
    this.nodes?.destroy();
    this.prims?.destroy();
    const usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST;
    this.nodes = this.device.createBuffer({ label: 'rt bvh nodes', size: nodeData.byteLength, usage });
    this.prims = this.device.createBuffer({ label: 'rt bvh prims', size: primData.byteLength, usage });
    this.staticKey = -1;
    this.version = -1;
    this.generation++;
    this.dynamicCount = -1;
  }

  /** Re-reads the registry when it changed. Cheap (a version compare) otherwise. */
  sync(reg: RTSceneRegistry): void {
    if (reg.version === this.version) return;
    this.version = reg.version;
    const staticKey = (reg as { staticVersion?: number }).staticVersion ?? reg.version;
    const statics = reg.allStatic();
    const dyn = reg.allDynamic();
    if (dyn.length > this.dynamicCap) { this.dynamicCap = 2 ** Math.ceil(Math.log2(dyn.length)); this.allocate(Math.max(this.staticCap, MIN_STATIC_PRIMS)); this.version = reg.version; }
    if (staticKey !== this.staticKey) {
      if (statics.length > this.staticCap) {
        this.allocate(Math.max(MIN_STATIC_PRIMS, 2 ** Math.ceil(Math.log2(statics.length))));
        this.version = reg.version;
      }
      this.buildStatic(statics);
      this.staticKey = staticKey;
    }
    this.buildDynamic(dyn);
  }

  private buildStatic(prims: readonly RTPrimitive[]): void {
    const r = this.staticBuilder.build(prims, this.target, 2 * this.dynamicCap, this.dynamicCap);
    this.staticRoot = r.root;
    this.staticCount = r.primCount;
    this.staticNodeCount = r.nodeCount;
    this.staticRebuilds++;
    if (r.primCount === 0) return;
    this.device.queue.writeBuffer(this.nodes, 2 * this.dynamicCap * NODE_BYTES, this.target.nodesU, 2 * this.dynamicCap * NODE_WORDS, r.nodeCount * NODE_WORDS);
    this.device.queue.writeBuffer(this.prims, this.dynamicCap * PRIM_BYTES, this.target.primsU, this.dynamicCap * PRIM_WORDS, r.primCount * PRIM_WORDS);
  }

  private buildDynamic(prims: readonly RTPrimitive[]): void {
    const rebuild = prims.length !== this.dynamicCount || prims.length <= DYNAMIC_MAX_PRIMS || this.dynamicAge++ >= 120;
    const r = rebuild ? this.dynamicBuilder.build(prims, this.target, 0, 0) : this.dynamicBuilder.refit(prims);
    if (rebuild) this.dynamicAge = 0;
    this.dynamicRoot = r.root;
    this.dynamicCount = r.primCount;
    this.dynamicNodeCount = r.nodeCount;
    if (r.primCount === 0) return;
    this.device.queue.writeBuffer(this.nodes, 0, this.target.nodesU, 0, r.nodeCount * NODE_WORDS);
    this.device.queue.writeBuffer(this.prims, 0, this.target.primsU, 0, r.primCount * PRIM_WORDS);
  }

  /** Which registry primitive a packed slot (as reported by a shader hit) holds; valid until the next rebuild of that tree. */
  slotToPrim(slot: number): PrimSlot {
    if (slot < this.dynamicCap) return { dynamic: true, index: this.dynamicBuilder.sortedOrder[slot] };
    return { dynamic: false, index: this.staticBuilder.sortedOrder[slot - this.dynamicCap] };
  }

  stats(): SceneStats {
    return {
      staticPrims: this.staticCount, dynamicPrims: this.dynamicCount, nodes: this.staticNodeCount + this.dynamicNodeCount,
      bufferBytes: this.nodes.size + this.prims.size, staticRebuilds: this.staticRebuilds,
    };
  }

  destroy(): void {
    this.nodes.destroy();
    this.prims.destroy();
  }
}
