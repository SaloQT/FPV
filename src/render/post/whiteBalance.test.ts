import { describe, expect, it } from 'vitest';
import { resolveShader } from '../shaderLib';
import { WHITE_BALANCE_TUNING, whiteBalanceDefines, whiteBalanceGains } from './whiteBalance';

const LUMA = [0.2126, 0.7152, 0.0722];
const lum = (c: number[]): number => c.reduce((s, v, i) => s + v * LUMA[i], 0);
/** A grey card under light of relative colour (r, 1, b), after the gains, as (r/g, b/g). */
function corrected(light: [number, number, number], gainEv = 0): [number, number] {
  const g = whiteBalanceGains(Math.log(light[0] / light[1]), Math.log(light[2] / light[1]), gainEv);
  const c = light.map((v, i) => v * g[i]);
  return [c[0] / c[1], c[2] / c[1]];
}

// Light colours measured with grey cards in the renderer (.bench/lightcast): open noon (sun + sky), shaded bark in a forest (skylight
// through the crown gaps), a 0.18 card on the ground in open shade, and a low sun about 5 degrees up.
const NOON: [number, number, number] = [1.02, 1, 0.97];
const FOREST_SHADE: [number, number, number] = [0.8, 1, 1.12];
const OPEN_SHADE: [number, number, number] = [0.75, 1, 1.45];
const GOLDEN: [number, number, number] = [1.45, 1, 0.55];

describe('camera white balance', () => {
  it('keeps the luminance of a grey', () => {
    for (const light of [NOON, FOREST_SHADE, OPEN_SHADE, GOLDEN]) {
      const g = whiteBalanceGains(Math.log(light[0]), Math.log(light[2]), 0);
      expect(lum(g)).toBeCloseTo(1, 6);
    }
  });

  it('leaves open noon within 2 % of where it was', () => {
    const [rg, bg] = corrected(NOON);
    expect(Math.abs(rg - 1)).toBeLessThan(0.02);
    expect(Math.abs(bg - 1)).toBeLessThan(0.02);
  });

  it('takes most of the blue out of forest shade', () => {
    const [rg, bg] = corrected(FOREST_SHADE);
    expect(rg).toBeGreaterThan(0.94);
    expect(bg).toBeLessThan(1.04);
  });

  it('keeps golden hour warm and open shade a little blue: a strong cast is only partly removed', () => {
    const [grg, gbg] = corrected(GOLDEN);
    expect(grg).toBeGreaterThan(1.12);
    expect(gbg).toBeLessThan(0.82);
    const [org, obg] = corrected(OPEN_SHADE);
    expect(obg).toBeGreaterThan(1.05);
    expect(org).toBeLessThan(0.97);
  });

  it('balances a golden-hour frame on its skylit shade and leaves blue hour blue', () => {
    const deg = (d: number): number => Math.sin((d * Math.PI) / 180);
    const golden = whiteBalanceGains(-0.3, 0.4, 2, deg(4));
    expect(golden).toEqual(whiteBalanceGains(-0.3, 0.4, 2, deg(40)));
    expect(golden[0]).toBeGreaterThan(1);
    expect(golden[2]).toBeLessThan(1);
    expect(whiteBalanceGains(-0.3, 0.4, 2, deg(-5))).toEqual([1, 1, 1]);
    const setting = whiteBalanceGains(-0.3, 0.4, 2, deg(-1));
    expect(setting[0]).toBeGreaterThan(1);
    expect(setting[0]).toBeLessThan(golden[0]);
  });

  it('fades the auto correction out between civil twilight and a full moon and locks to the cool night white point', () => {
    const night = whiteBalanceGains(0.3, -0.5, WHITE_BALANCE_TUNING.gainHi + 1);
    expect(night).toEqual(whiteBalanceGains(-0.4, 0.6, WHITE_BALANCE_TUNING.gainHi + 1));
    expect(night[2]).toBeGreaterThan(night[1]);
    expect(night[0]).toBeLessThan(night[1]);
    expect(lum(night)).toBeCloseTo(1, 6);
    const dusk = whiteBalanceGains(0.3, -0.5, (WHITE_BALANCE_TUNING.gainLo + WHITE_BALANCE_TUNING.gainHi) / 2);
    const day = whiteBalanceGains(0.3, -0.5, 0);
    // Halfway into the dark, red sits between the day correction and the night white point.
    expect(dusk[0]).toBeLessThan(Math.max(day[0], night[0]));
    expect(dusk[0]).toBeGreaterThan(Math.min(day[0], night[0]));
  });

  it('builds a shader whose constants all resolve', () => {
    const src = resolveShader('post/whitebalance.wgsl', whiteBalanceDefines());
    expect(src).not.toMatch(/\$\{/);
    expect(src).toContain('fn meter(');
    expect(src).toContain('fn resolve(');
    // It includes the world bindings and the atmosphere helpers, so its own names must not clash with theirs (TAU once did).
    const names = [...src.matchAll(/^(?:const|fn|var(?:<[^>]*>)?)\s+([A-Za-z_]\w*)/gm)].map((m) => m[1]);
    expect(names.filter((n, i) => names.indexOf(n) !== i)).toEqual([]);
  });

  it('feeds the composite through the exposure uniform', () => {
    const composite = resolveShader('post/composite.wgsl', { DITHER_LSB: '0.0' });
    expect(composite).toContain('* whiteBalance()');
  });
});
