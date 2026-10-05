import type { RaceSnapshot } from '../game/gateTimer';
import { formatSplit, formatTime } from '../game/units';
import { leaderRows, type LeaderEntry, type LeaderRow } from './leaderboard';

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

/** The leaderboard part of the result card: the track's board around the finish just flown. */
export interface FinishBoardView {
  title: string;
  /** "New track record!", "3rd of 12", ... (empty when nothing was recorded). */
  headline: string;
  rows: LeaderRow[];
  /** The track came from the track builder: the card offers the way back to it. */
  backToBuilder: boolean;
}

export function ordinal(n: number): string {
  const t = n % 100;
  const s = t >= 11 && t <= 13 ? 'th' : n % 10 === 1 ? 'st' : n % 10 === 2 ? 'nd' : n % 10 === 3 ? 'rd' : 'th';
  return `${n}${s}`;
}

/**
 * The top `limit` finishes of a board, plus the fresh one in its place when it ranked below them. `rank` is the fresh finish's
 * place from 1 (0: not kept, or nothing recorded).
 */
export function finishBoardView(title: string, entries: readonly LeaderEntry[], fresh: LeaderEntry | null, rank: number, backToBuilder: boolean, limit = 5): FinishBoardView {
  const all = leaderRows(entries, fresh);
  const rows = all.slice(0, limit);
  if (rank > limit && all[rank - 1] !== undefined) rows.push(all[rank - 1]);
  let headline = '';
  if (fresh !== null) {
    if (rank === 1) headline = entries.length > 1 ? 'New track record!' : 'First finish on this track';
    else if (rank > 1) headline = `${ordinal(rank)} of ${entries.length} on this track`;
    else headline = 'Not fast enough for the leaderboard';
  }
  return { title, headline, rows, backToBuilder };
}
