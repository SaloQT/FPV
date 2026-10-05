import { describe, expect, it } from 'vitest';
import { rankRacers, type RaceStanding } from './brains';

const r = (name: string, over: Partial<RaceStanding>): RaceStanding => ({ name, finished: false, finishTime: 0, progress: 0, toGate: 0, ...over });

describe('rankRacers', () => {
  it('puts finishers first by time, then the rest by gates cleared, then by distance to their next gate', () => {
    const order = rankRacers([
      r('slow finisher', { finished: true, finishTime: 70, progress: Infinity }),
      r('far behind', { progress: 3, toGate: 5 }),
      r('fast finisher', { finished: true, finishTime: 60, progress: Infinity }),
      r('close', { progress: 7, toGate: 2 }),
      r('closer', { progress: 7, toGate: 1 }),
    ]);
    expect(order).toEqual([2, 0, 4, 3, 1]);
  });
});
