/**
 * Saving and loading props as JSON files. The same file is read by the game (public/props), the bench tools and the lab page.
 * The file stores the design in the units a person reads (inches, grams), not the solver's SI numbers.
 */
import { DEFAULT_AIRFOIL, DEFAULT_PROP, INCH, type PropDesign } from './design';

export interface PropFile {
  schemaVersion: 1;
  name: string;
  diameterIn: number;
  pitchIn: number;
  pitchTilt: number;
  blades: number;
  chordRatio: number;
  chordTaper: number;
  hubRatio: number;
  thicknessRatio: number;
  airfoil: { clAlpha: number; alpha0: number; clMax: number; cd0: number; cdK: number };
  densityKgM3: number;
  /** Free-form notes: where the design came from and how it scored. */
  notes?: string;
}

export function serializeProp(d: PropDesign, notes?: string): PropFile {
  return {
    schemaVersion: 1, name: d.name, diameterIn: d.diameter / INCH, pitchIn: d.pitch / INCH, pitchTilt: d.pitchTilt, blades: d.blades,
    chordRatio: d.chordRatio, chordTaper: d.chordTaper, hubRatio: d.hubRatio, thicknessRatio: d.thicknessRatio,
    airfoil: { ...d.airfoil }, densityKgM3: d.density, ...(notes ? { notes } : {}),
  };
}

const num = (v: unknown, lo: number, hi: number, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback);

/** Reads a prop file leniently: missing or out-of-range numbers fall back to or clamp against the stock prop. */
export function parseProp(text: string | unknown): PropDesign {
  const j = (typeof text === 'string' ? JSON.parse(text) : text) as Partial<PropFile>;
  if (!j || typeof j !== 'object') throw new Error('prop file is not an object');
  const a = (j.airfoil ?? {}) as Partial<PropFile['airfoil']>;
  return {
    name: typeof j.name === 'string' ? j.name : 'prop',
    diameter: num(j.diameterIn, 2, 7, DEFAULT_PROP.diameter / INCH) * INCH,
    pitch: num(j.pitchIn, 1, 10, DEFAULT_PROP.pitch / INCH) * INCH,
    pitchTilt: num(j.pitchTilt, -0.5, 0.6, 0),
    blades: Math.round(num(j.blades, 2, 6, 3)),
    chordRatio: num(j.chordRatio, 0.05, 0.6, DEFAULT_PROP.chordRatio),
    chordTaper: num(j.chordTaper, -0.8, 0.8, 0),
    hubRatio: num(j.hubRatio, 0.05, 0.4, DEFAULT_PROP.hubRatio),
    thicknessRatio: num(j.thicknessRatio, 0.03, 0.2, DEFAULT_PROP.thicknessRatio),
    airfoil: {
      clAlpha: num(a.clAlpha, 3, 7, DEFAULT_AIRFOIL.clAlpha), alpha0: num(a.alpha0, -0.2, 0.1, DEFAULT_AIRFOIL.alpha0),
      clMax: num(a.clMax, 0.6, 2, DEFAULT_AIRFOIL.clMax), cd0: num(a.cd0, 0.005, 0.08, DEFAULT_AIRFOIL.cd0), cdK: num(a.cdK, 0, 0.3, DEFAULT_AIRFOIL.cdK),
    },
    density: num(j.densityKgM3, 800, 2000, DEFAULT_PROP.density),
  };
}

/** Where the prop lab stores the prop the game should fly. */
export const PROP_STORAGE_KEY = 'fpv.prop';
