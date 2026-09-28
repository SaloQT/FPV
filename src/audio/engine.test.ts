import { afterEach, describe, expect, it, vi } from 'vitest';
import type { QuadState } from '../contracts';
import { AudioEngine, type AudioEngineOptions, type AudioUpdateContext } from './engine';
import { asContext, FakeContext, FakeNode } from './fakeAudio';
import { ONBOARD_GAIN } from './mixer';

const DT = 1 / 60;
const HOVER = [1500, 1500, 1500, 1500] as QuadState['motorOmega'];

function makeState(over: Partial<QuadState> = {}): QuadState {
  return {
    time: 0, pos: [0, 0.05, 0], vel: [0, 0, 0], quat: [0, 0, 0, 1], angVel: [0, 0, 0], motorOmega: [0, 0, 0, 0], motorCmd: [0, 0, 0, 0],
    batteryVoltage: 25.2, batteryCurrent: 0, batteryMah: 0, gForce: [0, 1, 0], armed: false, onGround: true, crashed: false, impactSpeed: 0, ...over,
  };
}

const CHASE: AudioUpdateContext = { speed: 0, agl: 50, dt: DT, cameraMode: 'chase', windSpeed: 0 };

async function boot(opts: AudioEngineOptions = {}) {
  const ctx = new FakeContext();
  const engine = new AudioEngine({ contextFactory: () => asContext(ctx), ...opts });
  await engine.start();
  return { ctx, engine };
}

/** Advances the simulation and audio clocks by one frame and updates the engine. */
function step(engine: AudioEngine, ctx: FakeContext, s: QuadState, c: AudioUpdateContext = CHASE): void {
  s.time += DT;
  ctx.currentTime += DT;
  engine.update(s, c);
}

function run(engine: AudioEngine, ctx: FakeContext, s: QuadState, seconds: number, c: AudioUpdateContext = CHASE): void {
  for (let i = 0, n = Math.round(seconds / DT); i < n; i++) step(engine, ctx, s, c);
}

const motorOscillators = (ctx: FakeContext): FakeNode[] => ctx.of('oscillator').slice(0, 4);
const motorFreq = (ctx: FakeContext): number => motorOscillators(ctx)[0].param('frequency').last;
const oscillatorCount = (ctx: FakeContext): number => ctx.of('oscillator').length;
const shotCount = (ctx: FakeContext): number => ctx.of('bufferSource').length;

describe('AudioEngine without WebAudio', () => {
  it('is a silent no-op everywhere', async () => {
    expect(typeof AudioContext).toBe('undefined');
    const e = new AudioEngine();
    await e.start();
    expect(e.running).toBe(false);
    expect(e.synthKind).toBe('none');
    const s = makeState();
    expect(() => {
      e.update(s, CHASE);
      e.setVolumes({ master: 0.3 });
      e.setListenerAttached('fpv');
      e.setPilotPosition(1, 2, 3);
      e.beeper.gatePass();
      e.beeper.countdown(3);
      e.reset();
      e.dispose();
      e.dispose();
    }).not.toThrow();
  });

  it('stays silent when the graph cannot be built', async () => {
    const ctx = new FakeContext();
    ctx.createDynamicsCompressor = () => { throw new Error('unsupported'); };
    const e = new AudioEngine({ contextFactory: () => asContext(ctx) });
    await expect(e.start()).resolves.toBeUndefined();
    expect(e.running).toBe(false);
    expect(() => e.update(makeState(), CHASE)).not.toThrow();
  });
});

describe('AudioEngine graph', () => {
  it('builds the output chain, picks the oscillator synth without AudioWorklet and starts only once', async () => {
    const ctx = new FakeContext();
    let made = 0;
    const e = new AudioEngine({ contextFactory: () => { made++; return asContext(ctx); } });
    const first = e.start();
    expect(e.start()).toBe(first);
    await first;
    expect(made).toBe(1);
    expect(e.running).toBe(true);
    expect(e.synthKind).toBe('oscillator');
    const clip = ctx.of('waveShaper')[0];
    expect(clip.outputs).toContain(ctx.destination);
    expect(ctx.of('compressor')).toHaveLength(1);
    for (const n of ctx.nodes) if (n.kind === 'oscillator' || n.kind === 'bufferSource') expect(n.started).toBe(1);
  });

  it('uses the volumes it was given and follows setVolumes', async () => {
    const { ctx, engine } = await boot({ volumes: { master: 0.5 } });
    const targets = (v: number) => ctx.of('gain').some((n) => n.param('gain').targets.some((t) => t.value === v));
    expect(targets(0.25)).toBe(true);
    engine.setVolumes({ master: 0.9 });
    expect(targets(0.81)).toBe(true);
  });
});

describe('AudioEngine update', () => {
  it('turns motor speed into oscillator frequency and level', async () => {
    const { ctx, engine } = await boot();
    const s = makeState({ armed: true, motorOmega: [1000, 1000, 1000, 1000] });
    run(engine, ctx, s, 0.2);
    expect(motorFreq(ctx)).toBeCloseTo(1000 / (2 * Math.PI), 3);
    const oscs = motorOscillators(ctx);
    const gain = oscs[0].outputs[0];
    expect(gain.param('gain').last).toBeGreaterThan(0.01);
    expect(oscs[1].param('frequency').last).toBeGreaterThan(motorFreq(ctx));
    s.motorOmega = [0, 0, 0, 0];
    run(engine, ctx, s, 0.2);
    expect(motorFreq(ctx)).toBe(0);
    expect(gain.param('gain').last).toBe(0);
  });

  it('writes params at most once per 8 ms of audio time', async () => {
    const { ctx, engine } = await boot();
    const s = makeState({ armed: true, motorOmega: HOVER });
    const writes = () => motorOscillators(ctx)[0].param('frequency').targets.length;
    engine.update(s, CHASE);
    expect(writes()).toBe(1);
    ctx.currentTime += 0.003;
    engine.update(s, CHASE);
    expect(writes()).toBe(1);
    ctx.currentTime += 0.006;
    engine.update(s, CHASE);
    expect(writes()).toBe(2);
  });

  it('places the quad in the pilot scene and lowers the air-absorption cutoff with distance', async () => {
    const { ctx, engine } = await boot();
    engine.setPilotPosition(0, 1.6, 0);
    const s = makeState({ pos: [0, 10, -80], motorOmega: HOVER });
    run(engine, ctx, s, 0.3);
    const panner = ctx.of('panner')[0];
    expect(panner.param('positionZ').last).toBeLessThan(-70);
    expect(panner.param('positionY').last).toBeGreaterThan(5);
    const lows = ctx.of('biquad').filter((n) => n.type === 'lowpass' && n.param('frequency').targets.length > 0);
    expect(lows.some((n) => n.param('frequency').last < 12000)).toBe(true);
  });

  it('skips corrupt frames and never writes a non-finite value', async () => {
    const { ctx, engine } = await boot();
    const s = makeState({ armed: true, motorOmega: HOVER });
    run(engine, ctx, s, 0.1);
    const bad = makeState({ time: s.time, pos: [NaN, 0, 0], vel: [0, Infinity, 0], motorOmega: [NaN, -5, Infinity, 1e9] });
    const c: AudioUpdateContext = { speed: NaN, agl: NaN, dt: NaN, cameraMode: 'fpv', windSpeed: -Infinity };
    for (let i = 0; i < 5; i++) {
      ctx.currentTime += 0.02;
      expect(() => engine.update(bad, c)).not.toThrow();
    }
    const half = makeState({ time: s.time + 1, motorOmega: [NaN, -5, Infinity, 1e9] });
    run(engine, ctx, half, 0.1, c);
    for (const n of ctx.nodes) {
      for (const key of Object.keys(n)) {
        const p = n[key];
        if (p && typeof p === 'object' && 'calls' in p) for (const call of (p as { calls: { value: number; time: number }[] }).calls) expect(Number.isFinite(call.value + call.time)).toBe(true);
      }
    }
  });
});

describe('AudioEngine listener modes', () => {
  const onboardNode = (ctx: FakeContext) => ctx.of('gain').find((n) => n.param('gain').calls.some((c) => c.value === ONBOARD_GAIN))!;

  it('follows the camera in auto mode and lets setListenerAttached override it', async () => {
    const { ctx, engine } = await boot();
    const s = makeState({ motorOmega: HOVER });
    run(engine, ctx, s, 0.1, { ...CHASE, cameraMode: 'fpv' });
    expect(onboardNode(ctx).param('gain').last).toBe(ONBOARD_GAIN);
    run(engine, ctx, s, 0.1, CHASE);
    expect(onboardNode(ctx).param('gain').last).toBe(0);

    engine.setListenerAttached('fpv');
    run(engine, ctx, s, 0.1, CHASE);
    expect(onboardNode(ctx).param('gain').last).toBe(ONBOARD_GAIN);
    engine.setListenerAttached('chase');
    run(engine, ctx, s, 0.1, { ...CHASE, cameraMode: 'fpv' });
    expect(onboardNode(ctx).param('gain').last).toBe(0);
  });

  it('applies Doppler to the motor pitch only for the ground listener', async () => {
    const approach = { ...CHASE, speed: 60 };
    const pitch = async (mode: 'pilot' | 'onboard') => {
      const { ctx, engine } = await boot({ mode });
      engine.setPilotPosition(0, 1.6, 0);
      const s = makeState({ pos: [0, 1.6, -100], vel: [0, 0, 60], motorOmega: [1000, 1000, 1000, 1000], onGround: false });
      run(engine, ctx, s, 0.5, approach);
      return motorFreq(ctx) / (1000 / (2 * Math.PI));
    };
    expect(await pitch('pilot')).toBeGreaterThan(1.15);
    expect(await pitch('pilot')).toBeLessThan(1.3);
    expect(await pitch('onboard')).toBeCloseTo(1, 5);
  });
});

describe('AudioEngine events', () => {
  it('fires a crash sound once, with prop ticks only when the props were spinning', async () => {
    for (const [omega, minShots] of [[0, 1], [1500, 4]] as const) {
      const { ctx, engine } = await boot();
      const s = makeState({ armed: true, onGround: false, pos: [0, 4, 0], motorOmega: [omega, omega, omega, omega] });
      run(engine, ctx, s, 0.2);
      const before = shotCount(ctx);
      s.crashed = true;
      s.impactSpeed = 15;
      step(engine, ctx, s);
      s.crashed = false;
      run(engine, ctx, s, 0.1);
      const fired = shotCount(ctx) - before;
      expect(fired).toBeGreaterThanOrEqual(minShots);
      expect(fired).toBeLessThanOrEqual(omega ? 6 : 1);
    }
  });

  it('beeps on arm, disarm and low battery, and stays quiet with autoBeeps off', async () => {
    const { ctx, engine } = await boot({ cells: 6 });
    const s = makeState({ batteryVoltage: 24 });
    run(engine, ctx, s, 0.2);
    const base = oscillatorCount(ctx);
    s.armed = true;
    run(engine, ctx, s, 1.2);
    expect(oscillatorCount(ctx) - base).toBe(3);
    s.armed = false;
    run(engine, ctx, s, 1.2);
    expect(oscillatorCount(ctx) - base).toBe(5);
    s.armed = true;
    s.batteryVoltage = 18;
    run(engine, ctx, s, 6);
    expect(oscillatorCount(ctx) - base).toBeGreaterThanOrEqual(5 + 3 + 2);

    const quiet = await boot({ autoBeeps: false });
    const q = makeState();
    run(quiet.engine, quiet.ctx, q, 0.2);
    const quietBase = oscillatorCount(quiet.ctx);
    q.armed = true;
    run(quiet.engine, quiet.ctx, q, 0.2);
    q.armed = false;
    run(quiet.engine, quiet.ctx, q, 0.2);
    expect(oscillatorCount(quiet.ctx)).toBe(quietBase);
    quiet.engine.beeper.gatePass();
    expect(oscillatorCount(quiet.ctx)).toBeGreaterThan(quietBase);
  });

  it('plays race tones through the beeper on the UI bus', async () => {
    const { ctx, engine } = await boot();
    const before = oscillatorCount(ctx);
    engine.beeper.lap();
    expect(oscillatorCount(ctx) - before).toBeGreaterThanOrEqual(4);
  });
});

describe('AudioEngine lifecycle', () => {
  it('reset forgets the flight without producing sounds, dispose is idempotent and stops everything', async () => {
    const { ctx, engine } = await boot();
    const s = makeState({ armed: true, motorOmega: HOVER });
    run(engine, ctx, s, 0.2);
    const before = oscillatorCount(ctx) + shotCount(ctx);
    engine.reset();
    s.pos = [500, 2, 500];
    s.time = 0;
    run(engine, ctx, s, 0.2);
    expect(oscillatorCount(ctx) + shotCount(ctx)).toBe(before);

    engine.dispose();
    engine.dispose();
    expect(engine.running).toBe(false);
    expect(engine.context).toBeNull();
    for (const n of ctx.nodes) expect(n.connected).toBe(false);
    const writes = motorOscillators(ctx)[0].param('frequency').calls.length;
    ctx.currentTime += 1;
    engine.update(s, CHASE);
    engine.beeper.gatePass();
    expect(motorOscillators(ctx)[0].param('frequency').calls.length).toBe(writes);
  });

  it('disposing while start is pending leaves nothing running', async () => {
    const ctx = new FakeContext();
    const e = new AudioEngine({ contextFactory: () => asContext(ctx) });
    const p = e.start();
    e.dispose();
    await p;
    expect(e.running).toBe(false);
  });
});

describe('AudioEngine with a real-time context', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('a later start() from a gesture resumes a context the browser left suspended', async () => {
    vi.stubGlobal('AudioContext', FakeContext);
    const { ctx, engine } = await boot();
    const resume = vi.spyOn(ctx, 'resume');
    await engine.start();
    expect(resume).not.toHaveBeenCalled();
    ctx.state = 'suspended';
    await engine.start();
    expect(resume).toHaveBeenCalledTimes(1);
    expect(ctx.state).toBe('running');
    await engine.start();
    expect(resume).toHaveBeenCalledTimes(1);
  });

  it('closes the context when the graph cannot be built or the engine is disposed mid-start', async () => {
    vi.stubGlobal('AudioContext', FakeContext);
    const broken = new FakeContext();
    broken.createDynamicsCompressor = () => { throw new Error('unsupported'); };
    const failed = new AudioEngine({ contextFactory: () => asContext(broken) });
    await failed.start();
    expect(failed.running).toBe(false);
    expect(broken.state).toBe('closed');

    const ctx = new FakeContext();
    const e = new AudioEngine({ contextFactory: () => asContext(ctx) });
    const pending = e.start();
    e.dispose();
    await pending;
    expect(ctx.state).toBe('closed');
  });

  it('closes its context on dispose', async () => {
    vi.stubGlobal('AudioContext', FakeContext);
    const { ctx, engine } = await boot();
    engine.dispose();
    expect(ctx.state).toBe('closed');
  });
});
