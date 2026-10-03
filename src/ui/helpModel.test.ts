import { describe, expect, it } from 'vitest';
import { ACTION_LABELS, AXIS_LABELS, DEFAULT_BINDINGS, type Bindings } from '../input/bindings';
import { KeyboardStick } from '../input/keyboardStick';
import { MouseStick } from '../input/mouseStick';
import { PAD_ACTION_INFO } from '../input/padActions';
import { buildHelp, keyCaps, startSummary } from './helpModel';

const labels = (sections: ReturnType<typeof buildHelp>): string[] => sections.flatMap((s) => s.rows.map((r) => r.label));

describe('help model', () => {
  it('lists every action and every keyboard axis of the bindings exactly once', () => {
    const all = labels(buildHelp().filter((s) => s.title !== 'Gamepad or radio'));
    for (const label of Object.values(ACTION_LABELS)) expect(all.filter((l) => l === label), label).toHaveLength(1);
    for (const label of Object.values(AXIS_LABELS)) expect(all.filter((l) => l === label), label).toHaveLength(1);
  });

  it('shows the bound keys of each row', () => {
    const rows = buildHelp().flatMap((s) => s.rows);
    expect(rows.find((r) => r.label === ACTION_LABELS['arm-toggle'])?.keys).toEqual(['Space']);
    expect(rows.find((r) => r.label === ACTION_LABELS['toggle-help'])?.keys).toEqual(['F1']);
    expect(rows.find((r) => r.label === AXIS_LABELS.rollLeft)?.keys).toEqual(['Q', 'Left']);
  });

  it('follows a rebinding', () => {
    const custom: Bindings = { ...DEFAULT_BINDINGS, actions: { ...DEFAULT_BINDINGS.actions, respawn: ['KeyG'] } };
    const rows = buildHelp(custom).flatMap((s) => s.rows);
    expect(rows.find((r) => r.label === ACTION_LABELS.respawn)?.keys).toEqual(['G']);
  });

  it('marks an unbound action with no keys instead of dropping it', () => {
    const custom: Bindings = { ...DEFAULT_BINDINGS, actions: { ...DEFAULT_BINDINGS.actions, pause: [] } };
    const row = buildHelp(custom).flatMap((s) => s.rows).find((r) => r.label === ACTION_LABELS.pause);
    expect(row?.keys).toEqual([]);
  });

  it('merges the two Shift keys into one cap', () => {
    expect(keyCaps(['ShiftLeft', 'ShiftRight'])).toEqual(['Shift']);
    expect(keyCaps(['KeyW'])).toEqual(['W']);
    expect(keyCaps([])).toEqual([]);
  });

  it('describes the gamepad buttons of the default layout', () => {
    const pad = buildHelp().find((s) => s.title === 'Gamepad or radio');
    expect(pad?.rows.find((r) => r.label === PAD_ACTION_INFO.arm.label)?.keys).toEqual(['A']);
    expect(pad?.rows.find((r) => r.label === PAD_ACTION_INFO.menu.label)?.keys).toEqual(['Start']);
    // The four actions that were keyboard-only before the table existed stay off the pad sheet.
    expect(pad?.rows.some((r) => r.label === PAD_ACTION_INFO.resetTrack.label)).toBe(false);
  });

  it('names a switch by its axis, and an unfamiliar button by its number', () => {
    const pad = buildHelp().find((s) => s.title === 'Gamepad or radio');
    // The X-56 default layout leaves the hat and the slider free, so nothing is listed twice.
    const labels = pad?.rows.map((r) => r.label) ?? [];
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('gives every section a title and rows with labels', () => {
    for (const s of buildHelp()) {
      expect(s.title.length).toBeGreaterThan(0);
      expect(s.rows.length).toBeGreaterThan(0);
      for (const r of s.rows) expect(r.label.length).toBeGreaterThan(0);
    }
  });
});

describe('help text matches the input layer', () => {
  const mouseRow = (): string => buildHelp().find((s) => s.title === 'Mouse')?.rows.find((r) => r.keys[0] === 'Move')?.label ?? '';

  it('mouse right rolls right and mouse up pitches the nose up, as the sheet says', () => {
    const mouse = new MouseStick();
    mouse.addPixels(80, 0);
    mouse.update(0.01, 0, 1, false);
    expect(mouse.x).toBeGreaterThan(0);
    mouse.reset();
    mouse.addPixels(0, -80);
    mouse.update(0.01, 0, 1, false);
    // StickInput: pitch > 0 is nose down, so mouse up is a negative pitch stick.
    expect(mouse.y).toBeLessThan(0);
    expect(mouseRow()).toMatch(/roll and pitch/i);
    expect(mouseRow()).toMatch(/mouse up is nose up/i);
  });

  it('D yaws right, A left, the up arrow pitches up and Q rolls left, as the key rows say', () => {
    const k = new KeyboardStick();
    const axes = { throttleUp: false, throttleDown: false, throttleCut: false, boost: false, yawLeft: false, yawRight: true, rollLeft: false, rollRight: false, pitchUp: true, pitchDown: false };
    k.update(1, axes);
    expect(k.yaw).toBeGreaterThan(0);
    expect(k.pitch).toBeLessThan(0);
    k.update(1, { ...axes, yawRight: false, yawLeft: true, pitchUp: false, rollLeft: true });
    expect(k.yaw).toBeLessThan(0);
    expect(k.roll).toBeLessThan(0);
    expect(DEFAULT_BINDINGS.axes.yawRight).toEqual(['KeyD']);
    expect(DEFAULT_BINDINGS.axes.yawLeft).toEqual(['KeyA']);
    expect(DEFAULT_BINDINGS.axes.pitchUp).toEqual(['ArrowUp']);
    expect(DEFAULT_BINDINGS.axes.rollLeft).toContain('KeyQ');
  });

  it('explains the race start and the stick indicator', () => {
    const rows = buildHelp().find((s) => s.title === 'On screen')?.rows ?? [];
    expect(rows.map((r) => r.keys[0])).toEqual(['3 2 1', 'Boxes']);
  });
});

describe('start summary', () => {
  it('shows the essential keys from the bindings', () => {
    const rows = startSummary();
    expect(rows.find((r) => r.label === 'Arm and disarm')?.keys).toEqual(['Space']);
    expect(rows.find((r) => r.label === 'Throttle up and down')?.keys).toEqual(['W', 'S']);
    expect(rows.find((r) => r.label === 'Yaw')?.keys).toEqual(['A', 'D']);
    expect(rows.find((r) => r.label === 'Pause and settings')?.keys).toEqual(['Esc']);
  });

  it('follows a rebinding', () => {
    const custom: Bindings = { ...DEFAULT_BINDINGS, actions: { ...DEFAULT_BINDINGS.actions, 'camera-cycle': ['KeyB'] } };
    expect(startSummary(custom).find((r) => r.label === 'Change camera')?.keys).toEqual(['B']);
  });
});
