/**
 * Box stand-ins for the park round a race course, for the AI pilots: the GPU trainer and the brains' range sensing only know upright
 * boxes (ObstacleCollider). Every static solid within RACE_SENSE_REACH of the line is rasterised into SENSE_VOXEL cubes (a cube
 * counts as solid when its centre is within half a cube diagonal of the part's exact shape), and the solid cubes are merged greedily
 * into axis-aligned boxes. The boxes cover the real shapes, standing out from them by at most one cube diagonal; ground clutter
 * below SENSE_FLOOR is left out, as the line never flies that low. The space the moving rides sweep (RaceClearance's ride
 * envelopes) is filled the same way, so the boxes stand still while the rides move inside them; a follow-the-coaster route
 * leaves out the trains of the coaster it follows.
 *
 * The player and rival drones in the game still collide with the park's exact shapes (ParkCollision); these boxes are what a brain
 * sees and what the trainer's drones hit.
 */
import type { ObstacleCollider, TrackData, Vec3 } from '../../contracts';
import { partDistance } from './collision';
import { inverseRotate } from './math';
import { RaceClearance } from './raceCourse';
import { PARK_GRADE } from './surfaces';
import type { ParkData, ParkPart } from './types';

/** Cube size of the rasterisation, metres. */
export const SENSE_VOXEL = 1;
/** Solids further than this from the line in plan are left out, metres. */
export const RACE_SENSE_REACH = 30;
/** Solids whose top is below this height above the park grade are left out, metres. */
export const SENSE_FLOOR = 1.2;
/** The highest a stand-in reaches above the park grade, metres (the line flies at most 40 m up). */
const SENSE_TOP = 60;

/** World box round a part. */
function partBounds(part: ParkPart): [Vec3, Vec3] {
  const [x, y, z, w] = part.rot, h = part.half;
  const m = [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w), 2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w), 2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)];
  const lo: Vec3 = [0, 0, 0], hi: Vec3 = [0, 0, 0];
  for (let r = 0; r < 3; r++) { const e = Math.abs(m[r * 3]) * h[0] + Math.abs(m[r * 3 + 1]) * h[1] + Math.abs(m[r * 3 + 2]) * h[2]; lo[r] = part.pos[r] - e; hi[r] = part.pos[r] + e; }
  return [lo, hi];
}

/** Upright boxes standing in for the park's static solids round `track`'s line. */
export function parkSenseColliders(park: ParkData, track: TrackData): ObstacleCollider[] {
  const path = track.path, V = SENSE_VOXEL, reach = RACE_SENSE_REACH;
  // Plan-view distance to the line through a coarse hash of the line's points.
  const HASH = 16, hash = new Map<number, number[]>(), key = (x: number, z: number) => (Math.floor(x / HASH) + 512) * 1024 + Math.floor(z / HASH) + 512;
  path.forEach((p, i) => { const k = key(p[0], p[2]), list = hash.get(k); if (list) list.push(i); else hash.set(k, [i]); });
  const span = Math.ceil(reach / HASH) + 1;
  const near = (x0: number, z0: number, x1: number, z1: number): boolean => {
    for (let dx = Math.floor(x0 / HASH) - span; dx <= Math.floor(x1 / HASH) + span; dx++) for (let dz = Math.floor(z0 / HASH) - span; dz <= Math.floor(z1 / HASH) + span; dz++) {
      for (const i of hash.get((dx + 512) * 1024 + dz + 512) ?? []) {
        const p = path[i], cx = Math.max(x0, Math.min(x1, p[0])), cz = Math.max(z0, Math.min(z1, p[2]));
        if (Math.hypot(cx - p[0], cz - p[2]) <= reach) return true;
      }
    }
    return false;
  };
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const p of path) { minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]); minZ = Math.min(minZ, p[2]); maxZ = Math.max(maxZ, p[2]); }
  const x0 = Math.floor((minX - reach) / V) * V, z0 = Math.floor((minZ - reach) / V) * V, y0 = PARK_GRADE;
  const nx = Math.ceil((maxX + reach - x0) / V) + 1, nz = Math.ceil((maxZ + reach - z0) / V) + 1, ny = Math.ceil(SENSE_TOP / V);
  const solid = new Uint8Array(nx * ny * nz), index = (i: number, j: number, k: number) => (k * ny + j) * nx + i;
  const local: Vec3 = [0, 0, 0], normal: Vec3 = [0, 0, 0], grow = V * Math.sqrt(3) / 2;
  // Marks every cube inside [lo, hi] whose centre `within` puts inside the shape grown by half a cube diagonal.
  const fill = (lo: Vec3, hi: Vec3, within: (x: number, y: number, z: number) => boolean): void => {
    if (hi[1] < y0 + SENSE_FLOOR || lo[1] > y0 + SENSE_TOP || !near(lo[0], lo[2], hi[0], hi[2])) return;
    const i0 = Math.max(0, Math.floor((lo[0] - grow - x0) / V)), i1 = Math.min(nx - 1, Math.floor((hi[0] + grow - x0) / V));
    const j0 = Math.max(0, Math.floor((Math.max(lo[1], y0 + SENSE_FLOOR) - grow - y0) / V)), j1 = Math.min(ny - 1, Math.floor((hi[1] + grow - y0) / V));
    const k0 = Math.max(0, Math.floor((lo[2] - grow - z0) / V)), k1 = Math.min(nz - 1, Math.floor((hi[2] + grow - z0) / V));
    for (let k = k0; k <= k1; k++) for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const o = index(i, j, k);
      if (!solid[o] && within(x0 + (i + 0.5) * V, y0 + (j + 0.5) * V, z0 + (k + 0.5) * V)) solid[o] = 1;
    }
  };
  for (const part of park.parts) {
    if (!part.solid || part.body >= 0) continue;
    const [lo, hi] = partBounds(part);
    fill(lo, hi, (x, y, z) => {
      local[0] = x - part.pos[0]; local[1] = y - part.pos[1]; local[2] = z - part.pos[2];
      return partDistance(part, inverseRotate(part.rot, local, local), normal) <= grow;
    });
  }
  // The space the moving rides sweep counts as solid, so a brain keeps clear of a ride whatever it is doing.
  // A follow-the-coaster guide flies beside that coaster's trains, so their swept space is left to the exact collision.
  const followed = /^coaster-(\d+)$/.exec(track.parkCourse ?? '');
  const clearance = new RaceClearance(park, followed ? Number(followed[1]) : undefined);
  for (const [lo, hi] of clearance.rideBounds()) fill(lo, hi, (x, y, z) => clearance.rides(x, y, z) <= grow);
  // Greedy merge: grow each unclaimed solid cube along x, then z, then y while the whole face stays solid.
  const out: ObstacleCollider[] = [], taken = new Uint8Array(solid.length);
  const free = (i: number, j: number, k: number) => solid[index(i, j, k)] && !taken[index(i, j, k)];
  for (let j = 0; j < ny; j++) for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) {
    if (!free(i, j, k)) continue;
    let i1 = i; while (i1 + 1 < nx && free(i1 + 1, j, k)) i1++;
    let k1 = k; grow: while (k1 + 1 < nz) { for (let a = i; a <= i1; a++) if (!free(a, j, k1 + 1)) break grow; k1++; }
    let j1 = j; up: while (j1 + 1 < ny) { for (let c = k; c <= k1; c++) for (let a = i; a <= i1; a++) if (!free(a, j1 + 1, c)) break up; j1++; }
    for (let b = j; b <= j1; b++) for (let c = k; c <= k1; c++) for (let a = i; a <= i1; a++) taken[index(a, b, c)] = 1;
    out.push({ kind: 'box', center: [x0 + (i + i1 + 1) * V / 2, y0 + (j + j1 + 1) * V / 2, z0 + (k + k1 + 1) * V / 2], half: [(i1 - i + 1) * V / 2, (j1 - j + 1) * V / 2, (k1 - k + 1) * V / 2], yaw: 0 });
  }
  return out;
}
