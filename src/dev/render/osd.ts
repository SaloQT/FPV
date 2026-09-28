import type { Renderer, RenderStats } from '../../render/renderer';

/** One line of renderer stats in the top-left corner of the OSD canvas. */
export function drawOsd(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement, s: RenderStats, time: string): void {
  g.clearRect(0, 0, canvas.width, canvas.height);
  g.font = '12px monospace';
  g.fillStyle = '#fff';
  g.shadowColor = '#000';
  g.shadowBlur = 3;
  const gpu = s.gpuMs === null ? 'n/a' : s.gpuMs.toFixed(1);
  g.fillText(`${time}  ${s.renderWidth}x${s.renderHeight} -> ${s.outWidth}x${s.outHeight}  scale ${s.dynamicScale.toFixed(2)}  ${s.fps.toFixed(0)} fps  gpu ${gpu} ms`, 8, 16);
}

export interface ImageProbe { width: number; height: number; mean: number[]; top: number[]; bottom: number[]; maxChannel: number }

/** Reads the presented frame back and summarises it (mean colour overall, top quarter, bottom quarter), for headless checks. */
export async function probeImage(r: Renderer): Promise<ImageProbe> {
  const { width, height, rgba } = await r.capture();
  const region = (y0: number, y1: number): number[] => {
    const sum = [0, 0, 0];
    for (let y = y0; y < y1; y++) for (let x = 0; x < width; x++) for (let c = 0; c < 3; c++) sum[c] += rgba[(y * width + x) * 4 + c];
    const n = Math.max(1, (y1 - y0) * width);
    return sum.map((v) => Math.round((v / n) * 10) / 10);
  };
  let maxChannel = 0;
  for (let i = 0; i < rgba.length; i += 4) maxChannel = Math.max(maxChannel, rgba[i], rgba[i + 1], rgba[i + 2]);
  const q = Math.floor(height / 4);
  return { width, height, mean: region(0, height), top: region(0, q), bottom: region(height - q, height), maxChannel };
}
