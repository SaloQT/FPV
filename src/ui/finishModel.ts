import type { RaceSnapshot } from '../game/gateTimer';
import { formatSplit, formatTime } from '../game/units';

export interface FinishRow {
  label: string;
  time: string;
  /** Gap to the best lap ("+1.900"); empty on the best lap itself. */
  delta: string;
  best: boolean;
}

export interface FinishSplit {
  label: string;
  /** Time since the previous gate. */
  segment: string;
  /** Time since the lap began. */
  cumulative: string;
  /** Segment length relative to the longest one, 0..1: the bar height. */
  ratio: number;
  slowest: boolean;
}

export interface FinishView {
  total: string;
  best: string;
  bestLabel: string;
  missed: string;
  rows: FinishRow[];
  splits: FinishSplit[];
}

function seconds(s: number): string {
  return `${s.toFixed(2)} s`;
}

/** Everything the result panel shows, as text: laps against the best lap, and the best lap's gates one by one. */
export function buildFinishView(r: RaceSnapshot): FinishView {
  const single = r.laps <= 1;
  const times = r.lapTimes;
  const best = Number.isFinite(r.bestLap) ? r.bestLap : Math.min(...times);
  const bestIndex = times.findIndex((t) => t === best);
  const rows = times.map((t, i): FinishRow => ({
    label: single ? 'Run' : `Lap ${i + 1}`,
    time: formatTime(t),
    delta: i === bestIndex || times.length < 2 ? '' : formatSplit(t - best),
    best: i === bestIndex && times.length > 1,
  }));
  const marks = r.bestSplits;
  let longest = 0;
  const segments = marks.map((m, i) => {
    const seg = m.time - (i === 0 ? 0 : marks[i - 1].time);
    if (seg > longest) longest = seg;
    return seg;
  });
  const splits = marks.map((m, i): FinishSplit => ({
    label: i === marks.length - 1 ? 'Finish' : `G${m.gate + 1}`,
    segment: seconds(segments[i]),
    cumulative: formatTime(m.time),
    ratio: longest > 0 ? Math.max(segments[i], 0) / longest : 0,
    slowest: marks.length > 2 && segments[i] === longest,
  }));
  return {
    total: formatTime(r.totalTime),
    best: formatTime(best),
    bestLabel: single || bestIndex < 0 ? 'Best' : `Best (lap ${bestIndex + 1})`,
    missed: String(r.totalMissed),
    rows,
    splits,
  };
}
