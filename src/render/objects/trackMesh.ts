/** Bakes the whole track (gates, obstacles, start pad) into one world-space mesh plus the cloth flags that animate on top. */
import type { TerrainSampler, TrackData } from '../../contracts';
import { plate } from './extrude';
import { buildGate, type GlowStrip } from './gateMeshes';
import { KIND, type ClothFlag } from './materials';
import { MeshBuilder, affineMul, affineRotY, affineTranslate, type MeshData } from './meshBuilder';
import { buildObstacle } from './obstacleMeshes';
import { roundedRect } from './outlines';

export const PAD_SIZE = 1.2;
/** How far the pad's flat top stands above the highest terrain sample under its footprint. */
export const PAD_THICKNESS = 0.024;
const PAD_CORNER = 0.07;

export interface TrackMesh {
  mesh: MeshData;
  flags: ClothFlag[];
  strips: GlowStrip[];
}

function buildPad(b: MeshBuilder, track: TrackData, sampler: TerrainSampler): void {
  const [px, , pz] = track.start.pos;
  const yaw = track.start.yaw;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const h = PAD_SIZE / 2;
  let lo = Infinity;
  let hi = -Infinity;
  for (const [lx, lz] of [[0, 0], [h, h], [-h, h], [-h, -h], [h, -h]]) {
    const g = sampler.heightAt(px + c * lx + s * lz, pz - s * lx + c * lz);
    lo = Math.min(lo, g);
    hi = Math.max(hi, g);
  }
  b.kind = KIND.PAD;
  b.push(affineMul(affineTranslate(px, 0, pz), affineRotY(yaw)));
  plate(b, roundedRect(0, 0, h, h, PAD_CORNER), [], lo - 0.03, hi + PAD_THICKNESS, { wallKind: KIND.PAD_EDGE });
  b.pop();
}

export function buildTrackMesh(track: TrackData, sampler: TerrainSampler): TrackMesh {
  const b = new MeshBuilder();
  const flags: ClothFlag[] = [];
  const strips: GlowStrip[] = [];
  for (const g of track.gates) {
    const built = buildGate(b, g, sampler);
    flags.push(...built.flags);
    strips.push(...built.strips);
  }
  track.obstacles.forEach((o, i) => buildObstacle(b, o, i, flags));
  buildPad(b, track, sampler);
  return { mesh: b.finish(), flags, strips };
}
