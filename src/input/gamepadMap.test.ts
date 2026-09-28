import { describe, expect, it } from 'vitest';
import { sanitizeGamepadConfig } from './gamepadConfig';
import {
  beginRange, centerFromRaw, createPadSample, defaultGamepadConfig, extendRange, LATCHED_RATE, mapGamepad, normSigned, normUnit,
  padThrottle, resolveProfile, resolveThrottleMode, switchMode, type GamepadConfig, type PadLike, type PadSample,
} from './gamepadMap';

function pad(axes: number[], pressed: number[] = [], mapping = ''): PadLike {
  const buttons = Array.from({ length: 16 }, (_, i) => ({ pressed: pressed.includes(i), value: pressed.includes(i) ? 1 : 0 }));
  return { axes, buttons, mapping, connected: true };
}

function sample(p: PadLike, cfg: GamepadConfig = defaultGamepadConfig()): PadSample {
  const s = createPadSample();
  mapGamepad(p, cfg, s);
  return s;
}

describe('standard mapping (Xbox-style pads)', () => {
  const std = (axes: number[], pressed: number[] = []): PadLike => pad(axes, pressed, 'standard');

  it('right stick right is roll > 0 and right stick forward (up) is pitch > 0 (nose down)', () => {
    const s = sample(std([0, 0, 1, -1]));
    expect(s.profile).toBe('standard');
    expect(s.roll).toBe(1);
    expect(s.pitch).toBe(1);
    expect(sample(std([0, 0, -1, 1])).roll).toBe(-1);
    expect(sample(std([0, 0, 0, 1])).pitch).toBe(-1);
  });

  it('left stick right is yaw > 0 (nose right); left stick up is positive throttle deflection', () => {
    const s = sample(std([1, -1, 0, 0]));
    expect(s.yaw).toBe(1);
    expect(s.throttleDefl).toBe(1);
    expect(sample(std([-1, 1, 0, 0])).yaw).toBe(-1);
    expect(sample(std([0, 1, 0, 0])).throttleDefl).toBe(-1);
  });

  it('maps the face buttons: A arm, B turtle, X camera, Y respawn, LB mode, Start menu', () => {
    const s = sample(std([0, 0, 0, 0], [0, 1, 2, 3, 4, 9]));
    expect([s.arm, s.turtle, s.camera, s.respawn, s.modeCycle, s.menu]).toEqual([true, true, true, true, true, true]);
    const none = sample(std([0, 0, 0, 0]));
    expect([none.arm, none.turtle, none.camera, none.respawn, none.modeCycle, none.menu]).toEqual([false, false, false, false, false, false]);
  });
});

const linear: GamepadConfig = { ...defaultGamepadConfig(), deadzone: 0 };

describe('radio mapping (USB HID transmitters)', () => {
  it('AETR order: axes are roll, pitch, throttle, yaw and throttle is absolute 0..1', () => {
    const s = sample(pad([0.5, -0.5, -1, 0.25]), linear);
    expect(s.profile).toBe('radio');
    expect(s.roll).toBeCloseTo(0.5, 3);
    expect(s.pitch).toBeCloseTo(-0.5, 3);
    expect(s.yaw).toBeCloseTo(0.25, 3);
    expect(s.throttleDirect).toBe(0);
    expect(sample(pad([0, 0, 1, 0])).throttleDirect).toBe(1);
    expect(sample(pad([0, 0, 0, 0])).throttleDirect).toBeCloseTo(0.5, 9);
  });

  it('TAER order: throttle is axis 0, roll axis 1, pitch axis 2', () => {
    const cfg = { ...linear, radioOrder: 'TAER' as const };
    const s = sample(pad([1, -0.6, 0.6, -0.3]), cfg);
    expect(s.throttleDirect).toBe(1);
    expect(s.roll).toBeCloseTo(-0.6, 3);
    expect(s.pitch).toBeCloseTo(0.6, 3);
    expect(s.yaw).toBeCloseTo(-0.3, 3);
  });

  it('arm switch above 0.5 arms, and the mode switch has three positions', () => {
    expect(sample(pad([0, 0, -1, 0, 1, -1])).armSwitch).toBe(true);
    expect(sample(pad([0, 0, -1, 0, 0.4, -1])).armSwitch).toBe(false);
    expect(sample(pad([0, 0, -1, 0, -1, -1])).modeSwitch).toBe('acro');
    expect(sample(pad([0, 0, -1, 0, -1, 0])).modeSwitch).toBe('angle');
    expect(sample(pad([0, 0, -1, 0, -1, 1])).modeSwitch).toBe('horizon');
    expect(sample(pad([0, 0, -1, 0])).hasArmSwitch).toBe(false);
  });

  it('a profile forced in the config beats the reported mapping', () => {
    const cfg = { ...defaultGamepadConfig(), profile: 'radio' as const };
    expect(resolveProfile(pad([], [], 'standard'), cfg)).toBe('radio');
    expect(resolveProfile(pad([], [], 'standard'), defaultGamepadConfig())).toBe('standard');
    expect(resolveProfile(pad([], [], ''), defaultGamepadConfig())).toBe('radio');
  });
});

describe('deadzone, expo and calibration', () => {
  it('zeroes inside the deadzone and rescales so full deflection still reaches 1', () => {
    const cfg = { ...defaultGamepadConfig(), deadzone: 0.1 };
    expect(sample(pad([0.09, 0, 0, 0]), cfg).roll).toBe(0);
    expect(sample(pad([0.55, 0, 0, 0]), cfg).roll).toBeCloseTo(0.5, 6);
    expect(sample(pad([1, 0, 0, 0]), cfg).roll).toBe(1);
    expect(sample(pad([-0.55, 0, 0, 0]), cfg).roll).toBeCloseTo(-0.5, 6);
  });

  it('expo softens the centre and keeps the ends', () => {
    const cfg = { ...defaultGamepadConfig(), deadzone: 0, expo: 0.8 };
    const half = sample(pad([0.5, 0, 0, 0]), cfg).roll;
    expect(half).toBeCloseTo(0.8 * 0.125 + 0.2 * 0.5, 9);
    expect(sample(pad([1, 0, 0, 0]), cfg).roll).toBe(1);
  });

  it('scales each half of an off-centre axis by its own travel', () => {
    const c = { min: -0.8, center: 0.1, max: 0.9, invert: false };
    expect(normSigned(0.1, c)).toBe(0);
    expect(normSigned(0.9, c)).toBe(1);
    expect(normSigned(-0.8, c)).toBe(-1);
    expect(normSigned(0.5, c)).toBeCloseTo(0.5, 9);
    expect(normSigned(-0.35, c)).toBeCloseTo(-0.5, 9);
    expect(normSigned(2, c)).toBe(1);
  });

  it('inverts an axis', () => {
    const c = { min: -1, center: 0, max: 1, invert: true };
    expect(normSigned(0.5, c)).toBeCloseTo(-0.5, 9);
    expect(normUnit(1, c)).toBe(0);
    expect(normUnit(-1, c)).toBe(1);
    const cfg = { ...linear, cal: { ...linear.cal, roll: { ...linear.cal.roll, invert: true } } };
    expect(sample(pad([0.8, 0, 0, 0]), cfg).roll).toBeCloseTo(-0.8, 3);
  });

  it('maps throttle across the calibrated travel', () => {
    const c = { min: -0.6, center: 0, max: 0.8, invert: false };
    expect(normUnit(-0.6, c)).toBe(0);
    expect(normUnit(0.8, c)).toBe(1);
    expect(normUnit(0.1, c)).toBeCloseTo(0.5, 9);
    expect(normUnit(-2, c)).toBe(0);
  });

  it('treats missing, NaN and degenerate axes as centred', () => {
    expect(sample(pad([Number.NaN, 0, 0])).roll).toBe(0);
    const s = sample(pad([0.5, 0.5]));
    expect([s.throttleDirect, s.yaw]).toEqual([0, 0]);
    expect(normSigned(0.7, { min: 0.2, center: 0.2, max: 0.2, invert: false })).toBe(0);
  });

  it('mapping is pure: same pad and config give the same sample', () => {
    const p = pad([0.3, -0.2, 0.7, 0.1], [0]);
    expect(sample(p)).toEqual(sample(p));
  });
});

describe('throttle modes', () => {
  const s = createPadSample();

  it('auto picks direct for radios and latched for standard pads', () => {
    const cfg = defaultGamepadConfig();
    expect(resolveThrottleMode(cfg, 'radio')).toBe('direct');
    expect(resolveThrottleMode(cfg, 'standard')).toBe('latched');
    expect(resolveThrottleMode({ ...cfg, throttleMode: 'hover' }, 'radio')).toBe('hover');
  });

  it('direct is absolute', () => {
    s.throttleDirect = 0.42;
    expect(padThrottle('direct', s, 0.9, 0.01, 0.3)).toBe(0.42);
  });

  it('latched integrates the deflection and holds at centre', () => {
    s.throttleDefl = 1;
    expect(padThrottle('latched', s, 0.2, 0.5, 0.3)).toBeCloseTo(0.2 + LATCHED_RATE * 0.5, 9);
    s.throttleDefl = 0;
    expect(padThrottle('latched', s, 0.6, 0.5, 0.3)).toBe(0.6);
    s.throttleDefl = -1;
    expect(padThrottle('latched', s, 0.1, 5, 0.3)).toBe(0);
  });

  it('hover centres on the hover throttle and reaches 0 and 1 at the ends', () => {
    s.throttleDefl = 0;
    expect(padThrottle('hover', s, 0.9, 0.01, 0.3)).toBe(0.3);
    s.throttleDefl = 1;
    expect(padThrottle('hover', s, 0, 0.01, 0.3)).toBe(1);
    s.throttleDefl = -1;
    expect(padThrottle('hover', s, 0, 0.01, 0.3)).toBe(0);
  });

  it('switchMode has dead bands between the three positions', () => {
    expect(switchMode(-1)).toBe('acro');
    expect(switchMode(-0.2)).toBe('angle');
    expect(switchMode(0.2)).toBe('angle');
    expect(switchMode(1)).toBe('horizon');
  });
});

describe('calibration helpers', () => {
  it('centerFromRaw captures the resting values of the three spring sticks', () => {
    const next = centerFromRaw(defaultGamepadConfig(), 'radio', [0.05, -0.04, -1, 0.02, 0, 0]);
    expect([next.cal.roll.center, next.cal.pitch.center, next.cal.yaw.center]).toEqual([0.05, -0.04, 0.02]);
    expect(next.cal.throttle.center).toBe(0);
    expect(centerFromRaw(defaultGamepadConfig(), 'radio', [0.05, -0.04, -1, 0.02, 0, 0])).not.toBe(next);
  });

  it('beginRange then extendRange records min and max, and the calibrated stick reaches +-1', () => {
    let cfg = beginRange(defaultGamepadConfig(), 'radio', [0, 0, 0, 0]);
    for (const v of [0.4, -0.7, 0.3]) cfg = extendRange(cfg, 'radio', [v, 0, 0, 0]);
    expect([cfg.cal.roll.min, cfg.cal.roll.max]).toEqual([-0.7, 0.4]);
    expect(sample(pad([0.4, 0, 0, 0]), cfg).roll).toBe(1);
    expect(sample(pad([-0.7, 0, 0, 0]), cfg).roll).toBe(-1);
  });

  it('does not mutate the config it was given', () => {
    const cfg = defaultGamepadConfig();
    beginRange(cfg, 'standard', [1, 1, 1, 1]);
    expect(cfg.cal.roll).toEqual({ min: -1, center: 0, max: 1, invert: false });
  });
});

describe('sanitizeGamepadConfig', () => {
  it('falls back to defaults for junk', () => {
    for (const junk of [null, undefined, 5, 'x', [], { cal: 3, buttons: 'no' }]) expect(sanitizeGamepadConfig(junk)).toEqual(defaultGamepadConfig());
  });

  it('clamps numbers, rejects bad enums and drops unknown keys', () => {
    const c = sanitizeGamepadConfig({ profile: 'nope', throttleMode: 'hover', deadzone: 9, expo: -1, hoverThrottle: 0, radioOrder: 'TAER', evil: 1, cal: { roll: { min: -9, max: 9, center: 100, invert: true }, yaw: { min: 1, max: 1 } }, buttons: { arm: 99, turtle: 2.5, camera: -1 } }) as unknown as Record<string, unknown>;
    expect(c.profile).toBe('auto');
    expect(c.throttleMode).toBe('hover');
    expect(c.deadzone).toBe(0.4);
    expect(c.expo).toBe(0);
    expect(c.hoverThrottle).toBe(0.1);
    expect(c.radioOrder).toBe('TAER');
    expect('evil' in c).toBe(false);
    const cfg = c as unknown as GamepadConfig;
    expect(cfg.cal.roll).toEqual({ min: -4, max: 4, center: 4, invert: true });
    expect(cfg.cal.yaw).toEqual(defaultGamepadConfig().cal.yaw);
    expect(cfg.buttons).toEqual({ ...defaultGamepadConfig().buttons, arm: 31, camera: -1 });
  });

  it('round-trips a valid config through JSON', () => {
    const cfg = defaultGamepadConfig();
    cfg.deadzone = 0.12;
    cfg.cal.pitch = { min: -0.9, center: 0.02, max: 0.95, invert: true };
    expect(sanitizeGamepadConfig(JSON.parse(JSON.stringify(cfg)))).toEqual(cfg);
  });
});
