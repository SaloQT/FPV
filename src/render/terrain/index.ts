import type { FrameInfo, RenderContext, RenderModule, SceneData } from '../contracts';
import { DEPTH_STATE, GBUFFER_TARGETS } from '../contracts';
import { Clipmap, Frustum, MAX_TILES, TILE_BYTES, TILE_FLOATS, buildTileIndices, levelCount } from './clipmap';
import { createDetailTextures, type DetailTextures } from './detailTextures';
import { WaterMask } from './waterMask';
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
  /** 0 shaded, 1 clipmap level and grid, 2 slope, 3 layer weights (RGB), 4 wetness. */
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
  let detail: DetailTextures | null = null;

  const clipmap = new Clipmap();
  const frustum = new Frustum();
  const tileData = new Float32Array(2 * MAX_TILES * TILE_FLOATS);
  const paramsF = new Float32Array(8);
  const paramsU = new Uint32Array(paramsF.buffer);
  const stats: TerrainStats = { levels: 0, terrainTiles: 0, waterTiles: 0, culledTiles: 0, vertices: 0, triangles: 0, draws: 0 };

  let terrain: TerrainData | null = null;
  let mask: WaterMask | null = null;
  let debugMode = 0;

  function copyTile(dst: number, src: Float32Array, srcTile: number): void {
    const o = dst * TILE_FLOATS, s = srcTile * TILE_FLOATS;
    for (let k = 0; k < TILE_FLOATS; k++) tileData[o + k] = src[s + k];
  }

  function collectWater(count: number, t: TerrainData, m: WaterMask): number {
    let n = 0;
    const tiles = clipmap.tiles;
    for (let i = 0; i < count; i++) {
      const o = i * TILE_FLOATS, spacing = tiles[o + 4];
      const x0 = t.origin[0] + tiles[o] * spacing, z0 = t.origin[1] + tiles[o + 1] * spacing;
      if (m.regionBelow(x0, z0, x0 + tiles[o + 2] * spacing, z0 + tiles[o + 3] * spacing)) copyTile(count + n++, tiles, i);
    }
    return n;
  }

  function waterQuads(terrainCount: number, waterCount: number): number {
    let quads = 0;
    for (let i = 0; i < waterCount; i++) quads += tileData[(terrainCount + i) * TILE_FLOATS + 2] * tileData[(terrainCount + i) * TILE_FLOATS + 3];
    return quads;
  }

  const mod: TerrainModule = {
    name: 'terrain',
    stats,

    init(rc: RenderContext) {
      const dev = rc.device;
      device = dev;
      detail = createDetailTextures(rc);
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
        ],
      });
      const pipelineLayout = dev.createPipelineLayout({ bindGroupLayouts: [rc.frame.layout, rc.world.layout, layout2] });
      const make = (path: string, label: string): GPURenderPipeline => {
        const module = rc.module(path);
        return dev.createRenderPipeline({
          label,
          layout: pipelineLayout,
          vertex: { module, entryPoint: 'vs' },
          fragment: { module, entryPoint: 'fs', targets: GBUFFER_TARGETS },
          primitive: { topology: 'triangle-list', cullMode: 'back', frontFace: 'cw' },
          depthStencil: DEPTH_STATE,
        });
      };
      terrainPipe = make('terrain/terrain.wgsl', 'terrain');
      waterPipe = make('terrain/water.wgsl', 'terrain-water');
    },

    setScene(_rc: RenderContext, scene: SceneData) {
      terrain = scene.terrain;
      const t = scene.terrain;
      mask = new WaterMask(t.height, t.resolution, t.cellSize, t.origin, t.minHeight, t.maxHeight, t.waterLevel);
    },

    update(rc: RenderContext, f: FrameInfo) {
      stats.terrainTiles = 0;
      stats.waterTiles = 0;
      if (!terrain || !device || !tileBuf || !paramsBuf) return;
      const t = terrain;
      const q = rc.quality;
      const levels = levelCount(t.cellSize, q.terrainViewDistance);
      const cam = f.camera;
      frustum.setFromCamera(cam.pos, cam.quat, cam.fovY, cam.aspect);
      const count = clipmap.build(cam.pos[0], cam.pos[2], t.origin[0], t.origin[1], t.cellSize, levels, t.minHeight, t.maxHeight, frustum);
      for (let i = 0; i < count; i++) copyTile(i, clipmap.tiles, i);
      const water = mask && mask.enabled ? collectWater(count, t, mask) : 0;
      device.queue.writeBuffer(tileBuf, 0, tileData, 0, (count + water) * TILE_FLOATS);

      paramsF[0] = mask && mask.enabled ? t.waterLevel : NO_WATER;
      paramsF[1] = f.time;
      paramsU[2] = debugMode;
      paramsU[3] = q.detailOctaves;
      paramsU[4] = q.tier === 'low' ? 0 : 1;
      device.queue.writeBuffer(paramsBuf, 0, paramsF);

      stats.levels = levels;
      stats.terrainTiles = count;
      stats.waterTiles = water;
      stats.culledTiles = clipmap.stats.culledTiles;
      stats.vertices = (count + water) * VERTS_PER_TILE;
      stats.triangles = (clipmap.stats.quads + waterQuads(count, water)) * 2;
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
      debugMode = Math.max(0, Math.min(4, Math.trunc(mode)));
    },

    destroy() {
      tileBuf?.destroy();
      paramsBuf?.destroy();
      indexBuf?.destroy();
      detail?.destroy();
      tileBuf = paramsBuf = indexBuf = null;
      detail = null;
      group = null;
      terrainPipe = waterPipe = null;
    },
  };

  return mod;
}
