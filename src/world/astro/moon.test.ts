import { describe, expect, it } from 'vitest';
import { DEG, jdTTFromUT, julianCenturies, julianDateFromMs, nutation } from './julian';
import {
  EARTH_EQUATORIAL_RADIUS_KM, moonGeocentric, moonMagnitude, moonPhase, moonPhaseName, moonTopocentric, newMoonPosition,
} from './moon';
import { MOON_LON_DIST_TERMS } from './moonTerms';
import { MOON_LAT_TERMS } from './moonTermsLat';
import { sunPosition } from './sun';

const JDE_1992_APR_12 = 2448724.5;

describe('moon tables', () => {
  it('holds the 60 + 60 terms of Meeus tables 47.A and 47.B', () => {
    expect(MOON_LON_DIST_TERMS.length).toBe(60);
    expect(MOON_LAT_TERMS.length).toBe(60);
    for (const t of MOON_LON_DIST_TERMS) expect(t.length).toBe(6);
    for (const t of MOON_LAT_TERMS) expect(t.length).toBe(5);
  });
});

describe('moon geocentric (Meeus ex. 47.a, 1992 April 12 0h TD)', () => {
  const m = moonGeocentric(JDE_1992_APR_12);
  const nutLon = nutation(julianCenturies(JDE_1992_APR_12))[0];

  it('geometric longitude, latitude and distance', () => {
    expect((m.eclipticLongitudeRad - nutLon) / DEG).toBeCloseTo(133.162655, 4);
    expect(m.eclipticLatitudeRad / DEG).toBeCloseTo(-3.229126, 4);
    expect(m.distanceKm).toBeCloseTo(368409.7, 0);
  });

  it('apparent equatorial coordinates', () => {
    expect(m.eclipticLongitudeRad / DEG).toBeCloseTo(133.167265, 3);
    expect(m.raRad / DEG).toBeCloseTo(134.68847, 2);
    expect(m.decRad / DEG).toBeCloseTo(13.768368, 2);
  });

  it('angular radius is 16.2 arcmin at this near-perigee distance', () => {
    expect((m.angularRadiusRad / DEG) * 60).toBeCloseTo(16.21, 1);
  });

  it('reuses a supplied result object', () => {
    const buf = newMoonPosition();
    expect(moonGeocentric(JDE_1992_APR_12, buf)).toBe(buf);
    expect(buf.distanceKm).toBeCloseTo(368409.7, 0);
  });
});

describe('moon phase (Meeus ch. 48)', () => {
  it('ex. 48.a with Meeus inputs: elongation 110.79, phase angle 69.0756, k = 0.6786', () => {
    const m = moonGeocentric(JDE_1992_APR_12);
    const p = moonPhase(m, 20.6579 * DEG, 8.6964 * DEG, 149971520);
    expect(p.elongationRad / DEG).toBeCloseTo(110.79, 1);
    expect(p.phaseAngleRad / DEG).toBeCloseTo(69.0756, 1);
    expect(p.illuminatedFraction).toBeCloseTo(0.6786, 3);
  });

  it('same date with this module sun agrees to 3 decimals', () => {
    const m = moonGeocentric(JDE_1992_APR_12);
    const s = sunPosition(JDE_1992_APR_12);
    expect(moonPhase(m, s.raRad, s.decRad, s.distanceAu * 149597870.7).illuminatedFraction).toBeCloseTo(0.6786, 2);
  });

  it('new moon of 1977 Feb 18 03:37:42 TD (Meeus ex. 49.a) has ~zero lit fraction', () => {
    const jde = 2443192.65118;
    const m = moonGeocentric(jde);
    const s = sunPosition(jde);
    const dLon = ((m.eclipticLongitudeRad - s.eclipticLongitudeRad) / DEG + 540) % 360 - 180;
    expect(Math.abs(dLon)).toBeLessThan(0.03);
    const p = moonPhase(m, s.raRad, s.decRad, s.distanceAu * 149597870.7);
    expect(p.illuminatedFraction).toBeLessThan(0.01);
    expect(p.phaseAngleRad / DEG).toBeGreaterThan(170);
  });

  it('total solar eclipse of 2026-08-12 17:46 UTC: Moon within ~1 degree of the Sun', () => {
    const jd = jdTTFromUT(julianDateFromMs(Date.UTC(2026, 7, 12, 17, 46, 0)));
    const m = moonGeocentric(jd);
    const s = sunPosition(jd);
    const p = moonPhase(m, s.raRad, s.decRad, s.distanceAu * 149597870.7);
    expect(p.elongationRad / DEG).toBeLessThan(1.2);
    expect(p.illuminatedFraction).toBeLessThan(0.001);
  });

  it('partial lunar eclipse of 2026-08-28 04:18 UTC: full moon', () => {
    const jd = jdTTFromUT(julianDateFromMs(Date.UTC(2026, 7, 28, 4, 18, 0)));
    const m = moonGeocentric(jd);
    const s = sunPosition(jd);
    const p = moonPhase(m, s.raRad, s.decRad, s.distanceAu * 149597870.7);
    expect(p.elongationRad / DEG).toBeGreaterThan(178);
    expect(p.illuminatedFraction).toBeGreaterThan(0.999);
  });

  it('Allen magnitude: -12.73 at full, about -10.1 at quarter', () => {
    expect(moonMagnitude(0)).toBeCloseTo(-12.73, 6);
    expect(moonMagnitude(Math.PI / 2)).toBeCloseTo(-10.13, 2);
    expect(moonMagnitude(-Math.PI / 2)).toBeCloseTo(moonMagnitude(Math.PI / 2), 12);
  });

  it('names the eight phases', () => {
    expect(moonPhaseName(0.01)).toBe('New Moon');
    expect(moonPhaseName(Math.PI / 4)).toBe('Waxing Crescent');
    expect(moonPhaseName(Math.PI / 2)).toBe('First Quarter');
    expect(moonPhaseName(Math.PI)).toBe('Full Moon');
    expect(moonPhaseName(-Math.PI / 2)).toBe('Last Quarter');
    expect(moonPhaseName(-0.01)).toBe('New Moon');
  });
});

describe('moon topocentric (Meeus ch. 40)', () => {
  const geo = moonGeocentric(JDE_1992_APR_12);

  function vectorMethod(lst: number, lat: number, altM: number) {
    const u = Math.atan(0.99664719 * Math.tan(lat));
    const rs = 0.99664719 * Math.sin(u) + (altM / 6378140) * Math.sin(lat);
    const rc = Math.cos(u) + (altM / 6378140) * Math.cos(lat);
    const R = EARTH_EQUATORIAL_RADIUS_KM;
    const mx = geo.distanceKm * Math.cos(geo.decRad) * Math.cos(geo.raRad) - R * rc * Math.cos(lst);
    const my = geo.distanceKm * Math.cos(geo.decRad) * Math.sin(geo.raRad) - R * rc * Math.sin(lst);
    const mz = geo.distanceKm * Math.sin(geo.decRad) - R * rs;
    const d = Math.hypot(mx, my, mz);
    return { ra: (Math.atan2(my, mx) + 2 * Math.PI) % (2 * Math.PI), dec: Math.asin(mz / d), d };
  }

  it('agrees with a direct vector subtraction for several observers', () => {
    for (const [lat, lstOffset, alt] of [[46, 0.6, 1200], [-33, -1.9, 0], [10, 2.5, 4000], [80, 0.2, 100]] as const) {
      const lst = geo.raRad + lstOffset;
      const t = moonTopocentric(geo, lst, lat * DEG, alt);
      const v = vectorMethod(lst, lat * DEG, alt);
      expect(t.raRad).toBeCloseTo(v.ra, 9);
      expect(t.decRad).toBeCloseTo(v.dec, 9);
      expect(t.distanceKm).toBeCloseTo(v.d, 3);
    }
  });

  it('lowers the Moon by about the horizontal parallax on the meridian', () => {
    const lat = 46 * DEG;
    const t = moonTopocentric(geo, geo.raRad, lat, 0);
    const geoAlt = Math.asin(Math.sin(lat) * Math.sin(geo.decRad) + Math.cos(lat) * Math.cos(geo.decRad));
    const topoAlt = Math.asin(Math.sin(lat) * Math.sin(t.decRad) + Math.cos(lat) * Math.cos(t.decRad) * Math.cos(t.hourAngleRad));
    const parallaxDeg = Math.asin(EARTH_EQUATORIAL_RADIUS_KM / geo.distanceKm) / DEG;
    expect((geoAlt - topoAlt) / DEG).toBeGreaterThan(0.9 * parallaxDeg * Math.cos(geoAlt));
    expect((geoAlt - topoAlt) / DEG).toBeLessThan(1.05 * parallaxDeg);
  });

  it('does not shift the direction for an observer directly below the Moon (except distance)', () => {
    const lat = geo.decRad;
    const t = moonTopocentric(geo, geo.raRad, lat, 0);
    expect(Math.abs(t.raRad - geo.raRad)).toBeLessThan(1e-9);
    expect(t.distanceKm).toBeLessThan(geo.distanceKm - 6300);
    expect(t.distanceKm).toBeGreaterThan(geo.distanceKm - 6400);
  });
});
