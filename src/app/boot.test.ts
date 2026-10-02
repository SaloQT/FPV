import { describe, expect, it } from 'vitest';
import { defaultAppSettings } from '../ui/settingsSchema';
import { initialWorldRequest } from './boot';
import { parseParams } from './params';

describe('the first world request', () => {
  const settings = { ...defaultAppSettings(), seed: 42, quality: 'medium' as const, trackStyle: 'freestyle' as const, gateCount: 9, laps: 2, difficulty: 0.5 };

  it('builds the track from the world seed when the URL has no tseed', () => {
    const r = initialWorldRequest(settings, parseParams('?seed=42&autostart=1'));
    expect(r).toMatchObject({ seed: 42, terrainSeed: 42, style: 'freestyle', gateCount: 9, laps: 2, difficulty: 0.5, quality: 'medium' });
  });

  it('honours tseed under autostart=1: the terrain keeps the world seed, the track takes its own', () => {
    const r = initialWorldRequest(settings, parseParams('?seed=42&tseed=57&autostart=1'));
    expect(r.seed).toBe(57);
    expect(r.terrainSeed).toBe(42);
    expect(r.style).toBe('freestyle');
  });
});
