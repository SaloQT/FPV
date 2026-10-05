/**
 * Pure logic of the track builder: the recipe's sliders and weights, the track file format (export, import, the trainer's
 * `--track`), the saved-track library, the builder camera's orbit and fly-through maths, and the side elevation profile. No DOM
 * and no GPU, so all of it is tested in Node.
 */
import { TRACK_FEATURES, type GateKind, type ObstacleKind, type RenderQuality, type TrackData, type TrackFeature, type TrackGate, type TrackObstacle, type TrackRecipe, type Vec3 } from '../contracts';
import type { RaceSnapshot } from '../game/gateTimer';
import { RECIPE_GATE_KINDS, RECIPE_LIMITS, RECIPE_OBJECT_KINDS, sanitizeRecipe } from '../world/track/recipe';
import { onStorageKey } from './leaderboard';
import { formatLength, GATE_COLORS, GATE_KIND_LABELS } from './trackPreviewModel';

/** Quiet time after the last slider move before the track is rebuilt. */
export const BUILD_DEBOUNCE_MS = 300;

// ───────────────────────────── Recipe controls ─────────────────────────────

/** The recipe's plain numbers, one slider each. */
export type RecipeNumber = 'gateCount' | 'length' | 'laps' | 'difficulty' | 'elevation' | 'twist' | 'featureShare' | 'obstacles';

export interface RecipeSlider {
  key: RecipeNumber;
  label: string;
  hint: string;
  min: number;
  max: number;
  step: number;
  format(v: number): string;
}

const pct = (v: number): string => `${Math.round(v * 100)}%`;
const int = (v: number): string => String(Math.round(v));

const SLIDER_TEXT: Readonly<Record<RecipeNumber, { label: string; hint: string; format(v: number): string }>> = {
  gateCount: { label: 'Gates', hint: 'Gates wanted; a manoeuvre counts each of its gates.', format: int },
  length: { label: 'Length', hint: 'Rough length of one lap, or of the run.', format: (v) => formatLength(v) },
  laps: { label: 'Laps', hint: 'Laps of a circuit. A point-to-point run is always one.', format: int },
  difficulty: { label: 'Difficulty', hint: 'Gate size, turn tightness and how hard the manoeuvres are.', format: pct },
  elevation: { label: 'Elevation', hint: 'How much the line climbs and falls between gates.', format: pct },
  twist: { label: 'Twist', hint: 'Sweeping (0) to tight and twisty (100%).', format: pct },
  featureShare: { label: 'Manoeuvres', hint: 'Share of the gates spent on manoeuvres (split-S, loops, ladders ...).', format: pct },
  obstacles: { label: 'Obstacles', hint: 'How many objects stand along the course.', format: pct },
};

export const COURSE_KEYS: readonly RecipeNumber[] = ['gateCount', 'length', 'laps', 'difficulty', 'elevation', 'twist'];

/** The slider of a recipe number, with the generator's own limits (RECIPE_LIMITS). */
export function recipeSlider(key: RecipeNumber): RecipeSlider {
  const lim = RECIPE_LIMITS[key];
  return { key, ...SLIDER_TEXT[key], min: lim.min, max: lim.max, step: lim.step };
}

/** Laps only apply to a circuit. */
export function sliderEnabled(r: TrackRecipe, key: RecipeNumber): boolean {
  return key !== 'laps' || r.closed;
}

export function withValue(r: TrackRecipe, key: RecipeNumber, value: number): TrackRecipe {
  return sanitizeRecipe({ ...r, [key]: value });
}

/** Circuit or point to point. A point-to-point run is one lap; back on a circuit it gets `circuitLaps` (the laps it had) again. */
export function withClosed(r: TrackRecipe, closed: boolean, circuitLaps = 0): TrackRecipe {
  if (closed === r.closed) return r;
  return sanitizeRecipe({ ...r, closed, laps: closed ? Math.max(circuitLaps, r.laps, 1) : 1 });
}

export function withSeed(r: TrackRecipe, seed: number): TrackRecipe {
  return sanitizeRecipe({ ...r, seed: seed >>> 0 });
}

/** The weighted groups of a recipe: plain gate kinds, manoeuvres and obstacle kinds. */
export type WeightGroup = 'gates' | 'features' | 'objects';

/** Gate kinds placed between manoeuvres (start and finish are the generator's): the recipe's own list. */
export const GATE_WEIGHT_KINDS: readonly GateKind[] = RECIPE_GATE_KINDS;
/** Obstacle kinds a recipe weights: the recipe's own list. */
export const OBJECT_WEIGHT_KINDS: readonly ObstacleKind[] = RECIPE_OBJECT_KINDS;

export const FEATURE_LABELS: Readonly<Record<TrackFeature, string>> = {
  'split-s': 'Split-S', 'power-loop': 'Power loop', corkscrew: 'Corkscrew', ladder: 'Ladder', dive: 'Dive', drop: 'Drop ring',
  slalom: 'Slalom', hairpin: 'Hairpin', tunnel: 'Tunnel', window: 'Window', hurdle: 'Hurdles',
};

export const FEATURE_HINTS: Readonly<Record<TrackFeature, string>> = {
  'split-s': 'Half loop down: a gate, then a lower one facing back the way you came.',
  'power-loop': 'A full vertical loop back over a bar.',
  corkscrew: 'Gates rolled further and further around the line.',
  ladder: 'Rungs stacked straight up, flown up and back down.',
  dive: 'A steep drop through pitched gates.',
  drop: 'A flat ring flown straight down through.',
  slalom: 'Flags left and right of a straight.',
  hairpin: 'A 180 degree turn around a pylon or wall.',
  tunnel: 'A sleeve with a roof to fly low through.',
  window: 'An opening cut in a solid wall.',
  hurdle: 'Low wide bars just over the ground.',
};

export const OBJECT_LABELS: Readonly<Record<ObstacleKind, string>> = {
  pole: 'Poles', cone: 'Cones', tree: 'Trees', rock: 'Rocks', wall: 'Walls', flagpole: 'Flagpoles', tower: 'Towers',
  container: 'Containers', pillar: 'Pillars', beam: 'Beams', bridge: 'Bridges', scaffold: 'Scaffolds',
};

/** Range of every weight slider: the recipe's own weight limits. */
export const WEIGHT_MIN = RECIPE_LIMITS.weight.min;
export const WEIGHT_MAX = RECIPE_LIMITS.weight.max;
export const WEIGHT_STEP = RECIPE_LIMITS.weight.step;

export function weightKinds(group: WeightGroup): readonly string[] {
  return group === 'gates' ? GATE_WEIGHT_KINDS : group === 'features' ? TRACK_FEATURES : OBJECT_WEIGHT_KINDS;
}

export function weightLabel(group: WeightGroup, kind: string): string {
  if (group === 'gates') return GATE_KIND_LABELS[kind as GateKind];
  if (group === 'features') return FEATURE_LABELS[kind as TrackFeature];
  return OBJECT_LABELS[kind as ObstacleKind];
}

export function weightOf(r: TrackRecipe, group: WeightGroup, kind: string): number {
  const v = (r[group] as Record<string, number | undefined>)[kind];
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

export function withWeight(r: TrackRecipe, group: WeightGroup, kind: string, value: number): TrackRecipe {
  const next: Record<string, number> = { ...(r[group] as Record<string, number>) };
  if (value > 0) next[kind] = Math.min(value, WEIGHT_MAX);
  else delete next[kind];
  return sanitizeRecipe({ ...r, [group]: next });
}

/** Each kind's share of its group, 0..1 (what the slider's readout shows); all zero when the group is empty. */
export function weightShares(r: TrackRecipe, group: WeightGroup): Record<string, number> {
  const kinds = weightKinds(group);
  let sum = 0;
  for (const k of kinds) sum += Math.max(weightOf(r, group, k), 0);
  const out: Record<string, number> = {};
  for (const k of kinds) out[k] = sum > 0 ? Math.max(weightOf(r, group, k), 0) / sum : 0;
  return out;
}

/** What an empty group falls back to, said under the group. */
export const EMPTY_GROUP_TEXT: Readonly<Record<WeightGroup, string>> = {
  gates: 'All at zero: plain square gates.',
  features: 'All at zero: no manoeuvres.',
  objects: 'All at zero: trees and rocks.',
};

// ───────────────────────────── Track files ─────────────────────────────

/** What Export writes and the trainer's `--track` reads: the terrain the track sits on, the track, and its recipe. */
export interface TrackFile {
  terrainSeed: number;
  quality: RenderQuality;
  track: TrackData;
  recipe?: TrackRecipe;
}

/** What an imported file gave: a track or a recipe (or both), and the terrain when the file names one. */
export interface ImportedTrack {
  terrainSeed?: number;
  quality?: RenderQuality;
  track?: TrackData;
  recipe?: TrackRecipe;
}

const QUALITIES: readonly RenderQuality[] = ['low', 'medium', 'high', 'ultra'];
const GATE_KINDS: readonly GateKind[] = ['square', 'arch', 'hoop', 'dive', 'flag', 'start', 'finish', 'window', 'ladder', 'tunnel', 'hurdle', 'drop'];
const OBSTACLE_KINDS: readonly ObstacleKind[] = OBJECT_WEIGHT_KINDS;
const STYLES: readonly TrackData['style'][] = ['race', 'freestyle', 'mountain', 'sprint', 'technical', 'acro', 'industrial', 'custom'];
const MAX_PATH = 20000;
const MAX_GATES = 200;
const MAX_OBSTACLES = 4000;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function vec3(v: unknown): Vec3 | null {
  return Array.isArray(v) && v.length === 3 && v.every(finite) ? [v[0], v[1], v[2]] : null;
}

function gateOf(raw: unknown, index: number): TrackGate | null {
  if (!isRecord(raw)) return null;
  const pos = vec3(raw.pos);
  const kind = raw.kind as GateKind;
  if (pos === null || !GATE_KINDS.includes(kind)) return null;
  if (!finite(raw.yaw) || !finite(raw.width) || !finite(raw.height) || raw.width <= 0 || raw.height <= 0) return null;
  const gate: TrackGate = {
    index, kind, pos, yaw: raw.yaw, roll: finite(raw.roll) ? raw.roll : 0, pitch: finite(raw.pitch) ? raw.pitch : 0, width: raw.width, height: raw.height,
  };
  if (typeof raw.feature === 'string' && (TRACK_FEATURES as readonly string[]).includes(raw.feature)) gate.feature = raw.feature as TrackFeature;
  if (finite(raw.depth) && raw.depth > 0) gate.depth = raw.depth;
  return gate;
}

function obstacleOf(raw: unknown): TrackObstacle | null {
  if (!isRecord(raw)) return null;
  const pos = vec3(raw.pos);
  const size = vec3(raw.size);
  const kind = raw.kind as ObstacleKind;
  if (pos === null || size === null || !OBSTACLE_KINDS.includes(kind) || !finite(raw.yaw)) return null;
  return { kind, pos, yaw: raw.yaw, size };
}

/** A TrackData from untrusted JSON (a file), or null with nothing usable. Broken obstacles are dropped; a broken gate or path point rejects it. */
export function sanitizeTrackData(raw: unknown): TrackData | null {
  if (!isRecord(raw) || !Array.isArray(raw.gates) || !Array.isArray(raw.path)) return null;
  if (raw.gates.length < 2 || raw.gates.length > MAX_GATES || raw.path.length < 2 || raw.path.length > MAX_PATH) return null;
  const gates: TrackGate[] = [];
  for (let i = 0; i < raw.gates.length; i++) {
    const g = gateOf(raw.gates[i], i);
    if (g === null) return null;
    gates.push(g);
  }
  const path: Vec3[] = [];
  for (const p of raw.path) {
    const v = vec3(p);
    if (v === null) return null;
    path.push(v);
  }
  const start = isRecord(raw.start) ? { pos: vec3(raw.start.pos), yaw: raw.start.yaw } : null;
  if (start === null || start.pos === null || !finite(start.yaw)) return null;
  const obstacles = Array.isArray(raw.obstacles) ? raw.obstacles.slice(0, MAX_OBSTACLES).map(obstacleOf).filter((o): o is TrackObstacle => o !== null) : [];
  const closed = raw.closed === true;
  const style = STYLES.includes(raw.style as TrackData['style']) ? (raw.style as TrackData['style']) : 'custom';
  let length = 0;
  for (let i = 1; i < path.length; i++) length += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1], path[i][2] - path[i - 1][2]);
  if (closed) length += Math.hypot(path[0][0] - path[path.length - 1][0], path[0][1] - path[path.length - 1][1], path[0][2] - path[path.length - 1][2]);
  const track: TrackData = {
    seed: finite(raw.seed) ? raw.seed >>> 0 : 0,
    style,
    gates,
    obstacles,
    path,
    closed,
    length,
    start: { pos: start.pos, yaw: start.yaw },
    laps: closed && finite(raw.laps) ? Math.min(Math.max(Math.round(raw.laps), 1), 10) : 1,
  };
  if (isRecord(raw.recipe)) track.recipe = sanitizeRecipe(raw.recipe);
  // A custom track is identified by its recipe; one without (hand-edited JSON) keeps the style the validator can check it against.
  if (track.style === 'custom' && track.recipe === undefined) track.style = closed ? 'race' : 'freestyle';
  return track;
}

export function trackFileJson(f: TrackFile): string {
  const out: Record<string, unknown> = { terrainSeed: f.terrainSeed >>> 0, quality: f.quality, track: f.track };
  if (f.recipe !== undefined) out.recipe = f.recipe;
  return JSON.stringify(out);
}

/** A file name for an export: the track's name in lower case, letters, digits and dashes only. */
export function trackFileName(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
  return `${slug.length > 0 ? slug : 'track'}.track.json`;
}

/**
 * Reads an exported track (`{ terrainSeed, quality, track, recipe }`), a bare TrackData, or a bare recipe. The error says why
 * a file was refused.
 */
export function parseTrackFile(text: string): { ok: true; value: ImportedTrack } | { ok: false; error: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'That file is not JSON.' };
  }
  if (!isRecord(raw)) return { ok: false, error: 'That file holds no track.' };
  const value: ImportedTrack = {};
  if (finite(raw.terrainSeed)) value.terrainSeed = Math.max(0, Math.floor(raw.terrainSeed)) >>> 0;
  if (QUALITIES.includes(raw.quality as RenderQuality)) value.quality = raw.quality as RenderQuality;
  const bareTrack = Array.isArray(raw.gates) && Array.isArray(raw.path);
  const bareRecipe = raw.version === 1 && finite(raw.gateCount);
  const trackRaw = isRecord(raw.track) ? raw.track : bareTrack ? raw : null;
  const recipeRaw = isRecord(raw.recipe) ? raw.recipe : bareRecipe ? raw : null;
  if (trackRaw !== null) {
    const track = sanitizeTrackData(trackRaw);
    if (track === null) return { ok: false, error: 'The track in that file is damaged (gates, path or start).' };
    value.track = track;
    if (track.recipe !== undefined) value.recipe = track.recipe;
  }
  if (recipeRaw !== null) value.recipe = sanitizeRecipe(recipeRaw);
  if (value.track === undefined && value.recipe === undefined) return { ok: false, error: 'That file holds no track or recipe.' };
  return { ok: true, value };
}

// ───────────────────────────── Saved tracks ─────────────────────────────

export const TRACKS_KEY = 'fpv.tracks.v1';
export const MAX_SAVED = 100;
const MAX_NAME = 48;

/** A track in the library: a recipe on a terrain, or (for imported tracks without one) the track itself. */
export interface SavedTrack {
  name: string;
  terrainSeed: number;
  quality: RenderQuality;
  recipe?: TrackRecipe;
  track?: TrackData;
  savedAt: number;
}

export function cleanName(name: string): string {
  return name.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
}

export function sanitizeSavedTrack(raw: unknown): SavedTrack | null {
  if (!isRecord(raw) || typeof raw.name !== 'string' || !finite(raw.terrainSeed) || !QUALITIES.includes(raw.quality as RenderQuality)) return null;
  const name = cleanName(raw.name);
  if (name.length === 0) return null;
  const out: SavedTrack = { name, terrainSeed: Math.max(0, Math.floor(raw.terrainSeed)) >>> 0, quality: raw.quality as RenderQuality, savedAt: finite(raw.savedAt) ? raw.savedAt : 0 };
  if (isRecord(raw.recipe)) out.recipe = sanitizeRecipe(raw.recipe);
  else if (raw.track !== undefined) {
    const track = sanitizeTrackData(raw.track);
    if (track === null) return null;
    out.track = track;
  }
  return out.recipe !== undefined || out.track !== undefined ? out : null;
}

/** The saved library from untrusted JSON: newest first, unique names, at most MAX_SAVED. */
export function sanitizeSavedTracks(raw: unknown): SavedTrack[] {
  const list = isRecord(raw) && raw.version === 1 && Array.isArray(raw.tracks) ? raw.tracks : [];
  const seen = new Set<string>();
  const out: SavedTrack[] = [];
  for (const t of list.map(sanitizeSavedTrack).filter((x): x is SavedTrack => x !== null).sort((a, b) => b.savedAt - a.savedAt)) {
    const k = t.name.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
    if (out.length >= MAX_SAVED) break;
  }
  return out;
}

/** A name not yet in the library: "Name", "Name (2)", ... */
export function uniqueTrackName(base: string, taken: readonly SavedTrack[]): string {
  const names = new Set(taken.map((t) => t.name.toLowerCase()));
  const b = cleanName(base) || 'Track';
  if (!names.has(b.toLowerCase())) return b;
  for (let k = 2; ; k++) {
    const n = `${b.slice(0, MAX_NAME - 5)} (${k})`;
    if (!names.has(n.toLowerCase())) return n;
  }
}

export interface TrackStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function browserStorage(): TrackStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * The named-track library in `localStorage`. Every change re-reads what is saved first, and a change made in another tab is read
 * back, so two open tabs add to the same library instead of overwriting each other.
 */
export class SavedTracksStore {
  private tracks: SavedTrack[];
  /** Storage failed once: from then on the copy in memory is the only one. */
  private local = false;
  /** Another tab changed the library since it was read. */
  private stale = false;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly storage: TrackStorage | null = browserStorage()) {
    this.tracks = this.load();
    onStorageKey(storage, TRACKS_KEY, () => {
      this.stale = true;
      this.changed();
    });
  }

  list(): readonly SavedTrack[] {
    this.sync(false);
    return this.tracks;
  }

  find(name: string): SavedTrack | null {
    this.sync(false);
    const k = cleanName(name).toLowerCase();
    return this.tracks.find((t) => t.name.toLowerCase() === k) ?? null;
  }

  /** Saves under the track's name, replacing one of the same name. False when storage refused it (full or blocked). */
  save(track: SavedTrack): boolean {
    const clean = sanitizeSavedTrack(track);
    if (clean === null) return false;
    this.sync(true);
    const k = clean.name.toLowerCase();
    const next = [clean, ...this.tracks.filter((t) => t.name.toLowerCase() !== k)].slice(0, MAX_SAVED);
    const ok = this.write(next);
    this.tracks = next;
    this.changed();
    return ok;
  }

  remove(name: string): void {
    this.sync(true);
    const k = cleanName(name).toLowerCase();
    const next = this.tracks.filter((t) => t.name.toLowerCase() !== k);
    if (next.length === this.tracks.length) return;
    this.write(next);
    this.tracks = next;
    this.changed();
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }

  private changed(): void {
    for (const fn of [...this.listeners]) fn();
  }

  /** Reads the saved library again: before a change (`always`), or when another tab changed it. */
  private sync(always: boolean): void {
    if (this.storage === null || this.local || (!always && !this.stale)) return;
    this.stale = false;
    this.tracks = this.load();
  }

  private load(): SavedTrack[] {
    let text: string | null;
    try {
      text = this.storage?.getItem(TRACKS_KEY) ?? null;
    } catch {
      this.local = true;
      return [];
    }
    try {
      return text === null ? [] : sanitizeSavedTracks(JSON.parse(text));
    } catch {
      return [];
    }
  }

  private write(tracks: readonly SavedTrack[]): boolean {
    try {
      this.storage?.setItem(TRACKS_KEY, JSON.stringify({ version: 1, tracks }));
      return this.storage !== null;
    } catch {
      this.local = true;
      return false;
    }
  }
}

// ───────────────────────────── Builder camera ─────────────────────────────

/** An orbit around a point: azimuth 0 puts the camera south of the target looking north (the free camera's convention). */
export interface OrbitCam {
  target: Vec3;
  azimuth: number;
  /** Radians above the horizon. */
  elevation: number;
  distance: number;
}

export const ORBIT_MIN_M = 4;
export const ORBIT_MAX_M = 6000;
export const ORBIT_MIN_ELEVATION = -0.15;
export const ORBIT_MAX_ELEVATION = 1.553;
/** Field of view of the builder camera, radians (vertical). */
export const BUILDER_FOV = (55 * Math.PI) / 180;
const DRAG_RAD_PER_PX = 0.005;
const ZOOM_PER_WHEEL = 0.0012;

export function trackBounds(track: TrackData): { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number } {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  const take = (p: Vec3): void => {
    if (p[0] < x0) x0 = p[0];
    if (p[0] > x1) x1 = p[0];
    if (p[1] < y0) y0 = p[1];
    if (p[1] > y1) y1 = p[1];
    if (p[2] < z0) z0 = p[2];
    if (p[2] > z1) z1 = p[2];
  };
  for (const p of track.path) take(p);
  for (const g of track.gates) take(g.pos);
  take(track.start.pos);
  return { x0, x1, y0, y1, z0, z1 };
}

/** An orbit that frames the whole course from the south-east, 50 degrees up. */
export function fitOrbit(track: TrackData, aspect = 16 / 9): OrbitCam {
  const b = trackBounds(track);
  const radius = Math.max(Math.hypot(b.x1 - b.x0, b.z1 - b.z0) / 2, Math.max(b.y1 - b.y0, 10), 20);
  const half = Math.min(BUILDER_FOV / 2, Math.atan(Math.tan(BUILDER_FOV / 2) * Math.max(aspect, 0.3)));
  return {
    target: [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, (b.z0 + b.z1) / 2],
    azimuth: Math.PI * 0.25,
    elevation: 0.85,
    distance: clamp((radius / Math.sin(half)) * 1.05, ORBIT_MIN_M, ORBIT_MAX_M),
  };
}

/** Straight down onto the course, north up. */
export function topOrbit(track: TrackData, aspect = 16 / 9): OrbitCam {
  const fit = fitOrbit(track, aspect);
  return { ...fit, azimuth: 0, elevation: ORBIT_MAX_ELEVATION, distance: fit.distance * 0.95 };
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi);

export function orbitDrag(cam: OrbitCam, dx: number, dy: number): void {
  cam.azimuth -= dx * DRAG_RAD_PER_PX;
  cam.elevation = clamp(cam.elevation + dy * DRAG_RAD_PER_PX, ORBIT_MIN_ELEVATION, ORBIT_MAX_ELEVATION);
}

/** Wheel zoom: positive `wheel` (scrolling down) moves away. */
export function orbitZoom(cam: OrbitCam, wheel: number): void {
  cam.distance = clamp(cam.distance * Math.exp(wheel * ZOOM_PER_WHEEL), ORBIT_MIN_M, ORBIT_MAX_M);
}

/** Drags the target with the picture: `dx`, `dy` in px over a view `viewPx` tall. */
export function orbitPan(cam: OrbitCam, dx: number, dy: number, viewPx: number): void {
  const mPerPx = (2 * cam.distance * Math.tan(BUILDER_FOV / 2)) / Math.max(viewPx, 1);
  const s = Math.sin(cam.azimuth), c = Math.cos(cam.azimuth);
  // Screen right is (cos az, 0, -sin az); screen up, flattened onto the ground, is the view direction (-sin az, 0, -cos az).
  const up = Math.sin(cam.elevation) > 0.7 ? 1 : 1 / Math.max(Math.sin(cam.elevation), 0.25);
  cam.target[0] += (-dx * c - dy * s * up) * mPerPx;
  cam.target[2] += (dx * s - dy * c * up) * mPerPx;
}

/** Flies the target: `forward` and `right` along the ground in the view's heading, `up` straight up, metres. */
export function orbitMove(cam: OrbitCam, forward: number, right: number, up: number): void {
  const s = Math.sin(cam.azimuth), c = Math.cos(cam.azimuth);
  cam.target[0] += -s * forward + c * right;
  cam.target[2] += -c * forward - s * right;
  cam.target[1] += up;
}

/** Fly speed for the keys, m/s: in proportion to the view distance, so it feels the same close up and far out. */
export function flySpeed(cam: OrbitCam, fast: boolean): number {
  return clamp(cam.distance * 0.6, 4, 600) * (fast ? 3 : 1);
}

/** Where the orbit camera sits. */
export function orbitEye(cam: OrbitCam, out: Vec3): Vec3 {
  const ce = Math.cos(cam.elevation);
  out[0] = cam.target[0] + Math.sin(cam.azimuth) * ce * cam.distance;
  out[1] = cam.target[1] + Math.sin(cam.elevation) * cam.distance;
  out[2] = cam.target[2] + Math.cos(cam.azimuth) * ce * cam.distance;
  return out;
}

/** Near plane for a camera this far from what it looks at: close enough for gates up close, far enough for depth precision far out. */
export function nearPlane(distance: number): number {
  return clamp(distance * 0.002, 0.05, 2);
}

/** Cumulative arc length at every path point (one extra entry at the end for the closing segment of a closed path). */
export function pathArcLengths(path: readonly Vec3[], closed: boolean): Float64Array {
  const n = path.length;
  const s = new Float64Array(n + 1);
  for (let i = 1; i < n; i++) s[i] = s[i - 1] + Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1], path[i][2] - path[i - 1][2]);
  s[n] = closed && n > 1 ? s[n - 1] + Math.hypot(path[0][0] - path[n - 1][0], path[0][1] - path[n - 1][1], path[0][2] - path[n - 1][2]) : s[n - 1];
  return s;
}

/** The point at arc length `at` (wrapping on a closed path, clamped on an open one). */
export function pointAt(path: readonly Vec3[], arc: Float64Array, closed: boolean, at: number, out: Vec3): Vec3 {
  const n = path.length;
  if (n === 0) return out;
  const total = arc[n];
  let s = at;
  if (closed && total > 0) s = ((s % total) + total) % total;
  else s = clamp(s, 0, arc[n - 1]);
  let lo = 0, hi = closed ? n : n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (arc[mid] <= s) lo = mid;
    else hi = mid;
  }
  const a = path[lo], b = path[(lo + 1) % n];
  const seg = arc[lo + 1] - arc[lo];
  const t = seg > 1e-9 ? clamp((s - arc[lo]) / seg, 0, 1) : 0;
  out[0] = a[0] + (b[0] - a[0]) * t;
  out[1] = a[1] + (b[1] - a[1]) * t;
  out[2] = a[2] + (b[2] - a[2]) * t;
  return out;
}

/** Fly-through: speed along the line, how far behind and above the line the camera rides, and how far ahead it looks. */
export const FLY_SPEED_MS = 20;
const FLY_BACK_M = 6;
const FLY_UP_M = 1.6;
const FLY_LOOK_M = 14;

/**
 * The fly-through camera at arc length `s`: a little behind and above the line, looking at a point further on, so loops and
 * split-S read as the pilot will see them. Writes the eye and the look direction.
 */
export function flyThroughPose(path: readonly Vec3[], arc: Float64Array, closed: boolean, s: number, eye: Vec3, look: Vec3): void {
  pointAt(path, arc, closed, s - FLY_BACK_M, eye);
  pointAt(path, arc, closed, s + FLY_LOOK_M, look);
  eye[1] += FLY_UP_M;
  look[0] -= eye[0];
  look[1] -= eye[1];
  look[2] -= eye[2];
}

// ───────────────────────────── Elevation profile ─────────────────────────────

export interface ProfileGate {
  index: number;
  kind: GateKind;
  feature?: TrackFeature;
  /** Arc length along the line, m, and the opening centre's height. */
  s: number;
  y: number;
  /** Half the opening height, m (the marker's size). */
  half: number;
  color: string;
}

/** A run of consecutive gates of one manoeuvre, for the labels over the profile. */
export interface ProfileFeature {
  feature: TrackFeature;
  s0: number;
  s1: number;
  label: string;
}

export interface ProfileModel {
  /** Length of the line, m. */
  length: number;
  yMin: number;
  yMax: number;
  /** Line as s, y pairs. */
  line: Float32Array;
  /** Ground under the line as s, y pairs (same samples as `line`). */
  ground: Float32Array;
  gates: ProfileGate[];
  features: ProfileFeature[];
}

/** Index of the path point nearest to `p` (3D). */
export function nearestPathPoint(path: readonly Vec3[], p: Vec3): number {
  let best = 0, bd = Infinity;
  for (let i = 0; i < path.length; i++) {
    const q = path[i];
    const d = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2 + (q[2] - p[2]) ** 2;
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  return best;
}

/**
 * The side view of one lap: height of the line and of the ground under it against the distance flown, with the gates on it and
 * the manoeuvres labelled. `groundAt` is the terrain height (the app passes the sampler's).
 */
export function buildProfile(track: TrackData, groundAt: (x: number, z: number) => number, maxPoints = 600): ProfileModel {
  const path = track.path;
  const arc = pathArcLengths(path, track.closed);
  const n = path.length;
  const length = arc[n];
  const count = Math.max(2, Math.min(maxPoints, n + (track.closed ? 1 : 0)));
  const line = new Float32Array(count * 2);
  const ground = new Float32Array(count * 2);
  const p: Vec3 = [0, 0, 0];
  let yMin = Infinity, yMax = -Infinity;
  for (let k = 0; k < count; k++) {
    const s = (length * k) / (count - 1);
    pointAt(path, arc, track.closed, Math.min(s, length - 1e-6), p);
    const g = groundAt(p[0], p[2]);
    line[2 * k] = s;
    line[2 * k + 1] = p[1];
    ground[2 * k] = s;
    ground[2 * k + 1] = g;
    yMin = Math.min(yMin, p[1], g);
    yMax = Math.max(yMax, p[1], g);
  }
  const gates = track.gates.map((g): ProfileGate => {
    const i = nearestPathPoint(path, g.pos);
    yMin = Math.min(yMin, g.pos[1] - g.height / 2);
    yMax = Math.max(yMax, g.pos[1] + g.height / 2);
    const out: ProfileGate = { index: g.index, kind: g.kind, s: arc[i], y: g.pos[1], half: g.height / 2, color: GATE_COLORS[g.kind] };
    if (g.feature !== undefined) out.feature = g.feature;
    return out;
  });
  const features: ProfileFeature[] = [];
  for (let i = 0; i < gates.length; i++) {
    const f = gates[i].feature;
    if (f === undefined) continue;
    const last = features[features.length - 1];
    if (last !== undefined && last.feature === f && i > 0 && gates[i - 1].feature === f) last.s1 = Math.max(last.s1, gates[i].s);
    else features.push({ feature: f, s0: gates[i].s, s1: gates[i].s, label: FEATURE_LABELS[f] });
  }
  if (!Number.isFinite(yMin)) {
    yMin = 0;
    yMax = 1;
  }
  return { length, yMin, yMax: Math.max(yMax, yMin + 1), line, ground, gates, features };
}

/** "2 Split-S, 1 Ladder, 3 Hurdles": the manoeuvres on a track (runs of gates tagged with one), most common first. */
export function featureSummary(track: TrackData): { feature: TrackFeature; count: number }[] {
  const counts = new Map<TrackFeature, number>();
  let prev: TrackFeature | undefined;
  for (const g of track.gates) {
    if (g.feature !== undefined && g.feature !== prev) counts.set(g.feature, (counts.get(g.feature) ?? 0) + 1);
    prev = g.feature;
  }
  return [...counts.entries()].map(([feature, count]) => ({ feature, count })).sort((a, b) => b.count - a.count || TRACK_FEATURES.indexOf(a.feature) - TRACK_FEATURES.indexOf(b.feature));
}

export function describeFeatures(track: TrackData): string {
  const list = featureSummary(track);
  return list.length === 0 ? 'No manoeuvres' : list.map((f) => `${f.count} ${FEATURE_LABELS[f.feature]}`).join(', ');
}

/** What the leaderboard of a track is called. */
export function boardName(track: TrackData, terrainSeed: number, saved?: string): string {
  if (saved !== undefined && saved.length > 0) return saved;
  if (track.recipe !== undefined) return `Custom track ${track.recipe.seed} on terrain ${terrainSeed}`;
  const style = track.style.charAt(0).toUpperCase() + track.style.slice(1);
  return `${style} track ${track.seed} on terrain ${terrainSeed}`;
}

// ───────────────────────────── Benchmark ─────────────────────────────

/** Sim seconds a brain gets to finish a track in the benchmark: four times an ideal pilot's race, 60 to 400 s. */
export function benchTimeLimit(idealLapS: number, laps: number): number {
  const ideal = Number.isFinite(idealLapS) && idealLapS > 0 ? idealLapS * Math.max(laps, 1) : 60;
  return clamp(Math.ceil(ideal * 4), 60, 400);
}

/**
 * Gates a racer has cleared, out of `gateCount * laps`, from its timer's snapshot. On a circuit the first crossing of gate 0 is the
 * start line and each lap then ends on gate 0, so that first crossing is not counted.
 */
export function gatesCleared(snap: Pick<RaceSnapshot, 'finished' | 'gateCount' | 'gatesPassed' | 'lap' | 'laps'>, closed: boolean): number {
  const n = snap.gateCount;
  if (snap.finished) return n * Math.max(snap.laps, 1);
  const inLap = closed ? Math.max(snap.gatesPassed - 1, 0) : snap.gatesPassed;
  return (Math.max(snap.lap, 1) - 1) * n + inLap;
}

export interface BenchRow {
  name: string;
  /** "running", a finish time, or why it did not finish. */
  result: string;
  gates: string;
  crashes: number;
  finished: boolean;
}

/** The benchmark table: finishers by time first, then by gates cleared. */
export function benchRows(results: readonly { name: string; finish: number; gates: number; gateTotal: number; crashes: number; running: boolean }[]): BenchRow[] {
  return [...results]
    .sort((a, b) => {
      const fa = Number.isFinite(a.finish), fb = Number.isFinite(b.finish);
      if (fa !== fb) return fa ? -1 : 1;
      return fa ? a.finish - b.finish : b.gates - a.gates;
    })
    .map((r) => ({
      name: r.name,
      result: r.running ? 'flying...' : Number.isFinite(r.finish) ? `${r.finish.toFixed(2)} s` : 'did not finish',
      gates: `${r.gates}/${r.gateTotal}`,
      crashes: r.crashes,
      finished: Number.isFinite(r.finish),
    }));
}
