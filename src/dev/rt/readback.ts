import type { Renderer } from '../../render/renderer';
import { fromHalf } from '../../render/half';

export type Rect = [number, number, number, number];
export interface Plane { width: number; height: number; channels: number; data: Float32Array }
export interface ChannelStats { min: number; max: number; mean: number; std: number }
export interface PlaneStats { nonFinite: number; channels: ChannelStats[] }

const BYTES: Partial<Record<GPUTextureFormat, number>> = { r32float: 4, rgba16float: 8, rgba8unorm: 4 };

/** Copies a whole 2D texture to the CPU as floats (r32float, rgba16float or rgba8unorm), for dev checks only. */
export async function readPlane(device: GPUDevice, tex: GPUTexture): Promise<Plane> {
  const bpp = BYTES[tex.format];
  if (!bpp) throw new Error(`readPlane: unsupported format ${tex.format}`);
  const { width, height } = tex;
  const bytesPerRow = Math.ceil((width * bpp) / 256) * 256;
  const buffer = device.createBuffer({ label: 'rt dev readback', size: bytesPerRow * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const enc = device.createCommandEncoder();
  enc.copyTextureToBuffer({ texture: tex }, { buffer, bytesPerRow }, { width, height });
  device.queue.submit([enc.finish()]);
  await buffer.mapAsync(GPUMapMode.READ);
  const raw = new DataView(buffer.getMappedRange().slice(0));
  buffer.unmap();
  buffer.destroy();
  const channels = tex.format === 'r32float' ? 1 : 4;
  const data = new Float32Array(width * height * channels);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      for (let c = 0; c < channels; c++) {
        const at = y * bytesPerRow + (x * channels + c) * (bpp / channels);
        data[(y * width + x) * channels + c] = tex.format === 'r32float' ? raw.getFloat32(at, true) : tex.format === 'rgba16float' ? fromHalf(raw.getUint16(at, true)) : raw.getUint8(at) / 255;
      }
    }
  }
  return { width, height, channels, data };
}

export function pixelRect(p: Plane, frac: Rect): Rect {
  return [Math.floor(frac[0] * p.width), Math.floor(frac[1] * p.height), Math.max(Math.ceil(frac[2] * p.width), Math.floor(frac[0] * p.width) + 1), Math.max(Math.ceil(frac[3] * p.height), Math.floor(frac[1] * p.height) + 1)];
}

/** Per-channel min / max / mean / spatial standard deviation over a pixel rectangle (whole plane by default); non-finite values are counted and skipped. */
export function planeStats(p: Plane, rect: Rect = [0, 0, p.width, p.height]): PlaneStats {
  const stats: ChannelStats[] = [];
  let nonFinite = 0;
  for (let c = 0; c < p.channels; c++) {
    let min = Infinity, max = -Infinity, sum = 0, sum2 = 0, n = 0;
    for (let y = rect[1]; y < rect[3]; y++) {
      for (let x = rect[0]; x < rect[2]; x++) {
        const v = p.data[(y * p.width + x) * p.channels + c];
        if (!Number.isFinite(v)) { nonFinite++; continue; }
        min = Math.min(min, v); max = Math.max(max, v); sum += v; sum2 += v * v; n++;
      }
    }
    const mean = n ? sum / n : 0;
    stats.push({ min, max, mean, std: Math.sqrt(Math.max(n ? sum2 / n - mean * mean : 0, 0)) });
  }
  return { nonFinite, channels: stats };
}

export function luminance(p: Plane, rect: Rect): Float32Array {
  const w = rect[2] - rect[0], out = new Float32Array(w * (rect[3] - rect[1]));
  for (let y = rect[1]; y < rect[3]; y++) {
    for (let x = rect[0]; x < rect[2]; x++) {
      const i = (y * p.width + x) * p.channels;
      out[(y - rect[1]) * w + (x - rect[0])] = p.channels === 1 ? p.data[i] : 0.2126 * p.data[i] + 0.7152 * p.data[i + 1] + 0.0722 * p.data[i + 2];
    }
  }
  return out;
}

export interface SignalReport { sunShadow: PlaneStats; giDiffuse: PlaneStats; giSpecular: PlaneStats; hdr: PlaneStats; nonFinite: number }

/** NaN / inf census and value ranges of every RT output and the lit HDR image. */
export async function signalReport(renderer: Renderer): Promise<SignalReport> {
  const g = renderer['rc'].gbuf;
  const [s, d, sp, h] = await Promise.all([g.sunShadow, g.giDiffuse, g.giSpecular, g.hdr].map((t) => readPlane(renderer.device, t)));
  const r = { sunShadow: planeStats(s), giDiffuse: planeStats(d), giSpecular: planeStats(sp), hdr: planeStats(h) };
  return { ...r, nonFinite: r.sunShadow.nonFinite + r.giDiffuse.nonFinite + r.giSpecular.nonFinite + r.hdr.nonFinite };
}

export interface NoiseReport {
  frames: number;
  pixels: number;
  /** Mean over frames of the spatial std of the region, relative to its mean (coefficient of variation). */
  spatialCv: number;
  /** Mean over pixels of the std across frames, relative to the mean value. */
  temporalCv: number;
  mean: number;
}

/** Steps the renderer `frames` times and measures the noise of one RT signal inside a screen-fraction rectangle. */
export async function noiseStat(renderer: Renderer, step: () => void, signal: 'giDiffuse' | 'sunShadow' | 'giSpecular', frames: number, frac: Rect): Promise<NoiseReport> {
  let series: Float32Array[] = [];
  let spatial = 0;
  let rect: Rect = [0, 0, 1, 1];
  for (let f = 0; f < frames; f++) {
    step();
    const p = await readPlane(renderer.device, renderer['rc'].gbuf[signal]);
    if (f === 0) rect = pixelRect(p, frac);
    const lum = luminance(p, rect);
    series.push(lum);
    const mean = lum.reduce((a, v) => a + v, 0) / lum.length;
    const variance = lum.reduce((a, v) => a + (v - mean) * (v - mean), 0) / lum.length;
    spatial += mean > 1e-9 ? Math.sqrt(variance) / mean : 0;
  }
  const n = series[0].length;
  let temporal = 0, grand = 0;
  for (let i = 0; i < n; i++) {
    let m = 0;
    for (const s of series) m += s[i];
    m /= series.length;
    let v = 0;
    for (const s of series) v += (s[i] - m) * (s[i] - m);
    temporal += m > 1e-9 ? Math.sqrt(v / series.length) / m : 0;
    grand += m;
  }
  series = [];
  return { frames, pixels: n, spatialCv: spatial / frames, temporalCv: temporal / n, mean: grand / n };
}

/** Value of one RT texel (screen fractions) over `frames` consecutive frames: how fast a moving shadow's history clears. */
export async function seriesAt(renderer: Renderer, step: () => void, signal: 'giDiffuse' | 'sunShadow', frames: number, at: [number, number]): Promise<number[]> {
  const out: number[] = [];
  for (let f = 0; f < frames; f++) {
    step();
    const p = await readPlane(renderer.device, renderer['rc'].gbuf[signal]);
    const x = Math.min(p.width - 1, Math.floor(at[0] * p.width)), y = Math.min(p.height - 1, Math.floor(at[1] * p.height));
    const i = (y * p.width + x) * p.channels;
    out.push(p.channels === 1 ? p.data[i] : 0.2126 * p.data[i] + 0.7152 * p.data[i + 1] + 0.0722 * p.data[i + 2]);
  }
  return out;
}

/** Luminance of the latest RT output along a screen-space segment (fractions), `count` evenly spaced samples from (x0, y0) to (x1, y1). */
export async function lineOf(renderer: Renderer, signal: 'giDiffuse' | 'sunShadow' | 'giSpecular', from: [number, number], to: [number, number], count: number): Promise<number[]> {
  const p = await readPlane(renderer.device, renderer['rc'].gbuf[signal]);
  const out: number[] = [];
  for (let k = 0; k < count; k++) {
    const t = k / Math.max(count - 1, 1);
    const x = Math.min(p.width - 1, Math.floor((from[0] + (to[0] - from[0]) * t) * p.width));
    const y = Math.min(p.height - 1, Math.floor((from[1] + (to[1] - from[1]) * t) * p.height));
    const i = (y * p.width + x) * p.channels;
    out.push(p.channels === 1 ? p.data[i] : 0.2126 * p.data[i] + 0.7152 * p.data[i + 1] + 0.0722 * p.data[i + 2]);
  }
  return out;
}

export interface FrameDiff { meanAbs: number; p99: number; max: number; changedFraction: number }

/** Presented-frame difference between two consecutive frames (0..255 per channel). */
export async function frameDiff(renderer: Renderer, step: () => void): Promise<FrameDiff> {
  step();
  const a = (await renderer.capture()).rgba.slice();
  step();
  const b = (await renderer.capture()).rgba;
  const diffs = new Uint16Array(a.length / 4);
  let sum = 0, changed = 0, max = 0;
  for (let i = 0; i < diffs.length; i++) {
    const d = Math.max(Math.abs(a[i * 4] - b[i * 4]), Math.abs(a[i * 4 + 1] - b[i * 4 + 1]), Math.abs(a[i * 4 + 2] - b[i * 4 + 2]));
    diffs[i] = d;
    sum += d;
    if (d > 8) changed++;
    max = Math.max(max, d);
  }
  const sorted = diffs.slice().sort();
  return { meanAbs: sum / diffs.length, p99: sorted[Math.floor(sorted.length * 0.99)], max, changedFraction: changed / diffs.length };
}
