import type { QualityProfile } from '../contracts';

/** Probe rays per frame the reference profile (High: 2 GI rays x 96-step walks) may trace before the rotating subset shrinks. */
export const PROBE_RAY_BUDGET = 150_000;
/** Longest refresh rotation (frames between two updates of a probe) the reference profile accepts. */
export const PROBE_MAX_STRIDE = 16;

const REFERENCE_RAY_WORK = 2 * 96;
const MIN_PROBE_BUDGET = 20_000;
const MAX_STRIDE_LIMIT = 32;

export interface ProbeLimits { rayBudget: number; maxStride: number }

/**
 * Probe work follows the profile's screen-space ray work (GI rays x walk length: both feed the same indirect-light estimate), so a cheaper
 * profile traces fewer probe rays per frame and accepts a longer rotation to get there; the budget never drops below MIN_PROBE_BUDGET.
 */
export function probeLimits(q: Pick<QualityProfile, 'giRays' | 'rtMaxSteps'>): ProbeLimits {
  const work = Math.max(q.giRays, 1) * q.rtMaxSteps / REFERENCE_RAY_WORK;
  return {
    rayBudget: Math.max(MIN_PROBE_BUDGET, Math.round((PROBE_RAY_BUDGET * work) / 1000) * 1000),
    maxStride: Math.min(MAX_STRIDE_LIMIT, Math.max(PROBE_MAX_STRIDE, Math.ceil(PROBE_MAX_STRIDE / work))),
  };
}

/** Refresh stride K for a grid of `total` probes with `raysPerProbe` rays each: the smallest K that keeps the per-frame rays within `budget`. */
export function probeStride(total: number, raysPerProbe: number, budget = PROBE_RAY_BUDGET, maxStride = PROBE_MAX_STRIDE): number {
  return Math.min(maxStride, Math.max(1, Math.ceil((total * raysPerProbe) / Math.max(budget, 1))));
}

export interface ProbeImg { texture: GPUTexture; view: GPUTextureView }
/** SH-L1 radiance of one colour channel each: texel = (c0, c1, c2, c3) of the four coefficients. */
export interface ProbeSet { r: ProbeImg; g: ProbeImg; b: ProbeImg }
export type Vec3i = [number, number, number];

/**
 * Camera-centred toroidal grid of SH-L1 radiance probes (double-buffered: the update reads one set and writes the other).
 * Lattice coordinate c lives at texel posmod(c, dim); the window [lo, lo + dim) follows the camera in whole probe steps, so probes
 * that stay inside it keep their texels and only the ones entering are re-traced from scratch.
 */
export class ProbeGrid {
  readonly sets: [ProbeSet, ProbeSet];
  readonly dim: Vec3i;
  readonly spacing: number;
  readonly raysPerProbe: number;
  readonly total: number;
  /** Rotating subset: probe id % stride == frame % stride is refreshed each frame. */
  readonly stride: number;
  lo: Vec3i = [0, 0, 0];
  prevLo: Vec3i = [0, 0, 0];
  allFresh = true;
  private valid = false;
  private readonly textures: GPUTexture[] = [];

  constructor(device: GPUDevice, q: QualityProfile['probes'], readonly limits: ProbeLimits = { rayBudget: PROBE_RAY_BUDGET, maxStride: PROBE_MAX_STRIDE }) {
    this.dim = [q.dim[0], q.dim[1], q.dim[2]];
    this.spacing = q.spacing;
    this.raysPerProbe = q.raysPerProbe;
    this.total = q.dim[0] * q.dim[1] * q.dim[2];
    this.stride = probeStride(this.total, q.raysPerProbe, limits.rayBudget, limits.maxStride);
    const set = (i: number): ProbeSet => ({ r: this.make(device, `rt probe R ${i}`), g: this.make(device, `rt probe G ${i}`), b: this.make(device, `rt probe B ${i}`) });
    this.sets = [set(0), set(1)];
  }

  private make(device: GPUDevice, label: string): ProbeImg {
    const U = GPUTextureUsage;
    const texture = device.createTexture({
      label, dimension: '3d', format: 'rgba16float', size: [this.dim[0], this.dim[1], this.dim[2]],
      usage: U.STORAGE_BINDING | U.TEXTURE_BINDING | U.COPY_SRC,
    });
    this.textures.push(texture);
    return { texture, view: texture.createView({ dimension: '3d' }) };
  }

  matches(q: QualityProfile['probes'], limits: ProbeLimits): boolean {
    return limits.rayBudget === this.limits.rayBudget && limits.maxStride === this.limits.maxStride && q.dim[0] === this.dim[0] && q.dim[1] === this.dim[1] && q.dim[2] === this.dim[2] && q.spacing === this.spacing && q.raysPerProbe === this.raysPerProbe;
  }

  get bytes(): number { return this.total * 8 * 6; }
  get raysPerFrame(): number { return Math.ceil(this.total / this.stride) * this.raysPerProbe; }

  /** Forget every stored probe: the next update traces the whole grid from scratch. */
  reset(): void { this.valid = false; }

  /** Picks this frame's window from the camera position and the ground height below it. */
  plan(camX: number, camZ: number, groundY: number): void {
    const s = this.spacing, d = this.dim;
    this.prevLo = this.lo;
    this.lo = [Math.round(camX / s) - (d[0] >> 1), Math.floor(groundY / s) - 1, Math.round(camZ / s) - (d[2] >> 1)];
    this.allFresh = !this.valid;
  }

  /** The update dispatched for the planned window: the window it wrote is the one the read set is valid for from now on. */
  commit(): void { this.valid = true; }

  destroy(): void {
    for (const t of this.textures) t.destroy();
    this.textures.length = 0;
  }
}
