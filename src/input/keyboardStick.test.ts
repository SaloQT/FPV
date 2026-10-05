import { describe, expect, it } from 'vitest';
import { BOOST_FACTOR, KeyboardStick, RAMP_DOWN_S, RAMP_UP_S, YAW_RAMP_UP_S, THROTTLE_DOWN_RATE, THROTTLE_UP_RATE, type KeyboardAxes } from './keyboardStick';

const keys = (down: Partial<KeyboardAxes> = {}): KeyboardAxes => ({
  throttleUp: false, throttleDown: false, throttleCut: false, boost: false,
  yawLeft: false, yawRight: false, rollLeft: false, rollRight: false, pitchUp: false, pitchDown: false,
  ...down,
});

function run(k: KeyboardStick, axes: KeyboardAxes, seconds: number, dt = 1 / 1200): void {
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) k.update(dt, axes);
}

describe('KeyboardStick signs', () => {
  it('D is yaw > 0 (nose right) and A is yaw < 0', () => {
    const k = new KeyboardStick();
    run(k, keys({ yawRight: true }), YAW_RAMP_UP_S);
    expect(k.yaw).toBeCloseTo(1, 9);
    run(k, keys({ yawLeft: true }), 0.5);
    expect(k.yaw).toBeCloseTo(-1, 9);
  });

  it('roll right is roll > 0, roll left < 0', () => {
    const k = new KeyboardStick();
    run(k, keys({ rollRight: true }), 0.2);
    expect(k.roll).toBe(1);
    run(k, keys({ rollLeft: true }), 0.5);
    expect(k.roll).toBe(-1);
  });

  it('pitch up (nose up) is pitch < 0 and pitch down is pitch > 0', () => {
    const k = new KeyboardStick();
    run(k, keys({ pitchUp: true }), 0.2);
    expect(k.pitch).toBe(-1);
    run(k, keys({ pitchDown: true }), 0.5);
    expect(k.pitch).toBe(1);
  });

  it('opposing keys cancel', () => {
    const k = new KeyboardStick();
    run(k, keys({ yawLeft: true, yawRight: true }), 0.3);
    expect(k.yaw).toBe(0);
  });
});

describe('KeyboardStick ramps', () => {
  it('reaches full deflection in RAMP_UP_S and not before', () => {
    const k = new KeyboardStick();
    run(k, keys({ rollRight: true }), RAMP_UP_S / 2);
    expect(k.roll).toBeCloseTo(0.5, 6);
    run(k, keys({ rollRight: true }), RAMP_UP_S);
    expect(k.roll).toBe(1);
  });

  it('returns to centre in RAMP_DOWN_S after release', () => {
    const k = new KeyboardStick();
    run(k, keys({ pitchDown: true }), 0.5);
    run(k, keys(), RAMP_DOWN_S / 2);
    expect(k.pitch).toBeCloseTo(0.5, 6);
    run(k, keys(), RAMP_DOWN_S);
    expect(k.pitch).toBe(0);
  });

  it('crosses centre using the attack rate when reversing', () => {
    const k = new KeyboardStick();
    run(k, keys({ yawLeft: true }), 0.5);
    run(k, keys({ yawRight: true }), YAW_RAMP_UP_S);
    expect(k.yaw).toBeCloseTo(0, 6);
  });

  it('ramp time does not depend on the frame rate', () => {
    const a = new KeyboardStick();
    const b = new KeyboardStick();
    run(a, keys({ rollRight: true }), 0.1, 1 / 60);
    run(b, keys({ rollRight: true }), 0.1, 1 / 480);
    expect(a.roll).toBeCloseTo(b.roll, 6);
  });
});

describe('KeyboardStick throttle release', () => {
  it('ramps up while held and eases down after release', () => {
    const k = new KeyboardStick();
    run(k, keys({ throttleUp: true }), 0.5);
    expect(k.throttle).toBeCloseTo(THROTTLE_UP_RATE * 0.5, 6);
    const left = k.throttle;
    run(k, keys(), 2);
    expect(k.throttle).toBeLessThan(left);
    expect(k.throttle).toBeGreaterThan(0.05);
  });

  it('drops high thrust faster, with a gentler proportional tail at low thrust', () => {
    const high = new KeyboardStick(), low = new KeyboardStick();
    high.throttle = 1;
    low.throttle = 0.2;
    run(high, keys(), 0.5);
    run(low, keys(), 0.5);
    expect(1 - high.throttle).toBeGreaterThan(3 * (0.2 - low.throttle));
    expect(high.throttle).toBeGreaterThan(0.4);
    expect(high.throttle).toBeLessThan(0.6);
    expect(low.throttle).toBeGreaterThan(0.14);
    expect(low.throttle).toBeLessThan(0.2);
    expect(high.throttle).toBeLessThan(low.throttle / 0.2);
  });

  it('has the same release curve at 30 Hz and 240 Hz and settles to zero without undershooting', () => {
    const a = new KeyboardStick(), b = new KeyboardStick();
    a.throttle = b.throttle = 0.8;
    run(a, keys(), 1, 1 / 30);
    run(b, keys(), 1, 1 / 240);
    expect(a.throttle).toBeCloseTo(b.throttle, 9);
    run(a, keys(), 30, 1 / 30);
    expect(a.throttle).toBe(0);
  });

  it('does not decay gamepad-owned throttle', () => {
    const k = new KeyboardStick();
    k.throttle = 0.6;
    for (let i = 0; i < 300; i++) k.update(1 / 60, keys(), false);
    expect(k.throttle).toBe(0.6);
  });

  it('only releases when both throttle keys are up', () => {
    const k = new KeyboardStick();
    k.throttle = 0.6;
    k.update(0.1, keys({ throttleUp: true, throttleDown: true }));
    expect(k.throttle).toBeCloseTo(0.6 + 0.09 - 0.14, 9);
  });

  it('ramps down faster than up and clamps at zero', () => {
    const k = new KeyboardStick();
    run(k, keys({ throttleUp: true }), 1);
    const before = k.throttle;
    run(k, keys({ throttleDown: true }), 0.25);
    expect(k.throttle).toBeCloseTo(before - THROTTLE_DOWN_RATE * 0.25, 6);
    run(k, keys({ throttleDown: true }), 2);
    expect(k.throttle).toBe(0);
  });

  it('clamps at full throttle', () => {
    const k = new KeyboardStick();
    run(k, keys({ throttleUp: true }), 5);
    expect(k.throttle).toBe(1);
  });

  it('shift boosts the ramp rate', () => {
    const k = new KeyboardStick();
    run(k, keys({ throttleUp: true, boost: true }), 0.2);
    expect(k.throttle).toBeCloseTo(THROTTLE_UP_RATE * BOOST_FACTOR * 0.2, 6);
  });

  it('cut zeroes it instantly, even while W is held', () => {
    const k = new KeyboardStick();
    run(k, keys({ throttleUp: true }), 1);
    k.update(1 / 240, keys({ throttleUp: true, throttleCut: true }));
    expect(k.throttle).toBe(0);
  });

  it('releasing the sticks (focus loss) leaves the throttle alone', () => {
    const k = new KeyboardStick();
    run(k, keys({ throttleUp: true, rollRight: true, yawLeft: true }), 0.5);
    k.releaseSticks();
    expect([k.roll, k.pitch, k.yaw]).toEqual([0, 0, 0]);
    expect(k.throttle).toBeGreaterThan(0.4);
  });
});
