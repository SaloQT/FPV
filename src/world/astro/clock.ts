/** Simulation clock and the pure per-instant astronomy evaluation that feeds the sky renderer. */

import type { AstroState, Observer, Settings } from '../../contracts';
import { equatorialToWorld, equatorialToWorldDir, localSiderealRad } from './coords';
import {
  AU_KM, DEG, gastRad, gmstRad, jdTTFromUT, julianCenturies, julianDateFromMs, meanObliquity, nutation, wrapPi,
} from './julian';
import {
  moonGeocentric, moonPhase, moonPhaseName, moonTopocentric, newMoonPosition, type MoonPhase, type TopocentricMoon,
} from './moon';
import { planetPositions } from './planets';
import { sunPosition, type SunPosition } from './sun';

const HOUR_MS = 3600000;
const DAY_MS = 86400000;
/** Sim-time movement below which a cached state is reused: the Sun moves 0.002 deg in 0.5 s. */
const CACHE_TOLERANCE_MS = 500;

const NUT: [number, number] = [0, 0];
const SUN: SunPosition = { raRad: 0, decRad: 0, distanceAu: 0, eclipticLongitudeRad: 0, angularRadiusRad: 0 };
const MOON = newMoonPosition();
const TOPO: TopocentricMoon = { raRad: 0, decRad: 0, distanceKm: 0, hourAngleRad: 0 };
const PHASE: MoonPhase = { elongationRad: 0, phaseAngleRad: 0, illuminatedFraction: 0 };

interface Evaluation {
  /** Moon minus Sun apparent ecliptic longitude, radians: the input for the phase name. */
  moonMinusSunLonRad: number;
}

function evaluate(ms: number, observer: Observer, extra: Evaluation): AstroState {
  const jdUT = julianDateFromMs(ms);
  const jdTT = jdTTFromUT(jdUT);
  const T = julianCenturies(jdTT);
  const lat = observer.latitudeDeg * DEG;
  const lon = observer.longitudeDeg * DEG;

  nutation(T, NUT);
  const trueObliquity = meanObliquity(T) + NUT[1];
  // Apparent places of the Sun and Moon are relative to the true equinox, star and planet frames to the mean one.
  const lstApparent = localSiderealRad(gastRad(jdUT, NUT[0], trueObliquity), lon);
  const lstMean = localSiderealRad(gmstRad(jdUT), lon);

  sunPosition(jdTT, SUN);
  const sunDir = equatorialToWorldDir(SUN.raRad, SUN.decRad, lstApparent, lat);

  moonGeocentric(jdTT, MOON);
  moonTopocentric(MOON, lstApparent, lat, observer.altitudeM, TOPO);
  const moonDir = equatorialToWorldDir(TOPO.raRad, TOPO.decRad, lstApparent, lat);
  moonPhase(MOON, SUN.raRad, SUN.decRad, SUN.distanceAu * AU_KM, PHASE);
  extra.moonMinusSunLonRad = wrapPi(MOON.eclipticLongitudeRad - SUN.eclipticLongitudeRad);

  const toWorld = equatorialToWorld(T, lstMean, lat);
  const found = planetPositions(jdTT);
  const planets: AstroState['planets'] = [];
  for (let i = 0; i < found.length; i++) {
    const p = found[i];
    const [x, y, z] = p.dirJ2000;
    planets.push({
      name: p.name,
      magnitude: p.magnitude,
      dir: [
        toWorld[0] * x + toWorld[1] * y + toWorld[2] * z,
        toWorld[3] * x + toWorld[4] * y + toWorld[5] * z,
        toWorld[6] * x + toWorld[7] * y + toWorld[8] * z,
      ],
      color: [p.color[0], p.color[1], p.color[2]],
    });
  }

  return {
    julianDate: jdUT,
    sunDir,
    moonDir,
    sunElevation: Math.asin(Math.max(-1, Math.min(1, sunDir[1]))),
    moonElevation: Math.asin(Math.max(-1, Math.min(1, moonDir[1]))),
    moonIlluminatedFraction: PHASE.illuminatedFraction,
    moonPhaseAngle: PHASE.phaseAngleRad,
    equatorialToWorld: toWorld,
    planets,
  };
}

const SCRATCH_EXTRA: Evaluation = { moonMinusSunLonRad: 0 };

/**
 * Everything the sky needs for a UTC instant (ms since epoch) and place: Sun and Moon directions in WORLD axes (+Y up, +X east,
 * -Z north), geometric elevations (the Moon topocentric), lunar phase, the J2000-to-world star matrix and the planets.
 */
export function computeAstro(ms: number, observer: Observer): AstroState {
  return evaluate(ms, observer, SCRATCH_EXTRA);
}

export interface ClockDescription {
  /** Local MEAN solar time, HH:MM:SS (longitude / 15 hours from UTC; no time-zone or equation-of-time offset). */
  localTimeString: string;
  /** Date at the observer's local mean solar time, YYYY-MM-DD. */
  dateString: string;
  sunElevationDeg: number;
  moonPhaseName: string;
}

export type ClockSettings = Pick<Settings, 'timeMs' | 'timeScale' | 'observer'>;

const pad2 = (n: number): string => (n < 10 ? '0' : '') + n;

export class SimClock {
  /** Simulated seconds per real second; 0 pauses the clock. */
  timeScale: number;
  private ms: number;
  private observerValue: Observer;
  private cached: AstroState | null = null;
  private cachedMs = 0;
  private cachedLat = NaN;
  private cachedLon = NaN;
  private cachedAlt = NaN;
  private readonly extra: Evaluation = { moonMinusSunLonRad: 0 };

  constructor(settings: ClockSettings) {
    this.ms = settings.timeMs;
    this.timeScale = settings.timeScale;
    this.observerValue = { ...settings.observer };
  }

  get timeMs(): number {
    return this.ms;
  }

  get observer(): Readonly<Observer> {
    return this.observerValue;
  }

  advance(realDtSeconds: number): void {
    if (this.timeScale !== 0) this.ms += realDtSeconds * 1000 * this.timeScale;
  }

  setTimeMs(ms: number): void {
    this.ms = ms;
  }

  setObserver(observer: Observer): void {
    this.observerValue = { ...observer };
  }

  /** Move to a local MEAN solar time of day (hours, wrapped to 0..24) on the current local solar date. */
  setTimeOfDay(hoursLocalSolar: number): void {
    const offset = (this.observerValue.longitudeDeg / 15) * HOUR_MS;
    const dayStart = Math.floor((this.ms + offset) / DAY_MS) * DAY_MS;
    const hours = ((hoursLocalSolar % 24) + 24) % 24;
    this.ms = dayStart + hours * HOUR_MS - offset;
  }

  /** Cached between calls; treat the returned object as read-only. */
  state(): AstroState {
    const o = this.observerValue;
    const stale =
      this.cached === null ||
      Math.abs(this.ms - this.cachedMs) > CACHE_TOLERANCE_MS ||
      o.latitudeDeg !== this.cachedLat || o.longitudeDeg !== this.cachedLon || o.altitudeM !== this.cachedAlt;
    if (stale) {
      this.cached = evaluate(this.ms, o, this.extra);
      this.cachedMs = this.ms;
      this.cachedLat = o.latitudeDeg;
      this.cachedLon = o.longitudeDeg;
      this.cachedAlt = o.altitudeM;
    }
    return this.cached as AstroState;
  }

  describe(): ClockDescription {
    const s = this.state();
    const local = new Date(this.cachedMs + (this.observerValue.longitudeDeg / 15) * HOUR_MS);
    return {
      localTimeString: `${pad2(local.getUTCHours())}:${pad2(local.getUTCMinutes())}:${pad2(local.getUTCSeconds())}`,
      dateString: `${local.getUTCFullYear()}-${pad2(local.getUTCMonth() + 1)}-${pad2(local.getUTCDate())}`,
      sunElevationDeg: s.sunElevation / DEG,
      moonPhaseName: moonPhaseName(this.extra.moonMinusSunLonRad),
    };
  }
}
