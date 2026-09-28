import type { AstroState, Vec3 } from '../../contracts';

export type TimeOfDay = 'noon' | 'dusk' | 'night';

const DEG = Math.PI / 180;
const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/** Azimuth is measured clockwise from north (-Z), so east (+X) is 90 degrees. */
function direction(elevationDeg: number, azimuthDeg: number): Vec3 {
  const e = elevationDeg * DEG, a = azimuthDeg * DEG;
  return [Math.cos(e) * Math.sin(a), Math.sin(e), -Math.cos(e) * Math.cos(a)];
}

const PRESETS: Record<TimeOfDay, { sun: [number, number]; moon: [number, number]; phaseAngle: number }> = {
  noon: { sun: [60, 140], moon: [-25, 320], phaseAngle: 1.2 },
  dusk: { sun: [3, 250], moon: [-40, 70], phaseAngle: 0.9 },
  night: { sun: [-30, 250], moon: [45, 110], phaseAngle: 0.45 },
};

export function isTimeOfDay(s: string | null): s is TimeOfDay { return s === 'noon' || s === 'dusk' || s === 'night'; }

/** A hand-made AstroState with the requested sun and moon placement (no ephemeris). */
export function makeAstro(t: TimeOfDay): AstroState {
  const p = PRESETS[t];
  return {
    julianDate: 2461000.5,
    sunDir: direction(p.sun[0], p.sun[1]),
    moonDir: direction(p.moon[0], p.moon[1]),
    sunElevation: p.sun[0] * DEG,
    moonElevation: p.moon[0] * DEG,
    moonIlluminatedFraction: (1 + Math.cos(p.phaseAngle)) / 2,
    moonPhaseAngle: p.phaseAngle,
    equatorialToWorld: IDENTITY,
    planets: [],
  };
}
