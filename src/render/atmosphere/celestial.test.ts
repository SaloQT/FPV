import { describe, expect, it } from 'vitest';
import {
  DEG, LUNAR_FEATURES, LUNAR_ROWS, SUN_DISC_MAX_HDR, SUN_LIMB_U, discToSelenographic, galacticAxesEquatorial, selenographicToDisc, sunDiscRadiance,
  sunLimbFactor,
} from './celestial';

/** Mean of the limb-darkened disc: integral of I(mu) over the disc area, r = sin(angle from centre), mu = sqrt(1 - r^2). */
function discMean(channel: number): number {
  const n = 20000;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const r = (i + 0.5) / n;
    sum += sunLimbFactor(Math.sqrt(1 - r * r), channel) * 2 * r;
  }
  return sum / n;
}

const dot = (a: readonly number[], b: readonly number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: readonly number[], b: readonly number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

describe('sun disc', () => {
  it('normalises limb darkening so the disc mean is one in every channel', () => {
    for (let c = 0; c < 3; c++) expect(discMean(c)).toBeCloseTo(1, 4);
  });

  it('is brightest at the centre and darkest at the limb, blue limb darkest', () => {
    for (let c = 0; c < 3; c++) {
      expect(sunLimbFactor(1, c)).toBeCloseTo(1 / (1 - SUN_LIMB_U[c] / 3), 12);
      expect(sunLimbFactor(1, c)).toBeGreaterThan(sunLimbFactor(0.5, c));
      expect(sunLimbFactor(0.5, c)).toBeGreaterThan(sunLimbFactor(0, c));
      expect(sunLimbFactor(0, c)).toBeCloseTo((1 - SUN_LIMB_U[c]) / (1 - SUN_LIMB_U[c] / 3), 12);
    }
    expect(sunLimbFactor(0, 2)).toBeLessThan(sunLimbFactor(0, 1));
    expect(sunLimbFactor(0, 1)).toBeLessThan(sunLimbFactor(0, 0));
    expect(sunLimbFactor(-3, 0)).toBe(sunLimbFactor(0, 0));
    expect(sunLimbFactor(7, 2)).toBe(sunLimbFactor(1, 2));
  });

  it('gives about 1.9e9 cd/m2 for the top-of-atmosphere sun and returns the illuminance when integrated over the disc', () => {
    const radius = 0.00465;
    const lux = 1.3e5;
    const radiance = sunDiscRadiance(lux, radius);
    expect(radiance).toBeGreaterThan(1.7e9);
    expect(radiance).toBeLessThan(2.1e9);
    expect(radiance * Math.PI * radius * radius).toBeCloseTo(lux, 6);
  });

  it('keeps the exposed sun clamp below 59000 and inside half-float range', () => {
    expect(SUN_DISC_MAX_HDR).toBeLessThanOrEqual(59000);
    expect(SUN_DISC_MAX_HDR).toBeLessThan(65504);
    expect(Number.isFinite(SUN_DISC_MAX_HDR)).toBe(true);
  });
});

describe('lunar features', () => {
  const maria = LUNAR_FEATURES.filter((f) => f.kind === 'mare');
  const craters = LUNAR_FEATURES.filter((f) => f.kind === 'crater');
  const named = (name: string) => LUNAR_FEATURES.find((f) => f.name === name);

  it('has at least the twelve major maria and the bright ray craters', () => {
    expect(maria.length).toBeGreaterThanOrEqual(12);
    for (const name of [
      'Mare Imbrium', 'Mare Serenitatis', 'Mare Tranquillitatis', 'Mare Crisium', 'Mare Fecunditatis', 'Mare Nectaris', 'Oceanus Procellarum',
      'Mare Nubium', 'Mare Humorum', 'Mare Frigoris', 'Mare Vaporum', 'Mare Cognitum',
    ]) expect(named(name)?.kind, name).toBe('mare');
    for (const name of ['Tycho', 'Copernicus', 'Kepler', 'Aristarchus']) expect(named(name)?.kind, name).toBe('crater');
    expect(new Set(LUNAR_FEATURES.map((f) => f.name)).size).toBe(LUNAR_FEATURES.length);
  });

  it('places the features where an observer sees them', () => {
    const tycho = named('Tycho')!;
    expect(tycho.latDeg).toBeCloseTo(-43.4, 1);
    expect(tycho.lonDeg).toBeCloseTo(-11.4, 1);
    expect(named('Mare Crisium')!.lonDeg).toBeGreaterThan(50);
    expect(named('Mare Imbrium')!.latDeg).toBeGreaterThan(25);
    expect(named('Oceanus Procellarum')!.lonDeg).toBeLessThan(-45);
    expect(named('Mare Humorum')!.latDeg).toBeLessThan(0);
    for (const f of LUNAR_FEATURES) {
      expect(Math.abs(f.lonDeg)).toBeLessThan(90);
      expect(Math.abs(f.latDeg)).toBeLessThan(90);
      expect(f.radiusLonDeg).toBeGreaterThan(0);
      expect(f.radiusLatDeg).toBeGreaterThan(0);
      expect(f.strength).toBeGreaterThan(0);
      expect(f.strength).toBeLessThanOrEqual(1);
      expect(f.softness).toBeGreaterThan(0);
    }
  });

  it('keeps craters much smaller than maria and stores two uniform rows per feature', () => {
    expect(Math.max(...craters.map((c) => c.radiusLonDeg))).toBeLessThan(Math.min(...maria.map((m) => m.radiusLonDeg)));
    expect(LUNAR_ROWS).toBe(LUNAR_FEATURES.length * 2);
  });

  it('maps selenographic coordinates onto the visible disc and back', () => {
    expect(selenographicToDisc(0, 0)).toEqual([0, 0, 1]);
    const east = selenographicToDisc(90 * DEG, 0);
    expect(east[0]).toBeCloseTo(1, 12);
    expect(east[2]).toBeCloseTo(0, 12);
    expect(selenographicToDisc(0, 90 * DEG)[1]).toBeCloseTo(1, 12);
    for (const f of LUNAR_FEATURES) {
      const v = selenographicToDisc(f.lonDeg * DEG, f.latDeg * DEG);
      expect(Math.hypot(v[0], v[1], v[2])).toBeCloseTo(1, 12);
      expect(v[2]).toBeGreaterThan(0);
      const [lon, lat] = discToSelenographic(v[0], v[1], v[2]);
      expect(lon / DEG).toBeCloseTo(f.lonDeg, 9);
      expect(lat / DEG).toBeCloseTo(f.latDeg, 9);
    }
  });
});

describe('galactic axes', () => {
  const [gx, gy, gz] = galacticAxesEquatorial();
  const raDec = (v: readonly number[]) => [((Math.atan2(v[1], v[0]) / DEG) + 360) % 360, Math.asin(v[2]) / DEG];

  it('are orthonormal and right handed', () => {
    for (const a of [gx, gy, gz]) expect(Math.hypot(a[0], a[1], a[2])).toBeCloseTo(1, 6);
    expect(dot(gx, gy)).toBeCloseTo(0, 6);
    expect(dot(gy, gz)).toBeCloseTo(0, 6);
    expect(dot(gz, gx)).toBeCloseTo(0, 6);
    const c = cross(gx, gy);
    for (let i = 0; i < 3; i++) expect(c[i]).toBeCloseTo(gz[i], 6);
  });

  it('point the galactic centre and pole where the IAU frame puts them', () => {
    const [raGc, decGc] = raDec(gx);
    expect(raGc).toBeCloseTo(266.405, 0);
    expect(decGc).toBeCloseTo(-28.936, 0);
    const [raNp, decNp] = raDec(gz);
    expect(raNp).toBeCloseTo(192.859, 0);
    expect(decNp).toBeCloseTo(27.128, 0);
  });
});
