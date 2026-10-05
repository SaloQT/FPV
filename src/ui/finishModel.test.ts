import { describe, expect, it } from 'vitest';
import { createRaceSnapshot, type RaceSnapshot } from '../game/gateTimer';
import { buildFinishView, finishBoardView, ordinal } from './finishModel';
import type { LeaderEntry } from './leaderboard';

function race(over: Partial<RaceSnapshot> = {}): RaceSnapshot {
  return { ...createRaceSnapshot(), active: true, started: true, finished: true, gateCount: 4, laps: 3, ...over };
}

describe('buildFinishView', () => {
  it('lists every lap against the best one', () => {
    const v = buildFinishView(race({ totalTime: 125.5, bestLap: 40.1, lapTimes: [42, 43.4, 40.1], totalMissed: 0 }));
    expect(v.total).toBe('2:05.500');
    expect(v.best).toBe('0:40.100');
    expect(v.bestLabel).toBe('Best (lap 3)');
    expect(v.rows).toEqual([
      { label: 'Lap 1', time: '0:42.000', delta: '+1.900', best: false },
      { label: 'Lap 2', time: '0:43.400', delta: '+3.300', best: false },
      { label: 'Lap 3', time: '0:40.100', delta: '', best: true },
    ]);
    expect(v.missed).toBe('0');
  });

  it('calls a single point-to-point lap a run and does not mark it best against itself', () => {
    const v = buildFinishView(race({ laps: 1, totalTime: 31.25, bestLap: 31.25, lapTimes: [31.25] }));
    expect(v.rows).toEqual([{ label: 'Run', time: '0:31.250', delta: '', best: false }]);
    expect(v.bestLabel).toBe('Best');
  });

  it('turns the best lap into per-gate segment times with bars scaled to the longest', () => {
    const v = buildFinishView(race({
      lapTimes: [20], bestLap: 20,
      bestSplits: [{ gate: 1, time: 4 }, { gate: 2, time: 12 }, { gate: 3, time: 16 }, { gate: 0, time: 20 }],
    }));
    expect(v.splits.map((s) => s.label)).toEqual(['G2', 'G3', 'G4', 'Finish']);
    expect(v.splits.map((s) => s.segment)).toEqual(['4.00 s', '8.00 s', '4.00 s', '4.00 s']);
    expect(v.splits.map((s) => s.cumulative)).toEqual(['0:04.000', '0:12.000', '0:16.000', '0:20.000']);
    expect(v.splits.map((s) => s.ratio)).toEqual([0.5, 1, 0.5, 0.5]);
    expect(v.splits.map((s) => s.slowest)).toEqual([false, true, false, false]);
  });

  it('has no splits before a lap is complete and survives an empty lap list', () => {
    const v = buildFinishView(race({ lapTimes: [], bestLap: NaN, totalTime: 0 }));
    expect(v.splits).toEqual([]);
    expect(v.rows).toEqual([]);
    expect(v.best).toBe('-:--.---');
  });
});

describe('finishBoardView', () => {
  const e = (total: number, pilot = 'Bot'): LeaderEntry => ({ pilot, kind: pilot === 'You' ? 'you' : 'brain', total, bestLap: total / 3, laps: 3, missed: 0, date: 0 });

  it('says ordinals the English way', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111, 112].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '101st', '111th', '112th']);
  });

  it('heads a first finish, a record and a placing', () => {
    const first = e(50, 'You');
    expect(finishBoardView('T', [first], first, 1, false).headline).toBe('First finish on this track');
    const rec = e(40, 'You');
    expect(finishBoardView('T', [rec, e(50)], rec, 1, false).headline).toBe('New track record!');
    const third = e(60, 'You');
    expect(finishBoardView('T', [e(40), e(50), third], third, 3, true)).toMatchObject({ headline: '3rd of 3 on this track', backToBuilder: true });
    expect(finishBoardView('T', [e(40)], e(99, 'You'), 0, false).headline).toBe('Not fast enough for the leaderboard');
    expect(finishBoardView('T', [e(40)], null, 0, false).headline).toBe('');
  });

  it('shows the top rows, plus the fresh finish in its place below them', () => {
    const entries = Array.from({ length: 9 }, (_, i) => e(40 + i, `B${i}`));
    const fresh = e(47.5, 'You');
    entries.splice(8, 0, fresh);
    const v = finishBoardView('Canyon', entries, fresh, 9, false, 5);
    expect(v.title).toBe('Canyon');
    expect(v.rows.map((r) => r.rank)).toEqual([1, 2, 3, 4, 5, 9]);
    expect(v.rows.at(-1)?.fresh).toBe(true);
    expect(finishBoardView('Canyon', entries, entries[2], 3, false, 5).rows).toHaveLength(5);
  });
});
