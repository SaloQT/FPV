/** Uniform grid of discs (linked lists in typed arrays) for the Poisson-disc spacing checks; `cell` must be at least the largest query radius. */
export class SpatialHash {
  private readonly head: Int32Array;
  private next: Int32Array;
  private xs: Float32Array;
  private zs: Float32Array;
  private rs: Float32Array;
  private gs: Uint8Array;
  private readonly nx: number;
  private readonly nz: number;
  count = 0;

  constructor(private readonly minX: number, private readonly minZ: number, maxX: number, maxZ: number, private readonly cell: number, capacity: number) {
    this.nx = Math.max(1, Math.ceil((maxX - minX) / cell) + 1);
    this.nz = Math.max(1, Math.ceil((maxZ - minZ) / cell) + 1);
    this.head = new Int32Array(this.nx * this.nz).fill(-1);
    this.next = new Int32Array(capacity);
    this.xs = new Float32Array(capacity);
    this.zs = new Float32Array(capacity);
    this.rs = new Float32Array(capacity);
    this.gs = new Uint8Array(capacity);
  }

  private clampX(x: number): number {
    return Math.min(Math.max(Math.floor((x - this.minX) / this.cell), 0), this.nx - 1);
  }

  private clampZ(z: number): number {
    return Math.min(Math.max(Math.floor((z - this.minZ) / this.cell), 0), this.nz - 1);
  }

  add(x: number, z: number, r: number, group: number): void {
    if (this.count === this.xs.length) this.grow();
    const i = this.count++, c = this.clampZ(z) * this.nx + this.clampX(x);
    this.xs[i] = x; this.zs[i] = z; this.rs[i] = r; this.gs[i] = group;
    this.next[i] = this.head[c];
    this.head[c] = i;
  }

  private grow(): void {
    const cap = this.xs.length * 2 + 64;
    const f = (a: Float32Array): Float32Array => { const b = new Float32Array(cap); b.set(a); return b; };
    this.xs = f(this.xs); this.zs = f(this.zs); this.rs = f(this.rs);
    const nx = new Int32Array(cap); nx.set(this.next); this.next = nx;
    const g = new Uint8Array(cap); g.set(this.gs); this.gs = g;
  }

  /** Whether a disc of radius `r` and group `group` is closer than 0.5 (r + rj) times `same` (same group) or `cross` (other group) to a stored disc. */
  conflicts(x: number, z: number, r: number, group: number, same: number, cross: number): boolean {
    const cx = this.clampX(x), cz = this.clampZ(z);
    for (let j = Math.max(cz - 1, 0); j <= Math.min(cz + 1, this.nz - 1); j++) {
      for (let i = Math.max(cx - 1, 0); i <= Math.min(cx + 1, this.nx - 1); i++) {
        for (let k = this.head[j * this.nx + i]; k >= 0; k = this.next[k]) {
          const need = 0.5 * (r + this.rs[k]) * (this.gs[k] === group ? same : cross);
          const dx = this.xs[k] - x, dz = this.zs[k] - z;
          if (dx * dx + dz * dz < need * need) return true;
        }
      }
    }
    return false;
  }

  /** Whether the point is within `r + rj + pad` of a stored disc. */
  overlaps(x: number, z: number, r: number, pad: number): boolean {
    const cx = this.clampX(x), cz = this.clampZ(z);
    for (let j = Math.max(cz - 1, 0); j <= Math.min(cz + 1, this.nz - 1); j++) {
      for (let i = Math.max(cx - 1, 0); i <= Math.min(cx + 1, this.nx - 1); i++) {
        for (let k = this.head[j * this.nx + i]; k >= 0; k = this.next[k]) {
          const need = r + this.rs[k] + pad;
          const dx = this.xs[k] - x, dz = this.zs[k] - z;
          if (dx * dx + dz * dz < need * need) return true;
        }
      }
    }
    return false;
  }
}
