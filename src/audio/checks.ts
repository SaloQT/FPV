/** Offline verification scenarios and measurements behind the `?dev=audio` page: motor ramp, scripted flyby and crash. */
import { decimate, findPeak, peakAbs, rms } from './analysis';
import { BLADES, dopplerFactor, radialVelocity, SPEED_OF_SOUND, TWO_PI } from './dsp';
import { magnitudeSpectrum, peakBin } from './fft';
import { renderEngine, renderMotorRamp, type Rendered, type Script } from './offline';

export interface MotorRampResult {
  peakHz: number;
  expectedHz: number;
  rms: number;
  ok: boolean;
}

export interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

export interface Level {
  name: string;
  rmsDb: number;
  peakDb: number;
}

const RAMP = { seconds: 2, fromHz: 120, toHz: 380, rampSeconds: 1.5, amp: 0.1 };
const RAMP_TOLERANCE = 0.03;
const MIN_RMS = 1e-3;
const DECIMATION = 8;

export const dbfs = (x: number): number => 20 * Math.log10(Math.max(x, 1e-9));

export function mono(r: Rendered): Float32Array {
  const out = new Float32Array(r.left.length);
  for (let i = 0; i < out.length; i++) out[i] = 0.5 * (r.left[i] + r.right[i]);
  return out;
}

/** Renders 2 s of the motor synth with rising rpm and looks for the blade-pass line in the final steady stretch. */
export async function checkMotorRamp(): Promise<{ result: MotorRampResult; audio: Rendered; rampSeconds: number; fromHz: number; toHz: number }> {
  const audio = await renderMotorRamp(RAMP);
  const sr = audio.sampleRate;
  const x = mono(audio);
  const start = Math.floor(1.6 * sr), end = Math.floor(RAMP.seconds * sr);
  const decimated = decimate(x.subarray(start, end), DECIMATION);
  const decimatedRate = sr / DECIMATION;
  const expectedHz = BLADES * RAMP.toHz;
  const peak = findPeak(decimated, decimatedRate, 100, decimatedRate * 0.45, 2);
  const level = rms(x, start, end);
  const ok = Math.abs(peak.freq / expectedHz - 1) <= RAMP_TOLERANCE && level > MIN_RMS;
  return { result: { peakHz: peak.freq, expectedHz, rms: level, ok }, audio, rampSeconds: RAMP.rampSeconds, fromHz: RAMP.fromHz, toHz: RAMP.toHz };
}

// ───────────────────────────── Scripted flyby ─────────────────────────────

interface Key {
  t: number;
  p: readonly [number, number, number];
}

export const PILOT: readonly [number, number, number] = [0, 1.6, 0];
export const FLYBY_SECONDS = 11;
export const ARM_AT = 0.5;
export const CRASH_AT = 9.4;
export const DISARM_AT = 9.6;
const OMEGA = 2300;
const WIND = 3;
const CRASH_SPEED = 12;

/** Sit on the pad, spool up, climb, fly out to the left, pass the pilot at 25 m/s and dive into the ground. */
const PATH: readonly Key[] = [
  { t: 0, p: [0, 0.05, -3] }, { t: 2, p: [0, 0.05, -3] }, { t: 3, p: [0, 3, -3] }, { t: 5, p: [-45, 3, -6] },
  { t: 8.6, p: [45, 3, -6] }, { t: CRASH_AT, p: [55, 0.05, -6] }, { t: FLYBY_SECONDS, p: [55, 0.05, -6] },
];

function pathAt(t: number, pos: number[], vel: number[]): void {
  let i = 0;
  while (i < PATH.length - 2 && t >= PATH[i + 1].t) i++;
  const a = PATH[i], b = PATH[i + 1];
  const span = b.t - a.t;
  const u = Math.min(1, Math.max(0, (t - a.t) / span));
  const moving = t < b.t;
  for (let k = 0; k < 3; k++) {
    pos[k] = a.p[k] + (b.p[k] - a.p[k]) * u;
    vel[k] = moving ? (b.p[k] - a.p[k]) / span : 0;
  }
}

function flybyScript(onboard: boolean): Script {
  let crashed = false;
  return (t, s, c, engine) => {
    if (t === 0) engine.setPilotPosition(PILOT[0], PILOT[1], PILOT[2]);
    pathAt(t, s.pos, s.vel);
    const spin = t < 1 ? 0 : Math.min(1, t - 1);
    const flying = t < CRASH_AT;
    const omega = flying ? OMEGA * spin : 0;
    s.motorOmega[0] = s.motorOmega[1] = s.motorOmega[2] = s.motorOmega[3] = omega;
    s.armed = t >= ARM_AT && t < DISARM_AT;
    s.onGround = s.pos[1] < 0.06;
    s.crashed = !crashed && t >= CRASH_AT;
    s.impactSpeed = s.crashed ? CRASH_SPEED : 0;
    crashed ||= s.crashed;
    c.speed = Math.hypot(s.vel[0], s.vel[1], s.vel[2]);
    c.agl = s.pos[1];
    c.windSpeed = WIND;
    c.cameraMode = onboard ? 'fpv' : 'chase';
  };
}

const flightDoppler = (t: number): number => {
  const pos = [0, 0, 0], vel = [0, 0, 0];
  pathAt(t, pos, vel);
  return dopplerFactor(radialVelocity(pos[0], pos[1], pos[2], vel[0], vel[1], vel[2], PILOT[0], PILOT[1], PILOT[2]), SPEED_OF_SOUND);
};

/** Blade-pass frequency the pilot should hear at time t, Doppler included (0 while the props are stopped). */
export function expectedBladePassHz(t: number): number {
  const spin = t < 1 ? 0 : Math.min(1, t - 1);
  return t < CRASH_AT && spin > 0 ? BLADES * ((OMEGA * spin) / TWO_PI) * flightDoppler(t) : 0;
}

export function level(x: Float32Array, sr: number, t0: number, t1: number, name = ''): Level {
  const a = Math.floor(t0 * sr), b = Math.min(x.length, Math.floor(t1 * sr));
  return { name, rmsDb: dbfs(rms(x, a, b)), peakDb: dbfs(peakAbs(x, a, b)) };
}

const SEGMENTS: readonly (readonly [string, number, number])[] = [
  ['idle', 0.1, 0.45], ['arm beep', 0.5, 0.9], ['spool up', 1, 2], ['climb', 2.2, 3], ['far pass', 5.2, 5.6],
  ['closest', 6.6, 7], ['receding', 8, 8.4], ['crash', CRASH_AT, 9.9],
];

const FFT_SIZE = 16384;

function bladePassHz(x: Float32Array, sr: number, t0: number): number {
  const spectrum = magnitudeSpectrum(x, Math.floor(t0 * sr), FFT_SIZE);
  const bin = (hz: number): number => Math.round((hz * FFT_SIZE) / sr);
  return (peakBin(spectrum, bin(800), bin(1500)) * sr) / FFT_SIZE;
}

export interface FlybyReport {
  checks: Check[];
  levels: Record<'pilot' | 'onboard', Level[]>;
  pilot: Rendered;
  onboard: Rendered;
}

function dopplerCheck(pilot: Rendered): Check {
  const x = mono(pilot);
  const near = 5.2, far = 8;
  const half = FFT_SIZE / 2 / pilot.sampleRate;
  const measured = bladePassHz(x, pilot.sampleRate, near) / bladePassHz(x, pilot.sampleRate, far);
  const expected = flightDoppler(near + half) / flightDoppler(far + half);
  return { name: 'doppler', ok: Math.abs(measured / expected - 1) < 0.03, detail: `approach/recede pitch ${measured.toFixed(3)} (expected ${expected.toFixed(3)})` };
}

function beepCheck(pilot: Rendered): Check {
  const x = mono(pilot), sr = pilot.sampleRate;
  const beep = findPeak(x, sr, 1800, 3400, 25, Math.floor(ARM_AT * sr), Math.floor(0.9 * sr));
  const idle = findPeak(x, sr, 1800, 3400, 25, Math.floor(0.1 * sr), Math.floor(0.45 * sr));
  const ok = Math.abs(beep.freq / 2500 - 1) < 0.05 && beep.amp > 0.002 && beep.amp > 4 * idle.amp;
  return { name: 'arm beep', ok, detail: `${beep.freq.toFixed(0)} Hz at ${dbfs(beep.amp).toFixed(1)} dB (idle ${dbfs(idle.amp).toFixed(1)} dB)` };
}

const CRUISE_SEGMENTS = ['climb', 'far pass', 'closest', 'receding'];
/** Peak window (dBFS) for flying sound at default volumes: a -12 dBFS mix with headroom left for beeps and the crash. */
const CRUISE_PEAK_DB = [-16, -6] as const;
const CEILING_DB = -3;
const CRASH_AUDIBLE_DB = -30;
const MIN_ROLLOFF_DB = 8;

const pick = (levels: Level[], name: string): Level => levels.find((l) => l.name === name)!;

function safetyChecks(r: Rendered, label: string, levels: Level[]): Check[] {
  const all = dbfs(Math.max(peakAbs(r.left), peakAbs(r.right)));
  const cruise = Math.max(...CRUISE_SEGMENTS.map((n) => pick(levels, n).peakDb));
  const crash = pick(levels, 'crash').peakDb;
  return [
    { name: `${label} peak below ${CEILING_DB} dBFS`, ok: Number.isFinite(all) && all < CEILING_DB, detail: `peak ${all.toFixed(1)} dBFS` },
    { name: `${label} cruise headroom`, ok: cruise >= CRUISE_PEAK_DB[0] && cruise <= CRUISE_PEAK_DB[1], detail: `cruise peak ${cruise.toFixed(1)} dBFS (want ${CRUISE_PEAK_DB[0]}..${CRUISE_PEAK_DB[1]})` },
    { name: `${label} crash audible`, ok: crash > CRASH_AUDIBLE_DB, detail: `crash peak ${crash.toFixed(1)} dBFS` },
  ];
}

function rolloffCheck(levels: Level[]): Check {
  const drop = pick(levels, 'closest').peakDb - pick(levels, 'far pass').peakDb;
  return { name: 'pilot distance roll-off', ok: drop > MIN_ROLLOFF_DB, detail: `closest pass ${drop.toFixed(1)} dB louder than the far pass (want > ${MIN_ROLLOFF_DB})` };
}

/** Flies the scripted path through the whole engine, once as the ground pilot and once with the camera microphone. */
export async function runFlyby(): Promise<FlybyReport> {
  const [pilot, onboard] = await Promise.all([
    renderEngine({ seconds: FLYBY_SECONDS, script: flybyScript(false), engine: { mode: 'pilot' } }),
    renderEngine({ seconds: FLYBY_SECONDS, script: flybyScript(true), engine: { mode: 'onboard' } }),
  ]);
  const measure = (r: Rendered): Level[] => {
    const x = mono(r);
    return SEGMENTS.map(([name, a, b]) => level(x, r.sampleRate, a, b, name));
  };
  const levels = { pilot: measure(pilot), onboard: measure(onboard) };
  const checks = [dopplerCheck(pilot), beepCheck(pilot), rolloffCheck(levels.pilot), ...safetyChecks(pilot, 'pilot', levels.pilot), ...safetyChecks(onboard, 'onboard', levels.onboard)];
  return { checks, levels, pilot, onboard };
}
