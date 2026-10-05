import { describe, expect, it } from 'vitest';
import { RESPAWN_BACK_M } from './checkpoint';
import type { GateEvent } from './gateTimer';
import { createSessionSnapshot, HOVER_THROTTLE, RESPAWN_OFFER_S } from './sessionTypes';
import { makeSessionRig, type SessionRig } from './testKit';

/** Drives the pilot through arming and a climb-out so the session is `flying`. */
function takeOff(rig: SessionRig): void {
  rig.physics.onStep = (s): void => void (s.onGround = true);
  rig.input.stick.throttle = 0;
  rig.input.actions.push('arm-toggle');
  rig.run(0.02);
  rig.input.stick.throttle = 0.5;
  rig.run(0.02);
}

describe('arming rule', () => {
  it('arms with the throttle down and disarms on the next toggle', () => {
    const rig = makeSessionRig();
    rig.input.stick.throttle = 0.03;
    rig.input.actions.push('arm-toggle');
    rig.run(0.01);
    expect(rig.input.armed).toBe(true);
    expect(rig.physics.inputs.at(-1)?.armed).toBe(true);
    rig.input.actions.push('arm-toggle');
    rig.run(0.01);
    expect(rig.input.armed).toBe(false);
  });

  it('refuses to arm with the throttle up and shows THROTTLE HIGH for a couple of seconds', () => {
    const rig = makeSessionRig();
    const snap = createSessionSnapshot();
    rig.input.stick.throttle = 0.4;
    rig.input.actions.push('arm-toggle');
    rig.run(0.01);
    expect(rig.input.armed).toBe(false);
    expect(rig.session.snapshot(snap).throttleHigh).toBe(true);
    rig.run(1.5);
    expect(rig.session.snapshot(snap).throttleHigh).toBe(true);
    rig.run(1);
    expect(rig.session.snapshot(snap).throttleHigh).toBe(false);
  });

  it('reports the held turtle control in the snapshot', () => {
    const rig = makeSessionRig();
    const snap = createSessionSnapshot();
    expect(rig.session.snapshot(snap).turtle).toBe(false);
    rig.input.stick.turtle = true;
    rig.run(0.01);
    expect(rig.session.snapshot(snap).turtle).toBe(true);
    rig.input.stick.turtle = false;
    rig.run(0.01);
    expect(rig.session.snapshot(snap).turtle).toBe(false);
  });

  it('the limit is 5 percent: exactly 0.05 is refused, just below is accepted', () => {
    const rig = makeSessionRig();
    rig.input.stick.throttle = 0.05;
    rig.input.actions.push('arm-toggle');
    rig.run(0.01);
    expect(rig.input.armed).toBe(false);
    rig.input.stick.throttle = 0.049;
    rig.input.actions.push('arm-toggle');
    rig.run(0.01);
    expect(rig.input.armed).toBe(true);
  });

  it('ignores the arm key behind a menu', () => {
    const rig = makeSessionRig();
    rig.session.openMenu();
    rig.input.actions.push('arm-toggle');
    rig.run(0.01);
    expect(rig.input.armed).toBe(false);
  });
});

describe('takeoff, crash and respawn', () => {
  it('goes ready to flying once armed with throttle, not before', () => {
    const rig = makeSessionRig();
    rig.input.armed = true;
    rig.input.stick.throttle = 0.05;
    rig.run(0.05);
    expect(rig.session.state).toBe('ready');
    rig.input.stick.throttle = 0.4;
    rig.run(0.02);
    expect(rig.session.state).toBe('flying');
  });

  it('a crash while flying enters the crashed state and offers a respawn after 1.2 s', () => {
    const rig = makeSessionRig();
    const snap = createSessionSnapshot();
    takeOff(rig);
    rig.input.stick.throttle = 0;
    rig.physics.crashOnStep = rig.physics.steps + 5;
    rig.run(0.05);
    expect(rig.session.state).toBe('crashed');
    expect(rig.session.snapshot(snap).respawnOffered).toBe(false);
    rig.run(RESPAWN_OFFER_S + 0.05);
    expect(rig.session.snapshot(snap).respawnOffered).toBe(true);
    expect(rig.session.state).toBe('crashed');
  });

  it('R puts the quad back on the pad, disarmed, with the throttle cut, when no gate was passed', () => {
    const rig = makeSessionRig();
    takeOff(rig);
    rig.physics.crashOnStep = rig.physics.steps + 3;
    rig.run(0.05);
    const recenters = rig.input.recenters;
    rig.input.actions.push('respawn');
    rig.run(0.01);
    expect(rig.input.recenters).toBe(recenters + 1);
    const at = rig.physics.resets.at(-1)!;
    expect(at.pos[0]).toBe(0);
    expect(at.pos[2]).toBe(0);
    expect(at.pos[1]).toBeGreaterThan(0);
    expect(rig.input.armed).toBe(false);
    expect(rig.input.throttleSets.at(-1)).toBe(0);
    expect(rig.session.state).toBe('ready');
  });

  it('auto-respawn does it on its own once the cooldown is over', () => {
    const rig = makeSessionRig({ autoRespawn: true });
    takeOff(rig);
    const resets = rig.physics.resets.length;
    rig.physics.crashOnStep = rig.physics.steps + 3;
    rig.run(1);
    expect(rig.session.state).toBe('crashed');
    expect(rig.physics.resets.length).toBe(resets);
    rig.run(0.4);
    expect(rig.physics.resets.length).toBe(resets + 1);
    expect(rig.session.state).toBe('ready');
  });

  it('disarms a crashed quad that lies still on the ground for two seconds', () => {
    const rig = makeSessionRig();
    const snap = createSessionSnapshot();
    takeOff(rig);
    rig.input.stick.throttle = 0.02;
    rig.physics.crashOnStep = rig.physics.steps + 3;
    rig.run(1.5);
    expect(rig.input.armed).toBe(true);
    rig.run(1);
    expect(rig.input.armed).toBe(false);
    expect(rig.session.snapshot(snap).message).toBe('AUTO DISARM');
    rig.run(2.5);
    expect(rig.session.snapshot(snap).message).toBe('');
  });

  it('does not auto-disarm while the pilot still holds throttle or the quad is moving', () => {
    const rig = makeSessionRig();
    takeOff(rig);
    rig.physics.crashOnStep = rig.physics.steps + 3;
    rig.physics.state.vel[0] = 2;
    rig.run(4);
    expect(rig.input.armed).toBe(true);
  });

  it('flies on after a crash when armed with throttle once the cooldown is over', () => {
    const rig = makeSessionRig();
    takeOff(rig);
    rig.physics.crashOnStep = rig.physics.steps + 3;
    rig.run(0.5);
    expect(rig.session.state).toBe('crashed');
    rig.run(1);
    expect(rig.session.state).toBe('flying');
  });

  it('ignores the crash flag held over several steps as a single crash', () => {
    const rig = makeSessionRig();
    takeOff(rig);
    let n = 0;
    rig.physics.onStep = (s): void => {
      s.onGround = true;
      s.crashed = n++ < 20;
    };
    rig.run(0.05);
    expect(rig.session.state).toBe('crashed');
    rig.input.stick.throttle = 0;
    rig.run(RESPAWN_OFFER_S - 0.2);
    expect(rig.session.snapshot().respawnOffered).toBe(false);
    rig.run(0.5);
    expect(rig.session.snapshot().respawnOffered).toBe(true);
  });
});

describe('gates and checkpoints', () => {
  function flyThrough(rig: SessionRig, gates: number): void {
    rig.physics.state.vel[2] = -20;
    rig.run(0.5 * gates + 0.1);
    rig.physics.state.vel[2] = 0;
  }

  it('times the race from the first gate and reports progress', () => {
    const rig = makeSessionRig();
    const events: [GateEvent, number][] = [];
    rig.session.onGate = (e, g): void => void events.push([e, g]);
    flyThrough(rig, 2);
    const snap = rig.session.snapshot();
    expect(events).toEqual([['gate', 0], ['gate', 1]]);
    expect(snap.race).toMatchObject({ started: true, gatesPassed: 2, nextGate: 2, finished: false });
  });

  it('respawns 1.5 m before the last cleared gate, armed in the air with a hover throttle', () => {
    const rig = makeSessionRig();
    flyThrough(rig, 2);
    rig.session.respawn();
    const at = rig.physics.resets.at(-1)!;
    expect(at.pos[0]).toBeCloseTo(0, 6);
    expect(at.pos[1]).toBeCloseTo(2, 6);
    expect(at.pos[2]).toBeCloseTo(-20 + RESPAWN_BACK_M, 6);
    expect(at.yaw).toBe(0);
    expect(rig.session.state).toBe('flying');
    expect(rig.input.armed).toBe(true);
    expect(rig.input.throttleSets.at(-1)).toBe(0);
    rig.run(0.02);
    expect(rig.physics.inputs.find((i) => i.armed)?.throttle).toBe(0);
    expect(rig.input.throttleSets.at(-1)).toBe(HOVER_THROTTLE);
    expect(rig.physics.inputs.at(-1)?.throttle).toBe(HOVER_THROTTLE);
  });

  it('keeps the race timer running through a respawn', () => {
    const rig = makeSessionRig();
    flyThrough(rig, 1);
    const before = rig.session.snapshot().race.gatesPassed;
    rig.session.respawn();
    expect(rig.session.snapshot().race).toMatchObject({ started: true, gatesPassed: before });
  });

  it('finishes after the last gate and keeps the session flying state until then', () => {
    const rig = makeSessionRig();
    rig.physics.onStep = (s): void => void (s.onGround = true);
    rig.input.armed = true;
    rig.input.stick.throttle = 0.5;
    rig.run(0.02);
    expect(rig.session.state).toBe('flying');
    flyThrough(rig, 3);
    expect(rig.session.state).toBe('finished');
    expect(rig.session.snapshot().race.finished).toBe(true);
  });

  it('after the finish, R starts over on the pad with a fresh race', () => {
    const rig = makeSessionRig();
    rig.input.armed = true;
    rig.input.stick.throttle = 0.5;
    rig.run(0.02);
    flyThrough(rig, 3);
    rig.input.actions.push('respawn');
    rig.run(0.01);
    expect(rig.session.state).toBe('ready');
    expect(rig.session.snapshot().race).toMatchObject({ started: false, finished: false, gatesPassed: 0 });
    expect(rig.physics.resets.at(-1)?.pos[2]).toBe(0);
  });

  it('reset-track restarts the race, the flight timer and the pad position', () => {
    const rig = makeSessionRig();
    flyThrough(rig, 2);
    rig.input.actions.push('reset-track');
    rig.run(0.01);
    const snap = rig.session.snapshot();
    expect(snap.race).toMatchObject({ started: false, gatesPassed: 0, nextGate: 0 });
    expect(snap.flightTime).toBe(0);
    expect(rig.physics.resets.at(-1)?.pos[2]).toBe(0);
  });

  it('a new track resets to the start pad of that track', () => {
    const rig = makeSessionRig();
    rig.session.setTrack({ ...rig.session.raceTrack!, start: { pos: [30, 5, 40], yaw: 1 }, gates: [] });
    expect(rig.physics.resets.at(-1)).toMatchObject({ yaw: 1 });
    expect(rig.physics.resets.at(-1)?.pos[0]).toBe(30);
    expect(rig.session.snapshot().race.active).toBe(false);
  });

  it('works without a track', () => {
    const rig = makeSessionRig({ track: null });
    rig.run(0.05);
    expect(rig.session.snapshot().race.active).toBe(false);
    rig.session.respawn();
    expect(rig.physics.resets.at(-1)?.pos).toEqual([0, 0.05, 0]);
  });

  it('counts the flight timer only while armed', () => {
    const rig = makeSessionRig();
    rig.run(0.5);
    expect(rig.session.snapshot().flightTime).toBe(0);
    rig.input.armed = true;
    rig.run(0.5);
    expect(rig.session.snapshot().flightTime).toBeCloseTo(0.5, 2);
  });
});
