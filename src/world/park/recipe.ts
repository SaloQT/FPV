import { COASTER_FAMILIES, FLAT_FAMILIES, PARK_LAYOUTS, PARK_SIZES, PARK_THEMES, type ParkRecipe, type ParkSize, type ParkTheme, type ParkPalette } from './types';
export const PARK_PRESETS: Record<ParkSize, { coasters: number; rides: number; guests: number; radius: number }> = {
  compact: { coasters: 3, rides: 10, guests: 1000, radius: 430 },
  destination: { coasters: 7, rides: 18, guests: 3000, radius: 620 },
  mega: { coasters: 10, rides: 32, guests: 10000, radius: 760 },
};
export { COASTER_FAMILIES, FLAT_FAMILIES };
export function defaultParkRecipe(seed = 1337, size: ParkSize = 'destination'): ParkRecipe {
  return { version: 1, seed: seed >>> 0, size, layout: 'random', theme: 'mixed', guests: PARK_PRESETS[size].guests, route: 'free', coaster: 0 };
}
export function sanitizeParkRecipe(raw: unknown): ParkRecipe {
  const r = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  if (r.version !== undefined && r.version !== 1) throw new Error('Unsupported theme park recipe version');
  const size = PARK_SIZES.includes(r.size as ParkSize) ? r.size as ParkSize : 'destination';
  const out = defaultParkRecipe(1337, size);
  const n = (v: unknown, fb: number, lo: number, hi: number): number => typeof v === 'number' && Number.isFinite(v) ? Math.round(Math.max(lo, Math.min(hi, v))) : fb;
  out.seed = n(r.seed, out.seed, 0, 4294967295);
  out.guests = n(r.guests, out.guests, 0, 10000);
  if (r.layout === 'random' || PARK_LAYOUTS.includes(r.layout as never)) out.layout = r.layout as ParkRecipe['layout'];
  if (r.theme === 'mixed' || PARK_THEMES.includes(r.theme as never)) out.theme = r.theme as ParkRecipe['theme'];
  if (r.route === 'free' || r.route === 'tour' || r.route === 'coaster' || r.route === 'race') out.route = r.route;
  out.coaster = n(r.coaster, 0, 0, PARK_PRESETS[size].coasters - 1);
  return out;
}
export function parkRecipeKey(recipe: ParkRecipe): string { return JSON.stringify(sanitizeParkRecipe(recipe)); }
export const PALETTES: Record<ParkTheme, ParkPalette> = {
  space: { primary: [0.11, 0.22, 0.38], secondary: [0.54, 0.62, 0.7], accent: [0.04, 0.68, 0.95], timber: [0.19, 0.24, 0.29], ground: [0.12, 0.15, 0.2] },
  fantasy: { primary: [0.45, 0.12, 0.24], secondary: [0.53, 0.44, 0.32], accent: [0.95, 0.56, 0.12], timber: [0.25, 0.14, 0.07], ground: [0.28, 0.24, 0.19] },
  jungle: { primary: [0.12, 0.29, 0.12], secondary: [0.37, 0.32, 0.19], accent: [0.75, 0.32, 0.07], timber: [0.2, 0.12, 0.05], ground: [0.24, 0.2, 0.13] },
  western: { primary: [0.4, 0.14, 0.06], secondary: [0.58, 0.39, 0.17], accent: [0.91, 0.66, 0.18], timber: [0.3, 0.15, 0.06], ground: [0.36, 0.29, 0.19] },
  seaside: { primary: [0.04, 0.36, 0.46], secondary: [0.68, 0.68, 0.57], accent: [0.94, 0.22, 0.09], timber: [0.39, 0.28, 0.15], ground: [0.41, 0.38, 0.29] },
  steampunk: { primary: [0.23, 0.29, 0.24], secondary: [0.42, 0.22, 0.1], accent: [0.75, 0.47, 0.12], timber: [0.19, 0.12, 0.08], ground: [0.18, 0.16, 0.13] },
  alpine: { primary: [0.19, 0.36, 0.29], secondary: [0.55, 0.58, 0.57], accent: [0.69, 0.13, 0.07], timber: [0.28, 0.17, 0.08], ground: [0.27, 0.26, 0.22] },
  carnival: { primary: [0.53, 0.05, 0.12], secondary: [0.17, 0.15, 0.47], accent: [0.98, 0.67, 0.07], timber: [0.31, 0.19, 0.09], ground: [0.26, 0.23, 0.2] },
};
