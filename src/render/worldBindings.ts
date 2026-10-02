import type { TerrainData } from '../contracts';
import type { WorldBindings } from './contracts';
import { generateBlueNoiseRG8, BLUE_NOISE_SIZE } from './blueNoise';
import { toHalf } from './half';
import { buildMaxPyramid, buildNormalHorizon, packTerrainMaps } from './terrainUpload';

export const TRANSMITTANCE_LUT_SIZE = { width: 256, height: 64 } as const;
export const MULTI_SCATTER_LUT_SIZE = { width: 32, height: 32 } as const;
export const SKY_VIEW_LUT_SIZE = { width: 192, height: 108 } as const;
export const AERIAL_PERSPECTIVE_LUT_SIZE = { width: 32, height: 32, depth: 32 } as const;

// Numeric flag values (WebGPU spec) instead of the GPUShaderStage/GPUTextureUsage globals: those do not exist on a browser without
// WebGPU, and reading them at module load would blank the page before the failure panel can show.
const STAGES = 1 | 2 | 4; // VERTEX | FRAGMENT | COMPUTE
const LUT_USAGE = 4 | 8 | 16 | 2 | 1; // TEXTURE_BINDING | STORAGE_BINDING | RENDER_ATTACHMENT | COPY_DST | COPY_SRC
const DATA_USAGE = 4 | 2 | 1; // TEXTURE_BINDING | COPY_DST | COPY_SRC

type TerrainTextures = Pick<WorldBindings['tex'], 'terrainHeight' | 'terrainMaxPyr' | 'terrainNormal' | 'terrainMaps'>;

/** Nits: a plausible clear-daylight gradient so shaders that read the sky before the atmosphere module exists get something sane. */
function placeholderSkyView(): Uint16Array {
  const { width: w, height: h } = SKY_VIEW_LUT_SIZE;
  const out = new Uint16Array(w * h * 4);
  const zenith = [2400, 5000, 12000], horizon = [9000, 10500, 12500];
  for (let y = 0; y < h; y++) {
    const v = (y + 0.5) / h;
    const up = v < 0.5 ? 1 - v * 2 : 0;
    const k = v < 0.5 ? 1 : 0.3;
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) out[o + c] = toHalf((horizon[c] + (zenith[c] - horizon[c]) * up * up) * k);
      out[o + 3] = toHalf(1);
    }
  }
  return out;
}

function filledHalf(count: number, rgba: [number, number, number, number]): Uint16Array {
  const out = new Uint16Array(count * 4);
  const h = rgba.map(toHalf);
  for (let i = 0; i < count; i++) out.set(h, i * 4);
  return out;
}

/** Owns the group-1 textures/samplers. Its `group` and `tex` change when terrain size changes: never cache them across frames. */
export class WorldResources implements WorldBindings {
  readonly layout: GPUBindGroupLayout;
  group!: GPUBindGroup;
  tex: WorldBindings['tex'];
  readonly samplers: WorldBindings['samplers'];
  private terrainN = 0;

  constructor(private readonly device: GPUDevice) {
    const tex = (binding: number, sampleType: GPUTextureSampleType, viewDimension: GPUTextureViewDimension = '2d'): GPUBindGroupLayoutEntry =>
      ({ binding, visibility: STAGES, texture: { sampleType, viewDimension } });
    this.layout = device.createBindGroupLayout({
      label: 'world',
      entries: [
        { binding: 0, visibility: STAGES, sampler: { type: 'filtering' } },
        { binding: 1, visibility: STAGES, sampler: { type: 'filtering' } },
        tex(2, 'unfilterable-float'), tex(3, 'unfilterable-float'), tex(4, 'float'), tex(5, 'float'),
        tex(6, 'float'), tex(7, 'float'), tex(8, 'float'), tex(9, 'float', '3d'), tex(10, 'float'),
      ],
    });
    this.samplers = {
      linearClamp: device.createSampler({ label: 'linearClamp', magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge', addressModeW: 'clamp-to-edge' }),
      linearRepeat: device.createSampler({ label: 'linearRepeat', magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', addressModeU: 'repeat', addressModeV: 'repeat', addressModeW: 'repeat' }),
    };
    this.tex = { ...this.createTerrainTextures(1), ...this.createLuts(), blueNoise: this.createBlueNoise() };
    this.writePlaceholderTerrain();
    this.rebuildGroup();
  }

  get terrainResolution(): number { return this.terrainN; }

  /** Re-creates the bind group from the current textures; call after replacing any world texture. */
  rebuildGroup(): void {
    const t = this.tex;
    this.group = this.device.createBindGroup({
      label: 'world',
      layout: this.layout,
      entries: [
        { binding: 0, resource: this.samplers.linearClamp },
        { binding: 1, resource: this.samplers.linearRepeat },
        { binding: 2, resource: t.terrainHeight.createView() },
        { binding: 3, resource: t.terrainMaxPyr.createView() },
        { binding: 4, resource: t.terrainNormal.createView() },
        { binding: 5, resource: t.terrainMaps.createView() },
        { binding: 6, resource: t.transmittance.createView() },
        { binding: 7, resource: t.multiScatter.createView() },
        { binding: 8, resource: t.skyView.createView() },
        { binding: 9, resource: t.aerialPerspective.createView({ dimension: '3d' }) },
        { binding: 10, resource: t.blueNoise.createView() },
      ],
    });
  }

  /** Uploads height, the full max-pyramid, normal + horizon AO and material maps; recreates the terrain textures if N changed. */
  uploadTerrain(terrain: TerrainData): void {
    const n = terrain.resolution;
    if (n !== this.terrainN) {
      this.destroyTerrainTextures();
      Object.assign(this.tex, this.createTerrainTextures(n));
      this.rebuildGroup();
    }
    const q = this.device.queue, t = this.tex;
    const pyramid = buildMaxPyramid(terrain.height, n);
    pyramid.forEach((level, mip) => {
      const size = Math.max(1, n >> mip);
      q.writeTexture({ texture: t.terrainMaxPyr, mipLevel: mip }, level as Float32Array<ArrayBuffer>, { bytesPerRow: size * 4 }, { width: size, height: size });
    });
    q.writeTexture({ texture: t.terrainHeight }, terrain.height as Float32Array<ArrayBuffer>, { bytesPerRow: n * 4 }, { width: n, height: n });
    q.writeTexture({ texture: t.terrainNormal }, buildNormalHorizon(terrain.height, n, terrain.cellSize) as Uint8Array<ArrayBuffer>, { bytesPerRow: n * 4 }, { width: n, height: n });
    q.writeTexture({ texture: t.terrainMaps }, packTerrainMaps(terrain.maps, n) as Uint8Array<ArrayBuffer>, { bytesPerRow: n * 4 }, { width: n, height: n });
    this.terrainN = n;
  }

  destroy(): void {
    this.destroyTerrainTextures();
    const t = this.tex;
    for (const x of [t.transmittance, t.multiScatter, t.skyView, t.aerialPerspective, t.blueNoise]) x.destroy();
  }

  private destroyTerrainTextures(): void {
    const t = this.tex;
    for (const x of [t.terrainHeight, t.terrainMaxPyr, t.terrainNormal, t.terrainMaps]) x.destroy();
  }

  private createTerrainTextures(n: number): TerrainTextures {
    const d = this.device;
    const make = (label: string, format: GPUTextureFormat, mips: number) => d.createTexture({ label, format, size: [n, n], mipLevelCount: mips, usage: DATA_USAGE });
    return {
      terrainHeight: make('terrainHeight', 'r32float', 1),
      terrainMaxPyr: make('terrainMaxPyr', 'r32float', Math.floor(Math.log2(n)) + 1),
      terrainNormal: make('terrainNormal', 'rgba8unorm', 1),
      terrainMaps: make('terrainMaps', 'rgba8unorm', 1),
    };
  }

  private writePlaceholderTerrain(): void {
    const q = this.device.queue, t = this.tex;
    q.writeTexture({ texture: t.terrainHeight }, new Float32Array(1), { bytesPerRow: 4 }, [1, 1]);
    q.writeTexture({ texture: t.terrainMaxPyr }, new Float32Array(1), { bytesPerRow: 4 }, [1, 1]);
    q.writeTexture({ texture: t.terrainNormal }, new Uint8Array([128, 255, 128, 255]), { bytesPerRow: 4 }, [1, 1]);
    q.writeTexture({ texture: t.terrainMaps }, new Uint8Array(4), { bytesPerRow: 4 }, [1, 1]);
  }

  private createLuts(): Pick<WorldBindings['tex'], 'transmittance' | 'multiScatter' | 'skyView' | 'aerialPerspective'> {
    const d = this.device, q = d.queue;
    const lut = (label: string, size: { width: number; height: number; depth?: number }, data: Uint16Array<ArrayBuffer>) => {
      const dim = size.depth ? '3d' : '2d';
      const t = d.createTexture({ label, dimension: dim, format: 'rgba16float', size: [size.width, size.height, size.depth ?? 1], usage: LUT_USAGE });
      q.writeTexture({ texture: t }, data, { bytesPerRow: size.width * 8, rowsPerImage: size.height }, [size.width, size.height, size.depth ?? 1]);
      return t;
    };
    const T = TRANSMITTANCE_LUT_SIZE, M = MULTI_SCATTER_LUT_SIZE, A = AERIAL_PERSPECTIVE_LUT_SIZE;
    return {
      transmittance: lut('transmittanceLUT', T, filledHalf(T.width * T.height, [1, 1, 1, 1]) as Uint16Array<ArrayBuffer>),
      multiScatter: lut('multiScatterLUT', M, filledHalf(M.width * M.height, [0, 0, 0, 0]) as Uint16Array<ArrayBuffer>),
      skyView: lut('skyViewLUT', SKY_VIEW_LUT_SIZE, placeholderSkyView() as Uint16Array<ArrayBuffer>),
      aerialPerspective: lut('aerialPerspectiveLUT', A, filledHalf(A.width * A.height * A.depth, [0, 0, 0, 1]) as Uint16Array<ArrayBuffer>),
    };
  }

  private createBlueNoise(): GPUTexture {
    const t = this.device.createTexture({ label: 'blueNoise', format: 'rg8unorm', size: [BLUE_NOISE_SIZE, BLUE_NOISE_SIZE], usage: DATA_USAGE });
    this.device.queue.writeTexture({ texture: t }, generateBlueNoiseRG8() as Uint8Array<ArrayBuffer>, { bytesPerRow: BLUE_NOISE_SIZE * 2 }, [BLUE_NOISE_SIZE, BLUE_NOISE_SIZE]);
    return t;
  }
}
