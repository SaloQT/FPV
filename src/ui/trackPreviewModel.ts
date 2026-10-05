import type { GateKind, TrackData } from '../contracts';
import { describeTrack } from '../world/track/summary';
import { formatClock } from '../game/units';
import { estimateLapTime } from './lapEstimate';

/** What the world builder tells the start screen: a finished track, or how far the next one is. */
export interface PreviewState {
  status: 'idle' | 'working' | 'ready' | 'error';
  /** Name of the step being worked on ("Generating terrain", "Placing track"). */
  stage: string;
  /** 0..1 through the whole build. */
  progress: number;
  /** The track now in the world, or null before one exists. While `working` it is the previous one. */
  track: TrackData | null;
  /** Why the build failed (status `error`). */
  message: string;
}

export function idlePreview(track: TrackData | null): PreviewState {
  return { status: track === null ? 'idle' : 'ready', stage: '', progress: 0, track, message: '' };
}

export interface PreviewBox {
  width: number;
  height: number;
  /** Margin kept free around the course, px. */
  padding: number;
}

export interface PreviewGate {
  index: number;
  kind: GateKind;
  x: number;
  y: number;
  /** Unit direction of travel through the gate on screen (north is up). */
  dx: number;
  dy: number;
  /** Half the opening width on screen, px. */
  half: number;
  color: string;
}

export interface PreviewModel {
  /** Screen metres-to-pixels factor. */
  scale: number;
  /** Centreline as x, y pairs in px, about one point per `PATH_STEP_M`. */
  path: Float32Array;
  /** Height of each path point scaled to 0 (lowest) .. 1 (highest). */
  heights: Float32Array;
  gates: PreviewGate[];
  start: { x: number; y: number; dx: number; dy: number };
  closed: boolean;
}

export interface PreviewStats {
  gates: number;
  laps: number;
  /** Length of one lap (the whole course when it is point to point). */
  lapLengthM: number;
  elevationGainM: number;
  lapTimeS: number;
  /** Time for all laps of a closed course; equals `lapTimeS` otherwise. */
  totalTimeS: number;
}

/** Spacing of the drawn centreline: coarse enough to stay cheap, fine enough to look smooth at preview size. */
export const PATH_STEP_M = 6;
const MIN_HALF_PX = 3;

export const GATE_COLORS: Readonly<Record<GateKind, string>> = {
  start: '#62f58a',
  finish: '#ff5c5c',
  square: '#4db4ff',
  arch: '#ffb14d',
  hoop: '#c58bff',
  dive: '#ff7ab6',
  flag: '#ffe14d',
  window: '#7af0ff',
  ladder: '#a8ff5c',
  tunnel: '#ff9f40',
  hurdle: '#f0f0f0',
  drop: '#ff4df0',
};

export const GATE_KIND_LABELS: Readonly<Record<GateKind, string>> = {
  start: 'Start', finish: 'Finish', square: 'Square', arch: 'Arch', hoop: 'Hoop', dive: 'Dive', flag: 'Flag',
  window: 'Window', ladder: 'Ladder', tunnel: 'Tunnel', hurdle: 'Hurdle', drop: 'Drop',
};

/** Screen direction of a heading: yaw 0 faces north (up), positive yaw turns counter-clockwise (toward west, left). */
export function headingOnScreen(yaw: number): [number, number] {
  return [-Math.sin(yaw), -Math.cos(yaw)];
}

function bounds(track: TrackData): { x0: number; x1: number; z0: number; z1: number } {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  const take = (x: number, z: number): void => {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (z < z0) z0 = z;
    if (z > z1) z1 = z;
  };
  for (const p of track.path) take(p[0], p[2]);
  for (const g of track.gates) take(g.pos[0], g.pos[2]);
  take(track.start.pos[0], track.start.pos[2]);
  return { x0, x1, z0, z1 };
}

/** The course laid out in a box: uniform scale, centred, north up. An empty course fits as a point in the middle. */
export function buildPreview(track: TrackData, box: PreviewBox): PreviewModel {
  const { x0, x1, z0, z1 } = bounds(track);
  const w = Math.max(box.width - 2 * box.padding, 1);
  const h = Math.max(box.height - 2 * box.padding, 1);
  const scale = Math.min(w / Math.max(x1 - x0, 1), h / Math.max(z1 - z0, 1));
  const ox = box.width / 2 - ((x0 + x1) / 2) * scale;
  const oy = box.height / 2 - ((z0 + z1) / 2) * scale;
  const px = (x: number): number => ox + x * scale;
  const py = (z: number): number => oy + z * scale;

  const src = track.path;
  const keep: number[] = [];
  let acc = PATH_STEP_M;
  for (let i = 0; i < src.length; i++) {
    if (i > 0) acc += Math.hypot(src[i][0] - src[i - 1][0], src[i][2] - src[i - 1][2]);
    if (i === 0 || i === src.length - 1 || acc >= PATH_STEP_M) {
      keep.push(i);
      acc = 0;
    }
  }
  let yMin = Infinity, yMax = -Infinity;
  for (const i of keep) {
    if (src[i][1] < yMin) yMin = src[i][1];
    if (src[i][1] > yMax) yMax = src[i][1];
  }
  const span = Math.max(yMax - yMin, 1e-6);
  const path = new Float32Array(keep.length * 2);
  const heights = new Float32Array(keep.length);
  keep.forEach((i, k) => {
    path[2 * k] = px(src[i][0]);
    path[2 * k + 1] = py(src[i][2]);
    heights[k] = (src[i][1] - yMin) / span;
  });

  const gates = track.gates.map((g): PreviewGate => {
    const [dx, dy] = headingOnScreen(g.yaw);
    return {
      index: g.index, kind: g.kind, x: px(g.pos[0]), y: py(g.pos[2]), dx, dy,
      half: Math.max(MIN_HALF_PX, (g.width * scale) / 2), color: GATE_COLORS[g.kind],
    };
  });
  const [sx, sy] = headingOnScreen(track.start.yaw);
  return { scale, path, heights, gates, start: { x: px(track.start.pos[0]), y: py(track.start.pos[2]), dx: sx, dy: sy }, closed: track.closed };
}

/** Length, gates and a lap-time estimate for an ideal pilot (see `estimateLapTime`). */
export function previewStats(track: TrackData): PreviewStats {
  const d = describeTrack(track);
  const lapTimeS = estimateLapTime(track);
  const laps = track.closed ? track.laps : 1;
  return { gates: d.gates, laps, lapLengthM: d.lengthLapM, elevationGainM: d.elevationGainM, lapTimeS, totalTimeS: lapTimeS * laps };
}

export function formatLength(meters: number): string {
  if (!Number.isFinite(meters)) return '-';
  return meters >= 1000 ? `${(meters / 1000).toFixed(2)} km` : `${Math.round(meters)} m`;
}

/** The two lines under the map: "1.43 km, 12 gates, climb 34 m" and "est. lap 0:58, 3 laps 2:54". */
export function describePreview(s: PreviewStats): { course: string; time: string } {
  const course = [formatLength(s.lapLengthM), `${s.gates} gates`];
  if (s.elevationGainM >= 1) course.push(`climb ${Math.round(s.elevationGainM)} m`);
  const time = [`est. lap ${formatClock(s.lapTimeS)}`];
  if (s.laps > 1) time.push(`${s.laps} laps ${formatClock(s.totalTimeS)}`);
  return { course: course.join('  ·  '), time: time.join('  ·  ') };
}

/** A scale-bar length (1, 2 or 5 x 10^n metres) that is between 15% and 40% of the map width at `pxPerMeter`. */
export function niceScaleBar(pxPerMeter: number, mapWidthPx: number): { meters: number; px: number } {
  const target = (mapWidthPx * 0.25) / pxPerMeter;
  const pow = Math.pow(10, Math.floor(Math.log10(Math.max(target, 1e-9))));
  let best = pow;
  for (const m of [1, 2, 5, 10]) if (m * pow <= target) best = m * pow;
  return { meters: best, px: best * pxPerMeter };
}
