/** `?dev=audio`: renders the motor synth and a scripted flyby offline, checks the spectrum and levels, draws the evidence. */
import { checkMotorRamp, CRASH_AT, expectedBladePassHz, FLYBY_SECONDS, mono, runFlyby, type Check, type FlybyReport, type Level } from '../audio/checks';
import { BLADES, buildWavetableSet, motorHarmonicAmplitude } from '../audio/dsp';
import { drawLevels, drawSpectrogram, frame, overlayCurve, text, type Box } from '../audio/spectrogram';

const MARGIN = 8;
const MAX_HZ = 3000;
const SAMPLE_RATE = 48000;
const HEADROOM_DB = -12;
const LINE = 11;
const BG = '#10131a';
const OK = '#6fd07a';
const BAD = '#ff6b6b';

type RampRun = Awaited<ReturnType<typeof checkMotorRamp>>;

function fmtLevel(l: Level): string {
  return `rms ${l.rmsDb.toFixed(1)} peak ${l.peakDb.toFixed(1)}`;
}

function drawAll(g: CanvasRenderingContext2D, w: number, h: number, ramp: RampRun, fly: FlybyReport, tableBuildMs: number, renderMs: number): void {
  g.fillStyle = BG;
  g.fillRect(0, 0, w, h);
  const allOk = ramp.result.ok && fly.checks.every((c) => c.ok);
  text(g, `audio dev  synth ${ramp.audio.synth}  ${ramp.audio.sampleRate} Hz  tables ${tableBuildMs.toFixed(0)} ms  render ${renderMs.toFixed(0)} ms  ${allOk ? 'ALL OK' : 'FAILED'}`, MARGIN, 13, allOk ? OK : BAD, '11px monospace');

  const top = 28, colW = Math.floor((w - 3 * MARGIN) / 2), specH = Math.round((h - top) * 0.27);
  const left: Box = { x: MARGIN, y: top, w: colW, h: specH }, right: Box = { x: 2 * MARGIN + colW, y: top, w: colW, h: specH };
  drawSpectrogram(g, ramp.audio.left, ramp.audio.sampleRate, left, { maxHz: MAX_HZ, fftSize: 2048 });
  drawSpectrogram(g, fly.pilot.left, fly.pilot.sampleRate, right, { maxHz: MAX_HZ, fftSize: 4096 });
  const bladePass = (t: number): number => BLADES * (ramp.fromHz + (ramp.toHz - ramp.fromHz) * Math.min(1, t / ramp.rampSeconds));
  overlayCurve(g, left, 2, MAX_HZ, bladePass, '#5fd0ff');
  overlayCurve(g, right, FLYBY_SECONDS, MAX_HZ, expectedBladePassHz, '#5fd0ff');
  frame(g, left);
  frame(g, right);
  text(g, 'motor ramp 0-2 s, 0-3 kHz (blue: 3 x rpm)', left.x, top + specH + 12, '#9aa3b2', '10px monospace');
  text(g, 'pilot flyby 0-11 s (blue: doppler blade pass)', right.x, top + specH + 12, '#9aa3b2', '10px monospace');

  const chart: Box = { x: MARGIN, y: top + specH + 18, w: w - 2 * MARGIN, h: Math.round((h - top) * 0.2) };
  drawLevels(g, chart, [
    { colour: '#5fd0ff', samples: mono(fly.pilot), sampleRate: fly.pilot.sampleRate },
    { colour: '#ffb454', samples: mono(fly.onboard), sampleRate: fly.onboard.sampleRate },
  ], FLYBY_SECONDS, -60, HEADROOM_DB);
  frame(g, chart);
  text(g, `level dBFS: blue pilot, orange onboard, green ${HEADROOM_DB} dB target; crash at ${CRASH_AT} s`, chart.x, chart.y + chart.h + 12, '#9aa3b2', '10px monospace');

  let y = chart.y + chart.h + 12 + LINE + 2;
  const line = (s: string, ok: boolean): void => { text(g, s, MARGIN, y, ok ? OK : BAD, '10px monospace'); y += LINE - 1; };
  line(`ramp: peak ${ramp.result.peakHz.toFixed(1)} Hz expected ${ramp.result.expectedHz.toFixed(0)} Hz rms ${ramp.result.rms.toFixed(3)}`, ramp.result.ok);
  for (const c of fly.checks) line(`${c.name}: ${c.detail}`, c.ok);
  const pick = (levels: Level[], name: string): Level => levels.find((l) => l.name === name)!;
  for (const key of ['pilot', 'onboard'] as const) {
    const levels = fly.levels[key];
    text(g, `${key}: closest ${fmtLevel(pick(levels, 'closest'))}  far ${fmtLevel(pick(levels, 'far pass'))}  crash ${fmtLevel(pick(levels, 'crash'))}`, MARGIN, y, '#d8dde6', '10px monospace');
    y += LINE - 1;
  }
}

function toReport(checks: Check[]): { name: string; ok: boolean; detail: string }[] {
  return checks.map((c) => ({ name: c.name, ok: c.ok, detail: c.detail }));
}

export default async function run(canvas: HTMLCanvasElement, osd: HTMLCanvasElement): Promise<void> {
  canvas.style.display = 'none';
  const w = Math.max(320, window.innerWidth), h = Math.max(180, window.innerHeight);
  osd.width = w;
  osd.height = h;
  osd.style.width = '100%';
  osd.style.height = '100%';
  const g = osd.getContext('2d')!;
  g.fillStyle = BG;
  g.fillRect(0, 0, w, h);
  text(g, 'rendering audio offline...', MARGIN, 20);
  try {
    const t0 = performance.now();
    buildWavetableSet((k) => motorHarmonicAmplitude(k), SAMPLE_RATE);
    const tableBuildMs = performance.now() - t0;
    const t1 = performance.now();
    const ramp = await checkMotorRamp();
    const fly = await runFlyby();
    const renderMs = performance.now() - t1;
    drawAll(g, w, h, ramp, fly, tableBuildMs, renderMs);
    const allOk = ramp.result.ok && fly.checks.every((c) => c.ok);
    window.__fpv = {
      ready: true,
      audioTest: {
        peakHz: ramp.result.peakHz, expectedHz: ramp.result.expectedHz, rms: ramp.result.rms, ok: ramp.result.ok,
        allOk, synth: ramp.audio.synth, engineSynth: fly.pilot.synth, sampleRate: ramp.audio.sampleRate,
        tableBuildMs: Math.round(tableBuildMs), renderMs: Math.round(renderMs),
        checks: toReport(fly.checks), levels: fly.levels,
      },
    };
  } catch (e) {
    text(g, `audio dev failed: ${String((e as Error | undefined)?.message ?? e)}`, MARGIN, 40, BAD);
    throw e;
  }
}
