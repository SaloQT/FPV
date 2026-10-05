import { describe, expect, it } from 'vitest';
import { makeTrack } from '../game/testKit';
import { defaultRecipe } from '../world/track/recipe';
import {
  LEADERBOARD_KEY, LeaderboardStore, MAX_BOARDS, MAX_ENTRIES, insertEntry, leaderRows, pruneBoards, rankEntries, sanitizeEntry, sanitizeLeaderboard,
  trackBoardKey, trackIdentity, type LeaderEntry, type LeaderStorage, type TrackBoard,
} from './leaderboard';

const entry = (over: Partial<LeaderEntry> = {}): LeaderEntry => ({ pilot: 'You', kind: 'you', total: 60, bestLap: 20, laps: 3, missed: 0, date: 1000, ...over });

function memory(): LeaderStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

describe('track keys', () => {
  it('are 8 hex digits and stable', () => {
    const t = makeTrack(5);
    const k = trackBoardKey(1337, 'high', t);
    expect(k).toMatch(/^[0-9a-f]{8}$/);
    expect(trackBoardKey(1337, 'high', makeTrack(5))).toBe(k);
  });

  it('change with the terrain, the quality, the gates and the laps', () => {
    const t = makeTrack(5);
    const k = trackBoardKey(1337, 'high', t);
    expect(trackBoardKey(1338, 'high', t)).not.toBe(k);
    expect(trackBoardKey(1337, 'low', t)).not.toBe(k);
    const moved = makeTrack(5);
    moved.gates[2] = { ...moved.gates[2], pos: [3, 2, -30] };
    expect(trackBoardKey(1337, 'high', moved)).not.toBe(k);
    expect(trackBoardKey(1337, 'high', makeTrack(5, { closed: true, laps: 2 }))).not.toBe(trackBoardKey(1337, 'high', makeTrack(5, { closed: true, laps: 3 })));
  });

  it('ignore the laps of a point-to-point track (always one) and noise below the rounding', () => {
    expect(trackIdentity(makeTrack(4, { laps: 3 }))).toBe(trackIdentity(makeTrack(4, { laps: 1 })));
    const a = makeTrack(4);
    const b = makeTrack(4);
    b.gates[0] = { ...b.gates[0], pos: [0.001, 2, -10] };
    expect(trackIdentity(a)).toBe(trackIdentity(b));
  });

  it('use the recipe of a builder track instead of its gates', () => {
    const recipe = defaultRecipe();
    const a = makeTrack(5, { style: 'custom', recipe });
    const b = makeTrack(7, { style: 'custom', recipe });
    expect(trackIdentity(a)).toBe(trackIdentity(b));
    expect(trackIdentity(a).startsWith('r:')).toBe(true);
    expect(trackBoardKey(1, 'high', makeTrack(5, { style: 'custom', recipe: { ...recipe, seed: recipe.seed + 1 } }))).not.toBe(trackBoardKey(1, 'high', a));
  });
});

describe('ranking', () => {
  it('puts the fastest total first, then the faster lap, then the earlier run', () => {
    const list = [entry({ total: 70 }), entry({ total: 50, pilot: 'B', kind: 'brain' }), entry({ total: 50, bestLap: 15, pilot: 'C', kind: 'brain' }), entry({ total: 50, bestLap: 15, date: 5, pilot: 'D', kind: 'brain' })];
    expect(rankEntries(list).map((e) => e.pilot)).toEqual(['D', 'C', 'B', 'You']);
  });

  it('places a new finish and reports its rank from 1', () => {
    const base = [entry({ total: 50 }), entry({ total: 70 })];
    const r = insertEntry(base, entry({ total: 60, pilot: 'X', kind: 'brain' }));
    expect(r.rank).toBe(2);
    expect(r.entries.map((e) => e.total)).toEqual([50, 60, 70]);
  });

  it('keeps only the fastest MAX_ENTRIES and says 0 for a finish that fell off', () => {
    const full = Array.from({ length: MAX_ENTRIES }, (_, i) => entry({ total: 10 + i, pilot: `P${i}` }));
    const slow = insertEntry(full, entry({ total: 999 }));
    expect(slow.rank).toBe(0);
    expect(slow.entries).toHaveLength(MAX_ENTRIES);
    const fast = insertEntry(full, entry({ total: 1, pilot: 'Ace' }));
    expect(fast.rank).toBe(1);
    expect(fast.entries).toHaveLength(MAX_ENTRIES);
    expect(fast.entries.at(-1)?.pilot).toBe(`P${MAX_ENTRIES - 2}`);
  });

  it('counts the same pilot in the same time once (a benchmark run twice)', () => {
    const first = insertEntry([], entry({ pilot: 'Bot', kind: 'brain', total: 42.123, date: 1 }));
    const again = insertEntry(first.entries, entry({ pilot: 'Bot', kind: 'brain', total: 42.123, date: 9 }));
    expect(again.entries).toHaveLength(1);
    expect(again.rank).toBe(1);
    expect(again.entries[0].date).toBe(9);
    // A human with the same time is a different result.
    expect(insertEntry(again.entries, entry({ pilot: 'Bot', kind: 'you', total: 42.123 })).entries).toHaveLength(2);
  });
});

describe('sanitising', () => {
  it('drops broken entries and repairs the optional fields', () => {
    expect(sanitizeEntry(null)).toBeNull();
    expect(sanitizeEntry({ ...entry(), pilot: '  ' })).toBeNull();
    expect(sanitizeEntry({ ...entry(), kind: 'ghost' })).toBeNull();
    expect(sanitizeEntry({ ...entry(), total: -1 })).toBeNull();
    expect(sanitizeEntry({ ...entry(), total: Number.NaN })).toBeNull();
    const fixed = sanitizeEntry({ pilot: ' Ann ', kind: 'you', total: 30, bestLap: 99, laps: 2.6, missed: -3, date: 'x' });
    expect(fixed).toEqual({ pilot: 'Ann', kind: 'you', total: 30, bestLap: 30, laps: 3, missed: 0, date: 0 });
  });

  it('keeps good boards from untrusted JSON and drops the rest', () => {
    const raw = {
      version: 1,
      boards: {
        '0000abcd': { name: 'Mine', updated: 5, entries: [entry({ total: 80 }), { junk: true }, entry({ total: 40, pilot: 'Q', kind: 'brain' })] },
        'not-a-key': { name: 'Bad', entries: [entry()] },
        '0000ffff': { name: 'Empty', entries: [] },
      },
      extra: 'ignored',
    };
    const data = sanitizeLeaderboard(raw);
    expect(Object.keys(data.boards)).toEqual(['0000abcd']);
    expect(data.boards['0000abcd'].entries.map((e) => e.total)).toEqual([40, 80]);
    expect(sanitizeLeaderboard({ version: 2, boards: raw.boards }).boards).toEqual({});
    expect(sanitizeLeaderboard('nonsense').boards).toEqual({});
  });

  it('prunes to the boards raced most recently', () => {
    const boards: Record<string, TrackBoard> = {};
    for (let i = 0; i < MAX_BOARDS + 5; i++) {
      const key = i.toString(16).padStart(8, '0');
      boards[key] = { key, name: `T${i}`, updated: i, entries: [entry()] };
    }
    const kept = pruneBoards(boards);
    expect(Object.keys(kept)).toHaveLength(MAX_BOARDS);
    expect(kept['00000000']).toBeUndefined();
    expect(kept[(MAX_BOARDS + 4).toString(16).padStart(8, '0')]).toBeDefined();
  });
});

describe('rows', () => {
  it('formats times and dates and marks the fresh finish', () => {
    const fresh = entry({ total: 61.5, bestLap: 19.25, date: Date.UTC(2026, 9, 5) });
    const rows = leaderRows([entry({ total: 50, pilot: 'Bot', kind: 'brain' }), fresh], fresh);
    expect(rows.map((r) => [r.rank, r.pilot, r.fresh])).toEqual([[1, 'Bot', false], [2, 'You', true]]);
    expect(rows[1].date).toBe('2026-10-05');
    expect(rows[1].total).toMatch(/1:01\.5/);
  });
});

describe('LeaderboardStore', () => {
  it('records, saves under its versioned key and loads back', () => {
    const storage = memory();
    const store = new LeaderboardStore(storage);
    const seen: string[] = [];
    store.subscribe((k) => seen.push(k));
    expect(store.record('0000abcd', 'Track A', entry({ total: 55 }))).toBe(1);
    expect(store.record('0000abcd', 'renamed', entry({ total: 45, pilot: 'Bot', kind: 'brain' }))).toBe(1);
    expect(seen).toEqual(['0000abcd', '0000abcd']);
    expect(storage.data.has(LEADERBOARD_KEY)).toBe(true);
    const again = new LeaderboardStore(storage);
    const b = again.board('0000abcd');
    expect(b?.name).toBe('Track A');
    expect(b?.entries.map((e) => e.pilot)).toEqual(['Bot', 'You']);
    again.clear('0000abcd');
    expect(new LeaderboardStore(storage).board('0000abcd')).toBeNull();
  });

  it('refuses unusable finishes and survives broken or blocked storage', () => {
    const storage = memory();
    storage.data.set(LEADERBOARD_KEY, '{not json');
    const store = new LeaderboardStore(storage);
    expect(store.boards()).toEqual([]);
    expect(store.record('0000abcd', 'T', entry({ total: Number.NaN }))).toBe(0);
    const blocked: LeaderStorage = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('full'); } };
    const b = new LeaderboardStore(blocked);
    expect(b.record('0000abcd', 'T', entry())).toBe(1);
    expect(b.board('0000abcd')?.entries).toHaveLength(1);
  });

  it('re-reads the saved boards before a change, so two tabs add to the same board', () => {
    const storage = memory();
    const a = new LeaderboardStore(storage);
    const b = new LeaderboardStore(storage);
    a.record('0000abcd', 'T', entry({ total: 50, pilot: 'A', kind: 'brain' }));
    expect(b.record('0000abcd', 'T', entry({ total: 40, pilot: 'B', kind: 'brain' }))).toBe(1);
    a.record('11112222', 'U', entry({ total: 70 }));
    const fresh = new LeaderboardStore(storage);
    expect(fresh.board('0000abcd')?.entries.map((e) => e.pilot)).toEqual(['B', 'A']);
    expect(fresh.board('11112222')?.entries).toHaveLength(1);
    b.clear('11112222');
    expect(new LeaderboardStore(storage).board('11112222')).toBeNull();
    expect(new LeaderboardStore(storage).board('0000abcd')?.entries).toHaveLength(2);
  });

  it('keeps its finishes in memory once storage refuses a write', () => {
    let full = false;
    const data = new Map<string, string>();
    const storage: LeaderStorage = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => { if (full) throw new Error('full'); data.set(k, v); } };
    const s = new LeaderboardStore(storage);
    s.record('0000abcd', 'T', entry({ total: 50, pilot: 'A', kind: 'brain' }));
    full = true;
    s.record('0000abcd', 'T', entry({ total: 40, pilot: 'B', kind: 'brain' }));
    s.record('0000abcd', 'T', entry({ total: 45, pilot: 'C', kind: 'brain' }));
    expect(s.board('0000abcd')?.entries.map((e) => e.pilot)).toEqual(['B', 'C', 'A']);
  });
});
