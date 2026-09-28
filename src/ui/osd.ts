import type { HudModel } from './hud';
import { addCrosshair, addHorizon, SegmentBatch } from './osdHorizon';
import { COLOR_AMBER, COLOR_GREEN, COLOR_RED, COLOR_WHITE, Painter } from './osdPainter';
import { drawFinishCard, drawRacePanel } from './osdRace';
import type { OsdContext, OsdSurface } from './osdTypes';

const FLASH_PERIOD_MS = 1000;
const CRITICAL_FLASH_PERIOD_MS = 500;

function flashOn(nowMs: number, periodMs: number): boolean {
  return nowMs % periodMs < periodMs / 2;
}

/**
 * Betaflight-style on-screen display on the 2D `#osd` canvas. Draws from a `HudModel` without allocating; sizes come from
 * the canvas height so it looks the same at any resolution and device pixel ratio.
 */
export class OsdRenderer {
  private readonly painter: Painter;
  private readonly cross = new SegmentBatch();
  private readonly horizon = new SegmentBatch();

  constructor(
    private readonly surface: OsdSurface,
    private readonly g: OsdContext,
    private readonly pixelRatio: () => number = () => globalThis.devicePixelRatio || 1,
  ) {
    this.painter = new Painter(g);
    surface.style.width = '100%';
    surface.style.height = '100%';
  }

  static forCanvas(canvas: HTMLCanvasElement): OsdRenderer {
    const g = canvas.getContext('2d');
    if (g === null) throw new Error('2D canvas is not available for the OSD');
    return new OsdRenderer(canvas, g);
  }

  /** Matches the backing store to the displayed size in device pixels; true if it changed. */
  resize(): boolean {
    const ratio = this.pixelRatio();
    const w = Math.round(this.surface.clientWidth * ratio);
    const h = Math.round(this.surface.clientHeight * ratio);
    if (w < 1 || h < 1 || (w === this.surface.width && h === this.surface.height)) return false;
    this.surface.width = w;
    this.surface.height = h;
    return true;
  }

  clear(): void {
    this.g.clearRect(0, 0, this.surface.width, this.surface.height);
  }

  draw(m: HudModel, nowMs: number): void {
    this.resize();
    this.clear();
    if (!m.visible) return;
    const p = this.painter;
    p.layout(this.surface.width, this.surface.height, m.osdScale);
    p.begin();
    if (m.fpv) this.drawAttitude(m);
    this.drawCorners(m, nowMs);
    drawRacePanel(p, m);
    this.drawWarnings(m, nowMs);
    drawFinishCard(p, m);
  }

  private drawAttitude(m: HudModel): void {
    const p = this.painter;
    const cx = p.width / 2, cy = p.height / 2;
    this.cross.clear();
    this.horizon.clear();
    addCrosshair(this.cross, cx, cy, p.unit);
    addHorizon(this.horizon, { cx, cy, width: p.width, height: p.height, unit: p.unit, cameraPitch: m.camera.pitch, roll: m.camera.roll, fovY: m.fovY });
    this.horizon.stroke(this.g, p.unit, 0.5);
    this.cross.stroke(this.g, p.unit, 0.9);
  }

  private drawCorners(m: HudModel, nowMs: number): void {
    const p = this.painter;
    const left = p.marginX, right = p.width - p.marginX, cx = p.width / 2;
    const top = p.marginY + p.main;
    const bottom = p.height - p.marginY - p.main * 0.25;
    const cellColor = m.criticalBattery ? (flashOn(nowMs, CRITICAL_FLASH_PERIOD_MS) ? COLOR_RED : COLOR_WHITE) : m.lowBattery ? (flashOn(nowMs, FLASH_PERIOD_MS) ? COLOR_AMBER : COLOR_WHITE) : COLOR_WHITE;
    p.useMain();
    p.text(m.cellText, left, top, 'left', cellColor);
    p.text(m.timerText, cx, top + p.line * 0.9, 'center');
    p.text(m.armed ? 'ARMED' : 'DISARMED', right, top, 'right', m.armed ? COLOR_GREEN : COLOR_WHITE);
    p.text(m.modeText, right, top + p.line, 'right');
    p.text(m.currentText, left, bottom - p.line, 'left');
    p.text(m.speedText, right, bottom - p.line, 'right');
    p.useSmall();
    p.text(m.packText, left, top + p.line * 0.85, 'left');
    p.text(m.mahText, left, top + p.line * 1.65, 'left');
    p.text('FLY', cx, top, 'center');
    p.pair('THR', m.throttleText, left, bottom, 'left');
    p.pair(m.altAgl ? 'AGL' : 'ALT', m.altText, right, bottom, 'right');
    p.alpha(0.6);
    p.useSmall();
    p.text('F1 CONTROLS', cx, bottom, 'center');
    p.alpha(1);
  }

  private drawWarnings(m: HudModel, nowMs: number): void {
    const p = this.painter;
    const cx = p.width / 2;
    let y = p.height * 0.66;
    p.useBig();
    if (m.paused) p.text('PAUSED', cx, p.height * 0.32, 'center');
    if (m.crash) {
      p.text('CRASH', cx, y, 'center', COLOR_RED);
      y += p.big * 1.25;
    }
    if (m.lowBattery && flashOn(nowMs, m.criticalBattery ? CRITICAL_FLASH_PERIOD_MS : FLASH_PERIOD_MS)) {
      p.text('LOW BATTERY', cx, y, 'center', m.criticalBattery ? COLOR_RED : COLOR_AMBER);
    }
    if (m.lowBattery) y += p.big * 1.25;
    if (m.throttleHigh) {
      p.text('THROTTLE HIGH', cx, y, 'center', COLOR_AMBER);
      y += p.big * 1.25;
    }
    if (m.turtle) {
      p.text('TURTLE MODE', cx, y, 'center', COLOR_AMBER);
      y += p.big * 1.25;
    }
    if (m.race.missedVisible) {
      p.text(m.race.missedText, cx, y, 'center', COLOR_AMBER);
      y += p.big * 1.25;
    }
    p.useMain();
    if (m.message.length > 0) {
      p.text(m.message, cx, y, 'center');
      y += p.line * 1.3;
    }
    if (m.respawn) p.text('PRESS R TO RESPAWN', cx, y, 'center');
  }
}
