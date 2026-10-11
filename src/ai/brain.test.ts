import { describe, expect, it } from 'vitest';
import { BrainPolicy, criticSizes, episodeLimits, makeBrain, parseBrain, runMlp, senses, serializeBrain, widenInputs, type Brain } from './brain';
import { DEFAULT_ENV } from './gpu/envKernel';
import { randomBrain } from './testBrains';
import { ACT_SIZE, DEFAULT_EPISODE_LIMITS, LEGACY_OBS_SIZE, OBS_SIZE } from './spec';

describe('brain files', () => {
  it('round-trips every weight and the metadata', () => {
    const b = randomBrain();
    b.stats.bestLap = 21.5;
    const back = parseBrain(serializeBrain(b));
    expect(back.name).toBe('test');
    expect(back.hidden).toEqual([8, 8]);
    expect(back.stats.bestLap).toBe(21.5);
    expect(Array.from(back.actor)).toEqual(Array.from(b.actor));
    expect(Array.from(back.critic)).toEqual(Array.from(b.critic));
    expect(Array.from(back.logStd)).toEqual([-1, -1, -1, -1]);
  });

  it('keeps where its training ended episodes, and falls back to the defaults for brains saved before that was recorded', () => {
    const b = randomBrain();
    b.episode = { stallSeconds: 5, ceiling: 80, respawn: 'last-gate' };
    expect(episodeLimits(parseBrain(serializeBrain(b)))).toEqual({ stallSeconds: 5, ceiling: 80, respawn: 'last-gate' });
    // Older brains trained at the defaults, with gate spawns before the gate due next
    const old = randomBrain();
    expect(episodeLimits(parseBrain(serializeBrain(old)))).toEqual({ ...DEFAULT_EPISODE_LIMITS, respawn: 'next-gate' });
    // A damaged record is dropped rather than trusted
    const bad = JSON.parse(serializeBrain(b));
    bad.episode = { stallSeconds: -1, ceiling: 'high' };
    expect(parseBrain(JSON.stringify(bad)).episode).toBeUndefined();
    // Those defaults are the trainer's own
    expect(DEFAULT_ENV.stallSeconds).toBe(DEFAULT_EPISODE_LIMITS.stallSeconds);
    expect(DEFAULT_ENV.ceiling).toBe(DEFAULT_EPISODE_LIMITS.ceiling);
  });

  it('reads brains saved before obstacle sensing, which see the first slots only, and widens them to fly exactly the same', () => {
    const old = parseBrain(serializeBrain(randomBrain([6, 5], 4, 0.3, LEGACY_OBS_SIZE)));
    expect(old.obs).toBe(LEGACY_OBS_SIZE);
    expect(senses(old)).toBe(false);
    const x = Float64Array.from({ length: OBS_SIZE }, (_, i) => Math.sin(i * 1.7));
    const y = x.slice().fill(0.9, LEGACY_OBS_SIZE);
    const act = (b: Brain, o: Float64Array): number[] => Array.from(new BrainPolicy(b).act(o, new Float64Array(ACT_SIZE)));
    expect(act(old, y)).toEqual(act(old, x));
    // Zero weights on the new slots: the widened networks give the old outputs whatever the obstacle slots hold
    const wide = widenInputs(old);
    const grown = makeBrain({ hidden: old.hidden, actor: wide.actor, critic: wide.critic, logStd: old.logStd });
    expect(grown.obs).toBe(OBS_SIZE);
    expect(senses(grown)).toBe(true);
    expect(act(grown, y)).toEqual(act(old, x));
    const value = (b: Brain, o: Float64Array): number => {
      const out = new Float64Array(1);
      runMlp(b.critic, criticSizes(b.hidden, b.obs), o, out, b.hidden.map((h) => new Float64Array(h)));
      return out[0];
    };
    expect(value(grown, y)).toBe(value(old, x));
  });

  it('refuses files that are not brains or do not fit the layout', () => {
    expect(() => parseBrain('{}')).toThrow(/not a drone brain/);
    expect(() => parseBrain('nope')).toThrow(/JSON/);
    const raw = JSON.parse(serializeBrain(randomBrain())) as Record<string, unknown>;
    raw.hidden = [9, 8];
    expect(() => parseBrain(JSON.stringify(raw))).toThrow(/actor weights/);
    raw.hidden = [8, 8];
    raw.obs = 12;
    expect(() => parseBrain(JSON.stringify(raw))).toThrow(/inputs/);
  });
});

describe('BrainPolicy', () => {
  it('is tanh of the actor network output, computed layer by layer', () => {
    const b = randomBrain([5]);
    const x = Float32Array.from({ length: OBS_SIZE }, (_, i) => Math.sin(i));
    const p = b.actor;
    const h = new Float64Array(5);
    for (let r = 0; r < 5; r++) {
      let a = p[5 * OBS_SIZE + r];
      for (let c = 0; c < OBS_SIZE; c++) a += p[r * OBS_SIZE + c] * x[c];
      h[r] = Math.tanh(a);
    }
    const o = 5 * OBS_SIZE + 5;
    const want = Array.from({ length: ACT_SIZE }, (_, r) => {
      let a = p[o + ACT_SIZE * 5 + r];
      for (let c = 0; c < 5; c++) a += p[o + r * 5 + c] * h[c];
      return Math.tanh(a);
    });
    const got = new BrainPolicy(b).act(x, new Float64Array(ACT_SIZE));
    for (let i = 0; i < ACT_SIZE; i++) expect(got[i]).toBeCloseTo(want[i], 6);
  });
});
