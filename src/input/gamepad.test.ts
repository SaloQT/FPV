import { describe, expect, it } from 'vitest';
import { ACTIVITY_WINDOW_MS, GamepadInput } from './gamepad';
import { defaultGamepadConfig, type PadLike } from './gamepadMap';

function radio(axes: number[], pressed: number[] = []): PadLike {
  return { axes, buttons: Array.from({ length: 16 }, (_, i) => ({ pressed: pressed.includes(i), value: 0 })), mapping: '', id: 'test radio', connected: true };
}

function rig(): { input: GamepadInput; pads: (PadLike | null)[]; poll: (t: number) => void } {
  const pads: (PadLike | null)[] = [null];
  const input = new GamepadInput(() => pads);
  const cfg = defaultGamepadConfig();
  return { input, pads, poll: (t) => input.poll(cfg, t) };
}

describe('GamepadInput connection', () => {
  it('reports nothing without a pad and ignores mice that enumerate as gamepads', () => {
    const { input, pads, poll } = rig();
    poll(0);
    expect(input.connected).toBe(false);
    pads[0] = radio([0, 0]);
    poll(16);
    expect(input.connected).toBe(false);
    pads[0] = radio([0, 0, -1, 0]);
    poll(32);
    expect(input.connected).toBe(true);
    expect(input.padId).toBe('test radio');
    pads[0] = null;
    poll(48);
    expect(input.connected).toBe(false);
    expect(input.active).toBe(false);
  });
});

describe('GamepadInput activity', () => {
  it('is inactive for a still pad, active while sticks move, and expires after the window', () => {
    const { input, pads, poll } = rig();
    pads[0] = radio([0, 0, -1, 0]);
    poll(0);
    poll(16);
    expect(input.active).toBe(false);
    pads[0] = radio([0.6, 0, -1, 0]);
    poll(32);
    expect(input.active).toBe(true);
    pads[0] = radio([0, 0, -1, 0]);
    poll(48);
    poll(48 + ACTIVITY_WINDOW_MS - 100);
    expect(input.active).toBe(true);
    poll(48 + ACTIVITY_WINDOW_MS + 100);
    expect(input.active).toBe(false);
  });

  it('a stick held off-centre stays active', () => {
    const { input, pads, poll } = rig();
    pads[0] = radio([0.6, 0, -1, 0]);
    poll(0);
    poll(ACTIVITY_WINDOW_MS * 3);
    expect(input.active).toBe(true);
  });

  it('counts a raw axis change below the stick threshold as activity but not sensor noise', () => {
    const { input, pads, poll } = rig();
    pads[0] = radio([0, 0, -1, 0]);
    poll(0);
    pads[0] = radio([0.001, 0, -1, 0.002]);
    poll(16);
    expect(input.active).toBe(false);
    pads[0] = radio([0.001, 0, -0.9, 0.002]);
    poll(32);
    expect(input.active).toBe(true);
  });

  it('a spring-centred throttle held up keeps a latched pad active, but a direct-mode radio throttle does not by itself', () => {
    const standard = (axes: number[]): PadLike => ({ ...radio(axes), mapping: 'standard' });
    const latched = rig();
    latched.pads[0] = standard([0, -0.6, 0, 0]);
    latched.poll(0);
    latched.poll(ACTIVITY_WINDOW_MS * 3);
    expect(latched.input.sample.profile).toBe('standard');
    expect(latched.input.active).toBe(true);
    latched.pads[0] = standard([0, 0, 0, 0]);
    latched.poll(ACTIVITY_WINDOW_MS * 3 + 16);
    latched.poll(ACTIVITY_WINDOW_MS * 6);
    expect(latched.input.active).toBe(false);

    const direct = rig();
    direct.pads[0] = radio([0, 0, 0.6, 0]);
    direct.poll(0);
    direct.poll(ACTIVITY_WINDOW_MS * 3);
    expect(direct.input.active).toBe(false);
  });

  it('a button press counts as activity', () => {
    const { input, pads, poll } = rig();
    pads[0] = radio([0, 0, -1, 0]);
    poll(0);
    pads[0] = radio([0, 0, -1, 0], [5]);
    poll(16);
    expect(input.active).toBe(true);
  });
});

describe('GamepadInput edges', () => {
  it('fires once per press and not while held', () => {
    const { input, pads, poll } = rig();
    pads[0] = radio([0, 0, -1, 0]);
    poll(0);
    pads[0] = radio([0, 0, -1, 0], [0]);
    poll(16);
    expect(input.edges.arm).toBe(true);
    poll(32);
    expect(input.edges.arm).toBe(false);
    pads[0] = radio([0, 0, -1, 0]);
    poll(48);
    pads[0] = radio([0, 0, -1, 0], [0]);
    poll(64);
    expect(input.edges.arm).toBe(true);
  });

  it('reports each mapped button', () => {
    const { input, pads, poll } = rig();
    pads[0] = radio([0, 0, -1, 0]);
    poll(0);
    pads[0] = radio([0, 0, -1, 0], [2, 3, 4, 9]);
    poll(16);
    expect([input.edges.camera, input.edges.respawn, input.edges.modeCycle, input.edges.menu]).toEqual([true, true, true, true]);
  });

  it('a button already held when the pad appears does not fire', () => {
    const { input, pads, poll } = rig();
    pads[0] = radio([0, 0, -1, 0], [0, 9]);
    poll(0);
    expect(input.edges.arm).toBe(false);
    expect(input.edges.menu).toBe(false);
  });

  it('arm switch edges follow the level, and a switch left high at connect does not fire', () => {
    const { input, pads, poll } = rig();
    pads[0] = radio([0, 0, -1, 0, 1, -1]);
    poll(0);
    expect(input.edges.armSwitchOn).toBe(false);
    pads[0] = radio([0, 0, -1, 0, -1, -1]);
    poll(16);
    expect(input.edges.armSwitchOff).toBe(true);
    pads[0] = radio([0, 0, -1, 0, 1, -1]);
    poll(32);
    expect(input.edges.armSwitchOn).toBe(true);
    poll(48);
    expect(input.edges.armSwitchOn).toBe(false);
  });

  it('mode switch reports a change of position only', () => {
    const { input, pads, poll } = rig();
    pads[0] = radio([0, 0, -1, 0, -1, -1]);
    poll(0);
    poll(16);
    expect(input.edges.modeSwitchChanged).toBe(false);
    pads[0] = radio([0, 0, -1, 0, -1, 1]);
    poll(32);
    expect(input.edges.modeSwitchChanged).toBe(true);
    expect(input.sample.modeSwitch).toBe('horizon');
  });
});
