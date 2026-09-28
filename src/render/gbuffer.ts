import { FORMATS, type GBuffer } from './contracts';
import { scaledSize } from './dynamicRes';

/** Render-resolution size for an output size: round(out * renderScale * dynamicScale), even, >= 64 per axis. */
export function renderSize(outWidth: number, outHeight: number, renderScale: number, dynamicScale: number): { width: number; height: number } {
  return { width: scaledSize(outWidth, renderScale, dynamicScale), height: scaledSize(outHeight, renderScale, dynamicScale) };
}

/** Ray-tracing target size: ceil(render size / rtDivisor). */
export function rtSize(width: number, height: number, rtDivisor: number): { width: number; height: number } {
  return { width: Math.ceil(width / rtDivisor), height: Math.ceil(height / rtDivisor) };
}

type Key = keyof GBuffer['views'];
const KEYS: readonly Key[] = ['depth', 'albedo', 'normal', 'misc', 'motion', 'hdr', 'giDiffuse', 'giSpecular', 'sunShadow'];

/** Allocates every G-buffer and RT-domain texture. All start zeroed (giDiffuse/giSpecular alpha 0 = "no GI available") except sunShadow (1 = fully lit). */
export function createGBuffer(device: GPUDevice, width: number, height: number, rtDivisor: number): GBuffer {
  const rt = rtSize(width, height, rtDivisor);
  const U = GPUTextureUsage;
  const RASTER = U.RENDER_ATTACHMENT | U.TEXTURE_BINDING | U.COPY_SRC;
  const COMPUTE_WRITTEN = U.STORAGE_BINDING | U.TEXTURE_BINDING | U.COPY_SRC;
  const make = (label: string, format: GPUTextureFormat, w: number, h: number, usage: GPUTextureUsageFlags) =>
    device.createTexture({ label, format, size: [w, h], usage });
  const depth = make('gDepth', FORMATS.depth, width, height, RASTER);
  const albedo = make('gAlbedo', FORMATS.gAlbedo, width, height, RASTER);
  const normal = make('gNormal', FORMATS.gNormal, width, height, RASTER);
  const misc = make('gMisc', FORMATS.gMisc, width, height, RASTER);
  const motion = make('gMotion', FORMATS.gMotion, width, height, RASTER);
  const hdr = make('hdr', FORMATS.hdr, width, height, RASTER | U.STORAGE_BINDING);
  const giDiffuse = make('giDiffuse', FORMATS.giDiffuse, rt.width, rt.height, COMPUTE_WRITTEN | U.RENDER_ATTACHMENT);
  const giSpecular = make('giSpecular', FORMATS.giSpecular, rt.width, rt.height, COMPUTE_WRITTEN | U.RENDER_ATTACHMENT);
  const sunShadow = make('sunShadow', FORMATS.sunShadow, rt.width, rt.height, COMPUTE_WRITTEN | U.RENDER_ATTACHMENT);
  const tex = { depth, albedo, normal, misc, motion, hdr, giDiffuse, giSpecular, sunShadow };
  const views = {} as GBuffer['views'];
  for (const k of KEYS) views[k] = tex[k].createView(k === 'depth' ? { aspect: 'depth-only' } : undefined);
  clearToOne(device, views.sunShadow);
  return { width, height, ...tex, rtWidth: rt.width, rtHeight: rt.height, views };
}

// Without an RT module the key light must read as unshadowed, so the shadow term starts at 1 instead of 0.
function clearToOne(device: GPUDevice, view: GPUTextureView): void {
  const enc = device.createCommandEncoder({ label: 'sunShadow clear' });
  enc.beginRenderPass({ colorAttachments: [{ view, clearValue: [1, 1, 1, 1], loadOp: 'clear', storeOp: 'store' }] }).end();
  device.queue.submit([enc.finish()]);
}

export function destroyGBuffer(g: GBuffer): void {
  for (const k of KEYS) g[k].destroy();
}
