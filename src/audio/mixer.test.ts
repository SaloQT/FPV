import { describe, expect, it } from 'vitest';
import { asContext, FakeContext, FakeNode } from './fakeAudio';
import { DEFAULT_VOLUMES, Mixer, ONBOARD_GAIN, PILOT_GAIN, REFERENCE_DISTANCE, volumeGain } from './mixer';

describe('volumeGain', () => {
  it('squares the slider, clamps it and shrugs off junk', () => {
    expect(volumeGain(0)).toBe(0);
    expect(volumeGain(0.5)).toBe(0.25);
    expect(volumeGain(1)).toBe(1);
    expect(volumeGain(3)).toBe(1);
    expect(volumeGain(-1)).toBe(0);
    expect(volumeGain(NaN)).toBe(0);
  });
});

function build() {
  const ctx = new FakeContext();
  const mixer = new Mixer(asContext(ctx));
  return { ctx, mixer };
}

/** Follows the first output of each node until the destination (or a dead end). */
function chain(from: FakeNode): string[] {
  const out: string[] = [];
  for (let n: FakeNode | undefined = from; n; n = n.outputs[0]) out.push(n.kind);
  return out;
}

describe('Mixer graph', () => {
  it('ends in master, limiter, pre-gain, soft clip and the destination', () => {
    const { ctx } = build();
    const limiter = ctx.of('compressor')[0];
    expect(chain(limiter)).toEqual(['compressor', 'gain', 'waveShaper', 'destination']);
    expect(limiter.param('threshold').last).toBeLessThan(0);
    expect(limiter.param('ratio').last).toBeGreaterThanOrEqual(10);
    const clip = ctx.of('waveShaper')[0];
    expect(clip.curve).toBeInstanceOf(Float32Array);
    expect(clip.oversample).toBe('2x');
  });

  it('spatialises the airframe with an HRTF inverse-distance panner behind an air-absorption low-pass', () => {
    const { ctx } = build();
    const panner = ctx.of('panner')[0];
    expect(panner.panningModel).toBe('HRTF');
    expect(panner.distanceModel).toBe('inverse');
    expect(panner.refDistance).toBe(REFERENCE_DISTANCE);
    const lp = ctx.of('biquad').find((n) => n.outputs[0] === panner)!;
    expect(lp.type).toBe('lowpass');
    expect(lp.param('Q').value).toBeCloseTo(20 * Math.log10(0.5), 10);
    expect(chain(panner)).toEqual(['panner', 'gain', 'gain', 'gain', 'compressor', 'gain', 'waveShaper', 'destination']);
  });

  it('starts on the ground, with the mic branch and mic wind shut', () => {
    const { ctx, mixer } = build();
    const micLowpass = ctx.of('biquad').find((n) => n.param('frequency').value === 7000)!;
    expect(micLowpass.outputs[0].param('gain').value).toBe(0);
    expect((mixer.micIn as unknown as FakeNode).param('gain').value).toBe(0);
    const panner = ctx.of('panner')[0];
    expect(panner.outputs[0].param('gain').value).toBe(PILOT_GAIN);
  });
});

describe('Mixer control', () => {
  it('maps volumes to squared gains, effects also driving the UI bus', () => {
    const { ctx, mixer } = build();
    mixer.setVolumes({ master: 0.5, motors: 0.4, wind: 0.3, effects: 0.2 });
    const last = (n: FakeNode) => n.param('gain').last;
    expect(last(mixer.motors as unknown as FakeNode)).toBeCloseTo(0.16, 10);
    expect(last(mixer.effects as unknown as FakeNode)).toBeCloseTo(0.04, 10);
    expect(last(mixer.uiBus as unknown as FakeNode)).toBeCloseTo(0.04, 10);
    expect(ctx.of('gain').some((n) => Math.abs(last(n) - 0.25) < 1e-9)).toBe(true);
    expect(ctx.of('gain').some((n) => Math.abs(last(n) - 0.09) < 1e-9)).toBe(true);
    expect(volumeGain(DEFAULT_VOLUMES.master)).toBeCloseTo(0.64, 10);
  });

  it('crossfades between the ground listener and the onboard microphone', () => {
    const { ctx, mixer } = build();
    const mic = (mixer.micIn as unknown as FakeNode).param('gain');
    mixer.setOnboard(true);
    const onboard = ctx.of('gain').find((n) => n.param('gain').last === ONBOARD_GAIN)!;
    expect(mic.last).toBe(1);
    expect(ctx.of('gain').some((n) => n.param('gain').targets.some((t) => t.value === 0 && t.tc > 0))).toBe(true);
    mixer.setOnboard(false);
    expect(onboard.param('gain').last).toBe(0);
    expect(mic.last).toBe(0);
  });

  it('moves the panner and the low-pass, falling back to setPosition without AudioParams', () => {
    const { ctx, mixer } = build();
    mixer.setPilotScene(4000, 1, 2, -30);
    const panner = ctx.of('panner')[0];
    expect(panner.param('positionX').last).toBe(1);
    expect(panner.param('positionY').last).toBe(2);
    expect(panner.param('positionZ').last).toBe(-30);
    const lp = ctx.of('biquad').find((n) => n.outputs[0] === panner)!;
    expect(lp.param('frequency').last).toBe(4000);

    const calls: number[][] = [];
    panner.positionX = undefined;
    panner.setPosition = (x: number, y: number, z: number) => calls.push([x, y, z]);
    mixer.setPilotScene(4000, 5, 6, 7);
    expect(calls).toEqual([[5, 6, 7]]);
  });

  it('disconnects everything on dispose', () => {
    const { ctx, mixer } = build();
    mixer.dispose();
    for (const n of ctx.nodes) expect(n.connected).toBe(false);
  });
});
