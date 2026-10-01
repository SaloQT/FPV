import { describe, expect, it } from 'vitest';
import type { TrackData } from '../contracts';
import { createRaceSnapshot, GateTimer, type GateEvent } from './gateTimer';
import { makeTrack } from './testKit';

/** Flies through gate `i` (straight along -Z) so that the plane crossing happens exactly at sim time `t`. */
function pass(timer: GateTimer, track: TrackData, i: number, t: number): GateEvent {
  const z = track.gates[i].pos[2];
  return timer.check([0, 2, z + 1], [0, 2, z - 1], t - 0.05, t + 0.05);
}

/** Flies straight past gate `i` at sideways offset x (outside the opening). */
function bypass(timer: GateTimer, track: TrackData, i: number, t: number): GateEvent {
  const z = track.gates[i].pos[2];
  return timer.check([9, 2, z + 1], [9, 2, z - 1], t - 0.05, t + 0.05);
}

describe('GateTimer, open track', () => {
  it('starts on gate 0 and finishes on the last gate, in order', () => {
    const track = makeTrack(4);
    const timer = new GateTimer(track);
    const snap = createRaceSnapshot();
    expect(timer.fill(snap, 0)).toMatchObject({ active: true, started: false, nextGate: 0, gatesPassed: 0, lapTime: 0 });
    expect(pass(timer, track, 0, 1)).toBe('gate');
    expect(timer.fill(snap, 2)).toMatchObject({ started: true, nextGate: 1, gatesPassed: 1, lapTime: 1 });
    expect(pass(timer, track, 1, 3)).toBe('gate');
    expect(pass(timer, track, 2, 5)).toBe('gate');
    expect(timer.lastGate).toBe(2);
    expect(pass(timer, track, 3, 8)).toBe('finish');
    expect(timer.fill(snap, 20)).toMatchObject({ finished: true, gatesPassed: 4, lapTime: 7, totalTime: 7, bestLap: 7, lastLap: 7 });
    expect(snap.lapTimes).toEqual([7]);
  });

  it('records the crossing time between the two segment ends', () => {
    const track = makeTrack(2);
    const timer = new GateTimer(track);
    const snap = createRaceSnapshot();
    pass(timer, track, 0, 10);
    pass(timer, track, 1, 12.5);
    expect(timer.fill(snap, 99).lapTime).toBeCloseTo(2.5, 9);
  });

  it('ignores a gate passed the wrong way or outside the opening', () => {
    const track = makeTrack(3);
    const timer = new GateTimer(track);
    expect(bypass(timer, track, 0, 1)).toBe('none');
    expect(timer.check([0, 2, -11], [0, 2, -9], 0, 0.1)).toBe('none');
    expect(timer.isStarted).toBe(false);
  });

  it('flags a missed gate when a later one is passed, and keeps waiting for the missed one', () => {
    const track = makeTrack(5);
    const timer = new GateTimer(track);
    const snap = createRaceSnapshot();
    pass(timer, track, 0, 1);
    expect(bypass(timer, track, 1, 2)).toBe('none');
    expect(pass(timer, track, 2, 3)).toBe('missed');
    expect(timer.fill(snap, 3)).toMatchObject({ nextGate: 1, missedGate: 1, totalMissed: 1, gatesPassed: 1 });
    expect(snap.missedAt).toBeCloseTo(3.05, 9);
    expect(pass(timer, track, 1, 6)).toBe('gate');
    expect(timer.fill(snap, 6)).toMatchObject({ nextGate: 2, missedGate: -1, totalMissed: 1 });
  });

  it('does not treat a pass before the start as a miss', () => {
    const track = makeTrack(4);
    const timer = new GateTimer(track);
    expect(pass(timer, track, 1, 1)).toBe('none');
    expect(timer.fill(createRaceSnapshot(), 1).totalMissed).toBe(0);
  });

  it('a gate far beyond the lookahead is not a miss', () => {
    const track = makeTrack(8);
    const timer = new GateTimer(track);
    pass(timer, track, 0, 1);
    expect(pass(timer, track, 5, 2)).toBe('none');
  });

  it('is inert without a track and after a reset', () => {
    const none = new GateTimer(null);
    expect(none.check([0, 0, 1], [0, 0, -1], 0, 1)).toBe('none');
    expect(none.fill(createRaceSnapshot(), 5).active).toBe(false);
    const track = makeTrack(3);
    const timer = new GateTimer(track);
    pass(timer, track, 0, 1);
    pass(timer, track, 1, 2);
    timer.reset();
    expect(timer.fill(createRaceSnapshot(), 9)).toMatchObject({ started: false, nextGate: 0, gatesPassed: 0, lapTime: 0 });
    expect(timer.lastGate).toBe(-1);
  });
});

describe('GateTimer, closed track', () => {
  const track = makeTrack(4, { closed: true, laps: 3 });

  function lap(timer: GateTimer, t0: number, splits: [number, number, number, number]): GateEvent {
    pass(timer, track, 1, t0 + splits[0]);
    pass(timer, track, 2, t0 + splits[1]);
    pass(timer, track, 3, t0 + splits[2]);
    return pass(timer, track, 0, t0 + splits[3]);
  }

  it('gate 0 starts the race and closes every lap', () => {
    const timer = new GateTimer(track);
    const snap = createRaceSnapshot();
    expect(pass(timer, track, 0, 0)).toBe('gate');
    expect(lap(timer, 0, [5, 10, 15, 20])).toBe('lap');
    expect(timer.fill(snap, 21)).toMatchObject({ lap: 2, laps: 3, gatesPassed: 1, nextGate: 1, lastLap: 20, bestLap: 20, lapTime: 1 });
    expect(lap(timer, 20, [4, 8, 12, 17])).toBe('lap');
    expect(lap(timer, 37, [6, 12, 18, 24])).toBe('finish');
    expect(timer.fill(snap, 99)).toMatchObject({ finished: true, lap: 3, bestLap: 17, lastLap: 24, totalTime: 61, gatesPassed: 4 });
    expect(snap.lapTimes).toEqual([20, 17, 24]);
  });

  it('keeps the best lap when a slower one follows', () => {
    const timer = new GateTimer(track);
    const snap = createRaceSnapshot();
    pass(timer, track, 0, 0);
    lap(timer, 0, [5, 10, 15, 18]);
    lap(timer, 18, [7, 14, 21, 30]);
    expect(timer.fill(snap, 60).bestLap).toBe(18);
    expect(snap.lastLap).toBe(30);
  });

  it('reports the split delta against the best lap at each gate', () => {
    const timer = new GateTimer(track);
    const snap = createRaceSnapshot();
    pass(timer, track, 0, 0);
    expect(timer.fill(snap, 1).splitDelta).toBeNaN();
    pass(timer, track, 1, 5);
    expect(timer.fill(snap, 5).splitDelta).toBeNaN();
    pass(timer, track, 2, 10);
    pass(timer, track, 3, 15);
    pass(timer, track, 0, 20);
    pass(timer, track, 1, 24);
    expect(timer.fill(snap, 24).splitDelta).toBeCloseTo(-1, 9);
    pass(timer, track, 2, 31);
    expect(timer.fill(snap, 31).splitDelta).toBeCloseTo(+1, 9);
    expect(snap.splitAt).toBeCloseTo(31, 9);
  });

  it('missing the last gate before the line is a miss, not a lap', () => {
    const timer = new GateTimer(track);
    const snap = createRaceSnapshot();
    pass(timer, track, 0, 0);
    pass(timer, track, 1, 5);
    pass(timer, track, 2, 10);
    expect(pass(timer, track, 0, 14)).toBe('missed');
    expect(timer.fill(snap, 14)).toMatchObject({ nextGate: 3, lap: 1, missedGate: 3 });
    pass(timer, track, 3, 16);
    expect(pass(timer, track, 0, 19)).toBe('lap');
  });

  it('a single-gate closed track needs two passes for a lap', () => {
    const single = makeTrack(1, { closed: true, laps: 1 });
    const timer = new GateTimer(single);
    expect(pass(timer, single, 0, 1)).toBe('gate');
    expect(pass(timer, single, 0, 9)).toBe('finish');
    expect(timer.fill(createRaceSnapshot(), 9).lastLap).toBe(8);
  });
});

describe('GateTimer, multi-lap open track', () => {
  it('starts the next lap right after the last gate', () => {
    const track = makeTrack(3, { laps: 2 });
    const timer = new GateTimer(track);
    const snap = createRaceSnapshot();
    pass(timer, track, 0, 0);
    pass(timer, track, 1, 2);
    expect(pass(timer, track, 2, 4)).toBe('lap');
    expect(timer.fill(snap, 5)).toMatchObject({ lap: 2, nextGate: 0, gatesPassed: 0, lapTime: 1 });
    pass(timer, track, 0, 5);
    pass(timer, track, 1, 7);
    expect(pass(timer, track, 2, 8)).toBe('finish');
    expect(timer.fill(snap, 9)).toMatchObject({ finished: true, bestLap: 4, lastLap: 4 });
  });
});

describe('GateTimer best-lap splits', () => {
  it('lists the best circuit lap gate by gate with the start line last, and follows a faster lap', () => {
    const track = makeTrack(4, { closed: true, laps: 3 });
    const timer = new GateTimer(track);
    const snap = createRaceSnapshot();
    const lap = (t0: number, a: number, b: number, c: number, d: number): void => {
      pass(timer, track, 1, t0 + a);
      pass(timer, track, 2, t0 + b);
      pass(timer, track, 3, t0 + c);
      pass(timer, track, 0, t0 + d);
    };
    pass(timer, track, 0, 0);
    expect(timer.fill(snap, 1).bestSplits).toEqual([]);
    lap(0, 5, 10, 15, 20);
    expect(timer.fill(snap, 21).bestSplits).toEqual([{ gate: 1, time: 5 }, { gate: 2, time: 10 }, { gate: 3, time: 15 }, { gate: 0, time: 20 }]);
    lap(20, 7, 14, 21, 28);
    expect(timer.fill(snap, 49).bestSplits.map((m) => m.time)).toEqual([5, 10, 15, 20]);
    lap(48, 4, 9, 12, 16);
    expect(timer.fill(snap, 65).bestSplits).toEqual([{ gate: 1, time: 4 }, { gate: 2, time: 9 }, { gate: 3, time: 12 }, { gate: 0, time: 16 }]);
  });

  it('on a point-to-point track the marks run from the second gate to the finish and a reset clears them', () => {
    const track = makeTrack(4);
    const timer = new GateTimer(track);
    const snap = createRaceSnapshot();
    pass(timer, track, 0, 0);
    pass(timer, track, 1, 2);
    pass(timer, track, 2, 5);
    pass(timer, track, 3, 9);
    expect(timer.fill(snap, 10).bestSplits).toEqual([{ gate: 1, time: 2 }, { gate: 2, time: 5 }, { gate: 3, time: 9 }]);
    timer.reset();
    expect(timer.fill(snap, 0).bestSplits).toEqual([]);
  });
});
