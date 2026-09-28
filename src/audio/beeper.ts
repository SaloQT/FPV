/** Flight-controller buzzer and race-UI tones: sequences are plain data, the Beeper schedules them on the WebAudio clock. */

export type ToneKind = 'piezo' | 'bell' | 'tone';

export interface Tone {
  /** Start offset in seconds from the trigger. */
  at: number;
  dur: number;
  freq: number;
  gain: number;
  kind: ToneKind;
}

export type SequenceName =
  | 'arm' | 'disarm' | 'lowBattery' | 'beacon' | 'gatePass' | 'lap' | 'countdown' | 'countdownGo' | 'finished';

export interface Sequence {
  /** `quad` beeps come from the airframe (spatialised); `ui` beeps are heard as they are. */
  bus: 'quad' | 'ui';
  /** Triggers closer together than this are dropped (double calls, chattering thresholds). */
  minGap: number;
  tones: readonly Tone[];
}

export const PIEZO_HZ = 2500;
const PIEZO_BAND_HZ = 2600;
const PIEZO_BAND_Q = 1.5;
const BELL_PARTIAL = 2.76;

const piezo = (at: number, dur: number, freq = PIEZO_HZ, gain = 0.28): Tone => ({ at, dur, freq, gain, kind: 'piezo' });
const bell = (at: number, dur: number, freq: number, gain = 0.5): Tone => ({ at, dur, freq, gain, kind: 'bell' });

export const SEQUENCES: Record<SequenceName, Sequence> = {
  arm: { bus: 'quad', minGap: 1, tones: [piezo(0, 0.09), piezo(0.14, 0.09), piezo(0.28, 0.09)] },
  disarm: { bus: 'quad', minGap: 1, tones: [piezo(0, 0.14, PIEZO_HZ), piezo(0.22, 0.2, 2000)] },
  lowBattery: { bus: 'quad', minGap: 1.5, tones: [piezo(0, 0.12), piezo(0.22, 0.12)] },
  beacon: { bus: 'quad', minGap: 2, tones: [piezo(0, 0.4, PIEZO_HZ, 0.34), piezo(0.6, 0.4, PIEZO_HZ, 0.34), piezo(1.2, 0.4, PIEZO_HZ, 0.34)] },
  gatePass: { bus: 'ui', minGap: 0.08, tones: [bell(0, 0.35, 880, 0.45), bell(0.09, 0.45, 1320, 0.4)] },
  lap: { bus: 'ui', minGap: 0.5, tones: [bell(0, 0.5, 1047), bell(0.08, 0.5, 1319), bell(0.16, 0.5, 1568), bell(0.24, 0.8, 2093)] },
  countdown: { bus: 'ui', minGap: 0.3, tones: [{ at: 0, dur: 0.16, freq: 660, gain: 0.45, kind: 'tone' }] },
  countdownGo: { bus: 'ui', minGap: 0.3, tones: [{ at: 0, dur: 0.7, freq: 1320, gain: 0.5, kind: 'tone' }] },
  finished: {
    bus: 'ui',
    minGap: 1,
    tones: [bell(0, 0.3, 784), bell(0.12, 0.3, 1047), bell(0.24, 0.3, 1319), bell(0.36, 0.3, 1568), bell(0.52, 1.2, 2093, 0.55)],
  },
};

export function sequenceDuration(tones: readonly Tone[]): number {
  let end = 0;
  for (const t of tones) end = Math.max(end, t.at + t.dur);
  return end;
}

const NAMES = Object.keys(SEQUENCES) as SequenceName[];

export class Beeper {
  private ctx: BaseAudioContext | null = null;
  private quadBus: AudioNode | null = null;
  private uiBus: AudioNode | null = null;
  private piezoIn: GainNode | null = null;
  private piezoBand: BiquadFilterNode | null = null;
  private readonly lastAt: Record<SequenceName, number> = Object.fromEntries(NAMES.map((n) => [n, -Infinity])) as Record<SequenceName, number>;

  /** Beeps are silent no-ops until this is called. */
  attach(ctx: BaseAudioContext, quadBus: AudioNode, uiBus: AudioNode): void {
    this.detach();
    this.ctx = ctx;
    this.quadBus = quadBus;
    this.uiBus = uiBus;
    // A piezo disc rings around its resonance, which is what makes the square wave sound like a buzzer.
    this.piezoBand = ctx.createBiquadFilter();
    this.piezoBand.type = 'bandpass';
    this.piezoBand.frequency.value = PIEZO_BAND_HZ;
    this.piezoBand.Q.value = PIEZO_BAND_Q;
    this.piezoIn = ctx.createGain();
    this.piezoIn.connect(this.piezoBand).connect(quadBus);
    for (const n of NAMES) this.lastAt[n] = -Infinity;
  }

  detach(): void {
    this.piezoIn?.disconnect();
    this.piezoBand?.disconnect();
    this.ctx = this.quadBus = this.uiBus = this.piezoIn = this.piezoBand = null;
  }

  arm(): void { this.play('arm'); }
  disarm(): void { this.play('disarm'); }
  lowBattery(): void { this.play('lowBattery'); }
  beacon(): void { this.play('beacon'); }
  gatePass(): void { this.play('gatePass'); }
  lap(): void { this.play('lap'); }
  finished(): void { this.play('finished'); }

  /** Race start: three short beeps for n = 3, 2, 1 and one long beep for n = 0. */
  countdown(n: number): void {
    this.play(n > 0 ? 'countdown' : 'countdownGo');
  }

  dispose(): void {
    this.detach();
  }

  play(name: SequenceName): boolean {
    const ctx = this.ctx;
    if (!ctx || !this.piezoIn) return false;
    const seq = SEQUENCES[name];
    const now = ctx.currentTime;
    if (now - this.lastAt[name] < seq.minGap) return false;
    this.lastAt[name] = now;
    const bus = seq.bus === 'quad' ? this.quadBus! : this.uiBus!;
    for (const t of seq.tones) this.voice(ctx, t, now + t.at, t.kind === 'piezo' ? this.piezoIn : bus);
    return true;
  }

  private voice(ctx: BaseAudioContext, t: Tone, when: number, dest: AudioNode): void {
    const env = ctx.createGain();
    const g = env.gain;
    g.setValueAtTime(0, when);
    const end = when + t.dur;
    if (t.kind === 'bell') {
      g.linearRampToValueAtTime(t.gain, when + 0.004);
      g.exponentialRampToValueAtTime(0.0008, end);
    } else {
      const attack = t.kind === 'piezo' ? 0.004 : 0.012;
      const release = t.kind === 'piezo' ? 0.008 : 0.05;
      g.linearRampToValueAtTime(t.gain, when + attack);
      g.setValueAtTime(t.gain, Math.max(when + attack, end - release));
      g.linearRampToValueAtTime(0, end);
    }
    env.connect(dest);
    const stopAt = end + 0.02;
    const first = this.osc(ctx, t.kind === 'piezo' ? 'square' : 'sine', t.freq, 1, env, when, stopAt);
    if (t.kind === 'bell') this.osc(ctx, 'sine', t.freq * BELL_PARTIAL, 0.3, env, when, stopAt);
    first.onended = () => env.disconnect();
  }

  private osc(ctx: BaseAudioContext, type: OscillatorType, freq: number, level: number, dest: AudioNode, when: number, stopAt: number): OscillatorNode {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    if (level === 1) {
      o.connect(dest);
    } else {
      const g = ctx.createGain();
      g.gain.value = level;
      o.connect(g).connect(dest);
    }
    o.start(when);
    o.stop(stopAt);
    return o;
  }
}
