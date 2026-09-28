import type { FlightMode, QuadState } from '../contracts';
import type { CameraMode } from '../game/cameraRig';
import type { SessionSnapshot } from '../game/sessionTypes';
import { DEG, formatClock, formatSplit, formatTime, formatTimeCentis, toKmh } from '../game/units';
import {
  cameraPitchRoll, CRITICAL_CELL_V, estimateCells, formatMixed, formatVolts, LOW_CELL_V, mixedKey, quatPitchRoll, type Attitude,
} from './hudFormat';

/** The slice of the app settings the HUD reads. */
export interface HudSettings {
  mode: FlightMode;
  showOsd: boolean;
  osdScale: number;
  fov: number;
  cameraTiltDeg: number;
  autoRespawn: boolean;
}

/** Seconds a split time and a missed-gate notice stay on screen after they happen. */
export const SPLIT_SHOW_S = 4;
export const MISSED_SHOW_S = 3;
/** Batteries read as fresh below this many mAh used; the pack size is (re)detected until then. */
const FRESH_MAH = 20;

/** Slots in `HudModel.keys`, the last quantised value each cached text was built from. */
const K = { Cell: 0, Pack: 1, Mah: 2, Timer: 3, Current: 4, Throttle: 5, Speed: 6, Alt: 7, Gate: 8, Lap: 9, LapTime: 10, Best: 11, Split: 12, Missed: 13, Finish: 14, Count: 15 } as const;

export interface HudRace {
  active: boolean;
  gateText: string;
  lapText: string;
  lapTimeText: string;
  bestText: string;
  splitText: string;
  splitVisible: boolean;
  splitAhead: boolean;
  missedText: string;
  missedVisible: boolean;
}

export interface HudFinish {
  visible: boolean;
  totalText: string;
  bestText: string;
  lapTexts: string[];
}

/** Everything the OSD draws, as ready-made strings and flags. `buildHud` rewrites it in place every frame. */
export interface HudModel {
  visible: boolean;
  osdScale: number;
  /** The camera is the FPV one, so the crosshair and horizon apply. */
  fpv: boolean;
  /** Pack size, guessed from the voltage while the battery is fresh (0 until the first frame). */
  cells: number;
  cellVolts: number;
  cellText: string;
  packText: string;
  mahText: string;
  lowBattery: boolean;
  criticalBattery: boolean;
  timerText: string;
  armed: boolean;
  modeText: string;
  currentText: string;
  throttleText: string;
  speedText: string;
  altText: string;
  /** Altitude is above the ground below (true) or absolute (false). */
  altAgl: boolean;
  /** Body pitch (nose up positive) and roll (right wing down positive), radians. */
  attitude: Attitude;
  /** The FPV camera's elevation above the horizon (pitch) and its roll about the look axis, radians: what the horizon needs. */
  camera: Attitude;
  fovY: number;
  crash: boolean;
  paused: boolean;
  throttleHigh: boolean;
  turtle: boolean;
  respawn: boolean;
  message: string;
  race: HudRace;
  finish: HudFinish;
  /** Cache bookkeeping owned by `buildHud`. */
  keys: Float64Array;
}

export function createHudModel(): HudModel {
  const keys = new Float64Array(K.Count);
  keys.fill(NaN);
  return {
    visible: false, osdScale: 1, fpv: true, cells: 0, cellVolts: 0, cellText: '', packText: '', mahText: '', lowBattery: false,
    criticalBattery: false, timerText: '0:00', armed: false, modeText: '', currentText: '', throttleText: '', speedText: '',
    altText: '', altAgl: false, attitude: { pitch: 0, roll: 0 }, camera: { pitch: 0, roll: 0 }, fovY: 1.7, crash: false, paused: false,
    throttleHigh: false, turtle: false, respawn: false, message: '',
    race: {
      active: false, gateText: '', lapText: '', lapTimeText: '', bestText: '', splitText: '', splitVisible: false, splitAhead: false,
      missedText: '', missedVisible: false,
    },
    finish: { visible: false, totalText: '', bestText: '', lapTexts: [] },
    keys,
  };
}

const MODE_TEXT: Record<FlightMode, string> = { acro: 'ACRO', angle: 'ANGLE', horizon: 'HORIZON' };

function sameKey(keys: Float64Array, slot: number, value: number): boolean {
  if (keys[slot] === value) return true;
  keys[slot] = value;
  return false;
}

function keyOf(seconds: number, perSecond: number): number {
  return Number.isFinite(seconds) && seconds >= 0 ? Math.round(seconds * perSecond) : -1;
}

/**
 * Turns the physics state, the session snapshot and the settings into the OSD's model without allocating: text is only
 * rebuilt when the quantised value it shows changes. `groundHeight` is the terrain height under the quad (NaN if unknown,
 * then the altitude is absolute). `state` should be the interpolated render state so the horizon moves smoothly.
 */
export function buildHud(
  state: QuadState, snap: SessionSnapshot, settings: HudSettings, groundHeight: number, out: HudModel, cameraMode: CameraMode = 'fpv',
): HudModel {
  const k = out.keys;
  out.visible = settings.showOsd && snap.state !== 'menu';
  out.osdScale = settings.osdScale;
  out.fpv = cameraMode === 'fpv';
  fillBattery(state, out, k);
  if (!sameKey(k, K.Timer, Math.floor(snap.flightTime))) out.timerText = formatClock(snap.flightTime);
  out.armed = state.armed;
  out.modeText = MODE_TEXT[settings.mode];
  fillMotion(state, snap, groundHeight, out, k);
  quatPitchRoll(state.quat, out.attitude);
  out.fovY = settings.fov * DEG;
  cameraPitchRoll(state.quat, settings.cameraTiltDeg * DEG, out.camera);
  out.crash = snap.state === 'crashed' || state.crashed;
  out.paused = snap.state === 'paused';
  out.throttleHigh = snap.throttleHigh;
  out.turtle = snap.turtle;
  out.respawn = snap.respawnOffered && !settings.autoRespawn;
  out.message = snap.message;
  fillRace(snap, out, k);
  return out;
}

function fillBattery(state: QuadState, out: HudModel, k: Float64Array): void {
  const pack = state.batteryVoltage;
  if (out.cells < 1 || state.batteryMah < FRESH_MAH) out.cells = estimateCells(pack);
  const cell = pack / out.cells;
  out.cellVolts = cell;
  const cq = Math.round((Number.isFinite(cell) ? cell : 0) * 100);
  if (!sameKey(k, K.Cell, cq)) out.cellText = formatVolts(cq);
  const pq = Math.round((Number.isFinite(pack) ? pack : 0) * 10);
  if (!sameKey(k, K.Pack, pq)) out.packText = `${(pq / 10).toFixed(1)}V`;
  const mq = Math.max(0, Math.round(Number.isFinite(state.batteryMah) ? state.batteryMah : 0));
  if (!sameKey(k, K.Mah, mq)) out.mahText = `${mq}mAh`;
  out.criticalBattery = pack > 0.5 && cell < CRITICAL_CELL_V;
  out.lowBattery = pack > 0.5 && cell < LOW_CELL_V;
}

function fillMotion(state: QuadState, snap: SessionSnapshot, groundHeight: number, out: HudModel, k: Float64Array): void {
  const v = state.vel;
  const speed = toKmh(Math.hypot(v[0], v[1], v[2]));
  const sq = Number.isFinite(speed) ? Math.round(speed) : 0;
  if (!sameKey(k, K.Speed, sq)) out.speedText = `${sq}km/h`;
  const cq = mixedKey(state.batteryCurrent);
  if (!sameKey(k, K.Current, cq)) out.currentText = `${formatMixed(cq)}A`;
  const tq = Math.round(Math.min(Math.max(snap.throttle, 0), 1) * 100);
  if (!sameKey(k, K.Throttle, tq)) out.throttleText = `${tq}%`;
  out.altAgl = Number.isFinite(groundHeight);
  const aq = mixedKey(out.altAgl ? state.pos[1] - groundHeight : state.pos[1]);
  if (!sameKey(k, K.Alt, aq)) out.altText = `${formatMixed(aq)}m`;
}

function fillRace(snap: SessionSnapshot, out: HudModel, k: Float64Array): void {
  const r = snap.race;
  const o = out.race;
  o.active = r.active;
  const f = out.finish;
  f.visible = r.active && r.finished;
  if (!r.active) return;
  const gate = Math.min(r.nextGate + 1, r.gateCount);
  if (!sameKey(k, K.Gate, gate * 1000 + r.gateCount)) o.gateText = `GATE ${gate}/${r.gateCount}`;
  if (!sameKey(k, K.Lap, r.lap * 1000 + r.laps)) o.lapText = `LAP ${r.lap}/${r.laps}`;
  if (!sameKey(k, K.LapTime, keyOf(r.started ? r.lapTime : NaN, 100))) o.lapTimeText = r.started ? formatTimeCentis(r.lapTime) : formatTimeCentis(NaN);
  if (!sameKey(k, K.Best, keyOf(r.bestLap, 1000))) o.bestText = formatTime(r.bestLap);
  o.splitVisible = Number.isFinite(r.splitDelta) && snap.simTime - r.splitAt < SPLIT_SHOW_S;
  o.splitAhead = r.splitDelta < 0;
  if (o.splitVisible && !sameKey(k, K.Split, Math.round(r.splitDelta * 1000))) o.splitText = formatSplit(r.splitDelta);
  o.missedVisible = r.missedGate >= 0 && snap.simTime - r.missedAt < MISSED_SHOW_S;
  if (o.missedVisible && !sameKey(k, K.Missed, r.missedGate)) o.missedText = `MISSED GATE ${r.missedGate + 1}`;
  if (f.visible && !sameKey(k, K.Finish, Math.round(r.totalTime * 1000) * 64 + r.lapTimes.length)) fillFinish(snap, f);
}

function fillFinish(snap: SessionSnapshot, f: HudFinish): void {
  const r = snap.race;
  f.totalText = formatTime(r.totalTime);
  f.bestText = formatTime(r.bestLap);
  f.lapTexts.length = r.lapTimes.length;
  for (let i = 0; i < r.lapTimes.length; i++) f.lapTexts[i] = `LAP ${i + 1}  ${formatTime(r.lapTimes[i])}`;
}
