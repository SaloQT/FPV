import { STYLE_SPECS } from '../world/track/styles';
import type { AppSettings } from './settingsSchema';

type Style = AppSettings['trackStyle'];

/** The gate counts a style can really build; the generator clamps anything else into this range. */
export function gateRange(style: Style): { min: number; max: number } {
  const s = STYLE_SPECS[style];
  return { min: s.minGates, max: s.maxGates };
}

export function effectiveGates(style: Style, requested: number): number {
  const { min, max } = gateRange(style);
  return Math.min(Math.max(Math.round(requested), min), max);
}

/** One line on what a style builds: "Circuit, 10 to 18 gates, 500 to 900 m a lap". */
export function describeStyle(style: Style): string {
  const s = STYLE_SPECS[style];
  const len = s.minLength >= 1000 ? `${s.minLength / 1000} to ${s.maxLength / 1000} km` : `${s.minLength} to ${s.maxLength} m`;
  return `${s.closed ? 'Circuit' : 'Point to point'}, ${s.minGates} to ${s.maxGates} gates, ${len}${s.closed ? ' a lap' : ''}`;
}

/** Only circuits repeat: a point-to-point course is flown once whatever the laps setting says. */
export function lapsApply(style: Style): boolean {
  return STYLE_SPECS[style].closed;
}

export function effectiveLaps(style: Style, requested: number): number {
  return lapsApply(style) ? requested : 1;
}
