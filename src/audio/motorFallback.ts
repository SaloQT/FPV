/** Motor synth built from stock nodes for browsers without AudioWorklet: PeriodicWave oscillators plus filtered noise loops. */
import { loopSource, toAudioBuffer } from './audioBuffer';
import { tableSpectrum, type WavetableSet } from './dsp';
import { MOTOR_COUNT, MOTOR_PARAM_COUNT, P_AMP, P_FREQ, P_NOISE, P_NOISE_FC, P_RUMBLE } from './motorParams';
import type { MotorSynth } from './motorSynth';
import { noiseLoop } from './noise';

const WHOOSH_Q = 0.9;
const RUMBLE_HZ = 110;
/** RMS of the worklet's uniform (+-1) white noise, so both back ends share one level calibration. */
const UNIFORM_RMS = 1 / Math.sqrt(3);
/** Noise bandwidth of a 2nd order Butterworth low-pass in units of its cutoff. */
const BUTTERWORTH_ENBW = 1.1107;

function whiteBuffer(ctx: BaseAudioContext, seed: number): AudioBuffer {
  const data = noiseLoop('white', ctx.sampleRate, 2, seed);
  for (let i = 0; i < data.length; i++) data[i] *= UNIFORM_RMS;
  return toAudioBuffer(ctx, data);
}

export function createFallbackMotorSynth(ctx: BaseAudioContext, tables: WavetableSet): MotorSynth {
  const params: (AudioParam | null)[] = new Array<AudioParam | null>(MOTOR_PARAM_COUNT).fill(null);
  const nodes: AudioNode[] = [];
  const sources: (OscillatorNode | AudioBufferSourceNode)[] = [];
  const output = ctx.createGain();
  nodes.push(output);

  const { real, imag } = tableSpectrum(tables.data, 0, tables.size, tables.harmonics[0]);
  const wave = ctx.createPeriodicWave(real, imag, { disableNormalization: true });
  for (let i = 0; i < MOTOR_COUNT; i++) {
    const osc = ctx.createOscillator();
    osc.setPeriodicWave(wave);
    osc.frequency.value = 0;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    osc.connect(gain).connect(output);
    params[P_FREQ + i] = osc.frequency;
    params[P_AMP + i] = gain.gain;
    sources.push(osc);
    nodes.push(gain);
  }

  const whoosh = loopSource(ctx, whiteBuffer(ctx, 21));
  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.Q.value = WHOOSH_Q;
  band.frequency.value = 3500;
  const whooshGain = ctx.createGain();
  whooshGain.gain.value = 0;
  whoosh.connect(band).connect(whooshGain).connect(output);
  params[P_NOISE] = whooshGain.gain;
  params[P_NOISE_FC] = band.frequency;
  sources.push(whoosh);
  nodes.push(band, whooshGain);

  const rumble = loopSource(ctx, whiteBuffer(ctx, 22));
  const low = ctx.createBiquadFilter();
  low.type = 'lowpass';
  low.frequency.value = RUMBLE_HZ;
  low.Q.value = -3.01;
  const makeup = ctx.createGain();
  makeup.gain.value = 1 / (UNIFORM_RMS * Math.sqrt((BUTTERWORTH_ENBW * RUMBLE_HZ) / (ctx.sampleRate / 2)));
  const rumbleGain = ctx.createGain();
  rumbleGain.gain.value = 0;
  rumble.connect(low).connect(makeup).connect(rumbleGain).connect(output);
  params[P_RUMBLE] = rumbleGain.gain;
  sources.push(rumble);
  nodes.push(low, makeup, rumbleGain);

  for (const s of sources) s.start();

  return {
    kind: 'oscillator',
    output,
    params,
    dispose() {
      for (const s of sources) {
        try { s.stop(); } catch { /* already stopped */ }
        s.disconnect();
      }
      for (const n of nodes) n.disconnect();
    },
  };
}
