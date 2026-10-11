import { describe, expect, it } from 'vitest';
import { MAX_RACERS, parseRaceParam, raceParam, raceSize, raceSlots, rankRacers, type RaceStanding } from './brains';

describe('race entries', () => {
  it('reads a race of single quads, counts, and a brain named twice', () => {
    expect(parseRaceParam('ace,dash,steady')).toEqual([{ name: 'ace', count: 1 }, { name: 'dash', count: 1 }, { name: 'steady', count: 1 }]);
    expect(parseRaceParam('ultimate*15, g*10 ,x*5')).toEqual([{ name: 'ultimate', count: 15 }, { name: 'g', count: 10 }, { name: 'x', count: 5 }]);
    expect(parseRaceParam('ace*2,dash,ace')).toEqual([{ name: 'ace', count: 3 }, { name: 'dash', count: 1 }]);
    expect(parseRaceParam('ace*0,,*3,run-20261007T112453-djfw*2')).toEqual([{ name: 'run-20261007T112453-djfw', count: 2 }]);
    expect(raceParam(parseRaceParam('ultimate*15,g,x*5'))).toBe('ultimate*15,g,x*5');
  });

  it('lays out the quads brain by brain, labels copies, and stops at the race size', () => {
    const slots = raceSlots([{ name: 'ultimate', count: 3 }, { name: 'g', count: 1 }]);
    expect(slots.map((s) => s.label)).toEqual(['ultimate #1', 'ultimate #2', 'ultimate #3', 'g']);
    expect(slots.map((s) => s.group)).toEqual([0, 0, 0, 1]);
    const big = [{ name: 'ultimate', count: 15 }, { name: 'g', count: 10 }, { name: 'x', count: 10 }];
    expect(raceSize(big)).toBe(35);
    const cut = raceSlots(big);
    expect(cut).toHaveLength(MAX_RACERS);
    expect(cut.filter((s) => s.group === 2)).toHaveLength(MAX_RACERS - 25);
    expect(raceSlots([{ name: 'a', count: 1e9 }])).toHaveLength(MAX_RACERS);
  });
});

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
