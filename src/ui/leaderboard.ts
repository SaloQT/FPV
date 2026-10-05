/**
 * Leaderboards per track: the finishes of the pilot and of the trained brains, saved in `localStorage` under one versioned key.
 * A track is known by a short hash of its terrain (seed and quality tier) and of what decides the track itself: the recipe of a
 * track-builder track, or the gate list of any other track (a generated one, or one loaded from a file). Pure logic plus a small
 * store with an injectable storage, like the pilot options.
 */
import type { RenderQuality, TrackData } from '../contracts';
import { formatTime } from '../game/units';
import { recipeKey } from '../world/track/recipe';
import { hashSeed } from './seedModel';

export const LEADERBOARD_KEY = 'fpv.leaderboard.v1';
/** Finishes kept per track (the fastest). */
export const MAX_ENTRIES = 30;
/** Tracks kept; the ones not raced for the longest go first. */
export const MAX_BOARDS = 200;
const MAX_NAME = 60;
/** Two finishes this close (s) by the same pilot over the same laps are the same result (a benchmark run twice). */
const SAME_TIME_S = 0.0005;

export type PilotKind = 'you' | 'brain';

export interface LeaderEntry {
  /** "You", or the brain's name. */
  pilot: string;
  kind: PilotKind;
  /** Race time from the first gate to the finish, s. */
  total: number;
  /** Fastest lap, s (the whole run on a point-to-point track). */
  bestLap: number;
  laps: number;
  /** Gates flown past out of order on the way (each had to be flown again). */
  missed: number;
  /** When it was flown, ms since the epoch. */
  date: number;
}

export interface TrackBoard {
  key: string;
  /** What the board is shown as ("Custom track, seed 1234"). */
  name: string;
  /** Last time a finish was added, ms since the epoch. */
  updated: number;
  /** Fastest first, at most MAX_ENTRIES. */
  entries: LeaderEntry[];
}

export interface LeaderboardData {
  version: 1;
  boards: Record<string, TrackBoard>;
}

const round = (v: number, digits: number): number => {
  const k = 10 ** digits;
  return Math.round(v * k) / k;
};

/** What decides a track besides the terrain: the recipe's canonical key, else the gates in order with the lap count. */
export function trackIdentity(track: TrackData): string {
  if (track.recipe !== undefined) return `r:${recipeKey(track.recipe)}`;
  const gates = track.gates.map((g) => [g.kind, round(g.pos[0], 1), round(g.pos[1], 1), round(g.pos[2], 1), round(g.yaw, 2), round(g.width, 1), round(g.height, 1)].join(','));
  return `g:${track.closed ? 'c' : 'o'}${track.closed ? track.laps : 1}|${gates.join(';')}`;
}

/** The board key of a track on a terrain: 8 hex digits of FNV-1a. */
export function trackBoardKey(terrainSeed: number, quality: RenderQuality, track: TrackData): string {
  return hashSeed(`${terrainSeed >>> 0}|${quality}|${trackIdentity(track)}`).toString(16).padStart(8, '0');
}

function sameResult(a: LeaderEntry, b: LeaderEntry): boolean {
  return a.pilot === b.pilot && a.kind === b.kind && a.laps === b.laps && Math.abs(a.total - b.total) < SAME_TIME_S;
}

/** Faster total first; equal totals by the faster lap, then the earlier run. */
export function compareEntries(a: LeaderEntry, b: LeaderEntry): number {
  return a.total - b.total || a.bestLap - b.bestLap || a.date - b.date;
}

export function rankEntries(entries: readonly LeaderEntry[]): LeaderEntry[] {
  return [...entries].sort(compareEntries);
}

/**
 * Adds a finish to a board's entries. Returns the new entries (fastest first, capped) and the finish's place from 1, or 0 when it
 * was too slow to be kept. The same pilot finishing in the same time again counts once (its date moves on).
 */
export function insertEntry(entries: readonly LeaderEntry[], entry: LeaderEntry, max = MAX_ENTRIES): { entries: LeaderEntry[]; rank: number } {
  const same = entries.findIndex((e) => sameResult(e, entry));
  const kept = same >= 0 ? { ...entries[same], date: Math.max(entries[same].date, entry.date) } : entry;
  const list = same >= 0 ? entries.map((e, i) => (i === same ? kept : e)) : [...entries, entry];
  const sorted = rankEntries(list).slice(0, max);
  return { entries: sorted, rank: sorted.indexOf(kept) + 1 };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** One saved finish, or null when it is not a usable one. */
export function sanitizeEntry(raw: unknown): LeaderEntry | null {
  if (!isRecord(raw)) return null;
  const { pilot, kind, total, bestLap, laps, missed, date } = raw;
  if (typeof pilot !== 'string' || pilot.trim().length === 0) return null;
  if (kind !== 'you' && kind !== 'brain') return null;
  if (!finite(total) || total <= 0 || total > 1e6) return null;
  return {
    pilot: pilot.trim().slice(0, MAX_NAME),
    kind,
    total,
    bestLap: finite(bestLap) && bestLap > 0 && bestLap <= total + SAME_TIME_S ? bestLap : total,
    laps: finite(laps) ? Math.min(Math.max(Math.round(laps), 1), 99) : 1,
    missed: finite(missed) ? Math.max(Math.round(missed), 0) : 0,
    date: finite(date) && date > 0 ? date : 0,
  };
}

export function sanitizeBoard(key: string, raw: unknown): TrackBoard | null {
  if (!isRecord(raw) || !/^[0-9a-f]{8}$/.test(key)) return null;
  const entries = Array.isArray(raw.entries) ? raw.entries.map(sanitizeEntry).filter((e): e is LeaderEntry => e !== null) : [];
  if (entries.length === 0) return null;
  const name = typeof raw.name === 'string' && raw.name.trim().length > 0 ? raw.name.trim().slice(0, MAX_NAME) : 'Track';
  const updated = finite(raw.updated) ? raw.updated : Math.max(...entries.map((e) => e.date));
  return { key, name, updated, entries: rankEntries(entries).slice(0, MAX_ENTRIES) };
}

/** Keeps the MAX_BOARDS boards raced most recently. */
export function pruneBoards(boards: Record<string, TrackBoard>, max = MAX_BOARDS): Record<string, TrackBoard> {
  const list = Object.values(boards);
  if (list.length <= max) return boards;
  list.sort((a, b) => b.updated - a.updated);
  return Object.fromEntries(list.slice(0, max).map((b) => [b.key, b]));
}

/** Validates an untrusted saved copy: unknown keys, broken boards and broken entries are dropped. */
export function sanitizeLeaderboard(raw: unknown): LeaderboardData {
  const boards: Record<string, TrackBoard> = {};
  if (isRecord(raw) && raw.version === 1 && isRecord(raw.boards)) {
    for (const [key, b] of Object.entries(raw.boards)) {
      const board = sanitizeBoard(key, b);
      if (board !== null) boards[key] = board;
    }
  }
  return { version: 1, boards: pruneBoards(boards) };
}

/** A board row as text. */
export interface LeaderRow {
  rank: number;
  pilot: string;
  kind: PilotKind;
  total: string;
  best: string;
  /** YYYY-MM-DD (UTC). */
  date: string;
  /** The finish just added. */
  fresh: boolean;
}

export function leaderRows(entries: readonly LeaderEntry[], fresh: LeaderEntry | null = null, limit = MAX_ENTRIES): LeaderRow[] {
  return entries.slice(0, limit).map((e, i) => ({
    rank: i + 1,
    pilot: e.pilot,
    kind: e.kind,
    total: formatTime(e.total),
    best: formatTime(e.bestLap),
    date: e.date > 0 ? new Date(e.date).toISOString().slice(0, 10) : '',
    fresh: fresh !== null && sameResult(e, fresh),
  }));
}

export interface LeaderStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function browserStorage(): LeaderStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** Calls `fn` when another tab of the page changes `key` in localStorage; nothing outside a browser. */
export function onStorageKey(storage: unknown, key: string, fn: () => void): void {
  try {
    if (typeof window === 'undefined' || typeof localStorage === 'undefined' || storage !== localStorage) return;
    window.addEventListener('storage', (e) => {
      if (e.key === key || e.key === null) fn();
    });
  } catch {
    // No storage events (blocked storage): each tab keeps its own copy.
  }
}

/**
 * The saved leaderboards. Every change re-reads what is saved first, and a change made in another tab is read back, so two
 * open tabs add to the same boards instead of overwriting each other. Blocked or full storage keeps working in memory for the
 * session.
 */
export class LeaderboardStore {
  private data: LeaderboardData;
  /** Storage failed once: from then on the copy in memory is the only one. */
  private local = false;
  /** Another tab changed the saved boards since they were read. */
  private stale = false;
  private readonly listeners = new Set<(key: string) => void>();

  constructor(private readonly storage: LeaderStorage | null = browserStorage()) {
    this.data = this.load();
    onStorageKey(storage, LEADERBOARD_KEY, () => {
      this.stale = true;
      for (const fn of [...this.listeners]) fn('');
    });
  }

  board(key: string): TrackBoard | null {
    this.sync(false);
    return this.data.boards[key] ?? null;
  }

  boards(): readonly TrackBoard[] {
    this.sync(false);
    return Object.values(this.data.boards).sort((a, b) => b.updated - a.updated);
  }

  /** Adds a finish; returns its place from 1, or 0 when it was not fast enough to be kept. */
  record(key: string, name: string, entry: LeaderEntry): number {
    const clean = sanitizeEntry(entry);
    if (clean === null) return 0;
    this.sync(true);
    const old = this.data.boards[key];
    const { entries, rank } = insertEntry(old?.entries ?? [], clean);
    const board: TrackBoard = { key, name: old?.name ?? name.slice(0, MAX_NAME), updated: Math.max(old?.updated ?? 0, clean.date), entries };
    this.data = { version: 1, boards: pruneBoards({ ...this.data.boards, [key]: board }) };
    this.save();
    for (const fn of [...this.listeners]) fn(key);
    return rank;
  }

  clear(key: string): void {
    this.sync(true);
    if (!(key in this.data.boards)) return;
    const boards = { ...this.data.boards };
    delete boards[key];
    this.data = { version: 1, boards };
    this.save();
    for (const fn of [...this.listeners]) fn(key);
  }

  /** Listens for changed boards (the key of the board); returns the unsubscribe. */
  subscribe(fn: (key: string) => void): () => void {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }

  /** Reads the saved boards again: before a change (`always`), or when another tab changed them. */
  private sync(always: boolean): void {
    if (this.storage === null || this.local || (!always && !this.stale)) return;
    this.stale = false;
    this.data = this.load();
  }

  private load(): LeaderboardData {
    let text: string | null;
    try {
      text = this.storage?.getItem(LEADERBOARD_KEY) ?? null;
    } catch {
      this.local = true;
      return { version: 1, boards: {} };
    }
    try {
      return text === null ? { version: 1, boards: {} } : sanitizeLeaderboard(JSON.parse(text));
    } catch {
      return { version: 1, boards: {} };
    }
  }

  private save(): void {
    try {
      this.storage?.setItem(LEADERBOARD_KEY, JSON.stringify(this.data));
    } catch {
      // Blocked or full storage: the boards keep working for this visit.
      this.local = true;
    }
  }
}
