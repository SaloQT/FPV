import { describe, expect, it } from 'vitest';
import { sanitizeGamepadConfig } from './gamepadConfig';
import { defaultActionBinds, type ActionBind } from './padActions';
import {
  AXIS_DETECT_THRESHOLD, STICK_LAYOUTS, STICK_LAYOUT_HINTS, STICK_LAYOUT_LABELS, beginRange, bindAxis, centerFromRaw, createPadSample,
  defaultGamepadConfig, detectMovedAxis, detectPadInput, extendRange,
  LATCHED_RATE, mapGamepad, normSigned, normUnit, padThrottle, resolveProfile, resolveThrottleMode, resolvedAxisMap,
  switchMode, type GamepadConfig, type PadLike, type PadSample,
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
    expect([s.aux.arm, s.aux.turtle, s.aux.camera, s.aux.respawn, s.aux.modeCycle, s.aux.menu]).toEqual([true, true, true, true, true, true]);
    const none = sample(std([0, 0, 0, 0]));
    expect([none.aux.arm, none.aux.turtle, none.aux.camera, none.aux.respawn, none.aux.modeCycle, none.aux.menu]).toEqual([false, false, false, false, false, false]);
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
    const cfg = { ...linear, layout: 'TAER' as const };
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

describe('axis remapping', () => {
  it('an unbound config leaves every role on the profile layout', () => {
    expect(resolvedAxisMap(defaultGamepadConfig(), 'radio')).toEqual({ roll: 0, pitch: 1, throttle: 2, yaw: 3, arm: 4, mode: 5 });
    expect(resolvedAxisMap(defaultGamepadConfig(), 'standard')).toEqual({ roll: 2, pitch: 3, throttle: 1, yaw: 0, arm: -1, mode: -1 });
  });

  it('a bound role reads its own axis and the rest keep the layout', () => {
    const cfg = bindAxis(defaultGamepadConfig(), 'throttle', 5);
    expect(cfg.axisMap.throttle).toBe(5);
    expect(resolvedAxisMap(cfg, 'radio')).toEqual({ roll: 0, pitch: 1, throttle: 5, yaw: 3, arm: 4, mode: 5 });
  });

  it('the bound axis actually drives the sample', () => {
    // Axis 5 is the arm switch in AETR; a transmitter that puts throttle there now flies.
    const cfg = bindAxis(defaultGamepadConfig(), 'throttle', 5);
    const s = sample(pad([0, 0, 0, 0, 0, 1]), cfg);
    expect(s.throttleDirect).toBe(1);
    expect(s.roll).toBe(0);
  });

  it('a standard pad can be rebound past its usual layout', () => {
    const cfg = bindAxis(defaultGamepadConfig(), 'roll', 3);
    expect(sample(pad([0, 0, 0, 1], [], 'standard'), cfg).roll).toBe(1);
  });

  it('one axis drives one role: the role it displaces falls back to the layout', () => {
    const cfg = bindAxis(bindAxis(defaultGamepadConfig(), 'throttle', 0), 'roll', 0);
    expect(cfg.axisMap.roll).toBe(0);
    expect(cfg.axisMap.throttle).toBe(-1);
    expect(resolvedAxisMap(cfg, 'radio').roll).toBe(0);
    expect(resolvedAxisMap(cfg, 'radio').throttle).toBe(2);
  });

  it('ignores a negative or non-integer axis and never mutates its input', () => {
    const cfg = defaultGamepadConfig();
    expect(bindAxis(cfg, 'roll', -1)).toBe(cfg);
    expect(bindAxis(cfg, 'roll', 1.5)).toBe(cfg);
    expect(cfg.axisMap.roll).toBe(-1);
  });

  it('calibration follows the bound axis, not the layout one', () => {
    const cfg = bindAxis(defaultGamepadConfig(), 'roll', 5);
    const next = centerFromRaw(cfg, 'radio', [0.9, 0, 0, 0, 0, 0.25]);
    expect(next.cal.roll.center).toBe(0.25);
  });
});

describe('detectMovedAxis', () => {
  it('names the axis that moved furthest past the threshold', () => {
    expect(detectMovedAxis([0, 0, 0, 0], [0, 0, 0.9, 0.1])).toBe(2);
    expect(detectMovedAxis([0, 0, 0, 0], [0.4, 0, 0, 0])).toBe(0);
  });

  it('ignores direction, since a stick is moved either way', () => {
    expect(detectMovedAxis([0, 0, 0, 0], [0, 0, -0.8, 0])).toBe(2);
  });

  it('returns -1 while nothing has moved enough, so idle drift cannot pick an axis', () => {
    expect(detectMovedAxis([0, 0, 0, 0], [0, 0, 0, 0])).toBe(-1);
    expect(detectMovedAxis([0, 0, 0, 0], [0.01, -0.02, 0.03, 0])).toBe(-1);
  });

  it('defaults to a threshold above drift and below half travel', () => {
    expect(AXIS_DETECT_THRESHOLD).toBeGreaterThan(0.15);
    expect(AXIS_DETECT_THRESHOLD).toBeLessThan(0.5);
    expect(detectMovedAxis([0, 0, 0, 0], [0, 0, AXIS_DETECT_THRESHOLD, 0])).toBe(-1);
    expect(detectMovedAxis([0, 0, 0, 0], [0, 0, AXIS_DETECT_THRESHOLD + 0.01, 0])).toBe(2);
  });

  it('measures against a deflected rest position, not against zero', () => {
    // Throttle held at 0.8 before listening began: that is the baseline, not movement.
    const base = [0, 0, 0.8, 0];
    expect(detectMovedAxis(base, [0, 0, 0.8, 0])).toBe(-1);
    expect(detectMovedAxis(base, [0, 0, 0.3, 0])).toBe(2);
  });

  it('survives ragged, non-finite and empty input', () => {
    expect(detectMovedAxis([], [0.9, 0.9])).toBe(-1);
    expect(detectMovedAxis([0, 0, 0], [0, NaN, 0.9])).toBe(2);
    expect(detectMovedAxis([0, 0, 0], [Infinity, 0, 0.9])).toBe(2);
  });

  it('only looks as far as the shorter array, so a growing axis count cannot pick a phantom', () => {
    expect(detectMovedAxis([0, 0], [0, 0, 0.9])).toBe(-1);
  });
});

describe('sanitizeGamepadConfig', () => {
  it('falls back to defaults for junk', () => {
    for (const junk of [null, undefined, 5, 'x', [], { cal: 3, buttons: 'no' }]) expect(sanitizeGamepadConfig(junk)).toEqual(defaultGamepadConfig());
  });

  it('clamps numbers, rejects bad enums and drops unknown keys', () => {
    const c = sanitizeGamepadConfig({ profile: 'nope', throttleMode: 'hover', deadzone: 9, expo: -1, hoverThrottle: 0, layout: 'TAER', evil: 1, cal: { roll: { min: -9, max: 9, center: 100, invert: true }, yaw: { min: 1, max: 1 } } }) as unknown as Record<string, unknown>;
    expect(c.profile).toBe('auto');
    expect(c.throttleMode).toBe('hover');
    expect(c.deadzone).toBe(0.4);
    expect(c.expo).toBe(0);
    expect(c.hoverThrottle).toBe(0.1);
    expect(c.layout).toBe('TAER');
    expect('evil' in c).toBe(false);
    const cfg = c as unknown as GamepadConfig;
    expect(cfg.cal.roll).toEqual({ min: -4, max: 4, center: 4, invert: true });
    expect(cfg.cal.yaw).toEqual(defaultGamepadConfig().cal.yaw);
    expect(cfg.actions).toEqual(defaultGamepadConfig().actions);
  });

  it('clamps action bindings and rejects a bad kind or index', () => {
    const c = sanitizeGamepadConfig({ actions: { arm: { kind: 'switch9', index: 99.5 }, turtle: { kind: 'switch2', index: 4, dir: 1 }, camera: { kind: 'button', index: 2 } } });
    expect(c.actions.arm).toEqual({ kind: 'button', index: 0, dir: 1, step: 1 });
    expect(c.actions.turtle).toEqual({ kind: 'switch2', index: 4, dir: 1, step: 1 });
    expect(c.actions.camera).toEqual({ kind: 'button', index: 2, dir: 1, step: 1 });
    // Untouched actions keep their defaults.
    expect(c.actions.menu).toEqual(defaultGamepadConfig().actions.menu);
  });

  it('unbinds an action and cannot leave it pointing at a live index', () => {
    const c = sanitizeGamepadConfig({ actions: { menu: { kind: 'none', index: 9 } } });
    expect(c.actions.menu).toEqual({ kind: 'none', index: -1, dir: 1, step: 1 });
  });

  it('reads settings saved before the action table existed', () => {
    // Older builds stored button indices under `buttons` and the radio order under `radioOrder`.
    const c = sanitizeGamepadConfig({ radioOrder: 'TAER', buttons: { arm: 7, turtle: 2, camera: -1 } });
    expect(c.layout).toBe('TAER');
    expect(c.actions.arm).toEqual({ kind: 'button', index: 7, dir: 1, step: 1 });
    expect(c.actions.turtle).toEqual({ kind: 'button', index: 2, dir: 1, step: 1 });
    // -1 in the old table meant the pilot had unbound it, so it must not come back as the default.
    expect(c.actions.camera).toEqual({ kind: 'none', index: -1, dir: 1, step: 1 });
    // Actions the old table never had come out unbound rather than stealing a key.
    expect(c.actions.resetTrack).toEqual({ kind: 'none', index: -1, dir: 1, step: 1 });
    expect(c.actions.perf).toEqual({ kind: 'none', index: -1, dir: 1, step: 1 });
  });

  it('lets the new table override what the old one said', () => {
    const c = sanitizeGamepadConfig({ buttons: { arm: 7 }, actions: { arm: { kind: 'button', index: 1 } } });
    expect(c.actions.arm.index).toBe(1);
  });

  it('keeps valid axis bindings and untrusts the rest', () => {
    const cfg = sanitizeGamepadConfig({
      axisMap: { roll: 3, pitch: -1, yaw: 999, throttle: 2.5, arm: 'left', mode: null, nope: 1 },
    }).axisMap;
    expect(cfg.roll).toBe(3);
    expect(cfg.pitch).toBe(-1);
    expect(cfg.yaw).toBe(31);
    expect(cfg.throttle).toBe(-1);
    expect(cfg.arm).toBe(-1);
    expect(cfg.mode).toBe(-1);
    expect('nope' in cfg).toBe(false);
  });

  it('a missing axisMap leaves every role unbound', () => {
    expect(sanitizeGamepadConfig({ deadzone: 0.1 }).axisMap).toEqual(defaultGamepadConfig().axisMap);
    expect(sanitizeGamepadConfig({ axisMap: 'no' }).axisMap).toEqual(defaultGamepadConfig().axisMap);
  });

  it('round-trips a valid config through JSON', () => {
    const cfg = defaultGamepadConfig();
    cfg.deadzone = 0.12;
    cfg.cal.pitch = { min: -0.9, center: 0.02, max: 0.95, invert: true };
    expect(sanitizeGamepadConfig(JSON.parse(JSON.stringify(cfg)))).toEqual(cfg);
  });
});

describe('X-56 Rhino layout', () => {
  const rhino = (): GamepadConfig => ({ ...defaultGamepadConfig(), deadzone: 0, layout: 'X56' });

  it('reads the main stick, the throttle lever and the twist handle', () => {
    // Axis 0/1 are the stick, 3 is the long throttle lever and 6 the twist on the throttle grip.
    const s = sample(pad([0.5, -0.5, 0, 1, 0, 0, 0.25]), rhino());
    expect(s.roll).toBeCloseTo(0.5, 3);
    expect(s.pitch).toBeCloseTo(-0.5, 3);
    expect(s.throttleDirect).toBe(1);
    expect(s.yaw).toBeCloseTo(0.25, 3);
  });

  it('leaves the throttle at zero when the lever is at its low stop', () => {
    expect(sample(pad([0, 0, 0, -1, 0, 0, 0]), rhino()).throttleDirect).toBe(0);
    expect(sample(pad([0, 0, 0, 0, 0, 0, 0]), rhino()).throttleDirect).toBeCloseTo(0.5, 9);
  });

  it('is a named layout with a label and a hint, and any axis can still be rebound over it', () => {
    expect(STICK_LAYOUTS).toContain('X56');
    expect(STICK_LAYOUT_LABELS.X56).toMatch(/X-56/);
    expect(STICK_LAYOUT_HINTS.X56.length).toBeGreaterThan(0);
    // The twist handle is the pilot's to move: a hand binding overrides whatever the layout said.
    const rebound = bindAxis(rhino(), 'yaw', 5);
    expect(resolvedAxisMap(rebound, 'radio').yaw).toBe(5);
    expect(sample(pad([0, 0, 0, 0, 0, 1, 0]), rebound).yaw).toBeCloseTo(1, 3);
  });
});

describe('arming from a bound switch', () => {
  const withArm = (bind: ActionBind): GamepadConfig => ({ ...defaultGamepadConfig(), actions: { ...defaultActionBinds(), arm: bind } });

  it('reads a button binding as a press', () => {
    const s = sample(pad([0, 0, 0, 0, 0, 0, 0], [4]), withArm({ kind: 'button', index: 4, dir: 1, step: 1 }));
    expect(s.aux.arm).toBe(true);
    expect(s.armSwitch).toBe(false);
  });

  it('reads a two-position switch as a position, not a press', () => {
    const cfg = withArm({ kind: 'switch2', index: 6, dir: 1, step: 1 });
    const up = sample(pad([0, 0, 0, 0, 0, 0, 1]), cfg);
    expect(up.aux.arm).toBe(false);
    expect(up.hasArmSwitch).toBe(true);
    expect(up.armSwitch).toBe(true);
    const down = sample(pad([0, 0, 0, 0, 0, 0, 0]), cfg);
    expect(down.armSwitch).toBe(false);
  });

  it('a switch that happens to be high never also fires the press edge', () => {
    // Both paths would otherwise fire, and one arm input would toggle twice.
    const s = sample(pad([0, 0, 0, 0, 0, 0, 1]), withArm({ kind: 'switch2', index: 6, dir: 1, step: 1 }));
    expect(s.aux.arm).toBe(false);
  });
});

describe('detectPadInput', () => {
  const rest = { axes: [0, 0, 0, 0, 0, 0, 0], buttons: Array.from({ length: 8 }, () => ({ pressed: false, value: 0 })) };
  const withAxes = (v: readonly number[]) => ({ axes: v, buttons: rest.buttons });
  const pressed = (i: number) => ({ axes: rest.axes, buttons: rest.buttons.map((b, j) => ({ pressed: j === i, value: j === i ? 1 : 0 })) });

  it('finds the axis that moved furthest', () => {
    expect(detectPadInput(rest, withAxes([0, 0, 0, 0.9, 0, 0, 0]))).toEqual({ kind: 'axis', index: 3 });
  });

  it('returns nothing when nothing moved far enough', () => {
    expect(detectPadInput(rest, withAxes([0, 0.1, 0, 0, 0, 0, 0]))).toBeNull();
    expect(detectPadInput(rest, rest)).toBeNull();
  });

  it('finds a button press, including one the pad reports only through value', () => {
    expect(detectPadInput(rest, pressed(4))).toEqual({ kind: 'button', index: 4 });
    const analogue = { axes: rest.axes, buttons: rest.buttons.map((b, j) => ({ pressed: false, value: j === 2 ? 0.8 : 0 })) };
    expect(detectPadInput(rest, analogue)).toEqual({ kind: 'button', index: 2 });
  });

  it('prefers a button press over an axis drifting at the same time', () => {
    expect(detectPadInput(rest, { axes: [0, 0, 0, 0, 0.9, 0, 0], buttons: pressed(1).buttons })).toEqual({ kind: 'button', index: 1 });
  });

  it('ignores a button that was already held when listening began', () => {
    expect(detectPadInput(pressed(1), pressed(1))).toBeNull();
  });

  it('honours a custom threshold', () => {
    expect(detectPadInput(rest, withAxes([0, 0, 0, 0.1, 0, 0, 0]), 0.05)).toEqual({ kind: 'axis', index: 3 });
  });
});
