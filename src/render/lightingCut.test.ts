import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../contracts';
import { computeAstro } from '../world/astro/clock';
import { LIGHTING_CUT, LightingCutDetector } from './lightingCut';
import { ModuleHost } from './moduleHost';
import type { RenderContext, RenderModule } from './contracts';

const at = (hour: number, seconds = 0) => computeAstro(Date.UTC(2026, 5, 21, 0, 0, 0) + hour * 3600e3 + seconds * 1e3, DEFAULT_SETTINGS.observer);
const HEIGHT = 1200;

describe('lighting cut', () => {
  it('never fires on the first frame', () => {
    expect(new LightingCutDetector().step(at(12), HEIGHT)).toBe(false);
  });

  it('fires on a jump from noon to midnight, and only on that frame', () => {
    const d = new LightingCutDetector();
    d.step(at(12), HEIGHT);
    expect(d.step(at(23.5), HEIGHT)).toBe(true);
    expect(d.step(at(23.5, 1 / 60), HEIGHT)).toBe(false);
  });

  it('fires on a small scrub of the time-of-day slider (an hour moves the sun about 15 degrees)', () => {
    const d = new LightingCutDetector();
    d.step(at(9), HEIGHT);
    expect(d.step(at(10), HEIGHT)).toBe(true);
  });

  it('does not fire as time runs, even through sunset at 60 fps or with a 0.25 s frame hitch', () => {
    const d = new LightingCutDetector();
    let fired = 0;
    for (let s = 0; s < 1800; s += 1 / 60 * 30) if (d.step(at(19, s), HEIGHT)) fired++;
    expect(fired).toBe(0);
    d.step(at(12), HEIGHT);
    expect(d.step(at(12, 0.25), HEIGHT)).toBe(false);
  });

  it('fires on a jump of the scene brightness with the sun still', () => {
    const d = new LightingCutDetector();
    d.step(at(19.2), HEIGHT);
    // 20 minutes of dusk dims the land by far more than LIGHTING_CUT.luminanceEv; the sun moves only a few degrees in it.
    expect(d.step(at(19.2 + 1 / 3), HEIGHT)).toBe(true);
    expect(LIGHTING_CUT.luminanceEv).toBeGreaterThanOrEqual(1);
  });

  it('the module host passes a cut to every module that keeps lighting history, and survives one that throws', async () => {
    const log: string[] = [];
    const mods: RenderModule[] = [
      { name: 'rt', init: () => {}, resetLighting: () => { log.push('rt'); } },
      { name: 'plain', init: () => {} },
      { name: 'bad', init: () => {}, resetLighting: () => { throw new Error('boom'); } },
      { name: 'clouds', init: () => {}, resetLighting: () => { log.push('clouds'); } },
    ];
    const reports: string[] = [];
    const h = new ModuleHost(mods, (m) => reports.push(m));
    await h.init({} as RenderContext);
    h.resetLighting();
    expect(log).toEqual(['rt', 'clouds']);
    expect(reports.length).toBe(1);
  });
});
