/**
 * Ground height that includes the start pad. The rendered pad is a flat plate `PAD_THICKNESS` above the highest terrain
 * sample under it, so physics, the session's respawn logic and the camera must all see the same surface. One instance
 * lives for the whole app; `set` retargets it at a new terrain and track (the closures handed out stay valid).
 */
import type { TerrainData, TerrainSampler, TrackData, Vec3 } from '../contracts';
import { PAD_SIZE, PAD_THICKNESS } from '../render/objects/trackMesh';

const HALF = PAD_SIZE / 2;

export class PadGround implements TerrainSampler {
  /** Stable `(x, z) => height` for GameSession and CameraRig. */
  readonly groundHeightAt = (x: number, z: number): number => this.heightAt(x, z);
  private base: TerrainSampler;
  private px = 0;
  private pz = 0;
  private cos = 1;
  private sin = 0;
  private top = -Infinity;
  private active = false;

  constructor(base: TerrainSampler, track: TrackData | null = null) {
    this.base = base;
    this.set(base, track);
  }

  get data(): TerrainData {
    return this.base.data;
  }

  /** Height of the pad surface (top of the plate); `-Infinity` without a pad. */
  get padTop(): number {
    return this.top;
  }

  /** Points the wrapper at `base` and the pad of `track` (null: no pad). */
  set(base: TerrainSampler, track: TrackData | null): void {
    this.base = base;
    this.active = track !== null;
    this.top = -Infinity;
    if (!track) return;
    this.px = track.start.pos[0];
    this.pz = track.start.pos[2];
    const yaw = track.start.yaw;
    this.cos = Math.cos(yaw);
    this.sin = Math.sin(yaw);
    // Same five samples as the pad mesh: the centre and the four corners of the rotated footprint.
    let hi = -Infinity;
    for (const [lx, lz] of [[0, 0], [HALF, HALF], [-HALF, HALF], [-HALF, -HALF], [HALF, -HALF]]) {
      hi = Math.max(hi, base.heightAt(this.px + this.cos * lx + this.sin * lz, this.pz - this.sin * lx + this.cos * lz));
    }
    this.top = hi + PAD_THICKNESS;
  }

  /** True inside the (square, unrotated-corner) pad footprint. */
  onPad(x: number, z: number): boolean {
    if (!this.active) return false;
    const dx = x - this.px;
    const dz = z - this.pz;
    const lx = this.cos * dx - this.sin * dz;
    const lz = this.sin * dx + this.cos * dz;
    return lx >= -HALF && lx <= HALF && lz >= -HALF && lz <= HALF;
  }

  heightAt(x: number, z: number): number {
    const h = this.base.heightAt(x, z);
    return this.onPad(x, z) ? Math.max(this.top, h + PAD_THICKNESS) : h;
  }

  normalAt(x: number, z: number, out?: Vec3): Vec3 {
    if (!this.onPad(x, z)) return this.base.normalAt(x, z, out);
    const n = out ?? [0, 1, 0];
    n[0] = 0;
    n[1] = 1;
    n[2] = 0;
    return n;
  }

  slopeAt(x: number, z: number): number {
    return this.onPad(x, z) ? 0 : this.base.slopeAt(x, z);
  }

  raycast(origin: Vec3, dir: Vec3, maxDist: number): { t: number; point: Vec3; normal: Vec3 } | null {
    return this.base.raycast(origin, dir, maxDist);
  }
}
