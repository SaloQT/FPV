/** Small WebAudio buffer helpers shared by the synth modules. */
import { noiseLoop, type NoiseKind } from './noise';

export function toAudioBuffer(ctx: BaseAudioContext, data: Float32Array): AudioBuffer {
  const buffer = ctx.createBuffer(1, data.length, ctx.sampleRate);
  buffer.getChannelData(0).set(data);
  return buffer;
}

export function loopSource(ctx: BaseAudioContext, buffer: AudioBuffer, rate = 1): AudioBufferSourceNode {
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.loop = true;
  src.playbackRate.value = rate;
  return src;
}

const noiseCache = new WeakMap<BaseAudioContext, Map<string, AudioBuffer>>();

/** A unit-RMS seamless noise loop, generated once per context and shared by every consumer. */
export function noiseBuffer(ctx: BaseAudioContext, kind: NoiseKind, seconds: number, seed: number): AudioBuffer {
  let byKey = noiseCache.get(ctx);
  if (!byKey) {
    byKey = new Map();
    noiseCache.set(ctx, byKey);
  }
  const key = `${kind}:${seconds}:${seed}`;
  let buffer = byKey.get(key);
  if (!buffer) {
    buffer = toAudioBuffer(ctx, noiseLoop(kind, ctx.sampleRate, seconds, seed));
    byKey.set(key, buffer);
  }
  return buffer;
}
