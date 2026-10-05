/**
 * Track files for the trainer (`train.mjs --track`, `eval.mjs --track`): a TrackData JSON, or a track builder export
 * `{ terrainSeed, quality, track, recipe }`. Parsing checks every field the GPU world and the TypeScript sim read and throws a
 * readable error for anything they could not fly; optional fields get the generator's defaults.
 */
import type {
  GateKind, ObstacleKind, TerrainQuality, TrackData, TrackFeature, TrackGate, TrackObstacle, TrackStyle, Vec3,
} from '../../contracts';
import { TRACK_FEATURES } from '../../contracts';
import { isUprightKind } from '../../world/track/kindGeometry';
import { sanitizeRecipe } from '../../world/track/recipe';

const GATE_KINDS = {
  square: true, arch: true, hoop: true, dive: true, flag: true, start: true, finish: true, window: true, ladder: true, tunnel: true,
  hurdle: true, drop: true,
} satisfies Record<GateKind, true>;
const OBSTACLE_KINDS = {
  pole: true, cone: true, tree: true, rock: true, wall: true, flagpole: true, tower: true, container: true, pillar: true, beam: true,
  bridge: true, scaffold: true,
} satisfies Record<ObstacleKind, true>;
const STYLES = {
  race: true, freestyle: true, mountain: true, sprint: true, technical: true, acro: true, industrial: true, custom: true,
} satisfies Record<TrackStyle, true>;
const QUALITIES = { low: true, medium: true, high: true, ultra: true } satisfies Record<TerrainQuality, true>;

export interface TrackFile {
  track: TrackData;
  /** Seed of the terrain the track was built on (builder exports carry it; a bare TrackData has none). */
  terrainSeed?: number;
  quality?: TerrainQuality;
}

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

function num(v: unknown, what: string, fallback?: number): number {
  if (v === undefined && fallback !== undefined) return fallback;
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`${what} must be a finite number`);
  return v;
}

function vec3(v: unknown, what: string): Vec3 {
  if (!Array.isArray(v) || v.length !== 3) throw new Error(`${what} must be [x, y, z]`);
  return [num(v[0], `${what}[0]`), num(v[1], `${what}[1]`), num(v[2], `${what}[2]`)];
}

/** An optional array field: missing is empty. */
function list(v: unknown, what: string): unknown[] {
  if (v === undefined) return [];
  if (!Array.isArray(v)) throw new Error(`${what} must be an array`);
  return v;
}

function gate(v: unknown, i: number): TrackGate {
  const w = `gates[${i}]`;
  if (!isObj(v)) throw new Error(`${w} must be an object`);
  if (typeof v.kind !== 'string' || !(v.kind in GATE_KINDS)) throw new Error(`${w}.kind ${JSON.stringify(v.kind)} is not a gate kind`);
  const g: TrackGate = {
    index: i,
    kind: v.kind as GateKind,
    pos: vec3(v.pos, `${w}.pos`),
    yaw: num(v.yaw, `${w}.yaw`),
    pitch: num(v.pitch, `${w}.pitch`, 0),
    roll: num(v.roll, `${w}.roll`, 0),
    width: num(v.width, `${w}.width`),
    height: num(v.height, `${w}.height`),
  };
  if (!(g.width > 0.2 && g.height > 0.2)) throw new Error(`${w}: opening ${g.width} x ${g.height} m is too small`);
  // The walls, meshes and colliders of these kinds are built upright; a tilted pass test would miss clean passes.
  if (isUprightKind(g.kind) && (g.pitch !== 0 || g.roll !== 0)) throw new Error(`${w}: ${g.kind} gates stand upright (pitch and roll must be 0)`);
  if (typeof v.feature === 'string' && (TRACK_FEATURES as readonly string[]).includes(v.feature)) g.feature = v.feature as TrackFeature;
  if (v.depth !== undefined) g.depth = num(v.depth, `${w}.depth`);
  return g;
}

function obstacle(v: unknown, i: number): TrackObstacle {
  const w = `obstacles[${i}]`;
  if (!isObj(v)) throw new Error(`${w} must be an object`);
  if (typeof v.kind !== 'string' || !(v.kind in OBSTACLE_KINDS)) throw new Error(`${w}.kind ${JSON.stringify(v.kind)} is not an obstacle kind`);
  const size = vec3(v.size, `${w}.size`);
  if (!size.every((s) => s > 0)) throw new Error(`${w}.size must be positive`);
  return { kind: v.kind as ObstacleKind, pos: vec3(v.pos, `${w}.pos`), yaw: num(v.yaw, `${w}.yaw`, 0), size };
}

/** Length of a polyline (closed: including the edge back to the first point). */
export function polylineLength(path: readonly Vec3[], closed: boolean): number {
  let s = 0;
  for (let i = 1; i < path.length; i++) s += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1], path[i][2] - path[i - 1][2]);
  if (closed && path.length > 2) {
    const a = path[path.length - 1], b = path[0];
    s += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  }
  return s;
}

/** A TrackData from parsed JSON: checks and normalises every field (gate indices renumbered, laps 1 on an open run). */
export function parseTrackData(raw: unknown): TrackData {
  if (!isObj(raw)) throw new Error('track must be an object');
  if (!Array.isArray(raw.gates) || raw.gates.length === 0) throw new Error('track.gates must be a non-empty array');
  const gates = raw.gates.map(gate);
  const obstacles = list(raw.obstacles, 'track.obstacles').map(obstacle);
  const closed = raw.closed === true;
  const path = list(raw.path, 'track.path').map((p, i) => vec3(p, `path[${i}]`));
  if (!isObj(raw.start)) throw new Error('track.start must be { pos, yaw }');
  const start = { pos: vec3(raw.start.pos, 'start.pos'), yaw: num(raw.start.yaw, 'start.yaw') };
  const laps = closed ? Math.max(1, Math.min(99, Math.round(num(raw.laps, 'laps', 1)))) : 1;
  const style: TrackStyle = typeof raw.style === 'string' && raw.style in STYLES ? (raw.style as TrackStyle) : 'custom';
  const track: TrackData = {
    seed: Math.round(num(raw.seed, 'seed', 0)),
    style,
    gates,
    obstacles,
    path,
    closed,
    length: path.length > 1 ? polylineLength(path, closed) : 0,
    start,
    laps,
  };
  if (isObj(raw.recipe)) track.recipe = sanitizeRecipe(raw.recipe);
  return track;
}

/** A track file's JSON text: a TrackData, or a builder export `{ terrainSeed, quality, track, recipe? }`. */
export function parseTrackFile(text: string): TrackFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new Error(`not JSON: ${(e as Error).message}`);
  }
  if (!isObj(raw)) throw new Error('a track file holds a JSON object');
  if (!isObj(raw.track)) return { track: parseTrackData(raw) };
  const track = parseTrackData(raw.track);
  if (!track.recipe && isObj(raw.recipe)) track.recipe = sanitizeRecipe(raw.recipe);
  const out: TrackFile = { track };
  if (raw.terrainSeed !== undefined) out.terrainSeed = Math.round(num(raw.terrainSeed, 'terrainSeed'));
  if (raw.quality !== undefined) {
    if (typeof raw.quality !== 'string' || !(raw.quality in QUALITIES)) throw new Error(`quality ${JSON.stringify(raw.quality)} is not low, medium, high or ultra`);
    out.quality = raw.quality as TerrainQuality;
  }
  return out;
}
