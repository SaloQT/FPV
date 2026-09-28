/** Time scales and the Earth-orientation basics: Julian dates, sidereal time, Delta-T, obliquity and nutation. */

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;
export const ARCSEC = DEG / 3600;
export const JD_J2000 = 2451545.0;
export const AU_KM = 149597870.7;

const JD_UNIX_EPOCH = 2440587.5;
const MS_PER_DAY = 86400000;

export function julianDateFromMs(ms: number): number {
  return JD_UNIX_EPOCH + ms / MS_PER_DAY;
}

export function msFromJulianDate(jd: number): number {
  return (jd - JD_UNIX_EPOCH) * MS_PER_DAY;
}

/** Wraps to [0, 2pi). */
export function wrapTau(x: number): number {
  const r = x % TAU;
  return r < 0 ? r + TAU : r;
}

/** Wraps to [-pi, pi). */
export function wrapPi(x: number): number {
  return wrapTau(x + Math.PI) - Math.PI;
}

/** Julian centuries of 36525 days since J2000.0 for a Julian date (UT or TT, caller's choice). */
export function julianCenturies(jd: number): number {
  return (jd - JD_J2000) / 36525;
}

export function decimalYear(jd: number): number {
  return 2000 + (jd - JD_J2000) / 365.2425;
}

/** TT - UT in seconds, Espenak & Meeus polynomial expressions (NASA eclipse site); a prediction after ~2020. */
export function deltaT(year: number): number {
  if (year < -500) {
    const u = (year - 1820) / 100;
    return -20 + 32 * u * u;
  }
  if (year < 500) {
    const u = year / 100;
    return 10583.6 + u * (-1014.41 + u * (33.78311 + u * (-5.952053 + u * (-0.1798452 + u * (0.022174192 + u * 0.0090316521)))));
  }
  if (year < 1600) {
    const u = (year - 1000) / 100;
    return 1574.2 + u * (-556.01 + u * (71.23472 + u * (0.319781 + u * (-0.8503463 + u * (-0.005050998 + u * 0.0083572073)))));
  }
  if (year < 1700) {
    const t = year - 1600;
    return 120 - 0.9808 * t - 0.01532 * t * t + (t * t * t) / 7129;
  }
  if (year < 1800) {
    const t = year - 1700;
    return 8.83 + 0.1603 * t - 0.0059285 * t * t + 0.00013336 * t * t * t - (t * t * t * t) / 1174000;
  }
  if (year < 1860) {
    const t = year - 1800;
    return 13.72 + t * (-0.332447 + t * (0.0068612 + t * (0.0041116 + t * (-0.00037436 + t * (0.0000121272 + t * (-0.0000001699 + t * 0.000000000875))))));
  }
  if (year < 1900) {
    const t = year - 1860;
    return 7.62 + t * (0.5737 + t * (-0.251754 + t * (0.01680668 + t * (-0.0004473624 + t / 233174))));
  }
  if (year < 1920) {
    const t = year - 1900;
    return -2.79 + t * (1.494119 + t * (-0.0598939 + t * (0.0061966 - t * 0.000197)));
  }
  if (year < 1941) {
    const t = year - 1920;
    return 21.2 + t * (0.84493 + t * (-0.0761 + t * 0.0020936));
  }
  if (year < 1961) {
    const t = year - 1950;
    return 29.07 + 0.407 * t - (t * t) / 233 + (t * t * t) / 2547;
  }
  if (year < 1986) {
    const t = year - 1975;
    return 45.45 + 1.067 * t - (t * t) / 260 - (t * t * t) / 718;
  }
  if (year < 2005) {
    const t = year - 2000;
    return 63.86 + t * (0.3345 + t * (-0.060374 + t * (0.0017275 + t * (0.000651814 + t * 0.00002373599))));
  }
  if (year < 2050) {
    const t = year - 2000;
    return 62.92 + 0.32217 * t + 0.005589 * t * t;
  }
  const u = (year - 1820) / 100;
  if (year < 2150) return -20 + 32 * u * u - 0.5628 * (2150 - year);
  return -20 + 32 * u * u;
}

/** Terrestrial Time Julian date from a UT Julian date. */
export function jdTTFromUT(jdUT: number): number {
  return jdUT + deltaT(decimalYear(jdUT)) / 86400;
}

/** Greenwich mean sidereal time in radians [0, 2pi) for a UT Julian date (Meeus 12.4, IAU 1982). */
export function gmstRad(jdUT: number): number {
  const T = julianCenturies(jdUT);
  const deg = 280.46061837 + 360.98564736629 * (jdUT - JD_J2000) + T * T * (0.000387933 - T / 38710000);
  return wrapTau(deg * DEG);
}

/** Mean obliquity of the ecliptic (Meeus 22.2), radians, T in Julian centuries TT. */
export function meanObliquity(T: number): number {
  const arcsec = 84381.448 + T * (-46.815 + T * (-0.00059 + T * 0.001813));
  return arcsec * ARCSEC;
}

/** IAU 1980 nutation, the 13 largest terms (Meeus table 22.A): D, M, M', F, Omega multipliers; sin/cos coefficients in 0.0001". */
const NUTATION_TERMS: readonly number[][] = [
  [0, 0, 0, 0, 1, -171996, -174.2, 92025, 8.9],
  [-2, 0, 0, 2, 2, -13187, -1.6, 5736, -3.1],
  [0, 0, 0, 2, 2, -2274, -0.2, 977, -0.5],
  [0, 0, 0, 0, 2, 2062, 0.2, -895, 0.5],
  [0, 1, 0, 0, 0, 1426, -3.4, 54, -0.1],
  [0, 0, 1, 0, 0, 712, 0.1, -7, 0],
  [-2, 1, 0, 2, 2, -517, 1.2, 224, -0.6],
  [0, 0, 0, 2, 1, -386, -0.4, 200, 0],
  [0, 0, 1, 2, 2, -301, 0, 129, -0.1],
  [-2, -1, 0, 2, 2, 217, -0.5, -95, 0.3],
  [-2, 0, 1, 0, 0, -158, 0, 0, 0],
  [-2, 0, 0, 2, 1, 129, 0.1, -70, 0],
  [0, 0, -1, 2, 2, 123, 0, -53, 0],
];

/** Nutation in longitude [0] and obliquity [1] (radians) for T in Julian centuries TT. Writes into `out`. */
export function nutation(T: number, out: [number, number] = [0, 0]): [number, number] {
  const D = (297.85036 + T * (445267.11148 + T * (-0.0019142 + T / 189474))) * DEG;
  const M = (357.52772 + T * (35999.05034 + T * (-0.0001603 - T / 300000))) * DEG;
  const Mp = (134.96298 + T * (477198.867398 + T * (0.0086972 + T / 56250))) * DEG;
  const F = (93.27191 + T * (483202.017538 + T * (-0.0036825 + T / 327270))) * DEG;
  const om = (125.04452 + T * (-1934.136261 + T * (0.0020708 + T / 450000))) * DEG;
  let dpsi = 0;
  let deps = 0;
  for (let i = 0; i < NUTATION_TERMS.length; i++) {
    const t = NUTATION_TERMS[i];
    const arg = t[0] * D + t[1] * M + t[2] * Mp + t[3] * F + t[4] * om;
    dpsi += (t[5] + t[6] * T) * Math.sin(arg);
    deps += (t[7] + t[8] * T) * Math.cos(arg);
  }
  out[0] = dpsi * 0.0001 * ARCSEC;
  out[1] = deps * 0.0001 * ARCSEC;
  return out;
}

/** Greenwich apparent sidereal time (adds the equation of the equinoxes), radians. */
export function gastRad(jdUT: number, dpsi: number, trueObliquityRad: number): number {
  return wrapTau(gmstRad(jdUT) + dpsi * Math.cos(trueObliquityRad));
}
