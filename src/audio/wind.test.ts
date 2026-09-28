import { describe, expect, it } from 'vitest';
import { asContext, FakeContext, FakeNode, FakeParam } from './fakeAudio';
import { airspeedFrom, ambientWindGain, windMicCutoff, windMicGain, WindSynth } from './wind';

describe('wind laws', () => {
  it('combines flight speed and wind and tolerates junk', () => {
    expect(airspeedFrom(3, 4)).toBe(5);
    expect(airspeedFrom(NaN, 4)).toBe(4);
    expect(airspeedFrom(10, Infinity)).toBe(10);
  });

  it('sweeps the mic cutoff from 250 Hz to 6 kHz with airspeed', () => {
    expect(windMicCutoff(0)).toBe(250);
    expect(windMicCutoff(10)).toBeCloseTo(950, 6);
    expect(windMicCutoff(200)).toBe(6000);
    let prev = 0;
    for (let v = 0; v <= 90; v += 5) {
      const c = windMicCutoff(v);
      expect(c).toBeGreaterThanOrEqual(prev);
      prev = c;
    }
  });

  it('mic wind gain follows about v^1.7 and saturates past the top speed', () => {
    expect(windMicGain(0)).toBe(0);
    const ratio = windMicGain(20) / windMicGain(10);
    expect(ratio).toBeCloseTo(2 ** 1.7, 6);
    expect(windMicGain(80)).toBe(windMicGain(50));
    expect(windMicGain(35)).toBeGreaterThan(0.05);
  });

  it('ambient wind is always faintly there, grows with wind and stays below the mic wind', () => {
    expect(ambientWindGain(0)).toBeGreaterThan(0);
    expect(ambientWindGain(10)).toBeGreaterThan(ambientWindGain(3));
    expect(ambientWindGain(100)).toBe(ambientWindGain(25));
    expect(ambientWindGain(10)).toBeLessThan(windMicGain(35) / 2);
  });
});

describe('WindSynth', () => {
  it('starts every source, exposes the two outputs and steers them through smoothed targets', () => {
    const ctx = new FakeContext();
    const w = new WindSynth(asContext(ctx));
    for (const n of [...ctx.of('bufferSource'), ...ctx.of('oscillator')]) expect(n.started).toBe(1);
    expect(ctx.of('bufferSource').every((n) => (n.loop as boolean) === true)).toBe(true);

    ctx.currentTime = 1;
    w.update(30, 6);
    const mic = w.mic as unknown as FakeNode;
    const gain = mic.param('gain');
    expect(gain.targets.at(-1)).toMatchObject({ value: windMicGain(30), time: 1 });
    expect(gain.targets.at(-1)!.tc).toBeGreaterThan(0.05);
    expect((w.ambient as unknown as FakeNode).param('gain').last).toBe(ambientWindGain(6));
    const lows = ctx.of('biquad').filter((n) => n.type === 'lowpass' && n.param('frequency').targets.length > 0);
    expect(lows).toHaveLength(1);
    expect(lows[0].param('frequency').last).toBe(windMicCutoff(30));
  });

  it('stops and disconnects on dispose', () => {
    const ctx = new FakeContext();
    const w = new WindSynth(asContext(ctx));
    w.dispose();
    for (const n of ctx.nodes) expect(n.connected).toBe(false);
    for (const n of [...ctx.of('bufferSource'), ...ctx.of('oscillator')]) expect(n.stopped).toBe(true);
    expect(new FakeParam(1).last).toBe(1);
  });
});
