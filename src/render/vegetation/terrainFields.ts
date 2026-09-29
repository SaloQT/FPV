import type { TerrainData } from '../../contracts';

/** Bilinear reads of the terrain grids for the placement pass; results land in scratch fields so hot loops never allocate. */
export class TerrainFields {
  /** Terrain gradient (dh/dx, dh/dz) of the last `gradient` call. */
  gx = 0;
  gz = 0;
  private readonly n: number;
  private readonly inv: number;
  private readonly ox: number;
  private readonly oz: number;

  constructor(readonly data: TerrainData) {
    this.n = data.resolution;
    this.inv = 1 / data.cellSize;
    this.ox = data.origin[0];
    this.oz = data.origin[1];
  }

  /** True when (x, z) is at least `margin` metres inside the sampled area. */
  inside(x: number, z: number, margin: number): boolean {
    const e = (this.n - 1) * this.data.cellSize;
    return x >= this.ox + margin && z >= this.oz + margin && x <= this.ox + e - margin && z <= this.oz + e - margin;
  }

  private bilinear(a: ArrayLike<number>, x: number, z: number): number {
    const last = this.n - 1;
    const tx = Math.min(Math.max((x - this.ox) * this.inv, 0), last - 1e-4);
    const tz = Math.min(Math.max((z - this.oz) * this.inv, 0), last - 1e-4);
    const i = Math.floor(tx), j = Math.floor(tz), fx = tx - i, fz = tz - j;
    const b = j * this.n + i;
    const top = a[b] + (a[b + 1] - a[b]) * fx, bottom = a[b + this.n] + (a[b + this.n + 1] - a[b + this.n]) * fx;
    return top + (bottom - top) * fz;
  }

  /** Height on the drawn mesh: each quad is split along its (0,0)-(1,1) diagonal like TerrainSampler.heightAt, so plants and rocks touch the surface (a bilinear patch is up to about a metre off on 8 m cells). */
  height(x: number, z: number): number {
    const n = this.n, last = n - 1, h = this.data.height;
    const tx = Math.min(Math.max((x - this.ox) * this.inv, 0), last - 1e-4);
    const tz = Math.min(Math.max((z - this.oz) * this.inv, 0), last - 1e-4);
    const i = Math.floor(tx), j = Math.floor(tz), fx = tx - i, fz = tz - j;
    const b = j * n + i, h00 = h[b];
    if (fx >= fz) return h00 + (h[b + 1] - h00) * fx + (h[b + n + 1] - h[b + 1]) * fz;
    return h00 + (h[b + n + 1] - h[b + n]) * fx + (h[b + n] - h00) * fz;
  }

  soil(x: number, z: number): number {
    return this.bilinear(this.data.maps.soil, x, z);
  }

  flow(x: number, z: number): number {
    return this.bilinear(this.data.maps.flow, x, z);
  }

  wetness(x: number, z: number): number {
    return this.bilinear(this.data.maps.wetness, x, z);
  }

  /** Central differences over two cells; the slope angle is atan(hypot(gx, gz)). */
  gradient(x: number, z: number): number {
    const e = this.data.cellSize;
    this.gx = (this.height(x + e, z) - this.height(x - e, z)) / (2 * e);
    this.gz = (this.height(x, z + e) - this.height(x, z - e)) / (2 * e);
    return Math.hypot(this.gx, this.gz);
  }
}
