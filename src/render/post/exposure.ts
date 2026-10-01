import type { FrameInfo, RenderContext } from '../contracts';
import { CPU_EXPOSURE_KEY } from '../exposure';
import type { ExposureStage, OutSize, PostFlags, PostParams } from './types';

/**
 * Auto exposure on the resolved image. The CPU pre-exposure (render/exposure.ts) meters a 0.18-albedo ground plane from the astronomy
 * only, so this stage corrects the residual (clouds, shade, bright dusk sky, tunnels). The metered value is a trimmed mean of a
 * log2-luminance histogram whose highlights are soft-clipped, so neither the sun disc nor a small hot spot can drive it; the metering favours
 * the centre and, mildly, the ground. By day the darkest 30% of the frame (forest shade) is cut from that mean too: a frame of dark shade
 * with sunlit grass and sky used to open the camera 2.5 EV, which washed the grass out to code 200 and blew the sky; now the sunlit parts
 * decide (grass near code 140, the shade still readable) and an overcast frame, with everything dim, still brightens. The exposure then
 * follows highlight priority: the brightest ~12% of the frame (sunlit ground, sky, clouds) never lands above ~0.9 scene-linear (code ~205);
 * a low sun with a bright sky near it lowers the exposure up to protectMaxEv. The key itself falls with the metered scene luminance so a
 * dark scene stays dark.
 * The adapted state is the TOTAL exposure (pre-exposure * ratio) in EV, which makes it independent of CPU pre-exposure changes, and the
 * metering never sees the ratio it produces (open loop), so the adaptation cannot oscillate.
 * Night: below ~0.03 nits of CPU-estimated scene luminance the metered mean (black trees, a few stars) is replaced by that estimate, so the
 * exposure follows the astronomy (moonless: the full +20 EV of a starlight camera, a sky near black with stars and Milky Way readable; moon up:
 * the same gain until the 0.18-card reaches its dusk display level, then it falls), and the key stays flat below keyNightKneeNits.
 */
export const EXPOSURE_TUNING = {
  bins: 64,
  evMin: -12,
  evMax: 8,
  /** Trimmed-mean luminance the exposure aims for after the ratio (FPV cameras run a touch brighter than 0.18). */
  key: 0.22,
  /** Metered scene luminance (nits) under which the key falls, and by how much per EV of scene luminance (0: constant key). */
  keyKneeNits: 100,
  keySlope: 0.3,
  /** Below this scene luminance (deep twilight, moonlight) the key falls only keyNightSlope per EV, so a 0.18 card keeps its dark but readable display level until the gain runs out. */
  keyNightKneeNits: 0.1,
  keyNightSlope: 0,
  /**
   * The CPU's scene-luminance estimate (astronomy only) takes over from the metered mean in the dark: its weight is 0 above nightBlendHiNits and
   * 1 below nightBlendLoNits. A night frame is mostly black trees and a few stars, so its metered mean says nothing about how bright the night is.
   */
  nightBlendHiNits: 0.03,
  nightBlendLoNits: 0.003,
  /** In the dark only a metered mean more than this many EV above the estimate counts (artificial light): the exposure may fall for it, never rise. */
  nightMarginEv: 2,
  /**
   * By day and dusk the darkest 30% of the weighted frame (forest shade, tree trunks, a tunnel mouth) is ignored by the mean: shade must not
   * decide how bright the sunlit parts are. In the dark only 5% is, as the night regime was tuned with. The shade trim fades in with the CPU's
   * grey-card luminance, from trimBlendLoNits to trimBlendHiNits (clear deep twilight, sun about 7 degrees down, to civil twilight).
   */
  trimLow: 0.3,
  trimLowNight: 0.05,
  trimBlendLoNits: 0.03,
  trimBlendHiNits: 0.3,
  trimHigh: 0.05,
  /** Highlights above key * 2^knee are compressed with a tanh whose asymptote is kneeWidth EV higher. */
  knee: 3,
  kneeWidth: 1.5,
  /** Corner weight is 1 - centerBias relative to the centre. */
  centerBias: 0.6,
  /** The bottom row weighs 1 + vertBias and the top row 1 - vertBias: the ground leads, but the sky counts (a sunlit meadow is not metered as if it were forest shade). */
  vertBias: 0.3,
  /**
   * Highlight priority: the brightest clipFrac of the (weighted) frame (sunlit ground, sky, clouds) may sit at most clipEv above the key, i.e. at ~0.9
   * scene-linear (display code ~205); the exposure gives up to protectMaxEv to get there (a low sun with a bright sky near it).
   */
  clipFrac: 0.12,
  clipEv: 2,
  protectMaxEv: 3,
  stride: 2,
  weightScale: 64,
  /** Seconds. Exposure increasing (scene got darker) is slower than decreasing (scene got brighter): AGC protects highlights first. */
  tauBrighten: 0.35,
  tauDarken: 0.15,
  deadbandEv: 0.04,
  maxDt: 0.25,
  /** Luminance of a 0.18 grey card at noon: the CPU pre-exposure there is 1 / (4 * dayReferenceNits). */
  dayReferenceNits: 5000,
  /** Hard limits of the sensor gain (total exposure over the daylight reference, EV). A starlight camera needs ~+20 EV; the key law keeps a moonless sky near black. */
  maxGainEv: 20.3,
  minGainEv: -6,
  /** Numeric guard only: a starlit pre-exposure is +10 EV and a bright day -14 EV, so the ratio legitimately spans 2^-24..2^+6. */
  maxRatioEv: 26,
} as const;

const T = EXPOSURE_TUNING;
export const DAY_TOTAL_EV = -Math.log2(4 * T.dayReferenceNits);
const LOG2_KEY = Math.log2(T.key);
const KEY_KNEE_EV = Math.log2(T.keyKneeNits);
const NIGHT_KNEE_EV = Math.log2(T.keyNightKneeNits);
const NIGHT_BLEND_HI_EV = Math.log2(T.nightBlendHiNits);
const NIGHT_BLEND_LO_EV = Math.log2(T.nightBlendLoNits);
const TRIM_BLEND_LO_EV = Math.log2(T.trimBlendLoNits);
const TRIM_BLEND_HI_EV = Math.log2(T.trimBlendHiNits);
/** log2 of the pre-exposed luminance the CPU pre-exposure gives the surface it was computed from. */
export const EXPECTED_MEAN_EV = Math.log2(CPU_EXPOSURE_KEY);
const LUMA = [0.2126, 0.7152, 0.0722] as const;

/** Soft-clips an absolute log2 luminance (pre-exposed units): identity below key * 2^knee, tanh compression above. */
export function softClipEv(ev: number): number {
  const rel = ev - LOG2_KEY;
  return (rel <= T.knee ? rel : T.knee + T.kneeWidth * Math.tanh((rel - T.knee) / T.kneeWidth)) + LOG2_KEY;
}

export function binCenterEv(i: number): number {
  return T.evMin + ((i + 0.5) / T.bins) * (T.evMax - T.evMin);
}

/** Bin pair and upper-bin fraction that a luminance (pre-exposed, linear) is split between; the highlights stay uncompressed here. */
export function binCoords(luminance: number): { lo: number; hi: number; frac: number } {
  const ev = Math.log2(Math.max(luminance, 1e-9));
  const pos = Math.min(Math.max(((ev - T.evMin) / (T.evMax - T.evMin)) * T.bins - 0.5, 0), T.bins - 1);
  const lo = Math.floor(pos);
  return { lo, hi: Math.min(lo + 1, T.bins - 1), frac: pos - lo };
}

/** Metering weight for a pixel at UV (0..1, v down): 1 in the centre, 1 - centerBias in the corners, times 1 +- vertBias from the bottom to the top edge. */
export function centerWeight(u: number, v: number): number {
  const x = u * 2 - 1, y = v * 2 - 1;
  return (1 - T.centerBias * Math.min(Math.max((x * x + y * y) * 0.5, 0), 1)) * (1 + T.vertBias * Math.min(Math.max(y, -1), 1));
}

/** CPU mirror of one histogram sample (integer weights exactly as the shader splits them). */
export function accumulate(hist: Float64Array | number[], luminance: number, u: number, v: number): void {
  const total = Math.round(T.weightScale * centerWeight(u, v));
  const { lo, hi, frac } = binCoords(luminance);
  const upper = Math.round(total * frac);
  hist[lo] += total - upper;
  hist[hi] += upper;
}

/** Trimmed mean of the soft-clipped bin-centre EVs, the darkest `trimLow` and the brightest trimHigh of the weight cut; null when the histogram is empty. */
export function trimmedMeanEv(hist: ArrayLike<number>, trimLow: number = T.trimLow): number | null {
  let total = 0;
  for (let i = 0; i < T.bins; i++) total += hist[i];
  if (total <= 1) return null;
  const lo = trimLow * total, hi = (1 - T.trimHigh) * total;
  let cum = 0, sum = 0, kept = 0;
  for (let i = 0; i < T.bins; i++) {
    const w = Math.max(Math.min(cum + hist[i], hi) - Math.max(cum, lo), 0);
    sum += w * softClipEv(binCenterEv(i));
    kept += w;
    cum += hist[i];
  }
  return sum / Math.max(kept, 1e-6);
}

/** Weight (0..1) of the shade-trimmed mean against the night mean, from the CPU pre-exposure alone (it encodes the grey-card luminance): 0 in the dark, 1 from civil twilight on. */
export function shadeTrimWeight(preEv: number): number {
  const x = Math.min(Math.max((EXPECTED_MEAN_EV - preEv - TRIM_BLEND_LO_EV) / (TRIM_BLEND_HI_EV - TRIM_BLEND_LO_EV), 0), 1);
  return x * x * (3 - 2 * x);
}

/** The metered mean the exposure law works on: the plain trimmed mean, moving to the shade-trimmed one as the light comes up; null when the histogram is empty. */
export function meteredMeanEv(hist: ArrayLike<number>, preExposure: number): number | null {
  const night = trimmedMeanEv(hist, T.trimLowNight);
  if (night === null) return null;
  const w = shadeTrimWeight(Math.log2(Math.max(preExposure, 1e-12)));
  return w <= 0 ? night : night + w * ((trimmedMeanEv(hist, T.trimLow) as number) - night);
}

/**
 * EV (uncompressed) above which the brightest `fraction` of the weight lies, interpolated inside the bin that holds it so the value moves
 * smoothly with the frame instead of hopping a bin (0.3 EV) at a time; null when the histogram is empty.
 */
export function topQuantileEv(hist: ArrayLike<number>, fraction: number = T.clipFrac): number | null {
  let total = 0;
  for (let i = 0; i < T.bins; i++) total += hist[i];
  if (total <= 1) return null;
  const want = fraction * total;
  const width = (T.evMax - T.evMin) / T.bins;
  let cum = 0;
  for (let i = T.bins - 1; i > 0; i--) {
    const h = hist[i];
    if (cum + h >= want) return binCenterEv(i) + (0.5 - (want - cum) / Math.max(h, 1)) * width;
    cum += h;
  }
  return binCenterEv(0);
}

/** log2 of the key the metered mean goes to, for a metered scene luminance of lumEv (log2 nits): slope keySlope below keyKneeNits, keyNightSlope below keyNightKneeNits. */
export function keyEvFor(lumEv: number): number {
  return LOG2_KEY + T.keySlope * Math.min(lumEv - KEY_KNEE_EV, 0) + (T.keyNightSlope - T.keySlope) * Math.min(lumEv - NIGHT_KNEE_EV, 0);
}

/** Weight (0..1) of the astronomy-based estimate against the metered mean, from the CPU pre-exposure alone (it encodes the estimated scene luminance). */
export function nightWeight(preEv: number): number {
  const x = Math.min(Math.max((EXPECTED_MEAN_EV - preEv - NIGHT_BLEND_LO_EV) / (NIGHT_BLEND_HI_EV - NIGHT_BLEND_LO_EV), 0), 1);
  return 1 - x * x * (3 - 2 * x);
}

/**
 * Total exposure (EV, log2 of pre-exposure * ratio) the metered mean asks for. The mean goes to a key that falls below keyKneeNits, the
 * bright decile (`highEv`, uncompressed) may not end up more than clipEv over the key, and the sensor-gain and ratio limits apply last.
 * In the dark the metered mean gives way to the value the CPU's scene estimate implies (see nightWeight), except that a frame far brighter
 * than that estimate (a floodlit scene) still lowers the exposure; the highlight protection is off.
 */
export function targetTotalEv(meanEv: number, preExposure: number, highEv: number = -Infinity): number {
  const preEv = Math.log2(Math.max(preExposure, 1e-12));
  const night = nightWeight(preEv);
  const used = meanEv + night * (EXPECTED_MEAN_EV - meanEv);
  const keyEv = keyEvFor(used - preEv);
  const shift = keyEv - used;
  const protectedShift = shift + (1 - night) * (Math.max(Math.min(shift, LOG2_KEY + T.clipEv - highEv), shift - T.protectMaxEv) - shift);
  const floodlit = night * Math.max(meanEv - EXPECTED_MEAN_EV - T.nightMarginEv, 0);
  const gain = Math.max(Math.min(Math.max(preEv + protectedShift - DAY_TOTAL_EV, T.minGainEv), T.maxGainEv) - floodlit, T.minGainEv);
  return preEv + Math.min(Math.max(DAY_TOTAL_EV + gain - preEv, -T.maxRatioEv), T.maxRatioEv);
}

/** One adaptation step of the total exposure state: dead band, then exponential approach with direction-dependent time constant. */
export function adaptTotalEv(current: number, target: number, dt: number): number {
  const err = target - current;
  const eff = Math.sign(err) * Math.max(Math.abs(err) - T.deadbandEv, 0);
  const tau = err < 0 ? T.tauDarken : T.tauBrighten;
  return current + eff * (1 - Math.exp(-Math.min(Math.max(dt, 0), T.maxDt) / tau));
}

/** Values written to the ratio buffer: ratio, sensor gain over the daylight reference (EV), metered mean (EV), total exposure (EV). */
export function exposureOutput(totalEv: number, preExposure: number, meanEv: number): [number, number, number, number] {
  const preEv = Math.log2(Math.max(preExposure, 1e-12));
  const ratioEv = Math.min(Math.max(totalEv - preEv, -T.maxRatioEv), T.maxRatioEv);
  return [2 ** ratioEv, preEv + ratioEv - DAY_TOTAL_EV, meanEv, preEv + ratioEv];
}

export function luminanceOf(r: number, g: number, b: number): number {
  return r * LUMA[0] + g * LUMA[1] + b * LUMA[2];
}

export function exposureDefines(): Record<string, number> {
  return {
    EV_MIN: T.evMin, EV_MAX: T.evMax, KEY: T.key, KEY_KNEE_EV, KEY_SLOPE: T.keySlope, NIGHT_KNEE_EV, NIGHT_SLOPE: T.keyNightSlope, NIGHT_BLEND_HI_EV, NIGHT_BLEND_LO_EV, NIGHT_MARGIN_EV: T.nightMarginEv, EXPECTED_MEAN_EV, KNEE: T.knee, KNEE_WIDTH: T.kneeWidth,
    CENTER_BIAS: T.centerBias, VERT_BIAS: T.vertBias, CLIP_FRAC: T.clipFrac, CLIP_EV: T.clipEv, PROTECT_MAX_EV: T.protectMaxEv,
    STRIDE: T.stride, WEIGHT_SCALE: T.weightScale, TRIM_LOW: T.trimLow, TRIM_LOW_NIGHT: T.trimLowNight, TRIM_BLEND_LO_EV, TRIM_BLEND_HI_EV, TRIM_HIGH: T.trimHigh, TAU_BRIGHTEN: T.tauBrighten,
    TAU_DARKEN: T.tauDarken, DEADBAND: T.deadbandEv, MAX_DT: T.maxDt, DAY_TOTAL_EV, MAX_GAIN_EV: T.maxGainEv,
    MIN_GAIN_EV: T.minGainEv, MAX_RATIO_EV: T.maxRatioEv,
  };
}

const GROUP = 16;

type Readback = 'idle' | 'copied' | 'mapping';

export function createExposureStage(): ExposureStage {
  let rc: RenderContext;
  let layout: GPUBindGroupLayout;
  let histPipeline: GPUComputePipeline;
  let reducePipeline: GPUComputePipeline;
  let histogram: GPUBuffer;
  let params: GPUBuffer;
  let state: GPUBuffer;
  let ratio: GPUBuffer;
  let staging: GPUBuffer;
  let group: GPUBindGroup | null = null;
  let boundView: GPUTextureView | null = null;
  let outWidth = 0;
  let outHeight = 0;
  let statsWanted = false;
  let phase: Readback = 'idle';
  let exposureEv: number | null = null;
  const paramData = new ArrayBuffer(16);
  const paramF = new Float32Array(paramData);
  const paramU = new Uint32Array(paramData);
  const neutral = new Float32Array([1, 0, 0, 0]);

  function readStats(): void {
    phase = 'mapping';
    staging.mapAsync(GPUMapMode.READ).then(() => {
      const all = new Float32Array(staging.getMappedRange().slice(0, 16));
      const r = all[0];
      staging.unmap();
      if (r > 0 && Number.isFinite(r)) exposureEv = Math.log2(r);
      phase = 'idle';
    }).catch(() => { phase = 'idle'; });
  }

  return {
    init(ctx: RenderContext) {
      rc = ctx;
      const C = GPUShaderStage.COMPUTE;
      const buf = (binding: number, type: GPUBufferBindingType): GPUBindGroupLayoutEntry => ({ binding, visibility: C, buffer: { type } });
      layout = rc.device.createBindGroupLayout({
        label: 'exposure',
        entries: [{ binding: 0, visibility: C, texture: { sampleType: 'float' } }, buf(1, 'storage'), buf(2, 'uniform'), buf(3, 'storage'), buf(4, 'storage')],
      });
      const module = rc.module('post/histogram.wgsl', exposureDefines());
      const pipelineLayout = rc.device.createPipelineLayout({ bindGroupLayouts: [layout] });
      const make = (entryPoint: string) => rc.device.createComputePipeline({ label: `exposure ${entryPoint}`, layout: pipelineLayout, compute: { module, entryPoint } });
      histPipeline = make('hist');
      reducePipeline = make('reduce');
      const U = GPUBufferUsage;
      histogram = rc.device.createBuffer({ label: 'exposure histogram', size: T.bins * 4, usage: U.STORAGE });
      params = rc.device.createBuffer({ label: 'exposure params', size: 16, usage: U.UNIFORM | U.COPY_DST });
      state = rc.device.createBuffer({ label: 'exposure state', size: 16, usage: U.STORAGE });
      ratio = rc.device.createBuffer({ label: 'exposure ratio', size: 16, usage: U.STORAGE | U.UNIFORM | U.COPY_SRC | U.COPY_DST });
      staging = rc.device.createBuffer({ label: 'exposure readback', size: 16, usage: U.MAP_READ | U.COPY_DST });
      rc.device.queue.writeBuffer(ratio, 0, neutral);
    },

    resize(ctx: RenderContext, out: OutSize) {
      rc = ctx;
      outWidth = out.width;
      outHeight = out.height;
      group = null;
      boundView = null;
    },

    encode(enc: GPUCommandEncoder, ctx: RenderContext, f: FrameInfo, p: PostParams, flags: PostFlags, resolved: GPUTextureView) {
      if (boundView !== resolved) {
        group = ctx.device.createBindGroup({
          label: 'exposure',
          layout,
          entries: [
            { binding: 0, resource: resolved }, { binding: 1, resource: { buffer: histogram } }, { binding: 2, resource: { buffer: params } },
            { binding: 3, resource: { buffer: state } }, { binding: 4, resource: { buffer: ratio } },
          ],
        });
        boundView = resolved;
      }
      paramF[0] = p.preExposure;
      paramF[1] = f.dt;
      paramU[2] = f.frameIndex >>> 0;
      paramU[3] = flags.reset ? 1 : 0;
      ctx.device.queue.writeBuffer(params, 0, paramData);
      const span = GROUP * T.stride;
      const pass = enc.beginComputePass({ label: 'exposure' });
      pass.setBindGroup(0, group);
      pass.setPipeline(histPipeline);
      pass.dispatchWorkgroups(Math.ceil(Math.max(outWidth, 1) / span), Math.ceil(Math.max(outHeight, 1) / span));
      pass.setPipeline(reducePipeline);
      pass.dispatchWorkgroups(1);
      pass.end();
      if (!statsWanted) return;
      if (phase === 'copied') readStats();
      else if (phase === 'idle') {
        enc.copyBufferToBuffer(ratio, 0, staging, 0, 16);
        phase = 'copied';
      }
    },

    get ratio(): GPUBuffer {
      return ratio;
    },

    getStats() {
      statsWanted = true;
      return { exposureEv };
    },

    destroy() {
      histogram?.destroy();
      params?.destroy();
      state?.destroy();
      ratio?.destroy();
      staging?.destroy();
      group = null;
      boundView = null;
    },
  };
}
