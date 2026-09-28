import type { HudModel } from './hud';
import { COLOR_AMBER, COLOR_GREEN, COLOR_RED, COLOR_WHITE, type Painter } from './osdPainter';

/** Gate, lap and lap-time readouts on the right, below the arm/mode block. */
export function drawRacePanel(p: Painter, m: HudModel): void {
  const r = m.race;
  if (!r.active) return;
  const right = p.width - p.marginX;
  let y = p.marginY + p.main + p.line * 2.6;
  p.useMain();
  p.text(r.gateText, right, y, 'right');
  y += p.line;
  p.text(r.lapText, right, y, 'right');
  y += p.line;
  p.pair('TIME', r.lapTimeText, right, y, 'right');
  y += p.line;
  p.pair('BEST', r.bestText, right, y, 'right');
  if (!r.splitVisible) return;
  y += p.line;
  p.pair('SPLIT', r.splitText, right, y, 'right', r.splitAhead ? COLOR_GREEN : COLOR_RED);
}

const CARD_ROWS_MAX = 10;

/** Centre card with the total, the best lap and every lap once the race is over. */
export function drawFinishCard(p: Painter, m: HudModel): void {
  const f = m.finish;
  if (!f.visible) return;
  const laps = Math.min(f.lapTexts.length, CARD_ROWS_MAX);
  const w = p.charMain * 24;
  const h = p.big * 1.4 + p.line * (3.2 + laps);
  const x = (p.width - w) / 2;
  let y = (p.height - h) / 2;
  p.fillRect(x, y, w, h, 'rgba(8,10,14,0.66)');
  const cx = p.width / 2;
  y += p.big * 1.15;
  p.useBig();
  p.text('FINISHED', cx, y, 'center', COLOR_GREEN);
  y += p.line * 1.3;
  p.pair('TOTAL', f.totalText, cx + w * 0.4, y, 'right');
  y += p.line;
  p.pair('BEST', f.bestText, cx + w * 0.4, y, 'right', COLOR_AMBER);
  y += p.line * 0.5;
  p.useMain();
  for (let i = 0; i < laps; i++) {
    y += p.line;
    p.text(f.lapTexts[i], cx, y, 'center', COLOR_WHITE);
  }
}
