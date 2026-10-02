import { describe, expect, it } from 'vitest';
import { hashSeed, MAX_SEED, parseSeed, randomSeed, RANDOM_SEED_RANGE, seedFieldText, seedNumberNote, shareUrl, shareWorld, type ShareWorld } from './seedModel';

describe('parseSeed', () => {
  it('reads plain numbers as written', () => {
    expect(parseSeed('1337')).toBe(1337);
    expect(parseSeed('  0 ')).toBe(0);
    expect(parseSeed(String(MAX_SEED))).toBe(MAX_SEED);
  });

  it('hashes words, case-insensitively and stably', () => {
    const a = parseSeed('Alpine Lake');
    expect(a).toBe(parseSeed('alpine lake'));
    expect(a).not.toBe(parseSeed('alpine lakes'));
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThanOrEqual(MAX_SEED);
  });

  it('hashes numbers that do not fit a 32-bit seed instead of clamping them', () => {
    const big = parseSeed('99999999999');
    expect(big).toBe(hashSeed('99999999999'));
    expect(big).not.toBe(MAX_SEED);
  });

  it('treats empty input as no seed', () => {
    expect(parseSeed('')).toBeNull();
    expect(parseSeed('   ')).toBeNull();
  });
});

describe('hashSeed', () => {
  it('matches the published FNV-1a 32-bit values', () => {
    expect(hashSeed('')).toBe(0x811c9dc5);
    expect(hashSeed('a')).toBe(0xe40c292c);
    expect(hashSeed('foobar')).toBe(0xbf9cf968);
  });
});

describe('randomSeed', () => {
  it('stays inside the readable range', () => {
    expect(randomSeed(() => 0)).toBe(0);
    expect(randomSeed(() => 0.999999999)).toBe(RANDOM_SEED_RANGE - 1);
  });
});

describe('seedFieldText', () => {
  it('keeps the typed word while it names the current seed', () => {
    const seed = parseSeed('Alpine Lake') ?? -1;
    expect(seedFieldText('Alpine Lake', seed)).toBe('Alpine Lake');
    expect(seedFieldText('  alpine lake ', seed)).toBe('alpine lake');
  });

  it('falls back to the number when the seed no longer matches the typed text', () => {
    expect(seedFieldText('Alpine Lake', 12)).toBe('12');
    expect(seedFieldText('', 77)).toBe('77');
  });

  it('shows plain numbers as written', () => {
    expect(seedFieldText('1337', 1337)).toBe('1337');
  });
});

describe('seedNumberNote', () => {
  it('shows the numeric seed beside a word and nothing beside a number', () => {
    const seed = parseSeed('Alpine Lake') ?? -1;
    expect(seedNumberNote('Alpine Lake', seed)).toBe(`= ${seed}`);
    expect(seedNumberNote('1337', 1337)).toBe('');
  });
});

describe('shareUrl', () => {
  const world: ShareWorld = { terrainSeed: 42, trackSeed: 42, style: 'sprint', gateCount: 9, laps: 2, difficulty: 0.35, quality: 'high' };

  it('carries the world and drops everything else', () => {
    const url = shareUrl('https://x.test/play/?quality=low&cam=free#top', world);
    const u = new URL(url);
    expect(u.pathname).toBe('/play/');
    expect(u.hash).toBe('');
    expect(Object.fromEntries(u.searchParams)).toEqual({ seed: '42', style: 'sprint', gates: '9', laps: '2', diff: '35', quality: 'high' });
  });

  it('adds the track seed when the track came from the N key or a retry', () => {
    const u = new URL(shareUrl('https://x.test/', { ...world, trackSeed: 45 }));
    expect(u.searchParams.get('seed')).toBe('42');
    expect(u.searchParams.get('tseed')).toBe('45');
  });
});

describe('shareWorld', () => {
  const s = { seed: 7, trackStyle: 'race' as const, gateCount: 12, laps: 3, difficulty: 0.5, quality: 'low' as const };

  it('describes the settings when no built world matches them', () => {
    expect(shareWorld(s, null)).toEqual({ terrainSeed: 7, trackSeed: 7, style: 'race', gateCount: 12, laps: 3, difficulty: 0.5, quality: 'low' });
  });

  it('prefers the world on screen', () => {
    const w: ShareWorld = { terrainSeed: 7, trackSeed: 10, style: 'freestyle', gateCount: 12, laps: 1, difficulty: 0.5, quality: 'low' };
    expect(shareWorld(s, w)).toBe(w);
  });
});
