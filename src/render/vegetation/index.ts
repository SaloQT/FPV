import type { ObstacleCollider, Vec3 } from '../../contracts';
import type { FrameInfo, RenderContext, RenderModule, SceneData } from '../contracts';
import { buildColliders, buildRtProxies } from './colliders';
import { FarCanopy, FarCanopyPipeline } from './farCanopy';
import { GrassPipelines, GrassSystem } from './grass';
import { packInstances } from './instanceData';
import { FAR_TIER, FAR_UNCOVERED_NEAR, VEG_PARAM_BYTES, TREE_TIER, createParamViews, packVegParams } from './params';
import { REGION_RADIUS, TIER_LIMITS, placeVegetation, type VegPlacement } from './placement';
import { diffPlans, vegPlan, type VegPlan } from './placementPlan';
import { COARSE } from './region';
import { TreeAssets } from './treeAssets';
import { placeFarForest } from './treePlanFar';
import { TreeSystem } from './treeSystem';
import { DRAW_COUNT } from './variants';

export interface VegetationStats {
  /** Grass blades appended by the last sampled cull, all LODs. Null until the first async counter readback (dev builds only). */
  grassInstances: number | null;
  grassPatches: number | null;
  grassLod: [number, number, number] | null;
  /** Instance capacity of the grass buffer, all LODs, and its size in bytes. */
  grassCapacity: number;
  grassBytes: number;
  /** Placed trees, bushes and rocks for the current quality tier (a tier is an exact prefix of the ultra placement). */
  trees: number;
  bushes: number;
  rocks: number;
  /** Trees and bushes / rocks drawn per LOD in the last sampled cull; null until the first readback (dev builds only). */
  treeLod: [number, number, number] | null;
  rockLod: [number, number, number] | null;
  /** Instance slots and GPU bytes of the tree and rock buffers, and the static mesh bytes shared by all tiers. */
  treeSlots: number;
  treeBytes: number;
  meshBytes: number;
  /** Triangles of every (variant, LOD) mesh, variant-major (12 variants x 3 LODs). */
  meshTriangles: number[];
  colliders: number;
  rtPrimitives: number;
  /** Far-field canopy cards (billboards for trees beyond the real-tree draw distance and over ground the tree cap left bare): placed, of those over bare ground, GPU bytes and the triangles drawn at most (2 per card). */
  farCards: number;
  farUncovered: number;
  farBytes: number;
  farTriangles: number;
}

export type VegetationModule = RenderModule & {
  /** Feeds the prop wash and trample bend for this frame (call every frame; otherwise the wash follows FrameInfo.quad). */
  setQuad(pos: Vec3, vel: Vec3, thrust: number): void;
  setWind(dirXZ: [number, number], speed: number): void;
  /** Trunk boxes of the trees along the racing line and boulders next to it; a fresh array of the same deterministic boxes each call. */
  vegetationColliders(): ObstacleCollider[];
  stats(): VegetationStats;
};

const THRUST_PER_OMEGA2 = 1.1e-6;
const DEFAULT_WIND_DIR: [number, number] = [0.8, 0.6];
const DEFAULT_WIND_SPEED = 4;

export function createVegetationModule(): VegetationModule {
  const views = createParamViews();
  const wind = { dir: [DEFAULT_WIND_DIR[0], DEFAULT_WIND_DIR[1]] as [number, number], speed: DEFAULT_WIND_SPEED };
  const quadIn = { pos: [0, 0, 0] as Vec3, vel: [0, 0, 0] as Vec3, thrust: 0 };
  const quadUse = { pos: [0, 0, 0] as Vec3, vel: [0, 0, 0] as Vec3, thrust: 0 };
  let quadPending = false;
  const camXZ: [number, number] = [0, 0];
  const devReadback = import.meta.env.DEV;

  let scene: SceneData | null = null;
  let paramsBuf: GPUBuffer | null = null;
  let grass: GrassSystem | null = null;
  let grassPipes: GrassPipelines | null = null;
  let assets: TreeAssets | null = null;
  let trees: TreeSystem | null = null;
  let far: FarCanopy | null = null;
  let farPipe: FarCanopyPipeline | null = null;
  let farUncovered = 0;
  let built: VegPlan | null = null;
  let place: VegPlacement | null = null;
  let colliders: ObstacleCollider[] = [];
  let rtCount = 0;
  let treeCount = 0, bushCount = 0, rockCount = 0;
  const treeParams = { ...TREE_TIER.medium, slots: 0, draws: DRAW_COUNT };

  function rebuildGrass(ctx: RenderContext): void {
    grass?.destroy();
    grass = paramsBuf && grassPipes ? new GrassSystem(ctx, grassPipes, paramsBuf, devReadback) : null;
  }

  function rebuildTrees(ctx: RenderContext): void {
    trees?.destroy();
    trees = null;
    treeCount = bushCount = rockCount = 0;
    if (!paramsBuf || !assets || !place) return;
    const limits = TIER_LIMITS[ctx.quality.tier];
    const plantCount = Math.min(limits.plants, place.plants.count);
    const rocks = Math.min(limits.rocks, place.rocks.count);
    for (let i = 0; i < plantCount; i++) {
      if (assets.variants[place.plants.variant[i]].def.group === 'tree') treeCount++;
      else bushCount++;
    }
    rockCount = rocks;
    const packed = packInstances([{ set: place.plants, count: plantCount }, { set: place.rocks, count: rocks }], assets.variants);
    trees = new TreeSystem(ctx, assets, paramsBuf, packed, devReadback);
  }

  function rebuildFar(ctx: RenderContext): void {
    far?.destroy();
    far = null;
    farUncovered = 0;
    if (!paramsBuf || !farPipe || !place || !scene) return;
    const q = ctx.quality;
    const limits = TIER_LIMITS[q.tier];
    // The real trees are a nearest-first prefix: complete out to the walk ring of their last tree (or the whole region when the cap was not reached).
    const n = Math.min(limits.plants, place.plants.count);
    const coveredRing = n < limits.plants ? REGION_RADIUS : place.plantRing[n - 1] - COARSE;
    const forest = placeFarForest(scene.terrain, scene.track, { cap: FAR_TIER[q.tier].cards, radius: q.terrainViewDistance, coveredRing, uncoveredNear: FAR_UNCOVERED_NEAR });
    farUncovered = forest.uncovered;
    far = new FarCanopy(ctx, farPipe, paramsBuf, forest);
  }

  function currentQuad(f: FrameInfo): typeof quadUse | null {
    if (quadPending) {
      quadPending = false;
      quadUse.pos = quadIn.pos; quadUse.vel = quadIn.vel; quadUse.thrust = quadIn.thrust;
      return quadUse;
    }
    const q = f.quad;
    if (!q) return null;
    const w = q.motorOmega;
    quadUse.pos = q.pos;
    quadUse.vel = q.vel;
    quadUse.thrust = q.armed ? THRUST_PER_OMEGA2 * (w[0] * w[0] + w[1] * w[1] + w[2] * w[2] + w[3] * w[3]) : 0;
    return quadUse;
  }

  function sceneFocus(s: SceneData): Vec3 {
    if (s.track) return s.track.start.pos;
    const t = s.terrain, extent = (t.resolution - 1) * t.cellSize;
    return [t.origin[0] + extent / 2, 0, t.origin[1] + extent / 2];
  }

  const mod: VegetationModule = {
    name: 'vegetation',

    async init(ctx: RenderContext) {
      paramsBuf = ctx.device.createBuffer({ label: 'vegetation-params', size: VEG_PARAM_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      assets = await TreeAssets.create(ctx);
      farPipe = new FarCanopyPipeline(ctx);
      grassPipes = new GrassPipelines(ctx);
      built = vegPlan(ctx.quality);
      rebuildGrass(ctx);
    },

    setScene(ctx: RenderContext, s: SceneData) {
      scene = s;
      place = placeVegetation(s.terrain, s.track, TIER_LIMITS.ultra);
      colliders = buildColliders(place);
      const proxies = buildRtProxies(place, sceneFocus(s));
      rtCount = proxies.length;
      ctx.rt.setStatic('vegetation', proxies);
      const now = vegPlan(ctx.quality);
      built = built ? { ...now, grassBladesPerM2: built.grassBladesPerM2, grassDistance: built.grassDistance } : now;
      rebuildTrees(ctx);
      rebuildFar(ctx);
    },

    update(ctx: RenderContext, f: FrameInfo) {
      if (!paramsBuf || !scene) return;
      // Compared on the resolved profile, not the tier: Performance 240 keeps the tier but thins the grass.
      const now = vegPlan(ctx.quality);
      const redo = diffPlans(built, now);
      built = now;
      if (redo.grass) rebuildGrass(ctx);
      if (redo.trees) rebuildTrees(ctx);
      if (redo.far) rebuildFar(ctx);
      if (!grass) return;
      grass.pollReadback();
      trees?.pollReadback();
      const t = scene.terrain;
      camXZ[0] = f.camera.pos[0]; camXZ[1] = f.camera.pos[2];
      Object.assign(treeParams, TREE_TIER[ctx.quality.tier]);
      treeParams.slots = trees ? trees.slots : 0;
      packVegParams(views, {
        windDir: wind.dir,
        windSpeed: wind.speed,
        quad: currentQuad(f),
        budget: grass.budget,
        waterLevel: t.waterLevel,
        seed: t.seed,
        cameraXZ: camXZ,
        tree: treeParams,
        farDistance: built ? built.farDistance : 0,
      });
      ctx.device.queue.writeBuffer(paramsBuf, 0, views.u32);
    },

    encodePre(enc: GPUCommandEncoder, ctx: RenderContext) {
      if (!scene) return;
      grass?.encodePre(enc, ctx);
      trees?.encodePre(enc, ctx);
    },

    encodeGBuffer(pass: GPURenderPassEncoder) {
      if (!scene) return;
      grass?.encodeGBuffer(pass);
      trees?.encodeGBuffer(pass);
      far?.encodeGBuffer(pass);
    },

    setQuad(pos: Vec3, vel: Vec3, thrust: number) {
      quadIn.pos = pos; quadIn.vel = vel; quadIn.thrust = thrust;
      quadPending = true;
    },

    setWind(dirXZ: [number, number], speed: number) {
      wind.dir[0] = dirXZ[0]; wind.dir[1] = dirXZ[1]; wind.speed = speed;
    },

    vegetationColliders(): ObstacleCollider[] {
      return colliders.slice();
    },

    stats(): VegetationStats {
      const c = grass?.counts;
      const sampled = !!grass && grass.sampled;
      const tc = trees?.counts;
      const treesSampled = !!trees && trees.sampled;
      return {
        grassInstances: sampled && c ? c.lod[0] + c.lod[1] + c.lod[2] : null,
        grassPatches: sampled && c ? c.patches : null,
        grassLod: sampled && c ? [c.lod[0], c.lod[1], c.lod[2]] : null,
        grassCapacity: grass ? grass.budget.caps[0] + grass.budget.caps[1] + grass.budget.caps[2] : 0,
        grassBytes: grass ? grass.budget.bladeBytes : 0,
        trees: treeCount,
        bushes: bushCount,
        rocks: rockCount,
        treeLod: treesSampled && tc ? [tc.plantLod[0], tc.plantLod[1], tc.plantLod[2]] : null,
        rockLod: treesSampled && tc ? [tc.rockLod[0], tc.rockLod[1], tc.rockLod[2]] : null,
        treeSlots: trees ? trees.slots : 0,
        treeBytes: trees ? trees.bufferBytes : 0,
        meshBytes: assets ? assets.vertexBytes + assets.indexBytes : 0,
        meshTriangles: assets ? assets.triangles.slice() : [],
        colliders: colliders.length,
        rtPrimitives: rtCount,
        farCards: far ? far.cards : 0,
        farUncovered,
        farBytes: far ? far.bytes : 0,
        farTriangles: far ? 2 * far.cards : 0,
      };
    },

    destroy() {
      grass?.destroy();
      trees?.destroy();
      far?.destroy();
      assets?.destroy();
      paramsBuf?.destroy();
      grass = null;
      trees = null;
      far = null;
      assets = null;
      farPipe = null;
      grassPipes = null;
      paramsBuf = null;
    },
  };
  return mod;
}
