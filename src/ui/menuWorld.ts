import { el, setText, uid } from './dom';
import { buildControl } from './menuControls';
import { ControlGroup, rowFor, type BuiltControl, type ControlHost } from './menuHost';
import { slider, percent, type Control } from './menuSchema';
import { buildOptionToggle } from './menuExtras';
import { TRACK_SETUP } from './menuTabs';
import { parseSeed, randomSeed, shareUrl } from './seedModel';
import type { AppSettings } from './settingsSchema';
import { describeStyle, effectiveGates, effectiveLaps, gateRange, lapsApply } from './trackLimits';
import { TrackPreview } from './trackPreview';
import type { PreviewState } from './trackPreviewModel';
import './flow.css';

const COPIED_MS = 1600;

/** Same text field the world seed has always been, but it takes words too, and sits next to the buttons that pick or share one. */
function seedRow(host: ControlHost): BuiltControl {
  const id = uid('fpv-seed');
  const label = el('label', 'fpv-label', 'Seed');
  label.htmlFor = id;
  const input = el('input', 'fpv-input fpv-seed');
  input.type = 'text';
  input.id = id;
  input.maxLength = 40;
  input.spellcheck = false;
  input.autocomplete = 'off';
  input.setAttribute('aria-describedby', `${id}-hint`);
  input.placeholder = 'number or any word';
  const dice = el('button', 'fpv-btn fpv-btn--small', 'Random');
  dice.type = 'button';
  dice.setAttribute('aria-label', 'Random seed');
  const copy = el('button', 'fpv-btn fpv-btn--small', 'Copy link');
  copy.type = 'button';
  copy.title = 'Copies a link that opens this exact world';
  const hint = el('p', 'fpv-hint', 'The same seed builds the same terrain and track.');
  hint.id = `${id}-hint`;
  const root = el('div', 'fpv-world-seed', el('div', 'fpv-world-line', label, input, dice, copy), hint);
  let timer = 0;

  const show = (): void => { input.value = String(host.settings().seed); };
  input.addEventListener('change', () => {
    const seed = parseSeed(input.value);
    if (seed !== null) host.change({ seed });
    show();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') input.blur();
  });
  dice.addEventListener('click', () => {
    host.change({ seed: randomSeed() });
    show();
  });
  copy.addEventListener('click', () => {
    const url = shareUrl(host.shareBase(), host.settings());
    void copyText(url).then((ok) => {
      setText(copy, ok ? 'Copied' : 'Copy failed');
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setText(copy, 'Copy link'), COPIED_MS);
    });
  });
  return { root, sync: () => { if (document.activeElement !== input) show(); } };
}

/** The clipboard API needs a secure page; the textarea route covers plain http on a LAN. */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = el('textarea');
    area.value = text;
    area.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
    document.body.append(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    area.remove();
    return ok;
  }
}

/** A slider whose range and availability follow the track style: the generator clamps gates per style and flies laps only on circuits. */
function styledSlider(host: ControlHost, label: string, key: 'gateCount' | 'laps', hint?: string): BuiltControl {
  const r = rowFor({ label }, 'slider');
  const input = el('input', 'fpv-range');
  input.type = 'range';
  input.id = r.id;
  input.step = '1';
  const out = el('output', 'fpv-value');
  out.htmlFor = r.id;
  r.ctl.append(input, out);
  const note = el('p', 'fpv-hint', hint ?? '');
  note.hidden = true;
  if (hint !== undefined) r.root.append(note);
  const bounds = (s: AppSettings): { min: number; max: number; value: number; fixed: boolean } => {
    if (key === 'gateCount') {
      const { min, max } = gateRange(s.trackStyle);
      return { min, max, value: effectiveGates(s.trackStyle, s.gateCount), fixed: false };
    }
    return { min: 1, max: 10, value: effectiveLaps(s.trackStyle, s.laps), fixed: !lapsApply(s.trackStyle) };
  };
  let dragging = false;
  const paint = (b: ReturnType<typeof bounds>): void => {
    input.min = String(b.min);
    input.max = String(b.max);
    input.disabled = b.fixed;
    input.value = String(b.value);
    input.style.setProperty('--fill', `${((b.value - b.min) / (b.max - b.min)) * 100}%`);
    setText(out, String(b.value));
    note.hidden = !b.fixed;
  };
  input.addEventListener('input', () => {
    const v = Number(input.value);
    input.style.setProperty('--fill', `${((v - Number(input.min)) / (Number(input.max) - Number(input.min))) * 100}%`);
    setText(out, String(v));
    host.change(key === 'gateCount' ? { gateCount: v } : { laps: v });
  });
  input.addEventListener('pointerdown', () => { dragging = true; });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture', 'blur']) input.addEventListener(type, () => { dragging = false; });
  return { root: r.root, sync: (s) => { if (!dragging) paint(bounds(s)); } };
}

/** What the chosen style builds, so the gate and lap limits below it make sense. */
function styleCaption(): BuiltControl {
  const root = el('p', 'fpv-hint fpv-world-style', '');
  return { root, sync: (s) => setText(root, describeStyle(s.trackStyle)) };
}

function setup(): Control[] {
  const style = TRACK_SETUP.find((c) => c.id === 'trackStyle');
  return [
    ...(style === undefined ? [] : [{ ...style, label: 'Style' }]),
    slider('difficulty', 'Difficulty', 0, 1, 0.05, percent),
  ];
}

/**
 * The start screen's world card: the seed with its Random and share buttons, the track style, length and difficulty, and
 * a top-down map of the track that is being built from them, with its length, gate count and lap-time estimate.
 */
export class WorldCard {
  readonly root: HTMLElement;
  private readonly preview = new TrackPreview();
  private readonly group = new ControlGroup();

  constructor(host: ControlHost) {
    const controls = el('div', 'fpv-world-controls');
    const seed = this.group.add(seedRow(host)).root;
    const [style, difficulty] = setup();
    controls.append(this.group.add(buildControl(style, host)).root);
    controls.append(this.group.add(styleCaption()).root);
    controls.append(this.group.add(styledSlider(host, 'Gates', 'gateCount')).root);
    controls.append(this.group.add(styledSlider(host, 'Laps', 'laps', 'One run: only the Race style is a circuit.')).root);
    controls.append(this.group.add(buildControl(difficulty, host)).root);
    controls.append(this.group.add(buildOptionToggle('raceStart', 'Race start', 'A 3-2-1-GO keeps the quad disarmed until GO. Off is free flight.', host)).root);
    this.root = el('section', 'fpv-card fpv-world', el('h3', 'fpv-section-title', 'World'), seed, el('div', 'fpv-world-grid', this.preview.root, controls));
  }

  sync(settings: AppSettings): void {
    this.group.sync(settings);
  }

  setPreview(state: PreviewState): void {
    this.preview.setState(state);
  }

  /** The card was shown again: redraw the map at the size it now has. */
  refresh(): void {
    this.preview.refresh();
  }
}
