import { describe, expect, it } from 'vitest';
import { DEFAULT_BINDINGS } from './bindings';
import { keyEvent, makeRig } from './testKit';

describe('InputManager keyboard', () => {
  it('D held gives yaw > 0 (nose right) and releasing returns it to zero', () => {
    const r = makeRig();
    r.press('KeyD');
    expect(r.run(0.3).yaw).toBe(1);
    r.release('KeyD');
    expect(r.run(0.3).yaw).toBe(0);
  });

  it('A is yaw < 0; right arrow and E are roll > 0; up arrow is pitch < 0 (nose up)', () => {
    const r = makeRig();
    r.press('KeyA');
    expect(r.run(0.3).yaw).toBe(-1);
    r.release('KeyA');
    r.press('ArrowRight');
    expect(r.run(0.3).roll).toBe(1);
    r.release('ArrowRight');
    r.press('KeyQ');
    expect(r.run(0.3).roll).toBe(-1);
    r.release('KeyQ');
    r.press('ArrowUp');
    expect(r.run(0.3).pitch).toBe(-1);
    r.release('ArrowUp');
    r.press('ArrowDown');
    expect(r.run(0.3).pitch).toBe(1);
  });

  it('keeps an axis while either of its two keys is still down', () => {
    const r = makeRig();
    r.press('KeyE');
    r.press('ArrowRight');
    r.release('KeyE');
    expect(r.run(0.3).roll).toBe(1);
  });

  it('throttle is a latched stick: W ramps, releasing leaves it, S lowers, X cuts', () => {
    const r = makeRig();
    r.press('KeyW');
    const held = r.run(0.5).throttle;
    expect(held).toBeCloseTo(0.45, 1);
    r.release('KeyW');
    expect(r.run(2).throttle).toBeCloseTo(held, 6);
    r.press('KeyS');
    expect(r.run(0.1).throttle).toBeLessThan(held);
    r.release('KeyS');
    r.press('KeyX');
    expect(r.run(0.05).throttle).toBe(0);
  });

  it('setThrottle overwrites the latch and clamps', () => {
    const r = makeRig();
    r.input.setThrottle(0.3);
    expect(r.run(0.1).throttle).toBe(0.3);
    r.input.setThrottle(4);
    expect(r.run(0.1).throttle).toBe(1);
  });

  it('turtle is a held state and follows the T key', () => {
    const r = makeRig();
    expect(r.run(0.05).turtle).toBe(false);
    r.press('KeyT');
    expect(r.run(0.05).turtle).toBe(true);
    r.release('KeyT');
    expect(r.run(0.05).turtle).toBe(false);
  });

  it('reflects the latched arm state and the flight mode from settings', () => {
    const r = makeRig({ mode: 'horizon' });
    expect(r.run(0.05).armed).toBe(false);
    r.input.setArmed(true);
    const s = r.run(0.05);
    expect(s.armed).toBe(true);
    expect(s.mode).toBe('horizon');
  });

  it('losing window focus releases held keys and sticks but keeps the throttle', () => {
    const r = makeRig();
    r.press('KeyD');
    r.press('KeyW');
    r.run(0.5);
    r.win.dispatchEvent(new Event('blur'));
    const s = r.run(0.3);
    expect(s.yaw).toBe(0);
    expect(s.throttle).toBeGreaterThan(0.4);
  });

  it('a stalled frame does not slam the throttle', () => {
    const r = makeRig();
    r.press('KeyW');
    r.input.poll(5);
    expect(r.input.poll(0).throttle).toBeLessThanOrEqual(0.1);
  });
});

describe('InputManager actions', () => {
  it('emits each bound key as one edge event and clears after taking', () => {
    const r = makeRig();
    const codes = ['Space', 'KeyR', 'Backspace', 'KeyN', 'KeyC', 'Escape', 'F1', 'F3', 'KeyP'];
    for (const c of codes) r.press(c);
    r.clock.t += 500;
    expect([...r.input.takeActions()]).toEqual(['arm-toggle', 'respawn', 'reset-track', 'new-track', 'camera-cycle', 'toggle-menu', 'toggle-help', 'toggle-perf', 'pause']);
    expect(r.input.takeActions().length).toBe(0);
  });

  it('ignores key auto-repeat except for the time-of-day keys', () => {
    const r = makeRig();
    r.press('Space');
    r.press('Space', { repeat: true });
    r.press('Period');
    r.press('Period', { repeat: true });
    r.press('Comma', { repeat: true });
    expect([...r.input.takeActions()]).toEqual(['arm-toggle', 'time-forward', 'time-forward', 'time-back']);
  });

  it('cycles the flight mode in settings: acro, angle, horizon, acro', () => {
    const r = makeRig();
    const seen: string[] = [];
    for (let i = 0; i < 4; i++) {
      r.press('KeyV');
      seen.push(r.settings.get().mode);
    }
    expect(seen).toEqual(['angle', 'horizon', 'acro', 'angle']);
    expect(r.input.takeActions().every((a) => a === 'mode-cycle')).toBe(true);
  });

  it('suppresses browser defaults for bound keys only', () => {
    const r = makeRig();
    for (const c of ['Space', 'ArrowUp', 'ArrowLeft', 'Tab', 'KeyW', 'F1']) expect(r.press(c).defaultPrevented, c).toBe(true);
    expect(r.press('KeyL').defaultPrevented).toBe(false);
    expect(r.press('F5').defaultPrevented).toBe(false);
  });

  it('leaves browser shortcuts with Ctrl, Alt or Meta alone', () => {
    const r = makeRig();
    const e = r.press('KeyR', { ctrlKey: true });
    expect(e.defaultPrevented).toBe(false);
    r.press('KeyD', { altKey: true });
    r.press('KeyW', { metaKey: true });
    expect(r.input.takeActions().length).toBe(0);
    expect(r.run(0.3)).toMatchObject({ yaw: 0, throttle: 0 });
  });

  it('ignores game keys while a text field has focus but still honours Esc', () => {
    const r = makeRig();
    const inField = (code: string): Event => {
      const e = keyEvent('keydown', code);
      Object.defineProperty(e, 'target', { value: { tagName: 'INPUT' } });
      r.win.dispatchEvent(e);
      return e;
    };
    expect(inField('Space').defaultPrevented).toBe(false);
    inField('KeyW');
    inField('Escape');
    expect([...r.input.takeActions()]).toEqual(['toggle-menu']);
    expect(r.run(0.3).throttle).toBe(0);
  });

  it('caps the action queue instead of growing without bound', () => {
    const r = makeRig();
    for (let i = 0; i < 200; i++) r.press('Period');
    expect(r.input.takeActions().length).toBeLessThanOrEqual(32);
  });

  it('honours rebound keys and stops honouring the old ones', () => {
    const r = makeRig();
    r.input.setBindings({ actions: { ...DEFAULT_BINDINGS.actions, 'arm-toggle': ['KeyG'] }, axes: { ...DEFAULT_BINDINGS.axes, yawRight: ['KeyL'] } });
    r.press('KeyG');
    r.press('Space');
    expect([...r.input.takeActions()]).toEqual(['arm-toggle']);
    r.press('KeyL');
    expect(r.run(0.3).yaw).toBe(1);
  });
});
