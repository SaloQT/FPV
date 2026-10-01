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

/** The share URL for a world: the page's own address with the world settings as query parameters. */
export function shareUrl(base: string, s: Pick<AppSettings, 'seed' | 'trackStyle' | 'gateCount' | 'laps' | 'difficulty'>): string {
  const u = new URL(base);
  u.search = '';
  u.hash = '';
  u.searchParams.set('seed', String(s.seed));
  u.searchParams.set('style', s.trackStyle);
  u.searchParams.set('gates', String(s.gateCount));
  u.searchParams.set('laps', String(s.laps));
  u.searchParams.set('diff', String(Math.round(s.difficulty * 100)));
  return u.toString();
}
