import { describe, expect, it } from 'vitest';
import { hashSeed, MAX_SEED, parseSeed, randomSeed, RANDOM_SEED_RANGE, shareUrl } from './seedModel';

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

describe('shareUrl', () => {
  it('carries the world settings and drops everything else', () => {
    const url = shareUrl('https://x.test/play/?quality=low&cam=free#top', { seed: 42, trackStyle: 'sprint', gateCount: 9, laps: 2, difficulty: 0.35 });
    const u = new URL(url);
    expect(u.pathname).toBe('/play/');
    expect(u.hash).toBe('');
    expect(Object.fromEntries(u.searchParams)).toEqual({ seed: '42', style: 'sprint', gates: '9', laps: '2', diff: '35' });
  });
});
