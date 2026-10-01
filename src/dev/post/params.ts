import type { Settings, Vec3 } from '../../contracts';
import { sanitizeDebug, type PostDebugMode } from '../../render/post';
import type { TimeOfDay } from '../render/astro';

export type View = 'scene' | 'sun' | 'grid';
export type Look = 'day' | 'night';

export interface DevPostParams {
  view: View;
  look: Look;
  lens: number;
  noise: number;
  taa: boolean;
  motion: boolean;
  debug: PostDebugMode;
  quality: Settings['quality'];
  scale: number;
  frames: number;
  dt: number;
  fov: number;
  osd: boolean;
}

/** What the dev scene shader draws and how the pre-exposure wrapper scales it; the page mutates it between frames. */
export interface SceneState {
  /** Scene radiance scale, 1 = midday nits. */
  radiance: number;
  /** Extra pre-exposure factor baked into the HDR this frame / last frame (the wrapper applies the same factor to the post stages). */
  premul: number;
  prevPremul: number;
  grid: boolean;
  sunDir: Vec3;
  sunNits: number;
  lampNits: number;
  motion: boolean;
}

/**
 * Radiances of the two scene looks. Day: the CPU pre-exposure of the noon astro is about 4e-5, so the ground lands near 0.25.
 * Night: the night astro (a moonlit night) gives a pre-exposure of about 50, i.e. a 0.18 card at 5e-3 nits; the dev ground is about
 * 5e-3 nits (radiance 1 = 7300 nits) so the camera, which runs near its +20 EV starlight gain there, shows it dark but readable, with the
 * lamps and the sun disc far above the white point.
 */
export const LOOKS: Record<Look, { time: TimeOfDay; radiance: number; sunNits: number; lampNits: number }> = {
  day: { time: 'noon', radiance: 1, sunNits: 1.6e9, lampNits: 2e4 },
  night: { time: 'night', radiance: 7e-7, sunNits: 2500, lampNits: 1e5 },
};

const VIEWS: readonly View[] = ['scene', 'sun', 'grid'];
const DEG = Math.PI / 180;

/** Compass azimuth clockwise from -Z (north), elevation above the horizon, degrees. */
export function compassDir(azimuthDeg: number, elevationDeg: number): Vec3 {
  const e = elevationDeg * DEG, a = azimuthDeg * DEG;
  return [Math.cos(e) * Math.sin(a), Math.sin(e), -Math.cos(e) * Math.cos(a)];
}

export function sunDirFor(view: View): Vec3 {
  return view === 'sun' ? compassDir(10, 16) : compassDir(150, 40);
}

export function readParams(search: string): DevPostParams {
  const q = new URLSearchParams(search);
  const num = (key: string, fallback: number): number => {
    const raw = q.get(key);
    const v = Number(raw);
    return raw !== null && raw !== '' && Number.isFinite(v) ? v : fallback;
  };
  const unit = (key: string, fallback: number): number => Math.min(1, Math.max(0, num(key, fallback)));
  const quality = q.get('quality');
  return {
    view: VIEWS.find((v) => v === q.get('view')) ?? 'scene',
    look: q.get('exposure') === 'night' ? 'night' : 'day',
    lens: unit('lens', 0.35),
    noise: unit('noise', 0.15),
    taa: q.get('taa') !== '0',
    motion: q.get('motion') === '1',
    debug: sanitizeDebug(num('debug', 0)),
    quality: quality === 'low' || quality === 'medium' || quality === 'ultra' ? quality : 'high',
    scale: Math.min(1, Math.max(0.25, num('scale', 1))),
    frames: Math.max(1, Math.floor(num('frames', 16))),
    dt: Math.min(0.25, Math.max(1e-3, num('dt', 1 / 60))),
    fov: Math.min(150, Math.max(20, num('fov', 70))),
    osd: q.get('osd') === '1',
  };
}
