import { describe, expect, it } from 'vitest';
import { DEG, jdTTFromUT, julianDateFromMs } from './julian';
import { sunPosition } from './sun';

const HOURS = 15 * DEG;

describe('sun', () => {
  it('Meeus ex. 25.a: 1992 Oct 13 0h TD', () => {
    const s = sunPosition(2448908.5);
    expect(s.raRad / HOURS).toBeCloseTo(13 + 13 / 60 + 30.749 / 3600, 3);
    expect(s.decRad / DEG).toBeCloseTo(-(7 + 47 / 60 + 6 / 3600), 2);
    expect(Math.abs(s.distanceAu - 0.99760775)).toBeLessThan(1e-4);
    expect(s.eclipticLongitudeRad / DEG).toBeCloseTo(199.9090, 1);
  });

  it('apparent ecliptic longitude is 0 at the March 2026 equinox (14:46 UTC)', () => {
    const jd = jdTTFromUT(julianDateFromMs(Date.UTC(2026, 2, 20, 14, 46, 0)));
    const lon = sunPosition(jd).eclipticLongitudeRad / DEG;
    const wrapped = lon > 180 ? lon - 360 : lon;
    expect(Math.abs(wrapped)).toBeLessThan(0.05);
  });

  it('declination reaches +-23.44 deg at the solstices', () => {
    const june = sunPosition(jdTTFromUT(julianDateFromMs(Date.UTC(2026, 5, 21, 8, 24, 0))));
    const dec = sunPosition(jdTTFromUT(julianDateFromMs(Date.UTC(2026, 11, 21, 20, 50, 0))));
    expect(june.decRad / DEG).toBeCloseTo(23.437, 1);
    expect(dec.decRad / DEG).toBeCloseTo(-23.437, 1);
  });

  it('angular radius is ~16 arcmin and larger near perihelion (January) than aphelion (July)', () => {
    const jan = sunPosition(jdTTFromUT(julianDateFromMs(Date.UTC(2026, 0, 3))));
    const jul = sunPosition(jdTTFromUT(julianDateFromMs(Date.UTC(2026, 6, 6))));
    expect(jan.distanceAu).toBeCloseTo(0.9833, 3);
    expect(jul.distanceAu).toBeCloseTo(1.0167, 3);
    expect(jan.angularRadiusRad / DEG * 60).toBeCloseTo(16.25, 1);
    expect(jul.angularRadiusRad).toBeLessThan(jan.angularRadiusRad);
  });

  it('writes into a supplied result object', () => {
    const buf = { raRad: 0, decRad: 0, distanceAu: 0, eclipticLongitudeRad: 0, angularRadiusRad: 0 };
    expect(sunPosition(2451545, buf)).toBe(buf);
    expect(buf.distanceAu).toBeGreaterThan(0.98);
  });
});
