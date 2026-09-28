import { describe, expect, it } from 'vitest';
import { Beeper, PIEZO_HZ, SEQUENCES, sequenceDuration, type SequenceName } from './beeper';
import { asContext, FakeContext, FakeNode } from './fakeAudio';

const setup = () => {
  const ctx = new FakeContext();
  const quad = ctx.createGain() as unknown as FakeNode;
  const ui = ctx.createGain() as unknown as FakeNode;
  const beeper = new Beeper();
  beeper.attach(asContext(ctx), quad as unknown as AudioNode, ui as unknown as AudioNode);
  const oscs = () => ctx.of('oscillator');
  return { ctx, quad, ui, beeper, oscs };
};

const startTimes = (nodes: FakeNode[]) => nodes.map((n) => n.startArgs[0] as number);

describe('sequence data', () => {
  const names = Object.keys(SEQUENCES) as SequenceName[];

  it('every tone is audible, ordered and inside the human hearing range', () => {
    for (const name of names) {
      const { tones } = SEQUENCES[name];
      expect(tones.length).toBeGreaterThan(0);
      let prevAt = -1;
      for (const t of tones) {
        expect(t.at).toBeGreaterThanOrEqual(prevAt);
        prevAt = t.at;
        expect(t.dur).toBeGreaterThan(0.05);
        expect(t.freq).toBeGreaterThan(300);
        expect(t.freq).toBeLessThan(8000);
        expect(t.gain).toBeGreaterThan(0);
        expect(t.gain).toBeLessThanOrEqual(1);
      }
      expect(sequenceDuration(tones)).toBeLessThan(2);
    }
  });

  it('flight-controller beeps are 2.5 kHz-class piezo tones on the airframe bus', () => {
    for (const name of ['arm', 'disarm', 'lowBattery', 'beacon'] as const) {
      const s = SEQUENCES[name];
      expect(s.bus).toBe('quad');
      for (const t of s.tones) {
        expect(t.kind).toBe('piezo');
        expect(Math.abs(t.freq / PIEZO_HZ - 1)).toBeLessThanOrEqual(0.2);
      }
    }
    expect(SEQUENCES.arm.tones).toHaveLength(3);
    expect(SEQUENCES.lowBattery.tones).toHaveLength(2);
    expect(SEQUENCES.disarm.tones[1].freq).toBeLessThan(SEQUENCES.disarm.tones[0].freq);
    expect(SEQUENCES.beacon.tones).toHaveLength(3);
  });

  it('race tones are UI-bus sounds: a rising two-tone ding, a chime arpeggio, a short and a long countdown beep', () => {
    const [a, b] = SEQUENCES.gatePass.tones;
    expect(SEQUENCES.gatePass.bus).toBe('ui');
    expect(b.freq).toBeGreaterThan(a.freq);
    const lap = SEQUENCES.lap.tones.map((t) => t.freq);
    expect(lap).toEqual([...lap].sort((x, y) => x - y));
    expect(SEQUENCES.countdown.tones[0].dur).toBeLessThan(0.25);
    expect(SEQUENCES.countdownGo.tones[0].dur).toBeGreaterThanOrEqual(0.5);
    expect(SEQUENCES.finished.bus).toBe('ui');
  });
});

describe('Beeper', () => {
  it('does nothing until attached and after detaching', () => {
    const ctx = new FakeContext();
    const b = new Beeper();
    b.arm();
    b.gatePass();
    expect(ctx.nodes).toHaveLength(0);
    const s = setup();
    s.beeper.dispose();
    const before = s.ctx.nodes.length;
    s.beeper.arm();
    expect(s.ctx.nodes.length).toBe(before);
  });

  it('arm plays three square 2.5 kHz beeps scheduled on the clock through the piezo band-pass into the airframe bus', () => {
    const { ctx, quad, beeper, oscs } = setup();
    ctx.currentTime = 2;
    beeper.arm();
    const list = oscs();
    expect(list).toHaveLength(3);
    for (const o of list) {
      expect(o.type).toBe('square');
      expect((o.frequency as { value: number }).value).toBe(PIEZO_HZ);
    }
    const times = startTimes(list);
    expect(times[0]).toBeCloseTo(2, 9);
    expect(times[1]).toBeCloseTo(2.14, 9);
    expect(times[2]).toBeCloseTo(2.28, 9);
    const env = list[0].outputs[0];
    const band = ctx.of('biquad')[0];
    expect(band.type).toBe('bandpass');
    expect(env.outputs[0].outputs[0]).toBe(band);
    expect(band.outputs[0]).toBe(quad);
    expect(list.every((o) => o.started === 1 && o.stopped)).toBe(true);
  });

  it('gives beeps an attack and a release so they do not click', () => {
    const { ctx, beeper } = setup();
    beeper.arm();
    const env = ctx.of('oscillator')[0].outputs[0];
    const calls = env.param('gain').calls;
    expect(calls[0]).toMatchObject({ kind: 'set', value: 0 });
    expect(calls.some((c) => c.kind === 'linear' && c.value > 0)).toBe(true);
    expect(calls.at(-1)).toMatchObject({ kind: 'linear', value: 0 });
  });

  it('gate ding rings two bells with an inharmonic partial straight into the UI bus', () => {
    const { ctx, ui, beeper, oscs } = setup();
    beeper.gatePass();
    const list = oscs();
    expect(list).toHaveLength(4);
    const freqs = list.map((o) => (o.frequency as { value: number }).value);
    expect(freqs[1] / freqs[0]).toBeCloseTo(2.76, 6);
    expect(list.every((o) => o.type === 'sine')).toBe(true);
    const env = list[0].outputs[0];
    expect(env.outputs[0]).toBe(ui);
    expect(ctx.of('biquad')[0].outputs[0]).not.toBe(ui);
  });

  it('countdown uses short beeps for 3, 2, 1 and a long one for go', () => {
    const { ctx, beeper, oscs } = setup();
    const length = (i: number): number => {
      const calls = oscs()[i].outputs[0].param('gain').calls;
      return calls[calls.length - 1].time - (oscs()[i].startArgs[0] as number);
    };
    for (const n of [3, 2, 1]) {
      ctx.currentTime += 1;
      beeper.countdown(n);
    }
    expect(oscs()).toHaveLength(3);
    ctx.currentTime += 1;
    beeper.countdown(0);
    expect(oscs()).toHaveLength(4);
    for (let i = 0; i < 3; i++) expect(length(i)).toBeLessThan(0.25);
    expect(length(3)).toBeGreaterThanOrEqual(0.5);
  });

  it('drops repeats inside the minimum gap and allows them after', () => {
    const { ctx, beeper, oscs } = setup();
    beeper.lowBattery();
    beeper.lowBattery();
    expect(oscs()).toHaveLength(2);
    ctx.currentTime = 0.5;
    beeper.lowBattery();
    expect(oscs()).toHaveLength(2);
    ctx.currentTime = 2;
    beeper.lowBattery();
    expect(oscs()).toHaveLength(4);
    beeper.arm();
    expect(oscs()).toHaveLength(7);
  });

  it('frees the envelope when a beep ends', () => {
    const { ctx, beeper } = setup();
    beeper.lowBattery();
    const osc = ctx.of('oscillator')[0];
    const env = osc.outputs[0];
    osc.finish();
    expect(env.connected).toBe(false);
  });
});
