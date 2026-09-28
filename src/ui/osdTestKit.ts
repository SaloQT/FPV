import type { OsdContext, OsdSurface } from './osdTypes';

export interface DrawnText {
  text: string;
  x: number;
  y: number;
  align: string;
  color: string;
  font: string;
  alpha: number;
}

export interface DrawnLine {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Records what the OSD draws so tests can look at the result without a canvas. */
export class RecordingContext implements OsdContext {
  font = '';
  fillStyle: string | CanvasGradient | CanvasPattern = '';
  strokeStyle: string | CanvasGradient | CanvasPattern = '';
  lineWidth = 1;
  lineJoin: CanvasLineJoin = 'miter';
  lineCap: CanvasLineCap = 'butt';
  textAlign: CanvasTextAlign = 'start';
  textBaseline: CanvasTextBaseline = 'alphabetic';
  globalAlpha = 1;
  texts: DrawnText[] = [];
  lines: DrawnLine[] = [];
  rects: { x: number; y: number; w: number; h: number }[] = [];
  clears = 0;
  private pen: [number, number] = [0, 0];
  private path: DrawnLine[] = [];

  clearRect(): void {
    this.clears++;
    this.texts = [];
    this.lines = [];
    this.rects = [];
  }

  fillRect(x: number, y: number, w: number, h: number): void {
    this.rects.push({ x, y, w, h });
  }

  fillText(text: string, x: number, y: number): void {
    this.texts.push({ text, x, y, align: this.textAlign, color: String(this.fillStyle), font: this.font, alpha: this.globalAlpha });
  }

  strokeText(): void {}

  measureText(text: string): TextMetrics {
    const px = Number(/(\d+(?:\.\d+)?)px/.exec(this.font)?.[1] ?? 10);
    return { width: text.length * px * 0.6 } as TextMetrics;
  }

  beginPath(): void {
    this.path = [];
  }

  moveTo(x: number, y: number): void {
    this.pen = [x, y];
  }

  lineTo(x: number, y: number): void {
    this.path.push({ x0: this.pen[0], y0: this.pen[1], x1: x, y1: y });
    this.pen = [x, y];
  }

  /** Only the white pass is kept; the dark outline pass draws the same segments. */
  stroke(): void {
    if (this.strokeStyle === '#fff') this.lines.push(...this.path);
  }

  has(text: string): boolean {
    return this.texts.some((t) => t.text === text);
  }

  find(text: string): DrawnText | undefined {
    return this.texts.find((t) => t.text === text);
  }

  fontPx(text: string): number {
    return Number(/(\d+)px/.exec(this.find(text)?.font ?? '')?.[1] ?? NaN);
  }
}

export function makeSurface(cssW = 1280, cssH = 720): OsdSurface & { cssW: number; cssH: number } {
  return {
    width: 300, height: 150, cssW, cssH, style: { width: '', height: '' },
    get clientWidth(): number { return this.cssW; },
    get clientHeight(): number { return this.cssH; },
  };
}

/**
 * World-up component of the view ray through pixel (px, py) of an FPV camera tilted up by `tilt` on a body with attitude
 * `quat`: zero exactly where the picture shows the horizon. Built from the rotation matrix rows, independent of the HUD maths.
 */
export function rayWorldY(quat: readonly number[], tilt: number, fovY: number, w: number, h: number, px: number, py: number): number {
  const [x, y, z, qw] = quat;
  const bodyX = 2 * (x * y + z * qw), bodyY = 1 - 2 * (x * x + z * z), bodyZ = 2 * (y * z - x * qw);
  const s = Math.sin(tilt), c = Math.cos(tilt);
  const up = c * bodyY + s * bodyZ, look = s * bodyY - c * bodyZ;
  const focal = h / 2 / Math.tan(fovY / 2);
  return (px - w / 2) * bodyX - (py - h / 2) * up + focal * look;
}
