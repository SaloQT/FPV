import type { FrameInfo, RenderContext } from '../contracts';
import type { OutSize, PostFlags, PostStage } from './types';

/**
 * Camera auto white balance. The meter reads the light falling on every sampled surface from the renderer's own lighting terms (the sun
 * through the atmosphere times its traced visibility and cosine, plus the diffuse GI), so each pixel is a grey card, and averages their
 * log-chromaticity (ln r/g, ln b/g), each weighted by the square root of its light: the colour of the light the scene is lit by, whatever
 * colour the scene itself is (a frame full of green leaves does not read as a green illuminant, the way a grey-world camera would take it),
 * with the bright surfaces leading as in a camera, so an open field balances on the sun and sky and a forest interior on its skylit shade.
 * The estimate is smoothed over `tau` seconds so it does not pump in flight, and corrected toward D65 (linear sRGB white) the way a camera's
 * auto white balance does: nearly all of a small cast (forest shade under blue sky), less of a strong one. The correction fades out as the
 * sun sets: a golden-hour frame, mostly skylit shade, is balanced on that shade the way a camera's auto white balance does, so its sunlit grass
 * and leaves come out warm and golden as in photographs (left alone, the frame stayed blue-grey with the grass at r/g 0.7-0.8 where photographs
 * have 0.9-1.1), while blue hour, with the sun a few degrees down, stays blue. At night the camera locks to a fixed cool white point
 * (about 3600 K), so a moonless sky reads navy and the land cool grey.
 * The gains go into the exposure buffer (look.zw of the composite's Exposure uniform: red and blue; green follows so a grey keeps its luminance).
 */
export const WHITE_BALANCE_TUNING = {
  /** Every STRIDE-th pixel each way is metered. */
  stride: 4,
  /** Surfaces farther than this (m) are left out: the light near the camera is the light the picture is taken in. */
  maxDistance: 150,
  /** Less total weight than this (about as many sunlit pixels) and the estimate holds (a frame of sky, a camera inside a hedge). */
  minCount: 64,
  /** Share of a cast the camera removes at small casts, and the cast size (log-chromaticity length) at which it removes half as much. */
  strength: 1,
  soft: 0.8,
  /** Seconds. */
  tau: 1.5,
  maxDt: 0.25,
  /** Sensor gain (EV over daylight) over which the correction fades out: civil twilight to a full moon. */
  gainLo: 9,
  gainHi: 14,
  /**
   * The night camera's fixed white point, as ln(r/g) and ln(b/g) gains, reached as the correction fades out at night: a camera balanced for
   * about 3600 K, which draws a moonless dark-site sky deep blue and the land a cool grey, the way low-light cameras record it.
   */
  nightRG: -0.3,
  nightBG: 0.45,
  /** Sine of the sun elevation over which the correction fades in: none with the sun 4 degrees down (blue hour), all from 2 degrees up. */
  sunLo: -0.07,
  sunHi: 0.035,
  /**
   * Golden-hour warmth the camera keeps (ln r/g, ln b/g added to the gains), full with the sun under sunHi and gone by warmSunHi (about 15
   * degrees), and fading out below the horizon with the correction itself (blue hour stays blue). A camera's auto white balance leaves part
   * of a low sun's amber in the picture; balanced fully, the 18:48 audit frames had a mean saturation of 0.41 against 0.45 for nine
   * golden-hour photographs, and 0.46 with this. Noon is untouched.
   */
  warmRG: 0.06,
  warmBG: -0.12,
  warmSunHi: 0.26,
} as const;

const T = WHITE_BALANCE_TUNING;
const GROUP = 8;
const LUMA = [0.2126, 0.7152, 0.0722] as const;

export function whiteBalanceDefines(): Record<string, string | number> {
  const f = (v: number): string => (Number.isInteger(v) ? `${v}.0` : `${v}`);
  return {
    WB_STRIDE: T.stride, WB_MAX_DIST: f(T.maxDistance), WB_MIN_COUNT: f(T.minCount), WB_STRENGTH: f(T.strength), WB_SOFT: f(T.soft), WB_TAU: f(T.tau),
    WB_MAX_DT: f(T.maxDt), WB_GAIN_LO: f(T.gainLo), WB_GAIN_HI: f(T.gainHi), WB_SUN_LO: f(T.sunLo), WB_SUN_HI: f(T.sunHi), WB_NIGHT_RG: f(T.nightRG), WB_NIGHT_BG: f(T.nightBG),
    WB_WARM_RG: f(T.warmRG), WB_WARM_BG: f(T.warmBG), WB_WARM_SUN_HI: f(T.warmSunHi),
  };
}

const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};

/** Share of the golden-hour warmth kept at a sun elevation (sine): 1 from the horizon to 2 degrees up, 0 by 15 degrees and below 4 down. */
export function goldenWarmth(sunY: number): number {
  return smoothstep(T.sunLo, 0, sunY) * (1 - smoothstep(T.sunHi, T.warmSunHi, sunY));
}

/**
 * Channel gains (r, g, b) for an illuminant of log-chromaticity (ln r/g, ln b/g) at a sensor gain (EV over daylight) and a sun elevation
 * (sine; default overhead). Mirrors `resolve`
 * in whitebalance.wgsl; a grey keeps its luminance.
 */
export function whiteBalanceGains(lnRG: number, lnBG: number, gainEv: number, sunY = 1): [number, number, number] {
  const night = smoothstep(T.gainLo, T.gainHi, gainEv);
  const day = smoothstep(T.sunLo, T.sunHi, sunY);
  const f = T.strength / (1 + Math.hypot(lnRG, lnBG) / T.soft) * (1 - night) * day;
  const warm = goldenWarmth(sunY) * (1 - night);
  const r = Math.exp(-f * lnRG + night * T.nightRG + warm * T.warmRG), b = Math.exp(-f * lnBG + night * T.nightBG + warm * T.warmBG);
  const y = LUMA[0] * r + LUMA[1] + LUMA[2] * b;
  return [r / y, 1 / y, b / y];
}

export interface WhiteBalanceStage extends PostStage {
  /** `exposure` is the exposure stage's output buffer; this pass writes its red and blue gains into it after the exposure reduce. */
  encode(enc: GPUCommandEncoder, rc: RenderContext, f: FrameInfo, flags: PostFlags, exposure: GPUBuffer): void;
}

export function createWhiteBalanceStage(): WhiteBalanceStage {
  let layout: GPUBindGroupLayout;
  let meterPipeline: GPUComputePipeline;
  let resolvePipeline: GPUComputePipeline;
  let sums: GPUBuffer;
  let state: GPUBuffer;
  let params: GPUBuffer;
  let group: GPUBindGroup | null = null;
  let bound: { gi: GPUTextureView; depth: GPUTextureView; exposure: GPUBuffer } | null = null;
  const paramData = new ArrayBuffer(16);
  const paramF = new Float32Array(paramData);
  const paramU = new Uint32Array(paramData);

  return {
    init(rc: RenderContext) {
      const C = GPUShaderStage.COMPUTE;
      const tex = (binding: number): GPUBindGroupLayoutEntry => ({ binding, visibility: C, texture: { sampleType: 'unfilterable-float' } });
      const buf = (binding: number, type: GPUBufferBindingType): GPUBindGroupLayoutEntry => ({ binding, visibility: C, buffer: { type } });
      layout = rc.device.createBindGroupLayout({
        label: 'white balance',
        entries: [tex(0), tex(1), { binding: 2, visibility: C, texture: { sampleType: 'depth' } }, tex(3), tex(4), buf(5, 'uniform'), buf(6, 'storage'), buf(7, 'storage'), buf(8, 'storage')],
      });
      const module = rc.module('post/whitebalance.wgsl', whiteBalanceDefines());
      // Groups 0 and 1 are the frame uniforms and the world bindings (sun, transmittance LUT), as in the deferred lighting pass.
      const pipelineLayout = rc.device.createPipelineLayout({ bindGroupLayouts: [rc.frame.layout, rc.world.layout, layout] });
      const make = (entryPoint: string) => rc.device.createComputePipeline({ label: `white balance ${entryPoint}`, layout: pipelineLayout, compute: { module, entryPoint } });
      meterPipeline = make('meter');
      resolvePipeline = make('resolve');
      const U = GPUBufferUsage;
      sums = rc.device.createBuffer({ label: 'white balance sums', size: 16, usage: U.STORAGE });
      state = rc.device.createBuffer({ label: 'white balance state', size: 16, usage: U.STORAGE });
      params = rc.device.createBuffer({ label: 'white balance params', size: 16, usage: U.UNIFORM | U.COPY_DST });
    },

    resize(_rc: RenderContext, _out: OutSize) {
      group = null;
      bound = null;
    },

    encode(enc: GPUCommandEncoder, rc: RenderContext, f: FrameInfo, flags: PostFlags, exposure: GPUBuffer) {
      const v = rc.gbuf.views;
      if (!group || !bound || bound.gi !== v.giDiffuse || bound.depth !== v.depth || bound.exposure !== exposure) {
        group = rc.device.createBindGroup({
          label: 'white balance',
          layout,
          entries: [
            { binding: 0, resource: v.normal }, { binding: 1, resource: v.misc }, { binding: 2, resource: v.depth }, { binding: 3, resource: v.sunShadow },
            { binding: 4, resource: v.giDiffuse }, { binding: 5, resource: { buffer: params } }, { binding: 6, resource: { buffer: sums } },
            { binding: 7, resource: { buffer: state } }, { binding: 8, resource: { buffer: exposure, size: 32 } },
          ],
        });
        bound = { gi: v.giDiffuse, depth: v.depth, exposure };
      }
      paramF[0] = f.dt;
      paramU[1] = flags.reset ? 1 : 0;
      rc.device.queue.writeBuffer(params, 0, paramData);
      const pass = enc.beginComputePass({ label: 'white balance' });
      pass.setBindGroup(0, rc.frame.group);
      pass.setBindGroup(1, rc.world.group);
      pass.setBindGroup(2, group);
      pass.setPipeline(meterPipeline);
      const span = GROUP * T.stride;
      pass.dispatchWorkgroups(Math.ceil(rc.gbuf.width / span), Math.ceil(rc.gbuf.height / span));
      pass.setPipeline(resolvePipeline);
      pass.dispatchWorkgroups(1);
      pass.end();
    },

    destroy() {
      sums?.destroy();
      state?.destroy();
      params?.destroy();
      group = null;
      bound = null;
    },
  };
}
