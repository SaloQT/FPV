/** Mirrors TERRAIN_FAR_FRACTION in shaders/terrain/terrain_height.wgsl. */
const FAR_FRACTION = 0.35;
const BLOCK = 8;

/**
 * Conservative "does any terrain under this rectangle dip below the water plane" query over a block-min grid of the height map,
 * following the shader's mirrored extension (heights reflect at the borders and fade toward a flat far height). Lets the terrain
 * module skip water entirely on dry maps and draw water only for the clipmap tiles that can show it.
 */
export class WaterMask {
  readonly enabled: boolean;
  private readonly n: number;
  private readonly cell: number;
  private readonly originX: number;
  private readonly originZ: number;
  private readonly farBelow: boolean;
  private readonly blocks: number;
  private readonly wetPrefix: Uint32Array;
  private readonly segX = new Int32Array(8);
  private readonly segZ = new Int32Array(8);

  constructor(height: Float32Array, n: number, cell: number, origin: readonly [number, number], minHeight: number, maxHeight: number, waterLevel: number) {
    this.n = n;
    this.cell = cell;
    this.originX = origin[0];
    this.originZ = origin[1];
    this.farBelow = minHeight + FAR_FRACTION * (maxHeight - minHeight) < waterLevel;
    const nb = Math.ceil(n / BLOCK);
    this.blocks = nb;
    const blockMin = new Float32Array(nb * nb).fill(Infinity);
    let lowest = Infinity;
    for (let j = 0; j < n; j++) {
      const row = Math.floor(j / BLOCK) * nb;
      for (let i = 0; i < n; i++) {
        const h = height[j * n + i];
        const b = row + Math.floor(i / BLOCK);
        if (h < blockMin[b]) blockMin[b] = h;
        if (h < lowest) lowest = h;
      }
    }
    this.enabled = Number.isFinite(waterLevel) && lowest < waterLevel;
    // Keep the same Float32 minima and strict comparison as the block scan.
    // A padded summed-area table makes any inclusive block rectangle O(1).
    const stride = nb + 1;
    this.wetPrefix = new Uint32Array(stride * stride);
    for (let z = 0; z < nb; z++) {
      let rowWet = 0;
      for (let x = 0; x < nb; x++) {
        if (blockMin[z * nb + x] < waterLevel) rowWet++;
        this.wetPrefix[(z + 1) * stride + x + 1] = this.wetPrefix[z * stride + x + 1] + rowWet;
      }
    }
  }

  /** True if terrain under [x0,x1] x [z0,z1] (world metres) may be below the water level. */
  regionBelow(x0: number, z0: number, x1: number, z1: number): boolean {
    if (!this.enabled) return false;
    const tx0 = Math.floor((x0 - this.originX) / this.cell), tx1 = Math.ceil((x1 - this.originX) / this.cell);
    const tz0 = Math.floor((z0 - this.originZ) / this.cell), tz1 = Math.ceil((z1 - this.originZ) / this.cell);
    if (this.farBelow && (tx0 < 0 || tz0 < 0 || tx1 > this.n - 1 || tz1 > this.n - 1)) return true;
    const cx = this.fold(tx0, tx1, this.segX), cz = this.fold(tz0, tz1, this.segZ);
    for (let a = 0; a < cx; a++) {
      for (let b = 0; b < cz; b++) {
        if (this.blocksBelow(this.segX[2 * a], this.segX[2 * a + 1], this.segZ[2 * b], this.segZ[2 * b + 1])) return true;
      }
    }
    return false;
  }

  private blocksBelow(xa: number, xb: number, za: number, zb: number): boolean {
    const x0 = Math.floor(xa / BLOCK), x1 = Math.floor(xb / BLOCK) + 1;
    const z0 = Math.floor(za / BLOCK), z1 = Math.floor(zb / BLOCK) + 1;
    if (x1 <= x0 || z1 <= z0) return false;
    const stride = this.blocks + 1, prefix = this.wetPrefix;
    // Normal terrain grids have fewer than 2^32 blocks, so these integer counts
    // are exact. This is not an unbounded-size summed-area table.
    return ((prefix[z1 * stride + x1] - prefix[z0 * stride + x1]
      - prefix[z1 * stride + x0] + prefix[z0 * stride + x0]) >>> 0) !== 0;
  }

  private reflect(t: number, w: number, period: number): number {
    const m = ((t % period) + period) % period;
    return m > w ? period - m : m;
  }

  /** Reflects the texel interval [t0, t1] into [0, n - 1]; writes monotone (lo, hi) pairs and returns their count. */
  private fold(t0: number, t1: number, out: Int32Array): number {
    const w = this.n - 1, period = 2 * w;
    if (t1 - t0 >= period) {
      out[0] = 0;
      out[1] = w;
      return 1;
    }
    let count = 0;
    let a = t0;
    while (a <= t1) {
      const k = Math.floor(a / w);
      const b = Math.min(t1, (k + 1) * w);
      const ra = this.reflect(a, w, period), rb = this.reflect(b, w, period);
      out[2 * count] = Math.min(ra, rb);
      out[2 * count + 1] = Math.max(ra, rb);
      count++;
      a = (k + 1) * w + 1;
    }
    return count;
  }
}
