import { describe, expect, it } from 'vitest';
import { FlightEvents, type EventInput } from './events';

const DT = 1 / 60;

function makeState(over: Partial<EventInput> = {}): EventInput {
  return {
    time: 0, pos: [0, 0, 0], vel: [0, 0, 0], angVel: [0, 0, 0], motorOmega: [0, 0, 0, 0], batteryVoltage: 25.2,
    armed: false, onGround: true, crashed: false, impactSpeed: 0, ...over,
  };
}

/** Steps the tracker and returns a copy of each frame's flags. */
function drive(ev: FlightEvents, s: EventInput, seconds: number, mutate?: (s: EventInput, t: number) => void) {
  const out: ReturnType<typeof snapshot>[] = [];
  for (let i = 0, n = Math.round(seconds / DT); i < n; i++) {
    s.time += DT;
    mutate?.(s, s.time);
    out.push(snapshot(ev.update(s, DT)));
  }
  return out;
}

const snapshot = (f: FlightEvents['flags']) => ({ ...f });
const count = (frames: { [k: string]: unknown }[], key: string) => frames.filter((f) => f[key]).length;

describe('FlightEvents', () => {
  it('reports arm and disarm edges once and never on the first frame', () => {
    const ev = new FlightEvents();
    const s = makeState({ armed: true });
    expect(ev.update(s, DT).armed).toBe(false);
    const idle = drive(ev, s, 1);
    expect(count(idle, 'armed')).toBe(0);
    s.armed = false;
    const off = drive(ev, s, 1);
    expect(count(off, 'disarmed')).toBe(1);
    s.armed = true;
    expect(count(drive(ev, s, 1), 'armed')).toBe(1);
  });

  it('flags a crash once, with the impact speed and a prop strike only when the props spin', () => {
    const ev = new FlightEvents();
    const s = makeState({ armed: true, onGround: false, pos: [0, 5, 0], motorOmega: [1500, 1500, 1500, 1500] });
    drive(ev, s, 0.2);
    s.crashed = true;
    s.impactSpeed = 12;
    const hit = drive(ev, s, 0.1);
    expect(count(hit, 'crash')).toBe(1);
    const first = hit.find((f) => f.crash)!;
    expect(first.crashSpeed).toBe(12);
    expect(first.propStrike).toBe(true);

    const ev2 = new FlightEvents();
    const dead = makeState({ armed: false, onGround: false, pos: [0, 5, 0], crashed: false });
    drive(ev2, dead, 0.1);
    dead.crashed = true;
    dead.impactSpeed = 12;
    expect(drive(ev2, dead, 0.05).find((f) => f.crash)!.propStrike).toBe(false);

    const ev3 = new FlightEvents();
    const slow = makeState({ armed: true, onGround: false, motorOmega: [1500, 1500, 1500, 1500] });
    drive(ev3, slow, 0.1);
    slow.crashed = true;
    slow.impactSpeed = 2;
    expect(drive(ev3, slow, 0.05).find((f) => f.crash)!.propStrike).toBe(false);
  });

  it('reports a gentle touchdown as a landing, scaled by the sink rate, and not a crash', () => {
    const ev = new FlightEvents();
    const s = makeState({ onGround: false, pos: [0, 1, 0], vel: [0, -3, 0] });
    drive(ev, s, 0.1);
    s.onGround = true;
    s.vel = [0, 0, 0];
    const frames = drive(ev, s, 0.1);
    expect(count(frames, 'landing')).toBe(1);
    expect(count(frames, 'crash')).toBe(0);
    const level = frames.find((f) => f.landing)!.landingLevel;
    expect(level).toBeGreaterThan(0);
    expect(level).toBeLessThan(1);

    const ev2 = new FlightEvents();
    const hover = makeState({ onGround: false, pos: [0, 1, 0], vel: [0, -0.5, 0] });
    drive(ev2, hover, 0.1);
    hover.onGround = true;
    expect(count(drive(ev2, hover, 0.1), 'landing')).toBe(0);
  });

  it('promotes a hard touchdown to a crash when a slow frame missed the one-tick crashed flag', () => {
    const ev = new FlightEvents();
    const s = makeState({ armed: true, onGround: false, pos: [0, 2, 0], vel: [0, -7, 0], motorOmega: [1500, 1500, 1500, 1500] });
    drive(ev, s, 0.1);
    s.onGround = true;
    s.vel = [0, 0, 0];
    const frames = drive(ev, s, 0.1);
    expect(count(frames, 'crash')).toBe(1);
    expect(count(frames, 'landing')).toBe(0);
    const hit = frames.find((f) => f.crash)!;
    expect(hit.crashSpeed).toBe(7);
    expect(hit.propStrike).toBe(true);
    s.armed = false;
    expect(count(drive(ev, s, 21), 'beacon')).toBeGreaterThanOrEqual(1);
  });

  it('counts a crash flag and the ground contact right behind it as one crash, and a firm landing as a landing', () => {
    const ev = new FlightEvents();
    const s = makeState({ onGround: false, pos: [0, 2, 0], vel: [0, -7, 0] });
    drive(ev, s, 0.1);
    s.crashed = true;
    s.impactSpeed = 7;
    const hit = drive(ev, s, DT);
    s.onGround = true;
    s.crashed = false;
    s.vel = [0, 0, 0];
    const after = drive(ev, s, 0.2);
    expect(count(hit, 'crash') + count(after, 'crash')).toBe(1);
    expect(count(after, 'landing')).toBe(1);

    const ev2 = new FlightEvents();
    const firm = makeState({ onGround: false, pos: [0, 1, 0], vel: [0, -4, 0] });
    drive(ev2, firm, 0.1);
    firm.onGround = true;
    const frames = drive(ev2, firm, 0.1);
    expect(count(frames, 'crash')).toBe(0);
    expect(count(frames, 'landing')).toBe(1);
  });

  it('clacks at 3-10 Hz while tumbling on the ground and stays quiet otherwise', () => {
    const ev = new FlightEvents();
    const s = makeState({ vel: [4, 0, 0], angVel: [8, 0, 0] });
    const frames = drive(ev, s, 3);
    const n = count(frames, 'tumble');
    expect(n).toBeGreaterThanOrEqual(9);
    expect(n).toBeLessThanOrEqual(31);
    expect(frames.find((f) => f.tumble)!.tumbleLevel).toBeGreaterThan(0);

    const ev2 = new FlightEvents();
    expect(count(drive(ev2, makeState({ vel: [0.2, 0, 0], angVel: [8, 0, 0] }), 2), 'tumble')).toBe(0);
    expect(count(drive(ev2, makeState({ vel: [4, 0, 0], angVel: [0.5, 0, 0] }), 2), 'tumble')).toBe(0);
    expect(count(drive(ev2, makeState({ vel: [4, 0, 0], angVel: [8, 0, 0], onGround: false }), 2), 'tumble')).toBe(0);
  });

  it('warns every 3 s below 3.5 V per cell while armed, after the filter, and stops when recovered', () => {
    const ev = new FlightEvents();
    const s = makeState({ armed: true, batteryVoltage: 25.2 });
    drive(ev, s, 1);
    expect(count(drive(ev, s, 5), 'lowBattery')).toBe(0);
    s.batteryVoltage = 20.4;
    const first = drive(ev, s, 1);
    expect(count(first, 'lowBattery')).toBe(0);
    const later = drive(ev, s, 9);
    expect(count(later, 'lowBattery')).toBeGreaterThanOrEqual(3);
    expect(count(later, 'lowBattery')).toBeLessThanOrEqual(4);
    s.batteryVoltage = 24;
    drive(ev, s, 3);
    expect(count(drive(ev, s, 6), 'lowBattery')).toBe(0);
  });

  it('ignores a brief voltage sag under load', () => {
    const ev = new FlightEvents();
    const s = makeState({ armed: true, batteryVoltage: 23 });
    drive(ev, s, 1);
    const sag = drive(ev, s, 0.5, (st) => { st.batteryVoltage = 19.5; });
    expect(count(sag, 'lowBattery')).toBe(0);
  });

  it('does not warn while disarmed and honours an explicit cell count', () => {
    const ev = new FlightEvents();
    expect(count(drive(ev, makeState({ armed: false, batteryVoltage: 19 }), 8), 'lowBattery')).toBe(0);
    const four = new FlightEvents();
    four.setCells(4);
    const s = makeState({ armed: true, batteryVoltage: 13.4 });
    drive(four, s, 3);
    expect(count(drive(four, s, 4), 'lowBattery')).toBeGreaterThanOrEqual(1);
    const six = new FlightEvents();
    six.setCells(6);
    expect(count(drive(six, makeState({ armed: true, batteryVoltage: 22 }), 8), 'lowBattery')).toBe(0);
  });

  it('starts the lost-model beacon 20 s after a crash while disarmed on the ground, repeating every 4 s', () => {
    const ev = new FlightEvents();
    const s = makeState({ armed: true, onGround: false, pos: [0, 3, 0] });
    drive(ev, s, 0.2);
    s.crashed = true;
    s.impactSpeed = 10;
    drive(ev, s, DT);
    s.crashed = false;
    s.onGround = true;
    s.armed = false;
    const early = drive(ev, s, 19);
    expect(count(early, 'beacon')).toBe(0);
    const late = drive(ev, s, 13);
    expect(count(late, 'beacon')).toBeGreaterThanOrEqual(3);
    expect(count(late, 'beacon')).toBeLessThanOrEqual(4);
    s.armed = true;
    drive(ev, s, 0.2);
    s.armed = false;
    expect(count(drive(ev, s, 30), 'beacon')).toBe(0);
  });

  it('never beacons without a crash', () => {
    const ev = new FlightEvents();
    expect(count(drive(ev, makeState(), 60), 'beacon')).toBe(0);
  });

  it('re-seeds on a teleport or rewound time without emitting edge events', () => {
    const ev = new FlightEvents();
    const s = makeState({ armed: true, onGround: false, pos: [0, 30, 0] });
    drive(ev, s, 1);
    s.pos = [500, 2, 500];
    s.armed = false;
    s.onGround = true;
    const jump = drive(ev, s, DT);
    expect(jump[0].reset).toBe(true);
    expect(jump[0].disarmed).toBe(false);
    expect(jump[0].landing).toBe(false);
    s.time = 0;
    s.pos = [0, 1, 0];
    const back = drive(ev, s, DT);
    expect(back[0].reset).toBe(true);
    expect(count(drive(ev, s, 1), 'reset')).toBe(0);
  });

  it('manual reset re-seeds silently', () => {
    const ev = new FlightEvents();
    const s = makeState({ armed: false });
    drive(ev, s, 0.5);
    ev.reset();
    s.armed = true;
    expect(drive(ev, s, 0.5).some((f) => f.armed)).toBe(false);
  });

  it('survives junk input', () => {
    const ev = new FlightEvents();
    const s = makeState({ armed: true, batteryVoltage: NaN, motorOmega: [NaN, -3, Infinity, 0] });
    const frames = drive(ev, s, 1);
    expect(frames.length).toBe(60);
    s.crashed = true;
    s.impactSpeed = NaN;
    const hit = drive(ev, s, 0.1).find((f) => f.crash);
    expect(hit).toBeDefined();
    expect(Number.isFinite(hit!.crashSpeed)).toBe(true);
  });
});
