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

const COUNT_COLORS: Readonly<Record<number, string>> = { 3: COLOR_WHITE, 2: COLOR_AMBER, 1: COLOR_RED, 0: COLOR_GREEN };
/** The number fades from full to this alpha over its second, so each new one reads as a fresh beat. */
const COUNT_FADE_TO = 0.55;

/** The 3-2-1-GO of a race start in the middle of the picture, with a one-line caption under it. */
export function drawCountdown(p: Painter, m: HudModel): void {
  const c = m.countdown;
  if (!c.visible) return;
  const cx = p.width / 2;
  const y = p.height * 0.44;
  p.alpha(1 - (1 - COUNT_FADE_TO) * c.fraction);
  if (c.text.length > 0) {
    p.useHuge();
    p.text(c.text, cx, y + p.huge * 0.35, 'center', COUNT_COLORS[c.value] ?? COLOR_WHITE);
  }
  p.alpha(1);
  p.useBig();
  p.text(c.caption, cx, c.text.length > 0 ? y + p.huge * 0.35 + p.big * 1.6 : y, 'center', c.value === 0 ? COLOR_GREEN : COLOR_WHITE);
}
