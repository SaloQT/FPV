import type { ObstacleCollider, Vec3 } from '../../contracts';
import { isExtreme, type FrameInfo, type RenderContext, type RenderModule, type SceneData } from '../contracts';
import { RT_CAMERA_RERANK, RT_CAMERA_WITHIN, buildColliders, buildRtProxies, cameraShare, forestRtCap } from './colliders';
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
import { VegetationRenderBundle } from './renderBundle';
import { parkCanopyProxies, parkWoodProxies, prependParkPlantings, tierPlantCount } from './parkPlanting';
import { publishCanopyShadowOf, publishForestFloor } from './forestFloor';

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
  const renderBundle = new VegetationRenderBundle();
  const drawVegetation = (pass: GPURenderBundleEncoder): void => {
    grass?.encodeGBuffer(pass);
    trees?.encodeGBuffer(pass);
    far?.encodeGBuffer(pass);
  };
  const camXZ: [number, number] = [0, 0];
  const devReadback = import.meta.env.DEV;

  let scene: SceneData | null = null;
  let paramsBuf: GPUBuffer | null = null;
  let grass: GrassSystem | null = null;
  let grassPipes: GrassPipelines | null = null;
  let assets: TreeAssets | null = null;
  let assetsPending = false;
  let trees: TreeSystem | null = null;
  let far: FarCanopy | null = null;
  let farPipe: FarCanopyPipeline | null = null;
  let farUncovered = 0;
  let built: VegPlan | null = null;
  let place: VegPlacement | null = null;
  let parkPlantCount = 0;
  let colliders: ObstacleCollider[] = [];
  let rtCount = 0;
  /** The forest alone (before the park plantings are merged in), the cap its RT proxies were built for and the registry version seen then. */
  let forestPlace: VegPlacement | null = null;
  let rtCap = -1, rtSeen = -1, rtExtreme = false;
  /** Plants and rocks the race-line set has (proxyKey), the camera set's budget, and where the camera was when its set was last ranked. */
  let lineTaken = new Set<number>();
  let cameraTaken = new Set<number>();
  let cameraBudget = 0;
  /** The tree slot of each placed plant (park plantings first), from the last instance pack. */
  let plantSlots: Uint32Array | null = null;

  /**
   * Tells the tree shader which trees have GI proxies (park plantings, the race-line set, the camera's round): the others have nothing for
   * the GI rays from their leaves to hit, so they take their crown's full baked occlusion (tree.wgsl crownAo).
   */
  function publishProxied(ctx: RenderContext): void {
    if (!trees || !plantSlots) return;
    const bits = new Uint32Array(Math.ceil(trees.slots / 32));
    plantSlots.forEach((slot, j) => {
      const forest = j - parkPlantCount;
      if (forest < 0 || lineTaken.has(forest) || cameraTaken.has(forest)) bits[slot >> 5] |= 1 << (slot & 31);
    });
    trees.setProxied(ctx, bits);
  }
  let cameraFocus: Vec3 | null = null;
  let treeCount = 0, bushCount = 0, rockCount = 0;
  const treeParams = { ...TREE_TIER.medium, slots: 0, draws: DRAW_COUNT };

  /**
   * The vegetation's RT proxies: the park plantings' and, within what the other static groups (park, track) leave under MAX_PRIMS, the
   * forest's: about the start at ultra and below; at the extreme tier every plant along the race line (static), plus the plants round the
   * camera that the line set leaves out (a dynamic group, re-ranked every RT_CAMERA_RERANK metres, so lone trees and views off the line
   * are covered too and moving it never rebuilds the static tree). Rebuilt when the tier or the other groups change the budget.
   */
  function publishRt(ctx: RenderContext, camera?: Vec3): void {
    if (!scene || !forestPlace) return;
    const extreme = isExtreme(ctx.quality);
    if (ctx.rt.version !== rtSeen || extreme !== rtExtreme) {
      const parkProxies = [...parkCanopyProxies(scene.park?.park.plantings), ...parkWoodProxies(scene.park?.park.plantings)];
      const cap = forestRtCap(extreme, ctx.rt.allStatic().length - rtCount + parkProxies.length);
      const camera = extreme ? cameraShare(cap) : 0, line = cap - camera;
      if (line !== rtCap || extreme !== rtExtreme) {
        rtCap = line; rtExtreme = extreme; cameraBudget = camera; cameraFocus = null;
        lineTaken = new Set<number>();
        const proxies = buildRtProxies(forestPlace, sceneFocus(scene), line, { alongLine: extreme, taken: lineTaken });
        proxies.push(...parkProxies);
        rtCount = proxies.length;
        ctx.rt.setStatic('vegetation', proxies);
        if (!extreme) { ctx.rt.remove('vegetation-camera'); cameraTaken = new Set<number>(); }
        publishProxied(ctx);
      }
    }
    if (extreme && cameraBudget > 0 && camera && (!cameraFocus || Math.hypot(camera[0] - cameraFocus[0], camera[2] - cameraFocus[2]) > RT_CAMERA_RERANK)) {
      cameraFocus = [camera[0], camera[1], camera[2]];
      cameraTaken = new Set<number>();
      ctx.rt.setDynamic('vegetation-camera', buildRtProxies(forestPlace, cameraFocus, cameraBudget, { within: RT_CAMERA_WITHIN, skip: lineTaken, taken: cameraTaken }));
      publishProxied(ctx);
    }
    rtSeen = ctx.rt.version;
  }

  function rebuildGrass(ctx: RenderContext): void {
    renderBundle.invalidate();
    grass?.destroy();
    grass = paramsBuf && grassPipes ? new GrassSystem(ctx, grassPipes, paramsBuf, devReadback) : null;
  }

  function rebuildTrees(ctx: RenderContext): void {
    renderBundle.invalidate();
    trees?.destroy();
    trees = null;
    treeCount = bushCount = rockCount = 0;
    if (!paramsBuf || !assets || !place) return;
    const limits = TIER_LIMITS[ctx.quality.tier];
    const plantCount = tierPlantCount(place, limits.plants, parkPlantCount);
    const rocks = Math.min(limits.rocks, place.rocks.count);
    for (let i = 0; i < plantCount; i++) {
      if (assets.variants[place.plants.variant[i]].def.group === 'tree') treeCount++;
      else bushCount++;
    }
    rockCount = rocks;
    const packed = packInstances([{ set: place.plants, count: plantCount }, { set: place.rocks, count: rocks }], assets.variants);
    trees = new TreeSystem(ctx, assets, paramsBuf, packed, devReadback);
    plantSlots = packed.runSlots[0];
    publishProxied(ctx);
  }

  function rebuildFar(ctx: RenderContext): void {
    renderBundle.invalidate();
    far?.destroy();
    far = null;
    farUncovered = 0;
    if (!paramsBuf || !farPipe || !place || !scene) return;
    const q = ctx.quality;
    const limits = TIER_LIMITS[q.tier];
    // The real trees are a nearest-first prefix: complete out to the walk ring of their last tree (or the whole region when the cap was not reached).
    const n = tierPlantCount(place, limits.plants, parkPlantCount);
    const coveredRing = n - parkPlantCount < limits.plants ? REGION_RADIUS : place.plantRing[n - 1] - COARSE;
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
      renderBundle.invalidate();
      paramsBuf = ctx.device.createBuffer({ label: 'vegetation-params', size: VEG_PARAM_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      // The far-canopy and grass pipelines start compiling before the trees load, the trees' once they have; ready() waits for all of them.
      farPipe = new FarCanopyPipeline(ctx);
      grassPipes = new GrassPipelines(ctx);
      assets = await TreeAssets.create(ctx);
      built = vegPlan(ctx.quality);
      rebuildGrass(ctx);
    },

    async ready() {
      await Promise.all([assets?.ready, farPipe?.ready, grassPipes?.ready]);
    },

    setScene(ctx: RenderContext, s: SceneData) {
      scene = s;
      place = placeVegetation(s.terrain, s.track, TIER_LIMITS.ultra);
      // Park trunks have authoritative per-limb collision in ParkRuntime. Build
      // forest boxes before adding its explicit trees, avoiding duplicate boxes.
      colliders = buildColliders(place);
      grassPipes?.setCover(publishForestFloor(s.terrain, place, s.track));
      forestPlace = place;
      rtCap = -1;
      publishRt(ctx);
      const merged = prependParkPlantings(place, s.park?.park.plantings);
      place = merged.placement; parkPlantCount = merged.count;
      publishCanopyShadowOf(s.terrain, place);
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
      // Entering or leaving the extreme tier swaps the tree meshes for the dense-crowned set (or back); the old ones draw until the new are built.
      if (assets && !assetsPending && assets.dense !== isExtreme(ctx.quality)) {
        assetsPending = true;
        void TreeAssets.create(ctx).then((next) => {
          assetsPending = false;
          if (!paramsBuf) { next.destroy(); return; }
          const old = assets;
          assets = next;
          rebuildTrees(ctx);
          old?.destroy();
        }, () => { assetsPending = false; });
      }
      publishRt(ctx, f.camera.pos);
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
        parkRadius: scene.track?.parkMap?.radius ?? 0,
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
      if (grass && trees && trees.slots > 0) {
        // Their writable buffers are disjoint; clear both before the shared pass and keep every
        // dispatch in its original order. Dev-only copies can follow both systems' dispatches.
        grass.clearCounters(enc);
        trees.clearCounters(enc);
        const pass = enc.beginComputePass({ label: 'vegetation-cull' });
        grass.encodeCull(pass, ctx);
        trees.encodeCull(pass, ctx);
        pass.end();
        grass.copyCounters(enc);
        trees.copyCounters(enc);
        return;
      }
      grass?.encodePre(enc, ctx);
      trees?.encodePre(enc, ctx);
    },

    encodeGBuffer(pass: GPURenderPassEncoder, ctx: RenderContext) {
      if (!scene) return;
      renderBundle.encode(pass, ctx, drawVegetation);
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
      renderBundle.invalidate();
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
