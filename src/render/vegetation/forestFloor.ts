import type { TerrainData, TrackData } from '../../contracts';
import { bakeTrackDistance, publishGroundCover, rasterGroundCover, type CoverCrown } from '../terrain/groundCover';
import { publishCanopyShadow, rasterCanopyShadow, type ShadowCrown } from '../terrain/canopyShadow';
import { publishTrunkGrid, rasterTrunkGrid, type Trunk } from '../terrain/trunkGrid';
import type { VegPlacement } from './placement';
import { VARIANT_DEFS, variantPlan } from './variants';

/** Trees drop a full litter layer under their crowns; bushes a thinner one. Conifers (spruce, pine, juniper) shed needles. */
const TREE_STRENGTH = 1;
const BUSH_STRENGTH = 0.45;
const MIN_RADIUS = 1.2;

function* crowns(place: VegPlacement): Generator<CoverCrown> {
  const p = place.plants;
  const out: CoverCrown = { x: 0, z: 0, radius: 0, strength: 0, conifer: false };
  for (let i = 0; i < p.count; i++) {
    const def = VARIANT_DEFS[p.variant[i]];
    if (def.group === 'rock') continue;
    const plan = variantPlan(p.variant[i]);
    out.x = p.pos[i * 3];
    out.z = p.pos[i * 3 + 2];
    out.radius = Math.max((plan ? Math.max(plan.crownR[0], plan.crownR[2]) : 0.25 * def.height) * p.scale[i], MIN_RADIUS);
    out.strength = def.group === 'tree' ? TREE_STRENGTH : BUSH_STRENGTH;
    out.conifer = /^(spruce|pine|juniper)/.test(def.name);
    yield out;
  }
}

function* trunks(place: VegPlacement): Generator<Trunk> {
  const p = place.plants;
  const out: Trunk = { x: 0, z: 0, radius: 0, conifer: false };
  for (let i = 0; i < p.count; i++) {
    const def = VARIANT_DEFS[p.variant[i]];
    const plan = variantPlan(p.variant[i]);
    if (def.group !== 'tree' || !plan) continue;
    out.x = p.pos[i * 3];
    out.z = p.pos[i * 3 + 2];
    out.radius = plan.trunkRadius * p.scale[i];
    out.conifer = /^(spruce|pine|juniper)/.test(def.name);
    yield out;
  }
}

/**
 * Publishes the forest-floor cover of this placement for the terrain shader (see groundCover.ts) and returns it, along with the trunk
 * grid the ground at each tree's foot is drawn from (see trunkGrid.ts). With a track (outside the park, whose lawns are kept) the cover
 * also carries the distance to its racing line, for the worn ground of the course. Reads the placement and the track only.
 */
export function publishForestFloor(terrain: TerrainData, place: VegPlacement, track: TrackData | null = null): Uint8Array {
  const cover = rasterGroundCover(terrain, crowns(place));
  if (track && !track.parkMap && track.path.length > 1) bakeTrackDistance(terrain, track.path, track.closed, cover);
  publishGroundCover(terrain, cover);
  publishTrunkGrid(terrain, rasterTrunkGrid(terrain, trunks(place)));
  return cover;
}

/**
 * Leaf area density (one-sided leaf area per crown volume, times the leaf projection 0.5 and a clumping index, 1/m) by crown type: a broadleaf
 * crown 8 m deep then passes about 3% of the sun through its core and a conifer's denser one less; the shadow kernel cuts the clump gaps that
 * let sunflecks through (rt/shadow.wgsl).
 */
const LEAF_DENSITY_BROADLEAF = 0.45;
const LEAF_DENSITY_CONIFER = 0.6;
const LEAF_DENSITY_BUSH = 0.4;

function* shadowCrowns(place: VegPlacement): Generator<ShadowCrown> {
  const p = place.plants;
  const out: ShadowCrown = { x: 0, y: 0, z: 0, cx: 0, cy: 0, cz: 0, rx: 0, ry: 0, rz: 0, density: 0 };
  for (let i = 0; i < p.count; i++) {
    const def = VARIANT_DEFS[p.variant[i]];
    const plan = variantPlan(p.variant[i]);
    if (def.group === 'rock' || !plan) continue;
    const s = p.scale[i], c = Math.cos(p.yaw[i]), sn = Math.sin(p.yaw[i]);
    out.x = p.pos[i * 3]; out.y = p.pos[i * 3 + 1]; out.z = p.pos[i * 3 + 2];
    // The crown offset turns with the instance's yaw, as yawRotate does in the vegetation shaders.
    out.cx = (c * plan.crownC[0] + sn * plan.crownC[2]) * s;
    out.cy = plan.crownC[1] * s;
    out.cz = (-sn * plan.crownC[0] + c * plan.crownC[2]) * s;
    out.rx = plan.crownR[0] * s; out.ry = plan.crownR[1] * s; out.rz = plan.crownR[2] * s;
    out.density = def.group === 'bush' ? LEAF_DENSITY_BUSH : /^(spruce|pine|juniper)/.test(def.name) ? LEAF_DENSITY_CONIFER : LEAF_DENSITY_BROADLEAF;
    yield out;
  }
}

/** Publishes the crowns of this placement as the sun-shadow canopy map (see canopyShadow.ts). Reads the placement only. */
export function publishCanopyShadowOf(terrain: TerrainData, place: VegPlacement): void {
  publishCanopyShadow(terrain, rasterCanopyShadow(terrain, shadowCrowns(place)));
}
