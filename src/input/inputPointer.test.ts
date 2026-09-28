import { describe, expect, it } from 'vitest';
import { moveEvent, makeRig, padWith } from './testKit';
import type { OrbitDelta } from './pointer';

describe('InputManager mouse', () => {
  it('a click on the canvas requests pointer lock and reports it', () => {
    const r = makeRig();
    expect(r.input.pointerLocked).toBe(false);
    r.lock();
    expect(r.canvas.lockRequests).toBe(1);
    expect(r.input.pointerLocked).toBe(true);
  });

  it('mouse right is roll > 0, mouse up is pitch < 0, mouse down is pitch > 0', () => {
    const r = makeRig();
    r.lock();
    r.doc.dispatchEvent(moveEvent(80, 0));
    expect(r.input.poll(1 / 240).roll).toBeGreaterThan(0.2);
    r.run(3);
    r.doc.dispatchEvent(moveEvent(0, -80));
    expect(r.input.poll(1 / 240).pitch).toBeLessThan(-0.2);
    r.run(3);
    r.doc.dispatchEvent(moveEvent(0, 80));
    expect(r.input.poll(1 / 240).pitch).toBeGreaterThan(0.2);
  });

  it('retries without unadjusted movement when it is refused, and swallows a refused retry', async () => {
    const r = makeRig();
    const calls: unknown[] = [];
    Object.assign(r.canvas, { requestPointerLock: (options?: unknown): Promise<void> => { calls.push(options); return Promise.reject(new Error('refused')); } });
    r.input.requestPointerLock();
    await new Promise((done) => setTimeout(done, 0));
    expect(calls).toEqual([{ unadjustedMovement: true }, undefined]);
    expect(r.input.pointerLocked).toBe(false);
  });

  it('invertY flips the pitch sign', () => {
    const r = makeRig({ invertY: true });
    r.lock();
    r.doc.dispatchEvent(moveEvent(0, -80));
    expect(r.input.poll(1 / 240).pitch).toBeGreaterThan(0.2);
  });

  it('ignores movement while the pointer is not locked', () => {
    const r = makeRig();
    r.doc.dispatchEvent(moveEvent(200, 200));
    const s = r.input.poll(1 / 60);
    expect([s.roll, s.pitch]).toEqual([0, 0]);
  });

  it('ignores the bogus first delta right after the lock is granted', () => {
    const r = makeRig();
    r.canvas.dispatchEvent(new Event('click'));
    r.doc.dispatchEvent(moveEvent(900, 900));
    const s = r.input.poll(1 / 240);
    expect([s.roll, s.pitch]).toEqual([0, 0]);
  });

  it('springs back to centre with mouseCentering and holds with mouseCentering 0', () => {
    const r = makeRig({ mouseCentering: 0.6 });
    r.lock();
    r.doc.dispatchEvent(moveEvent(150, 0));
    r.input.poll(1 / 240);
    expect(r.run(3).roll).toBeLessThan(0.01);
    const held = makeRig({ mouseCentering: 0 });
    held.lock();
    held.doc.dispatchEvent(moveEvent(150, 0));
    held.input.poll(1 / 240);
    expect(held.run(5).roll).toBeCloseTo(0.5, 6);
  });

  it('applies mouseExpo and mouseDeadzone to the mouse part only', () => {
    const r = makeRig({ mouseCentering: 0, mouseExpo: 1, mouseDeadzone: 0 });
    r.lock();
    r.doc.dispatchEvent(moveEvent(150, 0));
    expect(r.input.poll(1 / 240).roll).toBeCloseTo(0.125, 6);
    const dz = makeRig({ mouseCentering: 0, mouseDeadzone: 0.1 });
    dz.lock();
    dz.doc.dispatchEvent(moveEvent(15, 0));
    expect(dz.input.poll(1 / 240).roll).toBe(0);
  });

  it('adds keyboard deflection on top of the mouse and clamps', () => {
    const r = makeRig({ mouseCentering: 0 });
    r.lock();
    r.doc.dispatchEvent(moveEvent(210, 0));
    r.press('KeyE');
    expect(r.run(0.3).roll).toBe(1);
  });

  it('counts a motion once when both pointerrawupdate and mousemove report it', () => {
    const r = makeRig({ mouseCentering: 0 });
    r.lock();
    r.doc.dispatchEvent(moveEvent(30, 0, 0, 'pointerrawupdate'));
    r.doc.dispatchEvent(moveEvent(30, 0, 0, 'mousemove'));
    expect(r.input.poll(1 / 240).roll).toBeCloseTo(0.1, 9);
  });

  it('falls back to mousemove when pointerrawupdate never fires', () => {
    const r = makeRig({ mouseCentering: 0 });
    r.lock();
    r.doc.dispatchEvent(moveEvent(30, 0));
    expect(r.input.poll(1 / 240).roll).toBeCloseTo(0.1, 9);
  });
});

describe('InputManager pointer lock loss', () => {
  it('a lock lost without our request (Esc) emits toggle-menu once, even if the Esc key also arrives', () => {
    const r = makeRig();
    r.lock();
    r.doc.pointerLockElement = null;
    r.doc.dispatchEvent(new Event('pointerlockchange'));
    r.press('Escape');
    expect(r.input.pointerLocked).toBe(false);
    expect([...r.input.takeActions()]).toEqual(['toggle-menu']);
  });

  it('a lock we released ourselves does not emit anything', () => {
    const r = makeRig();
    r.lock();
    r.input.setEnabled(false);
    expect(r.doc.exitCalls).toBe(1);
    expect(r.input.pointerLocked).toBe(false);
    expect(r.input.takeActions().length).toBe(0);
  });

  it('centres the mouse stick when the lock is lost so it cannot stay deflected', () => {
    const r = makeRig({ mouseCentering: 0 });
    r.lock();
    r.doc.dispatchEvent(moveEvent(150, 0));
    r.input.poll(1 / 240);
    r.doc.pointerLockElement = null;
    r.doc.dispatchEvent(new Event('pointerlockchange'));
    expect(r.input.poll(1 / 240).roll).toBe(0);
  });
});

describe('InputManager disabled (menu open)', () => {
  it('reads zero sticks, keeps the throttle, does not swallow keys and only fires UI actions', () => {
    const r = makeRig();
    r.input.setThrottle(0.4);
    r.input.setEnabled(false);
    expect(r.press('ArrowLeft').defaultPrevented).toBe(false);
    r.press('KeyD');
    r.press('Space');
    r.press('F1');
    expect(r.run(0.3)).toMatchObject({ roll: 0, pitch: 0, yaw: 0, throttle: 0.4, turtle: false });
    expect([...r.input.takeActions()]).toEqual(['toggle-help']);
    r.input.setEnabled(true);
    expect(r.run(0.3).yaw).toBe(0);
    r.press('KeyD');
    expect(r.run(0.3).yaw).toBe(1);
  });
});

describe('InputManager free-camera orbit', () => {
  const take = (r: ReturnType<typeof makeRig>): OrbitDelta => {
    const o: OrbitDelta = { dx: 0, dy: 0, wheel: 0 };
    r.input.takeOrbit(o);
    return o;
  };

  it('accumulates drag while unlocked, and the wheel in pixel-equivalents', () => {
    const r = makeRig();
    r.doc.dispatchEvent(moveEvent(10, -4, 1));
    r.doc.dispatchEvent(moveEvent(5, 2, 1));
    r.doc.dispatchEvent(moveEvent(50, 50, 0));
    r.canvas.dispatchEvent(Object.assign(new Event('wheel'), { deltaY: 100, deltaMode: 0 }));
    r.canvas.dispatchEvent(Object.assign(new Event('wheel'), { deltaY: 3, deltaMode: 1 }));
    const o = take(r);
    expect([o.dx, o.dy]).toEqual([15, -2]);
    expect(o.wheel).toBe(100 + 3 * 33);
    expect(take(r)).toEqual({ dx: 0, dy: 0, wheel: 0 });
  });

  it('a drag does not grab the mouse on release, a plain click does', () => {
    const r = makeRig();
    r.canvas.dispatchEvent(new Event('mousedown'));
    r.doc.dispatchEvent(moveEvent(40, 0, 1));
    r.canvas.dispatchEvent(new Event('click'));
    expect(r.canvas.lockRequests).toBe(0);
    r.canvas.dispatchEvent(new Event('mousedown'));
    r.canvas.dispatchEvent(new Event('click'));
    expect(r.canvas.lockRequests).toBe(1);
  });
});

describe('InputManager gamepad merge policy', () => {
  it('a moving pad overrides keyboard and mouse, and they take over again after 2 s of stillness', () => {
    const r = makeRig();
    r.pads[0] = padWith([0, 0, -1, 0]);
    r.run(0.1);
    r.press('KeyD');
    r.pads[0] = padWith([0.8, 0, -1, 0]);
    let s = r.run(0.1);
    expect(s.roll).toBeGreaterThan(0.7);
    expect(s.yaw).toBe(0);
    r.pads[0] = padWith([0, 0, -1, 0]);
    r.run(0.1);
    s = r.run(1);
    expect(s.yaw).toBe(0);
    s = r.run(1.5);
    expect(s.yaw).toBe(1);
  });

  it('a latched pad throttle keeps integrating while the stick is held for longer than the activity window', () => {
    const r = makeRig();
    r.pads[0] = { ...padWith([0, -0.2, 0, 0]), mapping: 'standard' };
    r.run(1);
    const early = r.input.poll(1 / 60).throttle;
    expect(early).toBeGreaterThan(0.1);
    const late = r.run(4).throttle;
    expect(late).toBeGreaterThan(0.5);
    expect(late).toBeLessThan(0.8);
  });

  it('a still pad never overrides the keyboard', () => {
    const r = makeRig();
    r.pads[0] = padWith([0, 0, -1, 0]);
    r.press('KeyD');
    expect(r.run(0.5).yaw).toBe(1);
  });

  it('shares one throttle latch: a radio sets it absolutely and it stays when the pad goes idle', () => {
    const r = makeRig();
    r.pads[0] = padWith([0, 0, -1, 0]);
    r.run(0.1);
    r.pads[0] = padWith([0, 0, 0.4, 0]);
    expect(r.run(0.1).throttle).toBeCloseTo(0.7, 3);
    expect(r.run(4).throttle).toBeCloseTo(0.7, 3);
    r.press('KeyX');
    expect(r.run(0.1).throttle).toBe(0);
  });

  it('pad buttons emit the same actions as the keys', () => {
    const r = makeRig();
    r.pads[0] = padWith([0, 0, -1, 0]);
    r.run(0.05);
    r.pads[0] = padWith([0, 0, -1, 0], [0, 2, 3, 9]);
    r.run(0.05);
    expect([...r.input.takeActions()].sort()).toEqual(['arm-toggle', 'camera-cycle', 'respawn', 'toggle-menu']);
  });

  it('the arm switch toggles only when it disagrees with the latched state', () => {
    const r = makeRig();
    r.pads[0] = padWith([0, 0, -1, 0, -1, -1]);
    r.run(0.05);
    r.pads[0] = padWith([0, 0, -1, 0, 1, -1]);
    r.run(0.05);
    expect([...r.input.takeActions()]).toEqual(['arm-toggle']);
    r.input.setArmed(true);
    r.pads[0] = padWith([0, 0, -1, 0, -1, -1]);
    r.run(0.05);
    expect([...r.input.takeActions()]).toEqual(['arm-toggle']);
    r.input.setArmed(false);
    r.pads[0] = padWith([0, 0, -1, 0, 1, -1]);
    r.run(0.05);
    r.input.takeActions();
    r.pads[0] = padWith([0, 0, -1, 0, -1, -1]);
    r.run(0.05);
    expect(r.input.takeActions().length).toBe(0);
  });

  it('the radio mode switch sets the flight mode and a button cycles it', () => {
    const r = makeRig();
    r.pads[0] = padWith([0, 0, -1, 0, -1, -1]);
    r.run(0.05);
    r.pads[0] = padWith([0, 0, -1, 0, -1, 1]);
    expect(r.run(0.05).mode).toBe('horizon');
    r.pads[0] = padWith([0, 0, -1, 0, -1, 1], [4]);
    expect(r.run(0.05).mode).toBe('acro');
  });

  it('pad turtle button sets the turtle flag', () => {
    const r = makeRig();
    r.pads[0] = padWith([0, 0, -1, 0], [1]);
    expect(r.run(0.05).turtle).toBe(true);
  });
});

describe('InputManager lifecycle', () => {
  it('dispose removes every listener', () => {
    const r = makeRig();
    r.input.dispose();
    r.press('Space');
    r.press('KeyD');
    r.canvas.dispatchEvent(new Event('click'));
    expect(r.canvas.lockRequests).toBe(0);
    expect(r.input.takeActions().length).toBe(0);
    expect(r.run(0.3).yaw).toBe(0);
  });
});
