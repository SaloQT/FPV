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

  it('lets a brain fly on after a knock instead of respawning it', () => {
    const rig = makeSessionRig({ track: null });
    const pilot = new FakePilot();
    rig.session.pilot = pilot;
    rig.run(0.05);
    rig.physics.state.vel[0] = 5;
    const resets = rig.physics.resets.length;
    rig.physics.crashOnStep = rig.physics.steps + 1;
    rig.run(0.01);
    rig.run(STUCK_S + 2);
    expect(rig.physics.resets.length).toBe(resets);
    expect(rig.session.state).toBe('flying');
  });

  it('respawns a stuck brain (even with auto-respawn off) and resets its pilot', () => {
    const rig = makeSessionRig({ autoRespawn: false });
    const pilot = new FakePilot();
    rig.session.pilot = pilot;
    rig.run(0.05);
    const resets = rig.physics.resets.length;
    const before = pilot.resets;
    rig.physics.crashOnStep = rig.physics.steps + 1;
    rig.run(RESPAWN_OFFER_S + 0.1);
    expect(rig.physics.resets.length).toBe(resets);
    rig.run(STUCK_S);
    expect(rig.physics.resets.length).toBe(resets + 1);
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
