import type { FrameInfo, RenderContext, RenderModule, SceneData } from '../contracts';
import { DEPTH_STATE, GBUFFER_TARGETS, isExtreme } from '../contracts';
import { Clipmap, EXTREME_RING_HALF, Frustum, MAX_TILES, RING_QUADS, TILE_BYTES, TILE_FLOATS, buildTileIndices, drawnLevels } from './clipmap';
import { createDetailTextures, type DetailTextures } from './detailTextures';
import { WaterMask } from './waterMask';
import { TilePayload } from './tilePayload';
import { GROUND_COVER_SIZE, groundCoverFor } from './groundCover';
import { TRUNK_GRID_SIZE, trunkGridFor } from './trunkGrid';
import type { TerrainData } from '../../contracts';

export interface TerrainStats {
  /** Clipmap levels drawn and tiles that survived frustum culling (terrain / water). */
  levels: number;
  terrainTiles: number;
  waterTiles: number;
  culledTiles: number;
  /** Distinct grid vertices shaded by the vertex stage (17 x 17 per tile) and triangles rasterised. */
  vertices: number;
  triangles: number;
  draws: number;
}

export type TerrainModule = RenderModule & {
  /** 0 shaded, 1 clipmap level and grid, 2 slope, 3 layer weights (RGB), 4 wetness, 5 forest-floor cover, 6 flow. */
  setDebugView(mode: number): void;
  readonly stats: Readonly<TerrainStats>;
};

const INDEX_COUNT = 16 * 16 * 6;
const VERTS_PER_TILE = 17 * 17;
const NO_WATER = -1e9;

export function createTerrainModule(): TerrainModule {
  let device: GPUDevice | null = null;
  let tileBuf: GPUBuffer | null = null;
  let paramsBuf: GPUBuffer | null = null;
  let indexBuf: GPUBuffer | null = null;
  let group: GPUBindGroup | null = null;
  let terrainPipe: GPURenderPipeline | null = null;
  let waterPipe: GPURenderPipeline | null = null;
  let pending: Promise<void> | null = null;
  let detail: DetailTextures | null = null;
  let coverTex: GPUTexture | null = null;
  // Trunk positions for the ground at the foot of each tree (trunkGrid.ts); uploaded with the cover.
  let trunkTex: GPUTexture | null = null;
  // The terrain whose forest-floor cover is in coverTex (null: cleared to bare ground).
  let coverFor: TerrainData | null = null;

  const clipmap = new Clipmap();
  const frustum = new Frustum();
  const payload = new TilePayload(clipmap.tiles);
  const paramsF = new Float32Array(8);
  const paramsU = new Uint32Array(paramsF.buffer);
  const stats: TerrainStats = { levels: 0, terrainTiles: 0, waterTiles: 0, culledTiles: 0, vertices: 0, triangles: 0, draws: 0 };

  let terrain: TerrainData | null = null;
  let parkRadius = 0;
  let mask: WaterMask | null = null;
  let debugMode = 0;

  const mod: TerrainModule = {
    name: 'terrain',
    stats,

    init(rc: RenderContext) {
      const dev = rc.device;
      device = dev;
      payload.invalidate();
      detail = createDetailTextures(rc);
      coverTex = dev.createTexture({ label: 'terrain-ground-cover', size: [GROUND_COVER_SIZE, GROUND_COVER_SIZE], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
      trunkTex = dev.createTexture({ label: 'terrain-trunk-grid', size: [TRUNK_GRID_SIZE, TRUNK_GRID_SIZE], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
      coverFor = null;
      tileBuf = dev.createBuffer({ label: 'terrain-tiles', size: 2 * MAX_TILES * TILE_BYTES, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
      paramsBuf = dev.createBuffer({ label: 'terrain-params', size: paramsF.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      const indices = buildTileIndices();
      indexBuf = dev.createBuffer({ label: 'terrain-tile-indices', size: indices.byteLength, usage: GPUBufferUsage.INDEX, mappedAtCreation: true });
      new Uint16Array(indexBuf.getMappedRange()).set(indices);
      indexBuf.unmap();

      const both = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT;
      const layout2 = dev.createBindGroupLayout({
        label: 'terrain-group2',
        entries: [
          { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
          { binding: 1, visibility: both, buffer: { type: 'uniform' } },
          { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float', viewDimension: '2d-array' } },
          { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float', viewDimension: '2d-array' } },
          { binding: 4, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
          { binding: 5, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
          { binding: 6, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        ],
      });
      group = dev.createBindGroup({
        label: 'terrain-group2',
        layout: layout2,
        entries: [
          { binding: 0, resource: { buffer: tileBuf } },
          { binding: 1, resource: { buffer: paramsBuf } },
          { binding: 2, resource: detail.viewA },
          { binding: 3, resource: detail.viewB },
          { binding: 4, resource: detail.sampler },
          { binding: 5, resource: coverTex.createView() },
          { binding: 6, resource: trunkTex.createView() },
        ],
      });
      const pipelineLayout = dev.createPipelineLayout({ bindGroupLayouts: [rc.frame.layout, rc.world.layout, layout2] });
      const make = (path: string, label: string): Promise<GPURenderPipeline> => {
        const module = rc.module(path);
        return dev.createRenderPipelineAsync({
          label,
          layout: pipelineLayout,
          vertex: { module, entryPoint: 'vs' },
          fragment: { module, entryPoint: 'fs', targets: GBUFFER_TARGETS },
          primitive: { topology: 'triangle-list', cullMode: 'back', frontFace: 'cw' },
          depthStencil: DEPTH_STATE,
        });
      };
      // Both compile in the background (ready), overlapping the later modules' start-up, as the detail textures' pipelines do.
      const textures = detail;
      pending = Promise.all([make('terrain/terrain.wgsl', 'terrain'), make('terrain/water.wgsl', 'terrain-water'), textures.ready]).then(([t, w]) => {
        if (detail !== textures) return; // destroyed (or initialised again) meanwhile
        terrainPipe = t;
        waterPipe = w;
      });
    },

    ready() {
      return pending ?? Promise.resolve();
    },

    setScene(_rc: RenderContext, scene: SceneData) {
      terrain = scene.terrain;
      parkRadius = scene.track?.parkMap?.radius ?? 0;
      payload.invalidate();
      const t = scene.terrain;
      mask = new WaterMask(t.height, t.resolution, t.cellSize, t.origin, t.minHeight, t.maxHeight, t.waterLevel);
    },

    update(rc: RenderContext, f: FrameInfo) {
      stats.terrainTiles = 0;
      stats.waterTiles = 0;
      if (!terrain || !device || !tileBuf || !paramsBuf) return;
      const t = terrain;
      // The vegetation module publishes the cover when it places the trees, which may come before or after this module's setScene.
      if (coverFor !== t && coverTex) {
        const cover = groundCoverFor(t);
        if (cover) {
          device.queue.writeTexture({ texture: coverTex }, cover as Uint8Array<ArrayBuffer>, { bytesPerRow: GROUND_COVER_SIZE * 4 }, [GROUND_COVER_SIZE, GROUND_COVER_SIZE]);
          const trunks = trunkGridFor(t);
          if (trunks && trunkTex) device.queue.writeTexture({ texture: trunkTex }, trunks as Uint8Array<ArrayBuffer>, { bytesPerRow: TRUNK_GRID_SIZE * 4 }, [TRUNK_GRID_SIZE, TRUNK_GRID_SIZE]);
          coverFor = t;
        }
      }
      const q = rc.quality;
      // Extreme draws every level at twice the reach, so the mesh is one level finer at every distance (about twice the tiles).
      clipmap.ringHalf = isExtreme(q) ? EXTREME_RING_HALF : RING_QUADS / 2;
      const levels = drawnLevels(t.cellSize, q.terrainViewDistance, clipmap.ringHalf);
      const cam = f.camera;
      frustum.setFromCamera(cam.pos, cam.quat, cam.fovY, cam.aspect);
      const count = clipmap.build(cam.pos[0], cam.pos[2], t.origin[0], t.origin[1], t.cellSize, levels, t.minHeight, t.maxHeight, frustum);
      const changed = payload.update(count, t.origin[0], t.origin[1], mask);
      const water = payload.waterCount;
      if (changed) device.queue.writeBuffer(tileBuf, 0, payload.data, 0, (count + water) * TILE_FLOATS);

      paramsF[0] = mask && mask.enabled ? t.waterLevel : NO_WATER;
      paramsF[1] = f.time;
      paramsU[2] = debugMode;
      paramsU[3] = q.detailOctaves;
      // Bit 0: steep-surface projections. Bit 1: extreme tier, parallax relief on the ground near the camera.
      paramsU[4] = (q.tier === 'low' ? 0 : 1) | (isExtreme(q) ? 2 : 0);
      paramsF[5] = parkRadius;
      paramsF[6] = clipmap.ringHalf;
      device.queue.writeBuffer(paramsBuf, 0, paramsF);

      stats.levels = levels;
      stats.terrainTiles = count;
      stats.waterTiles = water;
      stats.culledTiles = clipmap.stats.culledTiles;
      stats.vertices = (count + water) * VERTS_PER_TILE;
      stats.triangles = (clipmap.stats.quads + payload.waterQuads) * 2;
      stats.draws = (count > 0 ? 1 : 0) + (water > 0 ? 1 : 0);
    },

    encodeGBuffer(pass: GPURenderPassEncoder) {
      const count = stats.terrainTiles;
      if (count === 0 || !terrainPipe || !waterPipe || !indexBuf || !group) return;
      pass.setIndexBuffer(indexBuf, 'uint16');
      pass.setBindGroup(2, group);
      pass.setPipeline(terrainPipe);
      pass.drawIndexed(INDEX_COUNT, count, 0, 0, 0);
      if (stats.waterTiles > 0) {
        pass.setPipeline(waterPipe);
        pass.drawIndexed(INDEX_COUNT, stats.waterTiles, 0, 0, count);
      }
    },

    setDebugView(mode: number) {
      debugMode = Math.max(0, Math.min(6, Math.trunc(mode)));
    },

    destroy() {
      tileBuf?.destroy();
      paramsBuf?.destroy();
      indexBuf?.destroy();
      detail?.destroy();
      coverTex?.destroy();
      trunkTex?.destroy();
      trunkTex = null;
      coverTex = null;
      coverFor = null;
      tileBuf = paramsBuf = indexBuf = null;
      detail = null;
      group = null;
      terrainPipe = waterPipe = null;
    },
  };

  return mod;
}
