import type { AppSettings } from './settingsSchema';

export const MAX_SEED = 4294967295;
/** Random seeds stay short enough to read out loud and type in. */
export const RANDOM_SEED_RANGE = 1000000;

/** FNV-1a over the UTF-16 code units: a word seed always lands on the same world. */
export function hashSeed(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** A number is taken as written; any other text (a word, a name, a phrase) is hashed. Empty input is no seed. */
export function parseSeed(text: string): number | null {
  const t = text.trim();
  if (t.length === 0) return null;
  if (/^\d{1,10}$/.test(t)) {
    const n = Number(t);
    if (n <= MAX_SEED) return n;
  }
  return hashSeed(t.toLowerCase());
}

export function randomSeed(rand: () => number = Math.random): number {
  return Math.floor(rand() * RANDOM_SEED_RANGE);
}

/** What the seed field shows: the text the pilot typed while it still names the current seed, else the number. */
export function seedFieldText(typed: string, seed: number): string {
  return parseSeed(typed) === seed ? typed.trim() : String(seed);
}

/** The number beside a word seed ("= 2166136261"); nothing when the field already shows the number. */
export function seedNumberNote(text: string, seed: number): string {
  return text === String(seed) ? '' : `= ${seed}`;
}

/** The world on screen as a link must describe it: the terrain seed, the seed and the exact request the track came from. */
export interface ShareWorld {
  terrainSeed: number;
  trackSeed: number;
  style: AppSettings['trackStyle'];
  gateCount: number;
  laps: number;
  difficulty: number;
  quality: AppSettings['quality'];
}

type ShareSettings = Pick<AppSettings, 'seed' | 'trackStyle' | 'gateCount' | 'laps' | 'difficulty' | 'quality'>;

/** The world a link describes: the one on screen while it is the one the settings ask for, else what the settings would build. */
export function shareWorld(s: ShareSettings, w: ShareWorld | null): ShareWorld {
  if (w !== null) return w;
  return { terrainSeed: s.seed, trackSeed: s.seed, style: s.trackStyle, gateCount: s.gateCount, laps: s.laps, difficulty: s.difficulty, quality: s.quality };
}

/**
 * The share URL for a world: the page's own address with the world as query parameters. `seed` is the terrain, `tseed` the track
 * (only when it differs: the N key and the generator's retries move it), `style` and `gates` are what the track was built with.
 * The terrain grid depends on the quality tier, so `quality` rides along.
 */
export function shareUrl(base: string, w: ShareWorld): string {
  const u = new URL(base);
  u.search = '';
  u.hash = '';
  u.searchParams.set('seed', String(w.terrainSeed));
  if (w.trackSeed !== w.terrainSeed) u.searchParams.set('tseed', String(w.trackSeed));
  u.searchParams.set('style', w.style);
  u.searchParams.set('gates', String(w.gateCount));
  u.searchParams.set('laps', String(w.laps));
  u.searchParams.set('diff', String(Math.round(w.difficulty * 100)));
  u.searchParams.set('quality', w.quality);
  return u.toString();
}
