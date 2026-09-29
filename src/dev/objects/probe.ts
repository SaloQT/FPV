import type { Renderer } from '../../render/renderer';
import { fromHalf } from '../../render/half';

export interface MaterialProbe {
  pixels: number;
  /** Largest and mean motion vector length in render-target pixels over pixels of this material. */
  maxMotionPx: number;
  meanMotionPx: number;
}

export interface GBufferProbe {
  width: number;
  height: number;
  /** Keyed by MaterialId. */
  materials: Record<number, MaterialProbe>;
  /** Count of NaN/inf half floats across the HDR, normal and motion targets. */
  nonFinite: number;
  hdrMax: number;
}

async function readTexture(device: GPUDevice, tex: GPUTexture, bytesPerPixel: number): Promise<DataView> {
  const { width, height } = tex;
  const bytesPerRow = Math.ceil((width * bytesPerPixel) / 256) * 256;
  const buffer = device.createBuffer({ label: 'probe', size: bytesPerRow * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const enc = device.createCommandEncoder();
  enc.copyTextureToBuffer({ texture: tex }, { buffer, bytesPerRow }, { width, height });
  device.queue.submit([enc.finish()]);
  await buffer.mapAsync(GPUMapMode.READ);
  const src = new Uint8Array(buffer.getMappedRange());
  const out = new Uint8Array(width * height * bytesPerPixel);
  for (let y = 0; y < height; y++) out.set(src.subarray(y * bytesPerRow, y * bytesPerRow + width * bytesPerPixel), y * width * bytesPerPixel);
  buffer.unmap();
  buffer.destroy();
  return new DataView(out.buffer);
}

/** Reads the last frame's G-buffer back: per-material coverage and motion vector lengths, plus non-finite counts (dev checks only). */
export async function probeGBuffer(renderer: Renderer): Promise<GBufferProbe> {
  const gbuf = renderer['rc'].gbuf;
  const { width, height } = gbuf;
  const [misc, motion, normal, hdr] = await Promise.all([
    readTexture(renderer.device, gbuf.misc, 4),
    readTexture(renderer.device, gbuf.motion, 4),
    readTexture(renderer.device, gbuf.normal, 8),
    readTexture(renderer.device, gbuf.hdr, 8),
  ]);
  const sums: Record<number, { n: number; max: number; sum: number }> = {};
  let nonFinite = 0;
  let hdrMax = 0;
  for (let i = 0; i < width * height; i++) {
    const id = misc.getUint8(i * 4);
    const mx = fromHalf(motion.getUint16(i * 4, true)) * width;
    const my = fromHalf(motion.getUint16(i * 4 + 2, true)) * height;
    if (!Number.isFinite(mx) || !Number.isFinite(my)) nonFinite++;
    const len = Math.hypot(mx, my);
    const s = (sums[id] ??= { n: 0, max: 0, sum: 0 });
    s.n++;
    s.sum += len;
    if (len > s.max) s.max = len;
    for (let c = 0; c < 4; c++) {
      const h = fromHalf(hdr.getUint16(i * 8 + c * 2, true));
      if (Number.isFinite(h)) hdrMax = Math.max(hdrMax, h);
      else nonFinite++;
      if (!Number.isFinite(fromHalf(normal.getUint16(i * 8 + c * 2, true)))) nonFinite++;
    }
  }
  const materials: Record<number, MaterialProbe> = {};
  for (const [id, s] of Object.entries(sums)) materials[Number(id)] = { pixels: s.n, maxMotionPx: s.max, meanMotionPx: s.sum / s.n };
  return { width, height, materials, nonFinite, hdrMax };
}
