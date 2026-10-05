import { describe, expect, it } from 'vitest';
import { BrainPolicy, parseBrain, serializeBrain } from './brain';
import { randomBrain } from './testBrains';
import { ACT_SIZE, OBS_SIZE } from './spec';

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
