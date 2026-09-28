import type { TrackData, Vec3 } from '../contracts';
import { fillGateFrame, gateCrossing, makeGateFrame, type GateFrame } from './gateCross';

export type GateEvent = 'none' | 'gate' | 'lap' | 'finish' | 'missed';

/** Race state for the HUD. `GateTimer.fill` rewrites it in place. Times are seconds, NaN means "none yet". */
export interface RaceSnapshot {
  /** The track has gates, so the race panel applies. */
  active: boolean;
  /** The timer is running (the first gate was crossed). */
  started: boolean;
  finished: boolean;
  gateCount: number;
  /** Index of the gate the pilot must pass next. */
  nextGate: number;
  /** Gates cleared in the current lap (all of them once finished). */
  gatesPassed: number;
  /** 1-based current lap. */
  lap: number;
  laps: number;
  lapTime: number;
  /** Time since the first gate; frozen when finished. */
  totalTime: number;
  lastLap: number;
  bestLap: number;
  /** Gap to the best lap at the last gate or lap end (negative = ahead); `splitAt` is when it was set. */
  splitDelta: number;
  splitAt: number;
  /** Gate that was skipped by flying through a later one, or -1; `missedAt` is when. */
  missedGate: number;
  missedAt: number;
  totalMissed: number;
  /** Completed lap times in order (owned by the timer; do not mutate). */
  lapTimes: readonly number[];
}

export function createRaceSnapshot(): RaceSnapshot {
  return {
    active: false, started: false, finished: false, gateCount: 0, nextGate: 0, gatesPassed: 0, lap: 1, laps: 1,
    lapTime: 0, totalTime: 0, lastLap: NaN, bestLap: NaN, splitDelta: NaN, splitAt: -Infinity,
    missedGate: -1, missedAt: -Infinity, totalMissed: 0, lapTimes: [],
  };
}

/** How many gates beyond the expected one are watched for a skipped-gate pass. */
const MISSED_LOOKAHEAD = 2;

/**
 * Times a race over `track.gates`. The clock starts when gate 0 is first crossed. On a closed track gate 0 is also the
 * line that ends each lap; on an open track a lap ends at the last gate. Passing a gate ahead of the expected one
 * flags a miss and the expected gate stays put, so the pilot must go back through it.
 */
export class GateTimer {
  /** Gate most recently cleared in order, or -1 before any; the respawn checkpoint. */
  lastGate = -1;
  readonly gateCount: number;
  private readonly gates: TrackData['gates'];
  private readonly frames: GateFrame[];
  private readonly laps: number;
  private readonly loop: boolean;
  private readonly endIndex: number;
  private readonly curSplits: Float64Array;
  private readonly bestSplits: Float64Array;
  private lapTimes: number[] = [];
  private next = 0;
  private started = false;
  private finished = false;
  private passed = 0;
  private lapsDone = 0;
  private lapStart = 0;
  private raceStart = 0;
  private finishTime = 0;
  private lastLap = NaN;
  private bestLap = NaN;
  private splitDelta = NaN;
  private splitAt = -Infinity;
  private missedGate = -1;
  private missedAt = -Infinity;
  private totalMissed = 0;

  constructor(track: TrackData | null) {
    this.gates = track?.gates ?? [];
    const n = this.gates.length;
    this.gateCount = n;
    this.frames = this.gates.map((g) => fillGateFrame(g, makeGateFrame()));
    this.laps = Math.max(1, Math.floor(track?.laps ?? 1));
    this.loop = (track?.closed ?? false) || n < 2;
    this.endIndex = this.loop ? 0 : n - 1;
    this.curSplits = new Float64Array(n);
    this.bestSplits = new Float64Array(n);
  }

  /** Index of the gate the pilot must clear next. */
  get nextGate(): number {
    return this.next;
  }

  get isFinished(): boolean {
    return this.finished;
  }

  get isStarted(): boolean {
    return this.started;
  }

  reset(): void {
    this.lastGate = -1;
    this.lapTimes = [];
    this.next = 0;
    this.started = false;
    this.finished = false;
    this.passed = 0;
    this.lapsDone = 0;
    this.lapStart = this.raceStart = this.finishTime = 0;
    this.lastLap = this.bestLap = this.splitDelta = NaN;
    this.splitAt = this.missedAt = -Infinity;
    this.missedGate = -1;
    this.totalMissed = 0;
    this.curSplits.fill(0);
    this.bestSplits.fill(0);
  }

  /** Feed one motion segment (positions and the sim times at its ends). */
  check(prev: Vec3, pos: Vec3, tPrev: number, tNow: number): GateEvent {
    const n = this.gateCount;
    if (n === 0 || this.finished) return 'none';
    const g = this.next;
    const f = gateCrossing(this.gates[g], this.frames[g], prev, pos);
    if (f >= 0) return this.pass(g, tPrev + f * (tNow - tPrev));
    if (!this.started) return 'none';
    for (let k = 1; k <= MISSED_LOOKAHEAD; k++) {
      const idx = this.loop ? (g + k) % n : g + k;
      if (idx >= n || idx === g) break;
      if (gateCrossing(this.gates[idx], this.frames[idx], prev, pos) >= 0) {
        this.missedGate = g;
        this.missedAt = tNow;
        this.totalMissed++;
        return 'missed';
      }
    }
    return 'none';
  }

  fill(out: RaceSnapshot, now: number): RaceSnapshot {
    out.active = this.gateCount > 0;
    out.started = this.started;
    out.finished = this.finished;
    out.gateCount = this.gateCount;
    out.nextGate = this.next;
    out.gatesPassed = this.passed;
    out.lap = Math.min(this.lapsDone + 1, this.laps);
    out.laps = this.laps;
    out.lapTime = this.finished ? this.lastLap : this.started ? now - this.lapStart : 0;
    out.totalTime = this.finished ? this.finishTime : this.started ? now - this.raceStart : 0;
    out.lastLap = this.lastLap;
    out.bestLap = this.bestLap;
    out.splitDelta = this.splitDelta;
    out.splitAt = this.splitAt;
    out.missedGate = this.missedGate;
    out.missedAt = this.missedAt;
    out.totalMissed = this.totalMissed;
    out.lapTimes = this.lapTimes;
    return out;
  }

  private pass(g: number, t: number): GateEvent {
    const n = this.gateCount;
    this.lastGate = g;
    this.missedGate = -1;
    if (!this.started) {
      this.started = true;
      this.raceStart = this.lapStart = t;
      this.passed = 1;
      this.next = this.loop ? 1 % n : 1;
      return 'gate';
    }
    if (this.loop && g === 0) return this.completeLap(t);
    const rel = t - this.lapStart;
    this.curSplits[g] = rel;
    if (!Number.isNaN(this.bestLap)) {
      this.splitDelta = rel - this.bestSplits[g];
      this.splitAt = t;
    }
    this.passed++;
    this.next = (g + 1) % n;
    return !this.loop && g === n - 1 ? this.completeLap(t) : 'gate';
  }

  private completeLap(t: number): GateEvent {
    const n = this.gateCount;
    const lapTime = t - this.lapStart;
    this.curSplits[this.endIndex] = lapTime;
    if (Number.isNaN(this.bestLap)) {
      this.bestLap = lapTime;
      this.bestSplits.set(this.curSplits);
    } else {
      this.splitDelta = lapTime - this.bestSplits[this.endIndex];
      this.splitAt = t;
      if (lapTime < this.bestLap) {
        this.bestLap = lapTime;
        this.bestSplits.set(this.curSplits);
      }
    }
    this.lapTimes.push(lapTime);
    this.lastLap = lapTime;
    this.lapsDone++;
    if (this.lapsDone >= this.laps) {
      this.finished = true;
      this.finishTime = t - this.raceStart;
      this.passed = n;
      return 'finish';
    }
    this.lapStart = t;
    this.passed = this.loop ? 1 : 0;
    this.next = this.loop ? 1 % n : 0;
    return 'lap';
  }
}
