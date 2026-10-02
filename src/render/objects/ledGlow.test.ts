import { describe, expect, it } from 'vitest';
import { resolveShader } from '../shaderLib';
import { glowShown, ledDisplay, NIGHT_TOTAL_EXPOSURE } from './ledGlow';

const NOON_PRE = 1 / (4 * 5000);
const NIGHT_PRE = 1000;
const FP16_MAX = 65504;

/** The exposure ratio the camera model settles on: total exposure over the CPU pre-exposure. */
const displayOf = (shown: number, pre: number, total: number): number => shown * (total / pre);

describe('LED glow level', () => {
  it('uses the same night exposure the WGSL constant states (and the camera model gives)', () => {
    const wgsl = Number(/const NIGHT_TOTAL_EXPOSURE : f32 = ([\d.]+);/.exec(resolveShader('objects/glow.wgsl'))?.[1]);
    expect(Math.abs(Math.log2(NIGHT_TOTAL_EXPOSURE / wgsl))).toBeLessThan(0.02);
  });

  it('keeps the same formula in both glow shaders', () => {
    for (const path of ['objects/glow.wgsl', 'objects/quad_forward.wgsl']) {
      const code = resolveShader(path, path.includes('quad') ? { PROP_R: 0.065 } : {});
      expect(code, path).toContain('glowShown(');
      expect(code, path).toContain('ledDisplay(strength)');
    }
  });

  it('is faint at noon, where a sunlit grey card is brighter than the glow of an idle strip, and the active strip stays far from clipping', () => {
    const card = 0.18 * 5000 * NOON_PRE;
    const idle = glowShown(0.1, NOON_PRE, 1);
    expect(idle).toBeLessThan(card);
    expect(displayOf(idle, NOON_PRE, NOON_PRE)).toBeLessThan(0.05);
    expect(displayOf(glowShown(0.55, NOON_PRE, 1), NOON_PRE, NOON_PRE)).toBeLessThan(0.2);
  });

  it('is a bright, coloured core at night without leaving fp16 range', () => {
    for (const strength of [0.03, 0.1, 0.4, 0.6]) {
      for (const energy of [0.25, 1]) {
        const shown = glowShown(strength, NIGHT_PRE, energy);
        expect(shown).toBeLessThan(FP16_MAX / 100);
        expect(displayOf(shown, NIGHT_PRE, NIGHT_TOTAL_EXPOSURE)).toBeCloseTo(ledDisplay(strength), 6);
      }
    }
  });

  it('lets the active gate stand out from the idle ones and the passed ones fade', () => {
    const level = (s: number): number => displayOf(glowShown(s, NIGHT_PRE, 0.25), NIGHT_PRE, NIGHT_TOTAL_EXPOSURE);
    expect(level(0.4)).toBeGreaterThan(level(0.1) * 2);
    expect(level(0.03)).toBeLessThan(level(0.1));
    expect(level(0.1)).toBeGreaterThan(0.3);
  });

  it('does not depend on the distance energy factor once the cap holds', () => {
    expect(glowShown(0.1, NIGHT_PRE, 0.25)).toBe(glowShown(0.1, NIGHT_PRE, 1));
  });

  it('follows the physical value while it is below the cap (bright day), and holds the cap from there on', () => {
    const pre = 2e-4;
    expect(glowShown(0.1, pre, 1)).toBeCloseTo(0.1 * 20000 * 0.35 * pre, 9);
    expect(glowShown(0.1, 0.05, 1)).toBeCloseTo(ledDisplay(0.1), 9);
  });
});
