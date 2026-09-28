/** Geocentric apparent position of the Sun (Meeus ch. 25: equation of centre, aberration, nutation), ~0.01 deg. */

import { ARCSEC, AU_KM, DEG, julianCenturies, meanObliquity, nutation, wrapTau } from './julian';

export const SUN_RADIUS_KM = 696000;

const NUT: [number, number] = [0, 0];

export interface SunPosition {
  /** Apparent right ascension and declination of date, radians. */
  raRad: number;
  decRad: number;
  distanceAu: number;
  /** Apparent ecliptic longitude of date (nutation and aberration included), radians [0, 2pi). */
  eclipticLongitudeRad: number;
  angularRadiusRad: number;
}

/** `jdTT` is a Julian date in Terrestrial Time (Meeus's "JDE"). */
export function sunPosition(jdTT: number, out?: SunPosition): SunPosition {
  const T = julianCenturies(jdTT);
  const L0 = 280.46646 + T * (36000.76983 + T * 0.0003032);
  const M = (357.52911 + T * (35999.05029 - T * 0.0001537)) * DEG;
  const e = 0.016708634 - T * (0.000042037 + T * 0.0000001267);
  const C =
    (1.914602 - T * (0.004817 + T * 0.000014)) * Math.sin(M) +
    (0.019993 - T * 0.000101) * Math.sin(2 * M) +
    0.000289 * Math.sin(3 * M);
  const trueLongitude = (L0 + C) * DEG;
  const nu = M + C * DEG;
  const distanceAu = (1.000001018 * (1 - e * e)) / (1 + e * Math.cos(nu));

  const nut = nutation(T, NUT);
  const aberration = (20.4898 * ARCSEC) / distanceAu;
  const lambda = wrapTau(trueLongitude + nut[0] - aberration);
  const eps = meanObliquity(T) + nut[1];

  const r = out ?? { raRad: 0, decRad: 0, distanceAu: 0, eclipticLongitudeRad: 0, angularRadiusRad: 0 };
  r.raRad = wrapTau(Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda)));
  r.decRad = Math.asin(Math.sin(eps) * Math.sin(lambda));
  r.distanceAu = distanceAu;
  r.eclipticLongitudeRad = lambda;
  r.angularRadiusRad = Math.asin(SUN_RADIUS_KM / (distanceAu * AU_KM));
  return r;
}
