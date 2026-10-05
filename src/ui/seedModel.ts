import type { TrackRecipe, TrackStyle } from '../contracts';
import { recipeKey, sanitizeRecipe } from '../world/track/recipe';
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
  style: TrackStyle;
  gateCount: number;
  laps: number;
  difficulty: number;
  quality: AppSettings['quality'];
  /** A track-builder track: the recipe it was built from (the link then carries only the terrain and `trk`). */
  recipe?: TrackRecipe;
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
export function shareUrl(base: string, w: ShareWorld, extra: Readonly<Record<string, string>> = {}): string {
  const u = new URL(base);
  u.search = '';
  u.hash = '';
  u.searchParams.set('seed', String(w.terrainSeed));
  for (const [k, v] of Object.entries(extra)) u.searchParams.set(k, v);
  if (w.recipe !== undefined) {
    // The recipe holds the track's seed, gates, laps and difficulty; the terrain grid still depends on the quality tier.
    u.searchParams.set('quality', w.quality);
    u.searchParams.set('trk', encodeRecipe(w.recipe));
    return u.toString();
  }
  if (w.trackSeed !== w.terrainSeed) u.searchParams.set('tseed', String(w.trackSeed));
  u.searchParams.set('style', w.style);
  u.searchParams.set('gates', String(w.gateCount));
  u.searchParams.set('laps', String(w.laps));
  u.searchParams.set('diff', String(Math.round(w.difficulty * 100)));
  u.searchParams.set('quality', w.quality);
  return u.toString();
}

/** The world on screen is a track loaded from a file: no link can rebuild it, only its terrain. */
export interface FileTrackWorld {
  fileTrack: true;
  terrainSeed: number;
  quality: AppSettings['quality'];
}

/** What a share link describes: a world, the settings' world (null, while it is still being built), or a file track's terrain. */
export type SharedWorld = ShareWorld | FileTrackWorld | null;

/**
 * The share link of the menu. A file track has no link of its own, so it gets one that opens the track builder on its terrain
 * (seed, quality, `mode=builder`), where the file can be imported again; everything else is `shareUrl` of `shareWorld`.
 */
export function menuShareUrl(base: string, s: ShareSettings, w: SharedWorld): string {
  if (w !== null && 'fileTrack' in w) {
    const u = new URL(base);
    u.search = '';
    u.hash = '';
    u.searchParams.set('seed', String(w.terrainSeed));
    u.searchParams.set('quality', w.quality);
    u.searchParams.set('mode', 'builder');
    return u.toString();
  }
  return shareUrl(base, shareWorld(s, w));
}

/** Bytes of text as base64url without padding (the alphabet that survives a query string unescaped). */
export function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** The text a `toBase64Url` string carries, or null when it is not one. */
export function fromBase64Url(code: string): string | null {
  if (!/^[A-Za-z0-9_-]*$/.test(code)) return null;
  try {
    const bin = atob(code.replace(/-/g, '+').replace(/_/g, '/'));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/** A recipe as the `trk=` value of a share link: its canonical JSON (`recipeKey`), base64url. */
export function encodeRecipe(recipe: TrackRecipe): string {
  return toBase64Url(recipeKey(recipe));
}

/** The recipe in a `trk=` value, sanitised; null when the value is not one (damaged or cut-off links). */
export function decodeRecipe(code: string): TrackRecipe | null {
  const text = fromBase64Url(code.trim());
  if (text === null || text.length === 0) return null;
  try {
    const raw: unknown = JSON.parse(text);
    return typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? sanitizeRecipe(raw) : null;
  } catch {
    return null;
  }
}
