import type { OsdContext } from './osdTypes';

const FONT_STACK = 'ui-monospace, "SF Mono", Menlo, Consolas, "DejaVu Sans Mono", "Liberation Mono", monospace';

export const COLOR_WHITE = '#fff';
export const COLOR_RED = '#ff5252';
export const COLOR_AMBER = '#ffc233';
export const COLOR_GREEN = '#62f58a';

/** Font sizes in pixels at 1080p; everything scales with the canvas height. */
const SIZE_MAIN = 28;
const SIZE_SMALL = 19;
const SIZE_BIG = 44;

/** Shared text state of the OSD: the scaled layout, cached font strings and outlined text drawing. */
export class Painter {
  width = 0;
  height = 0;
  unit = 1;
  marginX = 0;
  marginY = 0;
  main = 0;
  small = 0;
  big = 0;
  /** Row pitch of the main font. */
  line = 0;
  charMain = 0;
  charSmall = 0;
  private fontMain = '';
  private fontSmall = '';
  private fontBig = '';
  private scale = NaN;

  constructor(private readonly g: OsdContext) {}

  /** Recomputes sizes when the canvas or the user's OSD scale changed. */
  layout(width: number, height: number, osdScale: number): void {
    if (width === this.width && height === this.height && osdScale === this.scale) return;
    this.width = width;
    this.height = height;
    this.scale = osdScale;
    const u = Math.max(0.35, (height / 1080) * osdScale);
    this.unit = u;
    this.main = Math.max(10, Math.round(SIZE_MAIN * u));
    this.small = Math.max(8, Math.round(SIZE_SMALL * u));
    this.big = Math.max(14, Math.round(SIZE_BIG * u));
    this.line = Math.round(this.main * 1.25);
    this.marginX = Math.round(width * 0.03);
    this.marginY = Math.round(height * 0.045);
    this.fontMain = `600 ${this.main}px ${FONT_STACK}`;
    this.fontSmall = `600 ${this.small}px ${FONT_STACK}`;
    this.fontBig = `700 ${this.big}px ${FONT_STACK}`;
    this.g.font = this.fontMain;
    this.charMain = this.g.measureText('0').width;
    this.g.font = this.fontSmall;
    this.charSmall = this.g.measureText('0').width;
  }

  /** Per-frame drawing state; a resized canvas forgets it. */
  begin(): void {
    const g = this.g;
    g.lineJoin = 'round';
    g.lineCap = 'round';
    g.strokeStyle = 'rgba(0,0,0,0.9)';
    g.lineWidth = Math.max(3, Math.round(this.main * 0.22));
    g.globalAlpha = 1;
  }

  useMain(): void {
    this.g.font = this.fontMain;
  }

  useSmall(): void {
    this.g.font = this.fontSmall;
  }

  useBig(): void {
    this.g.font = this.fontBig;
  }

  /** White-on-black outlined text in the current font; `y` is the baseline. */
  text(s: string, x: number, y: number, align: CanvasTextAlign, color: string = COLOR_WHITE): void {
    if (s.length === 0) return;
    const g = this.g;
    g.textAlign = align;
    g.strokeText(s, x, y);
    g.fillStyle = color;
    g.fillText(s, x, y);
  }

  /** Small caption followed by a main-size value, laid out from `x` towards the right ('left') or towards the left ('right'). */
  pair(caption: string, value: string, x: number, y: number, align: 'left' | 'right', color: string = COLOR_WHITE): void {
    this.useSmall();
    if (align === 'left') {
      this.text(caption, x, y, 'left', color);
      this.useMain();
      this.text(value, x + (caption.length + 1) * this.charSmall, y, 'left', color);
    } else {
      this.useMain();
      this.text(value, x, y, 'right', color);
      this.useSmall();
      this.text(caption, x - (value.length + 1) * this.charMain, y, 'right', color);
    }
  }

  fillRect(x: number, y: number, w: number, h: number, color: string): void {
    this.g.fillStyle = color;
    this.g.fillRect(x, y, w, h);
  }

  alpha(a: number): void {
    this.g.globalAlpha = a;
  }
}
