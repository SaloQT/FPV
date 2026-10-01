import type { StarCatalog, Vec3 } from '../../contracts';
import { loadStarCatalog } from '../../world/astro/stars';
import type { FrameInfo, RenderContext, RenderModule } from '../contracts';
import { CloudLayer } from './clouds';
import {
  CLOUD_SHADOW_EXTENT_M, cloudAmbientScale, cloudField, cloudVisibility, snapShadowCenter, type CloudField,
} from './cloudModel';
import { CloudNoise } from './cloudNoise';
import { AtmosphereLuts } from './lutPasses';
import { bakeMilkyWay } from './milkyWay';
import { DEFAULT_ATMOSPHERE_SETTINGS, sanitizeAtmosphereSettings, type AtmosphereSettings } from './settings';
import { SkyPass } from './skyPass';
import { packStars, starMagnitudeLimit } from './starData';
import { AtmosUniforms } from './uniforms';

export type { AtmosphereSettings } from './settings';

const running = new WeakMap<GPUDevice, AtmosphereModule>();

/** The atmosphere module running on `device` (null if none): lets passes that shade the ground read its cloud shadow map without a module-list contract. */
export function atmosphereOf(device: GPUDevice): AtmosphereModule | null {
  return running.get(device) ?? null;
}

/** Where the cloud shadow map sits in the world: texel (i, j) of N covers x = centerX + ((i + 0.5) / N - 0.5) * extentM, z likewise. */
export interface CloudShadowMapping {
  centerX: number;
  centerZ: number;
  extentM: number;
}

export interface AtmosphereModule extends RenderModule {
  setSettings(s: Partial<AtmosphereSettings>): void;
  getSettings(): Readonly<AtmosphereSettings>;
  /**
   * The top-down cloud shadow map (128x128 rgba16float; null before init): r = sun transmittance, g = moon transmittance, b = zenith
   * transmittance of both layers (the sky light a cloud lets through), a = 1. All 1 while clouds are disabled. Sample it with
   * getCloudShadowMapping(); it is refreshed in encodePre, so any later pass of the same frame may read it.
   */
  getCloudShadowTexture(): GPUTexture | null;
  getCloudShadowMapping(): CloudShadowMapping;
  /**
   * CPU estimate (0..1) of the share of the direct light along a world-space unit direction that survives the cloud layers, marched
   * from the camera through the same density functions the sky pass renders; 1 for a direction at or below the horizon. Meant for
   * gating effects (light shafts, lens flare, the sun's contribution to exposure); the lighting itself is exact on the GPU.
   */
  cloudSunVisibility(sunDir: ArrayLike<number>): number;
  /** Multiplier (>= 1) on the ground's sky-light for the current cloud cover, from the settings alone (see cloudAmbientScale). */
  getAmbientScale(): number;
}

const MOON_SCATTER_MIN_ELEVATION = (-7 * Math.PI) / 180;
const MOON_SCATTER_MIN_FRACTION = 0.002;
const HISTORY_BLEND = 0.9;
const LIGHT_STEPS = { low: 4, medium: 5, high: 6, ultra: 6 } as const;

class Atmosphere implements AtmosphereModule {
  readonly name = 'atmosphere';
  private settings: AtmosphereSettings;
  private luts!: AtmosphereLuts;
  private sky!: SkyPass;
  private noise!: CloudNoise;
  private clouds!: CloudLayer;
  private readonly uniforms = new AtmosUniforms();
  private readonly field: CloudField = cloudField(DEFAULT_ATMOSPHERE_SETTINGS, 0, 0, 0);
  private readonly camera: Vec3 = [0, 0, 0];
  private readonly shadow: CloudShadowMapping = { centerX: 0, centerZ: 0, extentM: CLOUD_SHADOW_EXTENT_M };
  private moonActive = false;
  private device: GPUDevice | null = null;

  constructor(options: Partial<AtmosphereSettings>) {
    this.settings = sanitizeAtmosphereSettings(options, DEFAULT_ATMOSPHERE_SETTINGS);
  }

  async init(rc: RenderContext): Promise<void> {
    this.luts = new AtmosphereLuts(rc);
    this.sky = new SkyPass(rc, this.luts.params);
    const enc = rc.device.createCommandEncoder({ label: 'cloud noise bake' });
    this.noise = new CloudNoise(rc, enc);
    rc.device.queue.submit([enc.finish()]);
    this.clouds = new CloudLayer(rc, this.noise, this.luts.params);
    const catalog = await this.loadCatalog();
    this.sky.setMilkyWay(bakeMilkyWay(catalog));
    this.sky.setStars(catalog ? packStars(catalog) : null);
    this.device = rc.device;
    running.set(rc.device, this);
  }

  setSettings(s: Partial<AtmosphereSettings>): void {
    this.settings = sanitizeAtmosphereSettings(s, this.settings);
  }

  getSettings(): Readonly<AtmosphereSettings> { return this.settings; }

  getCloudShadowTexture(): GPUTexture | null { return this.clouds ? this.clouds.shadow : null; }

  getCloudShadowMapping(): CloudShadowMapping { return this.shadow; }

  cloudSunVisibility(sunDir: ArrayLike<number>): number {
    const c = this.camera;
    return cloudVisibility(this.field, c[0], c[1], c[2], sunDir[0], sunDir[1], sunDir[2]);
  }

  getAmbientScale(): number { return cloudAmbientScale(this.settings); }

  update(rc: RenderContext, f: FrameInfo): void {
    const a = f.astro, cam = f.camera.pos;
    this.moonActive = a.moonElevation > MOON_SCATTER_MIN_ELEVATION && a.moonIlluminatedFraction > MOON_SCATTER_MIN_FRACTION;
    const magLimit = starMagnitudeLimit(rc.quality.tier);
    const seed = this.settings.seed ?? rc.settings.seed;
    this.clouds.prepare();
    this.shadow.centerX = snapShadowCenter(cam[0]);
    this.shadow.centerZ = snapShadowCenter(cam[2]);
    const data = this.uniforms.write({
      settings: this.settings, moonScattering: this.moonActive, seed, timeSeconds: f.time,
      equatorialToWorld: a.equatorialToWorld, starMagLimit: magLimit, cloudSteps: rc.quality.cloudSteps, jitterIndex: this.clouds.frameIndex,
      shadowCenterX: this.shadow.centerX, shadowCenterZ: this.shadow.centerZ, shadowExtentM: this.shadow.extentM,
      historyBlend: HISTORY_BLEND, historyValid: this.clouds.historyValid, lightSteps: LIGHT_STEPS[rc.quality.tier],
    });
    rc.device.queue.writeBuffer(this.luts.params, 0, data as Float32Array<ArrayBuffer>);
    this.sky.update(f, magLimit);
    this.camera[0] = cam[0]; this.camera[1] = cam[1]; this.camera[2] = cam[2];
    cloudField(this.settings, seed, f.time, rc.settings.observer.altitudeM, this.field);
  }

  encodePre(enc: GPUCommandEncoder): void {
    this.luts.bake(enc);
    this.luts.encode(enc, this.moonActive);
    this.clouds.encode(enc, this.settings.cloudsEnabled);
  }

  encodeSky(pass: GPURenderPassEncoder): void {
    this.sky.encode(pass, this.luts.skySun, this.luts.skyMoon, this.clouds.resolvedView());
  }

  destroy(): void {
    if (this.device && running.get(this.device) === this) running.delete(this.device);
    this.sky.destroy();
    this.clouds.destroy();
    this.noise.destroy();
    this.luts.destroy();
  }

  private async loadCatalog(): Promise<StarCatalog | null> {
    try {
      return await loadStarCatalog();
    } catch (e) {
      console.warn('atmosphere: no star catalogue, the sky will have no stars', e);
      return null;
    }
  }
}

export function createAtmosphereModule(options: Partial<AtmosphereSettings> = {}): AtmosphereModule {
  return new Atmosphere(options);
}
