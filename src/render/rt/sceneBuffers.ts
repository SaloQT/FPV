import type { RTPrimitive, RTSceneRegistry } from '../contracts';
import { BvhBuilder, NODE_BYTES, NODE_WORDS, NO_ROOT, type BvhTarget } from './bvh';
import { PRIM_BYTES, PRIM_WORDS } from './prims';

/** The dynamic tree (the quad) lives at the start of both buffers; the static tree follows it. */
export const DYNAMIC_MAX_PRIMS = 64;
const DYNAMIC_NODES = 2 * DYNAMIC_MAX_PRIMS;
const MIN_STATIC_PRIMS = 64;

export interface SceneStats {
  staticPrims: number;
  dynamicPrims: number;
  nodes: number;
  bufferBytes: number;
  staticRebuilds: number;
}

export interface PrimSlot { dynamic: boolean; index: number }

/** GPU storage of the proxy BVHs: static tree rebuilt only when the static set changes, dynamic tree rebuilt (<= 64 prims) when anything changed. */
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

  constructor(private readonly device: GPUDevice) {
    this.allocate(MIN_STATIC_PRIMS);
  }

  private allocate(staticCap: number): void {
    this.staticCap = staticCap;
    const nodeWords = (DYNAMIC_NODES + 2 * staticCap) * NODE_WORDS;
    const primWords = (DYNAMIC_MAX_PRIMS + staticCap) * PRIM_WORDS;
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
  }

  /** Re-reads the registry when it changed. Cheap (a version compare) otherwise. */
  sync(reg: RTSceneRegistry): void {
    if (reg.version === this.version) return;
    this.version = reg.version;
    const staticKey = (reg as { staticVersion?: number }).staticVersion ?? reg.version;
    const statics = reg.allStatic();
    if (staticKey !== this.staticKey) {
      if (statics.length > this.staticCap) {
        this.allocate(Math.max(MIN_STATIC_PRIMS, 2 ** Math.ceil(Math.log2(statics.length))));
        this.version = reg.version;
      }
      this.buildStatic(statics);
      this.staticKey = staticKey;
    }
    const dyn = reg.allDynamic();
    this.buildDynamic(dyn.length > DYNAMIC_MAX_PRIMS ? dyn.slice(0, DYNAMIC_MAX_PRIMS) : dyn);
  }

  private buildStatic(prims: readonly RTPrimitive[]): void {
    const r = this.staticBuilder.build(prims, this.target, DYNAMIC_NODES, DYNAMIC_MAX_PRIMS);
    this.staticRoot = r.root;
    this.staticCount = r.primCount;
    this.staticNodeCount = r.nodeCount;
    this.staticRebuilds++;
    if (r.primCount === 0) return;
    this.device.queue.writeBuffer(this.nodes, DYNAMIC_NODES * NODE_BYTES, this.target.nodesU, DYNAMIC_NODES * NODE_WORDS, r.nodeCount * NODE_WORDS);
    this.device.queue.writeBuffer(this.prims, DYNAMIC_MAX_PRIMS * PRIM_BYTES, this.target.primsU, DYNAMIC_MAX_PRIMS * PRIM_WORDS, r.primCount * PRIM_WORDS);
  }

  private buildDynamic(prims: readonly RTPrimitive[]): void {
    const r = this.dynamicBuilder.build(prims, this.target, 0, 0);
    this.dynamicRoot = r.root;
    this.dynamicCount = r.primCount;
    this.dynamicNodeCount = r.nodeCount;
    if (r.primCount === 0) return;
    this.device.queue.writeBuffer(this.nodes, 0, this.target.nodesU, 0, r.nodeCount * NODE_WORDS);
    this.device.queue.writeBuffer(this.prims, 0, this.target.primsU, 0, r.primCount * PRIM_WORDS);
  }

  /** Which registry primitive a packed slot (as reported by a shader hit) holds; valid until the next rebuild of that tree. */
  slotToPrim(slot: number): PrimSlot {
    if (slot < DYNAMIC_MAX_PRIMS) return { dynamic: true, index: this.dynamicBuilder.sortedOrder[slot] };
    return { dynamic: false, index: this.staticBuilder.sortedOrder[slot - DYNAMIC_MAX_PRIMS] };
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
