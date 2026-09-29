import type { FrameInfo, RenderContext } from '../contracts';
import type { ExposureStage, OutSize, PostFlags, PostParams } from './types';

/**
 * Auto exposure on the resolved image. The CPU pre-exposure (render/exposure.ts) meters a 0.18-albedo ground plane from the astronomy
 * only, so this stage corrects the residual (bright dusk sky, shade, tunnels). The metered value is the 5%-trimmed mean of a
 * log2-luminance histogram whose highlights are soft-clipped, so neither the sun disc nor a small hot spot can drive it.
 * The adapted state is the TOTAL exposure (pre-exposure * ratio) in EV, which makes it independent of CPU pre-exposure changes, and the
 * metering never sees the ratio it produces (open loop), so the adaptation cannot oscillate.
 */
export const EXPOSURE_TUNING = {
  bins: 64,
  evMin: -12,
  evMax: 8,
  /** Trimmed-mean luminance the exposure aims for after the ratio (FPV cameras run a touch brighter than 0.18). */
  key: 0.22,
  trimLow: 0.05,
  trimHigh: 0.05,
  /** Highlights above key * 2^knee are compressed with a tanh whose asymptote is kneeWidth EV higher. */
  knee: 3,
  kneeWidth: 1.5,
  /** Corner weight is 1 - centerBias relative to the centre. */
  centerBias: 0.6,
  stride: 2,
  weightScale: 64,
  /** Seconds. Exposure increasing (scene got darker) is slower than decreasing (scene got brighter): AGC protects highlights first. */
  tauBrighten: 0.35,
  tauDarken: 0.15,
  deadbandEv: 0.04,
  maxDt: 0.25,
  /** Luminance of a 0.18 grey card at noon: the CPU pre-exposure there is 1 / (4 * dayReferenceNits). */
  dayReferenceNits: 5000,
  /** Sensor gain (total exposure over the daylight reference) that is fully compensated; beyond it only overGainSlope of the deficit is. */
  maxGainEv: 12,
  overGainSlope: 0.85,
  minGainEv: -6,
  maxRatioEv: 10,
} as const;

const T = EXPOSURE_TUNING;
export const DAY_TOTAL_EV = -Math.log2(4 * T.dayReferenceNits);
const LOG2_KEY = Math.log2(T.key);
const LUMA = [0.2126, 0.7152, 0.0722] as const;

/** Soft-clips an absolute log2 luminance (pre-exposed units): identity below key * 2^knee, tanh compression above. */
export function softClipEv(ev: number): number {
  const rel = ev - LOG2_KEY;
  return (rel <= T.knee ? rel : T.knee + T.kneeWidth * Math.tanh((rel - T.knee) / T.kneeWidth)) + LOG2_KEY;
}

export function binCenterEv(i: number): number {
  return T.evMin + ((i + 0.5) / T.bins) * (T.evMax - T.evMin);
}

/** Bin pair and upper-bin fraction that a luminance (pre-exposed, linear) is split between. */
export function binCoords(luminance: number): { lo: number; hi: number; frac: number } {
  const ev = softClipEv(Math.log2(Math.max(luminance, 1e-9)));
  const pos = Math.min(Math.max(((ev - T.evMin) / (T.evMax - T.evMin)) * T.bins - 0.5, 0), T.bins - 1);
  const lo = Math.floor(pos);
  return { lo, hi: Math.min(lo + 1, T.bins - 1), frac: pos - lo };
}

/** Metering weight for a pixel at UV (0..1): 1 in the centre, 1 - centerBias in the corners. */
export function centerWeight(u: number, v: number): number {
  const x = u * 2 - 1, y = v * 2 - 1;
  return 1 - T.centerBias * Math.min(Math.max((x * x + y * y) * 0.5, 0), 1);
}

/** CPU mirror of one histogram sample (integer weights exactly as the shader splits them). */
export function accumulate(hist: Float64Array | number[], luminance: number, u: number, v: number): void {
  const total = Math.round(T.weightScale * centerWeight(u, v));
  const { lo, hi, frac } = binCoords(luminance);
  const upper = Math.round(total * frac);
  hist[lo] += total - upper;
  hist[hi] += upper;
}

/** Trimmed mean of bin-centre EVs; null when the histogram is empty. */
export function trimmedMeanEv(hist: ArrayLike<number>): number | null {
  let total = 0;
  for (let i = 0; i < T.bins; i++) total += hist[i];
  if (total <= 1) return null;
  const lo = T.trimLow * total, hi = (1 - T.trimHigh) * total;
  let cum = 0, sum = 0, kept = 0;
  for (let i = 0; i < T.bins; i++) {
    const w = Math.max(Math.min(cum + hist[i], hi) - Math.max(cum, lo), 0);
    sum += w * binCenterEv(i);
    kept += w;
    cum += hist[i];
  }
  return sum / Math.max(kept, 1e-6);
}

/** Total exposure (EV, log2 of pre-exposure * ratio) the metered mean asks for, after the sensor-gain and ratio limits. */
export function targetTotalEv(meanEv: number, preExposure: number): number {
  const preEv = Math.log2(Math.max(preExposure, 1e-12));
  let gain = LOG2_KEY - meanEv + preEv - DAY_TOTAL_EV;
  if (gain > T.maxGainEv) gain = T.maxGainEv + T.overGainSlope * (gain - T.maxGainEv);
  gain = Math.max(gain, T.minGainEv);
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
    EV_MIN: T.evMin, EV_MAX: T.evMax, KEY: T.key, KNEE: T.knee, KNEE_WIDTH: T.kneeWidth, CENTER_BIAS: T.centerBias, STRIDE: T.stride,
    WEIGHT_SCALE: T.weightScale, TRIM_LOW: T.trimLow, TRIM_HIGH: T.trimHigh, TAU_BRIGHTEN: T.tauBrighten, TAU_DARKEN: T.tauDarken,
    DEADBAND: T.deadbandEv, MAX_DT: T.maxDt, DAY_TOTAL_EV, MAX_GAIN_EV: T.maxGainEv, OVER_GAIN_SLOPE: T.overGainSlope,
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
      const r = new Float32Array(staging.getMappedRange().slice(0, 4))[0];
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
