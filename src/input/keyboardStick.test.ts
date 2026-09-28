import { describe, expect, it } from 'vitest';
import { BOOST_FACTOR, KeyboardStick, RAMP_DOWN_S, RAMP_UP_S, THROTTLE_DOWN_RATE, THROTTLE_UP_RATE, type KeyboardAxes } from './keyboardStick';

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
    run(k, keys({ yawRight: true }), 0.2);
    expect(k.yaw).toBe(1);
    run(k, keys({ yawLeft: true }), 0.5);
    expect(k.yaw).toBe(-1);
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
    run(k, keys({ yawRight: true }), RAMP_UP_S);
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

describe('KeyboardStick throttle latch', () => {
  it('ramps up at THROTTLE_UP_RATE and stays where it was left', () => {
    const k = new KeyboardStick();
    run(k, keys({ throttleUp: true }), 0.5);
    expect(k.throttle).toBeCloseTo(THROTTLE_UP_RATE * 0.5, 6);
    const left = k.throttle;
    run(k, keys(), 2);
    expect(k.throttle).toBe(left);
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
