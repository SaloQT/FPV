/** Pure image measurements for the post dev page's numeric checks (sRGB8 RGBA readbacks and half-float textures). */

const SRGB_TO_LINEAR = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  SRGB_TO_LINEAR[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export interface Region { x0: number; y0: number; x1: number; y1: number }

/** Rec.709 luminance of the RGBA8 pixel at pixel index `i`, decoded from sRGB. */
export function linearLuma(rgba: Uint8Array, i: number): number {
  const o = i * 4;
  return 0.2126 * SRGB_TO_LINEAR[rgba[o]] + 0.7152 * SRGB_TO_LINEAR[rgba[o + 1]] + 0.0722 * SRGB_TO_LINEAR[rgba[o + 2]];
}

export function meanLuminance(rgba: Uint8Array, width: number, height: number, region: Region = { x0: 0, y0: 0, x1: width, y1: height }): number {
  let sum = 0;
  for (let y = region.y0; y < region.y1; y++) for (let x = region.x0; x < region.x1; x++) sum += linearLuma(rgba, y * width + x);
  return sum / Math.max(1, (region.x1 - region.x0) * (region.y1 - region.y0));
}

/** Pixels that are exactly black while all four neighbours are lit: the signature of a NaN/Inf that a stage turned into 0. */
export function countIsolatedBlack(rgba: Uint8Array, width: number, height: number, neighbourMin = 16): number {
  const lit = (x: number, y: number): boolean => {
    const o = (y * width + x) * 4;
    return Math.max(rgba[o], rgba[o + 1], rgba[o + 2]) >= neighbourMin;
  };
  let n = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const o = (y * width + x) * 4;
      if ((rgba[o] | rgba[o + 1] | rgba[o + 2]) === 0 && lit(x - 1, y) && lit(x + 1, y) && lit(x, y - 1) && lit(x, y + 1)) n++;
    }
  }
  return n;
}

/**
 * Luminance-weighted centroid (in pixel-centre coordinates, so a line covering pixels 59 and 60 sits at 60) of the bright line near
 * `expected`. `axis` 'x' measures a vertical line: columns [expected - halfWidth, expected + halfWidth) averaged over the rows in `band`.
 */
export function lineCentroid(rgba: Uint8Array, width: number, axis: 'x' | 'y', expected: number, halfWidth: number, band: [number, number]): number {
  const start = Math.round(expected) - halfWidth;
  const profile: number[] = [];
  for (let k = 0; k < 2 * halfWidth; k++) {
    let sum = 0;
    for (let b = band[0]; b < band[1]; b++) sum += axis === 'x' ? linearLuma(rgba, b * width + start + k) : linearLuma(rgba, (start + k) * width + b);
    profile.push(sum / (band[1] - band[0]));
  }
  const base = Math.min(...profile);
  let weight = 0;
  let moment = 0;
  profile.forEach((p, k) => { weight += p - base; moment += (p - base) * (start + k + 0.5); });
  return weight > 0 ? moment / weight : NaN;
}

/** Count of NaN/Inf values in raw half-float data (exponent bits all ones). */
export function countNonFiniteHalf(data: Uint16Array): number {
  let n = 0;
  for (let i = 0; i < data.length; i++) if ((data[i] & 0x7c00) === 0x7c00) n++;
  return n;
}

/** Reads a whole rgba16float texture (COPY_SRC) back as raw halves, 4 per pixel, rows tightly packed. */
export async function readHalfTexture(device: GPUDevice, tex: GPUTexture): Promise<Uint16Array> {
  const { width, height } = tex;
  const rowBytes = width * 8;
  const bytesPerRow = Math.ceil(rowBytes / 256) * 256;
  const buffer = device.createBuffer({ label: 'post probe', size: bytesPerRow * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const enc = device.createCommandEncoder();
  enc.copyTextureToBuffer({ texture: tex }, { buffer, bytesPerRow }, { width, height });
  device.queue.submit([enc.finish()]);
  await buffer.mapAsync(GPUMapMode.READ);
  const src = new Uint8Array(buffer.getMappedRange());
  const out = new Uint8Array(rowBytes * height);
  for (let y = 0; y < height; y++) out.set(src.subarray(y * bytesPerRow, y * bytesPerRow + rowBytes), y * rowBytes);
  buffer.unmap();
  buffer.destroy();
  return new Uint16Array(out.buffer);
}
