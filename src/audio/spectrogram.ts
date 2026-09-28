/** Canvas drawing for the `?dev=audio` page: spectrograms, level-versus-time chart and text. */
import { rms, peakAbs } from './analysis';
import { magnitudeSpectrum } from './fft';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SpectrogramOptions {
  maxHz: number;
  fftSize?: number;
  /** Amplitude (dBFS) mapped to the darkest and the brightest colour. */
  floorDb?: number;
  ceilDb?: number;
}

const STOPS: readonly (readonly [number, number, number])[] = [[4, 4, 24], [43, 10, 92], [176, 34, 90], [245, 154, 30], [255, 248, 192]];

function paint(t: number, out: Uint8ClampedArray, at: number): void {
  const u = Math.min(1, Math.max(0, t)) * (STOPS.length - 1);
  const i = Math.min(STOPS.length - 2, Math.floor(u));
  const f = u - i;
  for (let c = 0; c < 3; c++) out[at + c] = STOPS[i][c] + (STOPS[i + 1][c] - STOPS[i][c]) * f;
  out[at + 3] = 255;
}

/** One column per pixel of time, one row per pixel of frequency, colour by amplitude in dBFS. */
export function drawSpectrogram(g: CanvasRenderingContext2D, x: Float32Array, sampleRate: number, box: Box, o: SpectrogramOptions): void {
  const n = o.fftSize ?? 2048, floor = o.floorDb ?? -90, ceil = o.ceilDb ?? -20;
  const img = g.createImageData(box.w, box.h);
  const binHz = sampleRate / n;
  const maxBin = Math.min(n / 2 - 2, o.maxHz / binHz);
  const span = Math.max(1, x.length - n);
  const column = new Float32Array(box.h);
  for (let cx = 0; cx < box.w; cx++) {
    const spectrum = magnitudeSpectrum(x, Math.floor((cx / Math.max(1, box.w - 1)) * span), n);
    for (let r = 0; r < box.h; r++) {
      const bin = (1 - r / (box.h - 1)) * maxBin;
      const k = Math.floor(bin), f = bin - k;
      column[r] = spectrum[k] * (1 - f) + spectrum[k + 1] * f;
    }
    for (let r = 0; r < box.h; r++) {
      const db = 20 * Math.log10(Math.max(column[r], 1e-9));
      paint((db - floor) / (ceil - floor), img.data, (r * box.w + cx) * 4);
    }
  }
  g.putImageData(img, box.x, box.y);
}

export function frame(g: CanvasRenderingContext2D, box: Box, colour = '#5a6270'): void {
  g.strokeStyle = colour;
  g.lineWidth = 1;
  g.strokeRect(box.x - 0.5, box.y - 0.5, box.w + 1, box.h + 1);
}

/** A curve y(t) in Hz drawn over a spectrogram, e.g. the frequency the synth should be producing. */
export function overlayCurve(g: CanvasRenderingContext2D, box: Box, seconds: number, maxHz: number, hz: (t: number) => number, colour: string): void {
  g.save();
  g.strokeStyle = colour;
  g.lineWidth = 1;
  g.setLineDash([3, 3]);
  g.beginPath();
  let pen = false;
  for (let cx = 0; cx < box.w; cx++) {
    const f = hz((cx / (box.w - 1)) * seconds);
    if (!(f > 0)) { pen = false; continue; }
    const cy = box.y + (1 - Math.min(1, f / maxHz)) * (box.h - 1);
    if (pen) g.lineTo(box.x + cx, cy);
    else g.moveTo(box.x + cx, cy);
    pen = true;
  }
  g.stroke();
  g.restore();
}

export function text(g: CanvasRenderingContext2D, s: string, x: number, y: number, colour = '#d8dde6', font = '11px monospace'): void {
  g.font = font;
  g.fillStyle = colour;
  g.fillText(s, x, y);
}

export interface LevelSeries {
  colour: string;
  samples: Float32Array;
  sampleRate: number;
}

const WINDOW_SECONDS = 0.05;

/** RMS (bright) and peak (dim) level of each series over time, with a reference line, e.g. the -12 dBFS headroom target. */
export function drawLevels(g: CanvasRenderingContext2D, box: Box, series: readonly LevelSeries[], seconds: number, floorDb: number, refDb: number): void {
  const yOf = (db: number): number => box.y + (1 - (Math.min(0, Math.max(floorDb, db)) - floorDb) / -floorDb) * box.h;
  g.fillStyle = '#0c0f16';
  g.fillRect(box.x, box.y, box.w, box.h);
  g.strokeStyle = '#242a36';
  g.lineWidth = 1;
  for (let db = 0; db >= floorDb; db -= 12) {
    g.beginPath();
    g.moveTo(box.x, Math.round(yOf(db)) + 0.5);
    g.lineTo(box.x + box.w, Math.round(yOf(db)) + 0.5);
    g.stroke();
    text(g, `${db}`, box.x + 2, yOf(db) + 9, '#5a6270', '9px monospace');
  }
  g.save();
  g.strokeStyle = '#6fd07a';
  g.setLineDash([4, 3]);
  g.beginPath();
  g.moveTo(box.x, Math.round(yOf(refDb)) + 0.5);
  g.lineTo(box.x + box.w, Math.round(yOf(refDb)) + 0.5);
  g.stroke();
  g.restore();
  for (const s of series) {
    const win = Math.floor(WINDOW_SECONDS * s.sampleRate);
    for (const [peak, alpha] of [[true, 0.35], [false, 1]] as const) {
      g.globalAlpha = alpha;
      g.strokeStyle = s.colour;
      g.beginPath();
      for (let cx = 0; cx < box.w; cx++) {
        const a = Math.floor((cx / box.w) * seconds * s.sampleRate);
        const b = Math.min(s.samples.length, a + win);
        const level = peak ? peakAbs(s.samples, a, b) : rms(s.samples, a, b);
        const cy = yOf(20 * Math.log10(Math.max(level, 1e-9)));
        if (cx === 0) g.moveTo(box.x + cx, cy);
        else g.lineTo(box.x + cx, cy);
      }
      g.stroke();
    }
    g.globalAlpha = 1;
  }
}
