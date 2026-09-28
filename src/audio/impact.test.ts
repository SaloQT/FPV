import { describe, expect, it } from 'vitest';
import { asContext, FakeContext, FakeNode } from './fakeAudio';
import {
  grainRate, IMPACT_SCALE, impactGain, ImpactSynth, SCRAPE_PROFILES, scrapeLevel, type TerrainKind, washLevel,
} from './impact';

describe('impact laws', () => {
  it('crash gain rises monotonically with closing speed and tolerates junk', () => {
    let prev = 0;
    for (let v = 0; v <= 40; v += 2) {
      const g = impactGain(v);
      expect(g).toBeGreaterThanOrEqual(prev);
      prev = g;
    }
    expect(impactGain(30)).toBeCloseTo(1, 9);
    expect(impactGain(3)).toBeLessThan(0.3);
    expect(impactGain(NaN)).toBe(impactGain(0));
  });

  it('scrapes only on the ground and above 0.3 m/s, louder when faster', () => {
    expect(scrapeLevel(5, false)).toBe(0);
    expect(scrapeLevel(0.3, true)).toBe(0);
    expect(scrapeLevel(0.1, true)).toBe(0);
    expect(scrapeLevel(0.5, true)).toBeGreaterThan(0);
    expect(scrapeLevel(5, true)).toBeGreaterThan(scrapeLevel(1, true));
    expect(scrapeLevel(30, true)).toBeCloseTo(1, 9);
    expect(scrapeLevel(NaN, true)).toBe(0);
  });

  it('prop wash needs grass, low altitude and spinning motors', () => {
    const base = washLevel(0.5, 0.6, 1);
    expect(base).toBeGreaterThan(0.9);
    expect(washLevel(0.5, 0.6, 0)).toBe(0);
    expect(washLevel(0.5, 0.05, 1)).toBe(0);
    expect(washLevel(8, 0.6, 1)).toBe(0);
    expect(washLevel(0.5, 0.6, 0.5)).toBeCloseTo(base * 0.5, 9);
    expect(washLevel(2, 0.6, 1)).toBeLessThan(base);
    expect(washLevel(NaN, 0.6, 1)).toBe(0);
  });

  it('gives each surface a distinct sound and faster sliding more grains', () => {
    const kinds = Object.keys(SCRAPE_PROFILES) as TerrainKind[];
    expect(new Set(kinds.map((k) => SCRAPE_PROFILES[k].hissHz)).size).toBe(4);
    expect(SCRAPE_PROFILES.rock.grit).toBeGreaterThan(SCRAPE_PROFILES.grass.grit * 3);
    expect(SCRAPE_PROFILES.sand.hissHz).toBeGreaterThan(SCRAPE_PROFILES.dirt.hissHz);
    expect(grainRate(10)).toBeGreaterThan(grainRate(1));
  });
});

describe('ImpactSynth', () => {
  const make = () => {
    const ctx = new FakeContext();
    const out = ctx.createGain();
    const synth = new ImpactSynth(asContext(ctx), out);
    const shots = () => ctx.of('bufferSource').filter((n) => (n.loop as boolean | undefined) !== true);
    return { ctx, out, synth, shots };
  };

  it('pre-renders banks of samples and keeps the ground loops running', () => {
    const { ctx } = make();
    expect(ctx.buffers.some((b) => b.duration > 1)).toBe(true);
    const loops = ctx.of('bufferSource').filter((n) => (n.loop as boolean) === true);
    expect(loops.length).toBe(3);
    for (const l of loops) expect(l.started).toBe(1);
  });

  it('scales the crash with impact speed and adds prop ticks only on a prop strike', () => {
    const { ctx, synth, shots } = make();
    synth.crash(4, false);
    expect(shots()).toHaveLength(1);
    const soft = ctx.of('gain').at(-1)!.param('gain').value;
    synth.crash(24, false);
    const hard = ctx.of('gain').at(-1)!.param('gain').value;
    expect(hard).toBeGreaterThan(soft * 2);
    expect(hard).toBeLessThanOrEqual(IMPACT_SCALE);
    const before = shots().length;
    synth.crash(20, true);
    expect(shots().length - before).toBeGreaterThanOrEqual(4);
  });

  it('varies pitch and never repeats the same sample twice in a row', () => {
    const { synth, shots } = make();
    for (let i = 0; i < 12; i++) synth.clack(0.5);
    const list = shots();
    const buffers = list.map((n) => n.buffer);
    for (let i = 1; i < buffers.length; i++) expect(buffers[i]).not.toBe(buffers[i - 1]);
    const rates = new Set(list.map((n) => (n.playbackRate as { value: number }).value));
    expect(rates.size).toBeGreaterThan(6);
    for (const r of rates) expect(Math.abs(r - 1)).toBeLessThanOrEqual(0.1);
  });

  it('caps simultaneous voices and frees them when they end', () => {
    const { synth, shots } = make();
    for (let i = 0; i < 60; i++) synth.tick(1);
    expect(shots()).toHaveLength(24);
    (shots()[0] as FakeNode).finish();
    synth.tick(1);
    expect(shots()).toHaveLength(25);
    synth.tick(1);
    expect(shots()).toHaveLength(25);
  });

  it('drives the ground loops from the surface profile and levels', () => {
    const { ctx, synth } = make();
    synth.update('rock', 1, 0, 8);
    const bands = ctx.of('biquad');
    const hiss = bands[0], grit = bands[1];
    expect(hiss.param('frequency').last).toBe(SCRAPE_PROFILES.rock.hissHz);
    expect(grit.param('frequency').last).toBe(SCRAPE_PROFILES.rock.gritHz);
    const [, hissGain, gritGain] = ctx.of('gain');
    expect(gritGain.param('gain').last).toBeGreaterThan(hissGain.param('gain').last);
    synth.update('rock', 0, 0, 0);
    expect(hissGain.param('gain').last).toBe(0);
    expect(gritGain.param('gain').last).toBe(0);
  });

  it('stops everything on dispose', () => {
    const { ctx, synth } = make();
    synth.dispose();
    for (const n of ctx.of('bufferSource').filter((s) => (s.loop as boolean) === true)) expect(n.stopped).toBe(true);
  });
});
