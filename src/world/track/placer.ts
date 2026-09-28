/** Obstacle bookkeeping: accepts an obstacle only when it satisfies every rule validateTrack checks, with a little margin. */
import type { TerrainSampler, TrackData, TrackObstacle, Vec3 } from '../../contracts';
import { PathIndex } from './pathIndex';
import { WATER_MARGIN } from './styles';
import { MARKER_CLEARANCE, MAX_OBSTACLES, TREE_CLEARANCE, footprint, isLargeObstacle } from './validateParts';

export type PlacementInput = Pick<TrackData, 'style' | 'gates' | 'path' | 'closed' | 'start'>;

/** Margins on top of the validator's limits so float noise never flips a placement into an error. */
const MARGIN = 0.4;
const EDGE_OF_MAP = 3;

export type ObstacleKind = TrackObstacle['kind'];

export class Placer {
  readonly out: TrackObstacle[] = [];
  readonly index: PathIndex;
  private readonly half: number;
  private readonly ox: number;
  private readonly oz: number;
  private readonly floor: number;

  constructor(
    readonly track: PlacementInput,
    readonly sampler: TerrainSampler,
  ) {
    const d = sampler.data;
    this.index = new PathIndex(track.path);
    this.half = (d.resolution * d.cellSize) / 2;
    this.ox = d.origin[0] + this.half;
    this.oz = d.origin[1] + this.half;
    this.floor = d.waterLevel + WATER_MARGIN;
  }

  get full(): boolean {
    return this.out.length >= MAX_OBSTACLES;
  }

  /**
   * Puts an obstacle of `kind` on the ground at (x, z). `size` follows TrackObstacle (round: radius, height, radius; box: full
   * extents). `nearPad` skips the launch-pad keep-out so the pad's own cones can be placed. Returns true when it was accepted.
   */
  add(kind: ObstacleKind, x: number, z: number, yaw: number, size: Vec3, nearPad = false): boolean {
    if (this.full) return false;
    const { sampler } = this;
    if (Math.abs(x - this.ox) > this.half - EDGE_OF_MAP || Math.abs(z - this.oz) > this.half - EDGE_OF_MAP) return false;
    const ground = sampler.heightAt(x, z);
    if (ground < this.floor) return false;
    const o: TrackObstacle = { kind, pos: [x, ground, z], yaw, size };
    const fp = footprint(o);
    const large = isLargeObstacle(o);
    if (large && sampler.slopeAt(x, z) > (kind === 'wall' ? 0.2 : 0.55)) return false;
    this.index.nearestXZ(x, z);
    if (this.index.lastDist - fp < (large ? TREE_CLEARANCE : MARKER_CLEARANCE) + MARGIN) return false;
    for (const g of this.track.gates) {
      if (Math.hypot(x - g.pos[0], z - g.pos[2]) < Math.max(g.width, g.height) / 2 + fp + 0.5 + MARGIN) return false;
    }
    const pad = this.track.start.pos;
    if (!nearPad && Math.hypot(x - pad[0], z - pad[2]) < fp + 2.5) return false;
    for (const q of this.out) {
      if (Math.hypot(x - q.pos[0], z - q.pos[2]) < fp + footprint(q) + 0.3) return false;
    }
    this.out.push(o);
    return true;
  }
}
