import { MAX_TILES, TILE_FLOATS } from './clipmap';
import type { WaterMask } from './waterMask';

/** Retains the last terrain prefix and water suffix independently of Clipmap's reused scratch array.
 * Scene water/origin changes and replacement GPU buffers must invalidate this cache.
 */
export class TilePayload {
  readonly data = new Float32Array(2 * MAX_TILES * TILE_FLOATS);
  waterCount = 0;
  waterQuads = 0;
  private count = -1;
  private originX = NaN;
  private originZ = NaN;
  private mask: WaterMask | null = null;
  private enabled = false;
  private readonly bits = new Uint32Array(this.data.buffer);
  private readonly sourceBits: Uint32Array;

  constructor(private readonly source: Float32Array) {
    this.sourceBits = new Uint32Array(source.buffer, source.byteOffset, source.length);
  }

  invalidate(): void { this.count = -1; }

  /** Returns whether the active GPU payload needs uploading. Compare all bits, including signed zero.
   * Always called AFTER rebuilding/culling the clipmap; camera motion alone is not a cache key.
   */
  update(count: number, originX: number, originZ: number, mask: WaterMask | null): boolean {
    const size = count * TILE_FLOATS;
    const enabled = !!mask?.enabled;
    let same = count === this.count && Object.is(originX, this.originX) && Object.is(originZ, this.originZ)
      && mask === this.mask && enabled === this.enabled;
    if (same) {
      for (let i = 0; i < size; i++) {
        if (this.sourceBits[i] !== this.bits[i]) { same = false; break; }
      }
    }
    if (same) return false;

    // Finish replacing the prefix before writing the suffix: count can grow into the old water data.
    const tiles = this.source, data = this.data;
    for (let i = 0; i < size; i++) data[i] = tiles[i];
    let water = 0, quads = 0;
    if (mask && mask.enabled) {
      for (let i = 0; i < count; i++) {
        const o = i * TILE_FLOATS, spacing = tiles[o + 4];
        const x0 = originX + tiles[o] * spacing, z0 = originZ + tiles[o + 1] * spacing;
        if (mask.regionBelow(x0, z0, x0 + tiles[o + 2] * spacing, z0 + tiles[o + 3] * spacing)) {
          const dst = (count + water++) * TILE_FLOATS;
          for (let k = 0; k < TILE_FLOATS; k++) data[dst + k] = tiles[o + k];
          quads += data[dst + 2] * data[dst + 3];
        }
      }
    }
    this.count = count;
    this.originX = originX; this.originZ = originZ;
    this.mask = mask; this.enabled = enabled;
    this.waterCount = water;
    this.waterQuads = quads;
    return true;
  }
}
