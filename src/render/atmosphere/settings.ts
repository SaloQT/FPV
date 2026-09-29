/**
 * Tunable knobs of the atmosphere module. Settings (src/contracts.ts) carries no cloud fields, so they live here; the world seed comes
 * from rc.settings.seed unless `seed` is set. Change them at runtime with AtmosphereModule.setSettings().
 */
export interface AtmosphereSettings {
  cloudsEnabled: boolean;
  /** Cumulus sky cover, 0 (clear) .. 1 (overcast). */
  cloudCoverage: number;
  /** Thin cirrus sky cover 0..1. */
  cirrusCoverage: number;
  /** Multiplier on the cloud extinction (1 = cumulus with ~40 /km core). */
  cloudDensity: number;
  /** Wind speed at cloud level (m/s) and the compass bearing it blows TOWARD (degrees clockwise from north). */
  windSpeed: number;
  windDirectionDeg: number;
  cumulusBaseKm: number;
  cumulusTopKm: number;
  cirrusBaseKm: number;
  cirrusTopKm: number;
  starsEnabled: boolean;
  /** Multiplier on star flux (1 = photometric). */
  starBrightness: number;
  /** 0 = steady, 1 = full scintillation (grows toward the horizon either way). */
  twinkle: number;
  milkyWayEnabled: boolean;
  milkyWayBrightness: number;
  /** Multiplier on airglow and the starlight floor (Frame.sky.w is applied on top). */
  nightSkyScale: number;
  /** Overrides rc.settings.seed for the cloud pattern when not null. */
  seed: number | null;
}

export const DEFAULT_ATMOSPHERE_SETTINGS: Readonly<AtmosphereSettings> = {
  cloudsEnabled: true,
  cloudCoverage: 0.4,
  cirrusCoverage: 0.3,
  cloudDensity: 1,
  windSpeed: 6,
  windDirectionDeg: 250,
  cumulusBaseKm: 1.5,
  cumulusTopKm: 4,
  cirrusBaseKm: 8,
  cirrusTopKm: 10,
  starsEnabled: true,
  starBrightness: 1,
  twinkle: 0.5,
  milkyWayEnabled: true,
  milkyWayBrightness: 1,
  nightSkyScale: 1,
  seed: null,
};

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

/** Returns a sanitised copy: ranges clamped, layers ordered, non-finite numbers replaced by the defaults. */
export function sanitizeAtmosphereSettings(s: Partial<AtmosphereSettings>, base: Readonly<AtmosphereSettings> = DEFAULT_ATMOSPHERE_SETTINGS): AtmosphereSettings {
  const m: AtmosphereSettings = { ...base, ...s };
  const num = (v: number, fallback: number): number => (Number.isFinite(v) ? v : fallback);
  m.cloudCoverage = clamp(num(m.cloudCoverage, base.cloudCoverage), 0, 1);
  m.cirrusCoverage = clamp(num(m.cirrusCoverage, base.cirrusCoverage), 0, 1);
  m.cloudDensity = clamp(num(m.cloudDensity, 1), 0.05, 8);
  m.windSpeed = clamp(num(m.windSpeed, base.windSpeed), 0, 80);
  m.windDirectionDeg = num(m.windDirectionDeg, base.windDirectionDeg);
  m.cumulusBaseKm = clamp(num(m.cumulusBaseKm, base.cumulusBaseKm), 0.3, 6);
  m.cumulusTopKm = clamp(num(m.cumulusTopKm, base.cumulusTopKm), m.cumulusBaseKm + 0.3, 9);
  m.cirrusBaseKm = clamp(num(m.cirrusBaseKm, base.cirrusBaseKm), m.cumulusTopKm + 0.5, 14);
  m.cirrusTopKm = clamp(num(m.cirrusTopKm, base.cirrusTopKm), m.cirrusBaseKm + 0.2, 16);
  m.starBrightness = clamp(num(m.starBrightness, 1), 0, 20);
  m.twinkle = clamp(num(m.twinkle, base.twinkle), 0, 1);
  m.milkyWayBrightness = clamp(num(m.milkyWayBrightness, 1), 0, 20);
  m.nightSkyScale = clamp(num(m.nightSkyScale, 1), 0, 20);
  return m;
}
