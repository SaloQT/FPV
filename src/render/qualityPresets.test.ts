import { describe, expect, it } from 'vitest';
import { qualityProfile, type QualityProfile } from './contracts';
import { performanceProfile, qualityCostIndex, resolveQuality, sameProfile } from './qualityPresets';

const TIERS = ['low', 'medium', 'high', 'ultra'] as const;

describe('quality tiers really differ in cost', () => {
  it('the cost index rises strictly from low to ultra', () => {
    const costs = TIERS.map((t) => qualityCostIndex(qualityProfile(t)));
    for (let i = 1; i < costs.length; i++) expect(costs[i]).toBeGreaterThan(costs[i - 1] * 1.15);
  });

  it('every tier is distinct in at least four budget fields', () => {
    const keys: (keyof QualityProfile)[] = ['rtDivisor', 'giRays', 'rtMaxSteps', 'rtSpecular', 'probes', 'grassBladesPerM2', 'grassDistance', 'terrainViewDistance', 'cloudSteps', 'detailOctaves'];
    for (let i = 1; i < TIERS.length; i++) {
      const a = qualityProfile(TIERS[i - 1]), b = qualityProfile(TIERS[i]);
      const differing = keys.filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
      expect(differing.length).toBeGreaterThanOrEqual(4);
    }
  });
});

describe('Performance 240', () => {
  it('keeps the tier and every field that defines the look of the pictures', () => {
    for (const t of TIERS) {
      const base = qualityProfile(t);
      const p = performanceProfile(base);
      expect(p.tier).toBe(t);
      expect(p.rtDivisor).toBe(base.rtDivisor);
      expect(p.rtSpecular).toBe(base.rtSpecular);
      expect(p.bloom).toBe(base.bloom);
      expect(p.taa).toBe(base.taa);
      expect(p.terrainViewDistance).toBe(base.terrainViewDistance);
    }
  });

  it('is much cheaper than the tier it derives from and never raises a budget', () => {
    for (const t of TIERS) {
      const base = qualityProfile(t);
      const p = performanceProfile(base);
      expect(qualityCostIndex(p)).toBeLessThan(qualityCostIndex(base) * (t === 'low' ? 0.95 : 0.8));
      expect(p.giRays).toBeLessThanOrEqual(base.giRays);
      expect(p.rtMaxSteps).toBeLessThanOrEqual(base.rtMaxSteps);
      expect(p.probes.raysPerProbe).toBeLessThanOrEqual(base.probes.raysPerProbe);
      expect(p.cloudSteps).toBeLessThanOrEqual(base.cloudSteps);
      expect(p.grassBladesPerM2).toBeLessThanOrEqual(base.grassBladesPerM2);
      expect(p.grassDistance).toBeLessThanOrEqual(base.grassDistance);
      expect(p.detailOctaves).toBeLessThanOrEqual(base.detailOctaves);
    }
  });

  it('keeps the probe grid footprint within 15% and the dimensions even', () => {
    for (const t of TIERS) {
      const base = qualityProfile(t);
      const p = performanceProfile(base);
      for (let a = 0; a < 3; a++) {
        const before = base.probes.dim[a] * base.probes.spacing;
        const after = p.probes.dim[a] * p.probes.spacing;
        expect(Math.abs(after - before) / before).toBeLessThan(0.15);
        expect(p.probes.dim[a] % 2).toBe(0);
      }
    }
  });

  it('refreshes every probe more often than the tier it derives from (shorter rotation)', () => {
    const rotation = (q: QualityProfile): number => Math.min(16, Math.max(1, Math.ceil((q.probes.dim[0] * q.probes.dim[1] * q.probes.dim[2] * q.probes.raysPerProbe) / 150_000)));
    const base = qualityProfile('high');
    expect(rotation(performanceProfile(base))).toBeLessThan(rotation(base));
  });

  it('resolveQuality picks the derived profile only when the preset is on', () => {
    expect(sameProfile(resolveQuality({ quality: 'high', performance240: false }), qualityProfile('high'))).toBe(true);
    expect(sameProfile(resolveQuality({ quality: 'high', performance240: true }), performanceProfile(qualityProfile('high')))).toBe(true);
    expect(sameProfile(resolveQuality({ quality: 'high', performance240: true }), qualityProfile('high'))).toBe(false);
  });
});
