import { describe, expect, it } from 'vitest';
import type { PadButton, PadLike } from './gamepadMap';
import {
  BIND_KIND_LABELS, PAD_ACTIONS, PAD_ACTION_INFO, SWITCH_ON_THRESHOLD, bindOn, defaultActionBinds, describeBind,
  flipBind, nextStep, sanitizeActionBinds, unboundBind,
} from './padActions';

function pad(axes: readonly number[] = [], pressed: readonly number[] = []): PadLike {
  const n = pressed.length === 0 ? 1 : Math.max(...pressed) + 1;
  const buttons: PadButton[] = Array.from({ length: n }, (_, i) => ({ pressed: pressed.includes(i), value: pressed.includes(i) ? 1 : 0 }));
  return { axes, buttons };
}

const button = (index: number) => ({ kind: 'button', index, dir: 1, step: 1 }) as const;
const switch2 = (index: number, dir: 1 | -1 = 1) => ({ kind: 'switch2', index, dir, step: 1 }) as const;
const switch3 = (index: number, step: 0 | 1 | 2) => ({ kind: 'switch3', index, dir: 1, step }) as const;

describe('default action bindings', () => {
  it('keeps the button numbers the sim has always used', () => {
    const d = defaultActionBinds();
    expect(d.arm).toEqual(button(0));
    expect(d.turtle).toEqual(button(1));
    expect(d.camera).toEqual(button(2));
    expect(d.respawn).toEqual(button(3));
    expect(d.modeCycle).toEqual(button(4));
    expect(d.menu).toEqual(button(9));
  });

  it('leaves the newly bindable actions unbound so no key is stolen', () => {
    const d = defaultActionBinds();
    for (const action of ['resetTrack', 'newTrack', 'help', 'perf'] as const) expect(d[action].kind).toBe('none');
  });

  it('has a label, a hint and a key for every action', () => {
    for (const action of PAD_ACTIONS) {
      expect(PAD_ACTION_INFO[action].label.length).toBeGreaterThan(0);
      expect(PAD_ACTION_INFO[action].hint.length).toBeGreaterThan(0);
      expect(BIND_KIND_LABELS[defaultActionBinds()[action].kind].length).toBeGreaterThan(0);
    }
  });

  it('hands out fresh objects so editing one never reaches the defaults', () => {
    const d = defaultActionBinds();
    d.arm.index = 9;
    expect(defaultActionBinds().arm.index).toBe(0);
    expect(unboundBind()).not.toBe(d.arm);
  });
});

describe('bindOn', () => {
  it('reads a button press', () => {
    expect(bindOn(pad([], [3]), button(3))).toBe(true);
    expect(bindOn(pad([], []), button(3))).toBe(false);
  });

  it('reads a two-position switch from either end of its travel', () => {
    expect(bindOn(pad([0]), switch2(0, 1))).toBe(false);
    expect(bindOn(pad([1]), switch2(0, 1))).toBe(true);
    expect(bindOn(pad([-1]), switch2(0, -1))).toBe(true);
    expect(bindOn(pad([1]), switch2(0, -1))).toBe(false);
  });

  it('ignores a switch that has not travelled past the threshold', () => {
    expect(bindOn(pad([SWITCH_ON_THRESHOLD - 0.01]), switch2(0))).toBe(false);
    expect(bindOn(pad([SWITCH_ON_THRESHOLD + 0.01]), switch2(0))).toBe(true);
  });

  it('reads the detent a three-position switch is in', () => {
    expect(bindOn(pad([-1]), switch3(0, 0))).toBe(true);
    expect(bindOn(pad([0]), switch3(0, 1))).toBe(true);
    expect(bindOn(pad([1]), switch3(0, 2))).toBe(true);
    // The same axis position is a different action depending on which detent was chosen.
    expect(bindOn(pad([0]), switch3(0, 0))).toBe(false);
    expect(bindOn(pad([-1]), switch3(0, 2))).toBe(false);
  });

  it('is off for an unbound action and for an index the pad does not have', () => {
    expect(bindOn(pad([1, 1, 1]), unboundBind())).toBe(false);
    expect(bindOn(pad([1]), button(9))).toBe(false);
    expect(bindOn(pad([]), switch2(4))).toBe(false);
    expect(bindOn(pad([Number.NaN]), switch2(0))).toBe(false);
    expect(bindOn(pad([1]), { ...switch2(0), index: -1 })).toBe(false);
  });
});

describe('bind helpers', () => {
  it('flips which end of a two-position switch is on, and leaves other kinds alone', () => {
    expect(flipBind(switch2(3, 1)).dir).toBe(-1);
    expect(flipBind(switch2(3, -1)).dir).toBe(1);
    expect(flipBind(button(3))).toEqual(button(3));
  });

  it('cycles a three-position switch through its detents and wraps', () => {
    expect(nextStep(switch3(0, 0)).step).toBe(1);
    expect(nextStep(switch3(0, 1)).step).toBe(2);
    expect(nextStep(switch3(0, 2)).step).toBe(0);
    expect(nextStep(switch2(0)).step).toBe(1);
  });

  it('never mutates the binding it was given', () => {
    const b = switch2(3, 1);
    flipBind(b);
    nextStep(b);
    expect(b).toEqual(switch2(3, 1));
  });

  it('describes a binding the way the settings screen shows it, 1-based', () => {
    expect(describeBind(unboundBind())).toBe('not set');
    expect(describeBind(button(0))).toBe('Button 1');
    expect(describeBind(switch2(2, 1))).toBe('Axis 3, high end');
    expect(describeBind(switch2(2, -1))).toBe('Axis 3, low end');
    expect(describeBind(switch3(4, 1))).toBe('Axis 5, middle detent');
  });
});

describe('sanitizeActionBinds', () => {
  const base = defaultActionBinds();

  it('keeps a valid table unchanged', () => {
    const raw = { arm: { kind: 'switch2', index: 4, dir: -1, step: 1 }, turtle: { kind: 'button', index: 0, dir: 1, step: 1 } };
    expect(sanitizeActionBinds(raw)).toEqual({ ...base, arm: switch2(4, -1), turtle: button(0) });
  });

  it('falls back per field to the default when a field is the wrong type', () => {
    const out = sanitizeActionBinds({ arm: { kind: 'switch2', index: 4, dir: 'up', step: 9 } });
    expect(out.arm).toEqual({ kind: 'switch2', index: 4, dir: 1, step: 1 });
  });

  it('rejects an unknown kind and an out-of-range index', () => {
    expect(sanitizeActionBinds({ arm: { kind: 'lever', index: 0 } }).arm.kind).toBe('button');
    expect(sanitizeActionBinds({ arm: { kind: 'button', index: 1e9 } }).arm.index).toBe(63);
    // A nonsense index clamps to -1 rather than being guessed at, and reads as off.
    const stray = sanitizeActionBinds({ arm: { kind: 'button', index: -5 } }).arm;
    expect(stray.index).toBe(-1);
    expect(bindOn(pad([1, 1, 1, 1, 1]), stray)).toBe(false);
  });

  it('clamps the direction and the detent to real values', () => {
    expect(sanitizeActionBinds({ arm: { kind: 'switch2', index: 1, dir: 7, step: 0 } }).arm).toEqual({ kind: 'switch2', index: 1, dir: 1, step: 0 });
    expect(sanitizeActionBinds({ arm: { kind: 'switch2', index: 1, dir: 0, step: 5 } }).arm).toEqual(switch2(1, 1));
    expect(sanitizeActionBinds({ arm: { kind: 'switch3', index: 1, step: 0 } }).arm.step).toBe(0);
    expect(sanitizeActionBinds({ arm: { kind: 'switch3', index: 1, step: 2 } }).arm.step).toBe(2);
    expect(sanitizeActionBinds({ arm: { kind: 'switch3', index: 1, step: 7 } }).arm.step).toBe(1);
  });

  it('clears the index when the kind is unbound so nothing is left half-bound', () => {
    expect(sanitizeActionBinds({ arm: { kind: 'none', index: 4 } }).arm).toEqual(unboundBind());
  });

  it('ignores junk entirely and returns the defaults', () => {
    for (const raw of [null, 'nope', 7, []]) expect(sanitizeActionBinds(raw)).toEqual(base);
  });
});
