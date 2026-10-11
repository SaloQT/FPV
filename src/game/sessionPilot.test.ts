import { describe, expect, it } from 'vitest';
import type { PilotRace, StepPilot } from '../ai/brainPilot';
import type { QuadState, StickInput } from '../contracts';
import { RESPAWN_OFFER_S } from './sessionTypes';
import { STUCK_S } from './stuck';
import { makeSessionRig } from './testKit';

/** A pilot that pushes full throttle and right roll, and records what the session told it. */
class FakePilot implements StepPilot {
  calls = 0;
  resets = 0;
  race: PilotRace = { track: null, nextGate: -1 };
  control(_s: QuadState, cmd: StickInput, race: PilotRace): void {
    this.calls++;
    this.race = { ...race };
    cmd.roll = 0.5;
    cmd.throttle = 0.6;
    cmd.mode = 'acro';
  }
  reset(): void {
    this.resets++;
  }
}

describe('session pilot hook', () => {
  it('arms on the pad, flies the sticks it sets and takes off', () => {
    const rig = makeSessionRig();
    const pilot = new FakePilot();
    rig.session.pilot = pilot;
    rig.input.stick.throttle = 0;
    rig.run(0.05);
    expect(rig.input.armed).toBe(true);
    expect(pilot.calls).toBe(50);
    expect(pilot.race.nextGate).toBe(0);
    expect(pilot.race.track?.gates.length).toBe(3);
    const last = rig.physics.inputs.at(-1)!;
    expect(last.roll).toBe(0.5);
    expect(last.throttle).toBe(0.6);
    expect(rig.session.state).toBe('flying');
  });

  it('lets go of a crashed quad and puts it back at its last gate once the crash has played out, auto-respawn or not', () => {
    const rig = makeSessionRig({ autoRespawn: false });
    const pilot = new FakePilot();
    rig.session.pilot = pilot;
    rig.run(0.05);
    // Moving, so the stuck watch stays out of it
    rig.physics.state.vel[0] = 5;
    const resets = rig.physics.resets.length;
    const before = pilot.resets;
    rig.physics.crashOnStep = rig.physics.steps + 1;
    rig.run(0.01);
    expect(rig.session.state).toBe('crashed');
    const calls = pilot.calls;
    rig.run(RESPAWN_OFFER_S - 0.1);
    // Its training ended the episode at the crash: the brain does not fly on from one
    expect(pilot.calls).toBe(calls);
    const idle = rig.physics.inputs.at(-1)!;
    expect([idle.roll, idle.pitch, idle.yaw, idle.throttle]).toEqual([0, 0, 0, 0]);
    expect(rig.physics.resets.length).toBe(resets);
    rig.run(0.2);
    expect(rig.physics.resets.length).toBe(resets + 1);
    expect(pilot.resets).toBeGreaterThan(before);
    expect(rig.session.state).toBe('flying');
    rig.run(0.05);
    expect(pilot.calls).toBeGreaterThan(calls);
  });

  it('respawns a stuck brain (even with auto-respawn off) and resets its pilot', () => {
    const rig = makeSessionRig({ autoRespawn: false });
    const pilot = new FakePilot();
    rig.session.pilot = pilot;
    rig.run(0.05);
    const resets = rig.physics.resets.length;
    const placements = rig.session.placements;
    const before = pilot.resets;
    rig.run(STUCK_S - 0.3);
    expect(rig.physics.resets.length).toBe(resets);
    rig.run(0.6);
    expect(rig.physics.resets.length).toBe(resets + 1);
    expect(rig.session.placements).toBe(placements + 1);
    expect(pilot.resets).toBeGreaterThan(before);
  });

  it('waits for GO before arming on a race start', () => {
    const rig = makeSessionRig();
    rig.session.setRaceStart(true);
    rig.session.resetTrack();
    rig.session.pilot = new FakePilot();
    rig.run(0.5);
    expect(rig.input.armed).toBe(false);
    expect(rig.physics.inputs.at(-1)!.armed).toBe(false);
    rig.run(6);
    expect(rig.input.armed).toBe(true);
  });

  it('gives the sticks back when the pilot is cleared', () => {
    const rig = makeSessionRig();
    rig.session.pilot = new FakePilot();
    rig.run(0.05);
    rig.session.pilot = null;
    rig.input.stick.roll = -0.25;
    rig.run(0.02);
    expect(rig.physics.inputs.at(-1)!.roll).toBe(-0.25);
  });
});
