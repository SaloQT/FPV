/**
 * The track builder screen: a full-screen mode over the live 3D view. On the left the recipe (course numbers, terrain, the
 * weights of manoeuvres, gate kinds and objects); in the middle the 3D preview, which the mouse and WASD steer; on the right the
 * top-down map, a side elevation strip, and tabs for the track's leaderboard, the brains (race and benchmark) and the library
 * (save, load, export, import, links). The app's BuilderHub does the work; this only shows its state and forwards input.
 */
import type { RenderQuality, TrackData, TrackFeature, TrackRecipe } from '../contracts';
import { el, setHidden, setText, uid } from './dom';
import {
  COURSE_KEYS, EMPTY_GROUP_TEXT, FEATURE_HINTS, WEIGHT_MAX, WEIGHT_MIN, WEIGHT_STEP, recipeSlider, sliderEnabled, weightKinds, weightLabel, weightOf, weightShares,
  withClosed, withSeed, withValue, withWeight, type BenchRow, type ProfileModel, type RecipeNumber, type SavedTrack, type WeightGroup,
} from './builderModel';
import { leaderRows, type LeaderEntry } from './leaderboard';
import type { BrainListing } from './menuBrains';
import { parseSeed, randomSeed } from './seedModel';
import { TrackPreview } from './trackPreview';
import { buildPreview, type PreviewState } from './trackPreviewModel';
import './ui.css';
import './flow.css';
import './builder.css';

export type BuilderCameraMode = 'orbit' | 'fly' | 'top';

/** Everything the builder screen shows. */
export interface BuilderState {
  recipe: TrackRecipe;
  terrainSeed: number;
  quality: RenderQuality;
  /** The map and its build progress (the track on screen while the next one is built). */
  preview: PreviewState;
  /** The track on screen came from the builder (else it is the world the builder was opened over). */
  built: boolean;
  /** A note under the status (why a build failed, which seed was used). */
  note: string;
  profile: ProfileModel | null;
  features: string;
  boardName: string;
  board: readonly LeaderEntry[];
  fresh: LeaderEntry | null;
  brains: readonly BrainListing[];
  bench: { running: boolean; rows: readonly BenchRow[]; note: string };
  saved: readonly SavedTrack[];
  /** Name the track on screen was saved or loaded as, or ''. */
  savedName: string;
  camera: BuilderCameraMode;
  spin: boolean;
  /** The track on screen can be linked (it has a recipe). */
  linkable: boolean;
  /** Revert puts back the track from before the builder opened. */
  canRevert: boolean;
}

/** What the screen needs from the app's builder hub. */
export interface BuilderHost {
  state(): BuilderState;
  subscribe(fn: () => void): () => void;
  setRecipe(recipe: TrackRecipe): void;
  randomise(): void;
  resetRecipe(): void;
  setTerrain(seed: number): void;
  /** Runs inside the click: captures the mouse. */
  fly(): void;
  race(names: readonly string[]): void;
  benchmark(names: readonly string[]): void;
  stopBenchmark(): void;
  save(name: string): void;
  load(name: string): void;
  remove(name: string): void;
  exportFile(): void;
  importFile(file: File): void;
  copyLink(builder: boolean): Promise<boolean>;
  clearBoard(): void;
  revert(): void;
  close(): void;
  setCamera(mode: BuilderCameraMode): void;
  setSpin(on: boolean): void;
  fit(): void;
  focusGate(index: number): void;
  /** Mouse drag over the view: orbit, or pan with the right button or Shift. */
  drag(dx: number, dy: number, pan: boolean, viewPx: number): void;
  wheel(delta: number): void;
  /** Held camera keys: -1..1 forward, right and up, and the fast modifier. */
  keys(forward: number, right: number, up: number, fast: boolean): void;
}

const CONFIRM_MS = 3000;
const COPIED_MS = 1600;
const PROFILE_PAD = { left: 34, right: 8, top: 16, bottom: 16 };

function button(label: string, tone: string, onClick: () => void, title?: string): HTMLButtonElement {
  const b = el('button', `fpv-btn fpv-btn--${tone}`, label);
  b.type = 'button';
  if (title !== undefined) b.title = title;
  b.addEventListener('click', onClick);
  return b;
}

/** A button that asks for a second click within a few seconds before it acts: the in-page confirm. */
function confirmButton(label: string, confirmLabel: string, onConfirm: () => void, tone = 'small'): HTMLButtonElement {
  const b = el('button', `fpv-btn fpv-btn--${tone}`, label);
  b.type = 'button';
  let armed = 0;
  const disarm = (): void => {
    window.clearTimeout(armed);
    armed = 0;
    setText(b, label);
    b.classList.remove('fpv-btn--armed');
  };
  b.addEventListener('click', () => {
    if (armed !== 0) {
      disarm();
      onConfirm();
      return;
    }
    setText(b, confirmLabel);
    b.classList.add('fpv-btn--armed');
    armed = window.setTimeout(disarm, CONFIRM_MS);
  });
  b.addEventListener('blur', disarm);
  return b;
}

function section(title: string, ...children: (HTMLElement | null)[]): HTMLElement {
  return el('section', 'fpv-builder-section', el('h3', 'fpv-section-title', title), ...children);
}

interface RangeRow {
  root: HTMLElement;
  set(value: number, enabled?: boolean, readout?: string): void;
}

/** A labelled slider with a readout. `onInput` gets every step while dragging. */
function rangeRow(label: string, hint: string, min: number, max: number, step: number, format: (v: number) => string, onInput: (v: number) => void, compact = false): RangeRow {
  const id = uid('fpv-b');
  const name = el('label', 'fpv-label', label);
  name.htmlFor = id;
  name.title = hint;
  const input = el('input', 'fpv-range');
  input.type = 'range';
  input.id = id;
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.title = hint;
  const out = el('output', 'fpv-value');
  out.htmlFor = id;
  const root = el('div', compact ? 'fpv-builder-row fpv-builder-row--weight' : 'fpv-builder-row', name, input, out);
  let dragging = false;
  const fill = (v: number): void => input.style.setProperty('--fill', `${((v - min) / (max - min || 1)) * 100}%`);
  input.addEventListener('input', () => {
    const v = Number(input.value);
    fill(v);
    if (!compact) setText(out, format(v));
    onInput(v);
  });
  input.addEventListener('pointerdown', () => { dragging = true; });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture', 'blur']) input.addEventListener(type, () => { dragging = false; });
  return {
    root,
    set(value, enabled = true, readout) {
      input.disabled = !enabled;
      root.classList.toggle('fpv-builder-row--off', !enabled);
      if (readout !== undefined) setText(out, readout);
      if (dragging) return;
      if (readout === undefined) setText(out, format(value));
      input.value = String(value);
      fill(value);
    },
  };
}

/** A seed field that takes numbers or words, with a Random button. */
function seedField(label: string, hint: string, onSeed: (seed: number) => void): { root: HTMLElement; set(seed: number): void } {
  const id = uid('fpv-b');
  const name = el('label', 'fpv-label', label);
  name.htmlFor = id;
  const input = el('input', 'fpv-input fpv-seed');
  input.type = 'text';
  input.id = id;
  input.maxLength = 40;
  input.spellcheck = false;
  input.autocomplete = 'off';
  input.placeholder = 'number or any word';
  input.title = hint;
  const dice = button('Random', 'small', () => onSeed(randomSeed()));
  dice.setAttribute('aria-label', `Random ${label.toLowerCase()}`);
  input.addEventListener('change', () => {
    const seed = parseSeed(input.value);
    if (seed !== null) onSeed(seed);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') input.blur();
  });
  return {
    root: el('div', 'fpv-builder-seed', name, input, dice),
    set(seed) {
      if (document.activeElement !== input) input.value = String(seed);
    },
  };
}

const FORM_TAGS = new Set(['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON']);
const TEXT_TAGS = new Set(['INPUT', 'SELECT', 'TEXTAREA']);
const CAMERA_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'ShiftLeft', 'ShiftRight', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

export class BuilderUI {
  readonly element: HTMLElement;
  private readonly status = el('span', 'fpv-builder-status', '');
  private readonly statusBar = el('div', 'fpv-map-bar-fill');
  private readonly note = el('p', 'fpv-hint fpv-builder-note', '');
  private readonly flyBtn: HTMLButtonElement;
  private readonly revertBtn: HTMLButtonElement;
  private readonly map = new TrackPreview();
  private readonly profile = el('canvas', 'fpv-builder-profile');
  private readonly profileTip = el('div', 'fpv-builder-tip', '');
  private readonly features = el('p', 'fpv-builder-features', '');
  private readonly seed: ReturnType<typeof seedField>;
  private readonly terrain: ReturnType<typeof seedField>;
  private readonly circuit: HTMLButtonElement;
  private readonly open: HTMLButtonElement;
  private readonly sliders = new Map<RecipeNumber, RangeRow>();
  private readonly weights = new Map<string, RangeRow>();
  private readonly emptyNotes = new Map<WeightGroup, HTMLElement>();
  private readonly camButtons = new Map<BuilderCameraMode, HTMLButtonElement>();
  private readonly spin: HTMLButtonElement;
  private readonly tabs = new Map<string, { button: HTMLButtonElement; panel: HTMLElement }>();
  private readonly boardTitle = el('p', 'fpv-builder-board-title', '');
  private readonly boardBody = el('tbody');
  private readonly boardEmpty = el('p', 'fpv-hint', 'No finishes on this track yet. Fly it, race brains on it or run the benchmark.');
  private readonly brainList = el('div', 'fpv-brain-list fpv-builder-brains');
  private readonly brainBoxes = new Map<string, HTMLInputElement>();
  private readonly raceBtn: HTMLButtonElement;
  private readonly benchBtn: HTMLButtonElement;
  private readonly benchStop: HTMLButtonElement;
  private readonly benchNote = el('p', 'fpv-hint', '');
  private readonly benchBody = el('tbody');
  private readonly saveName = el('input', 'fpv-input');
  private readonly savedList = el('ul', 'fpv-builder-saved');
  private readonly linkBtn: HTMLButtonElement;
  private readonly builderLinkBtn: HTMLButtonElement;
  private readonly fileInput = el('input', 'fpv-file');
  private state: BuilderState;
  private frame = 0;
  private profileModel: ProfileModel | null = null;
  private profileKey = '';
  private profileDrawn: ProfileModel | null = null;
  private drag: { id: number; x: number; y: number; pan: boolean } | null = null;
  private readonly held = new Set<string>();
  private observer: ResizeObserver | null = null;
  private brainsKey = '';
  /** Laps of the circuit before it was switched to point to point. */
  private circuitLaps = 0;
  /** What the map, the leaderboard and the benchmark table show now: each is repainted only when its content changes. */
  private mapShown: unknown = null;
  private boardShown = '';
  private benchShown = '';
  private savedKey: readonly SavedTrack[] | null = null;

  constructor(root: HTMLElement, private readonly host: BuilderHost) {
    this.state = host.state();
    const title = el('h2', 'fpv-title', 'Track builder');
    title.id = uid('fpv-builder-title');
    this.flyBtn = button('Fly it', 'primary', () => host.fly(), 'Fly this track yourself (the mouse is captured)');
    this.revertBtn = confirmButton('Revert', 'Click again to revert', () => host.revert(), 'default');
    this.revertBtn.title = 'Put back the track you had before opening the builder';
    const statusWrap = el('div', 'fpv-builder-statuswrap', this.status, el('div', 'fpv-map-bar fpv-builder-bar', this.statusBar));
    const head = el('header', 'fpv-builder-head', title, statusWrap, el('span', 'fpv-spacer'),
      button('Randomise', 'default', () => host.randomise(), 'A new random mix of every variable'),
      this.revertBtn,
      button('Close', 'default', () => host.close(), 'Back to the menu with this track (Esc)'),
      this.flyBtn);

    // Left: the recipe.
    this.seed = seedField('Seed', 'The layout\'s own random stream: the same recipe and seed build the same track.', (s) => host.setRecipe(withSeed(host.state().recipe, s)));
    this.terrain = seedField('Terrain', 'The terrain the track is fitted to. A new terrain takes a few seconds to generate.', (s) => host.setTerrain(s));
    this.circuit = button('Circuit', 'small', () => host.setRecipe(withClosed(host.state().recipe, true, this.circuitLaps)));
    this.open = button('Point to point', 'small', () => {
      const r = host.state().recipe;
      // Remembered so going back to a circuit keeps its laps.
      if (r.closed) this.circuitLaps = r.laps;
      host.setRecipe(withClosed(r, false));
    });
    const shape = el('div', 'fpv-segment fpv-builder-shape', this.circuit, this.open);
    this.circuit.className = this.open.className = 'fpv-segment-btn';
    const course = section('Course', this.seed.root, shape, ...COURSE_KEYS.map((k) => this.slider(k)));
    const terrainSec = section('Terrain', this.terrain.root, el('p', 'fpv-hint', 'Leaderboards and links remember the terrain with the track.'));
    const features = section('Manoeuvres', this.slider('featureShare'), this.weightGroup('features'));
    const gates = section('Gate kinds', el('p', 'fpv-hint', 'Gates between the manoeuvres.'), this.weightGroup('gates'));
    const objects = section('Objects', this.slider('obstacles'), this.weightGroup('objects'));
    const reset = confirmButton('Reset recipe', 'Click again to reset', () => host.resetRecipe());
    const left = el('aside', 'fpv-builder-left fpv-builder-panel', course, terrainSec, features, gates, objects, el('div', 'fpv-builder-foot', reset));

    // Middle: the 3D view's controls.
    const camBar = el('div', 'fpv-segment fpv-builder-cams');
    for (const [mode, label, tip] of [['orbit', 'Orbit', 'Drag to turn, right-drag or Shift-drag to move, wheel to zoom (O)'], ['fly', 'Fly-through', 'Ride along the racing line (G)'], ['top', 'Top', 'Straight down, north up (T)']] as const) {
      const b = el('button', 'fpv-segment-btn', label);
      b.type = 'button';
      b.title = tip;
      b.addEventListener('click', () => host.setCamera(mode));
      this.camButtons.set(mode, b);
      camBar.append(b);
    }
    this.spin = button('Spin', 'small', () => host.setSpin(!host.state().spin), 'Turn slowly around the track');
    const fit = button('Fit', 'small', () => host.fit(), 'Frame the whole track (F)');
    const view = el('div', 'fpv-builder-view',
      el('div', 'fpv-builder-viewbar', camBar, this.spin, fit),
      el('p', 'fpv-builder-viewhint', 'Drag: turn  ·  Right-drag: move  ·  Wheel: zoom  ·  WASD QE: fly  ·  Shift: faster'));
    view.setAttribute('aria-label', '3D preview: drag to look around');
    this.wireView(view);

    // Right: map, profile, tabs.
    const profileWrap = el('div', 'fpv-builder-profilewrap', this.profile, this.profileTip);
    this.profileTip.hidden = true;
    this.wireProfile();
    this.wireMap();
    this.raceBtn = button('Race', 'primary', () => host.race(this.pickedBrains()), 'One brain flies your quad; two or more race each other on this track');
    this.benchBtn = button('Benchmark', 'default', () => host.benchmark(this.pickedBrains()), 'Every ticked brain flies the track on its own, as fast as the page allows; finishes go on the leaderboard');
    this.benchStop = button('Stop', 'default', () => host.stopBenchmark());
    const board = el('div', 'fpv-builder-tab',
      this.boardTitle,
      el('table', 'fpv-builder-table', el('thead', '', el('tr', '', el('th', '', '#'), el('th', '', 'Pilot'), el('th', '', 'Time'), el('th', '', 'Best lap'), el('th', '', 'Date'))), this.boardBody),
      this.boardEmpty,
      el('div', 'fpv-builder-actions', confirmButton('Clear board', 'Click again to clear', () => host.clearBoard())));
    const brains = el('div', 'fpv-builder-tab',
      el('p', 'fpv-hint', 'Tick the brains to use. Race flies them in the sim with you watching; Benchmark times each one on its own in the background.'),
      this.brainList,
      el('div', 'fpv-builder-actions', this.raceBtn, this.benchBtn, this.benchStop),
      this.benchNote,
      el('table', 'fpv-builder-table', el('thead', '', el('tr', '', el('th', '', 'Brain'), el('th', '', 'Result'), el('th', '', 'Gates'), el('th', '', 'Crashes'))), this.benchBody));
    this.saveName.type = 'text';
    this.saveName.maxLength = 48;
    this.saveName.placeholder = 'Track name';
    this.saveName.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.doSave();
    });
    this.fileInput.type = 'file';
    this.fileInput.accept = '.json,application/json';
    this.fileInput.hidden = true;
    this.fileInput.addEventListener('change', () => {
      const f = this.fileInput.files?.[0];
      if (f) host.importFile(f);
      this.fileInput.value = '';
    });
    this.linkBtn = this.copyButton('Copy link', false, 'A link that opens this terrain and track, ready to fly');
    this.builderLinkBtn = this.copyButton('Copy builder link', true, 'A link that opens this track in the builder');
    const library = el('div', 'fpv-builder-tab',
      el('div', 'fpv-builder-saverow', this.saveName, button('Save', 'small', () => this.doSave())),
      this.savedList,
      el('div', 'fpv-builder-actions',
        button('Export', 'small', () => host.exportFile(), 'Download the track as JSON (the trainer reads it with --track)'),
        button('Import', 'small', () => this.fileInput.click(), 'Load an exported track or recipe file'),
        this.linkBtn, this.builderLinkBtn, this.fileInput));
    const tabBar = el('div', 'fpv-tabs fpv-builder-tabs');
    tabBar.setAttribute('role', 'tablist');
    const panels = el('div', 'fpv-builder-tabpanels');
    for (const [id, label, panel] of [['board', 'Leaderboard', board], ['brains', 'Brains', brains], ['library', 'Library', library]] as const) {
      const b = el('button', 'fpv-tab', label);
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.addEventListener('click', () => this.selectTab(id));
      tabBar.append(b);
      panel.setAttribute('role', 'tabpanel');
      panels.append(panel);
      this.tabs.set(id, { button: b, panel });
    }
    this.selectTab('board');
    const right = el('aside', 'fpv-builder-right fpv-builder-panel', this.map.root, profileWrap, this.features, this.note, tabBar, panels);

    this.element = el('div', 'fpv-builder', head, left, view, right);
    this.element.setAttribute('role', 'dialog');
    this.element.setAttribute('aria-labelledby', title.id);
    this.element.hidden = true;
    root.append(this.element);
    if (typeof ResizeObserver !== 'undefined') {
      this.observer = new ResizeObserver(() => this.schedule());
      this.observer.observe(this.profile);
    }
    host.subscribe(() => this.schedule());
  }

  get visible(): boolean {
    return !this.element.hidden;
  }

  show(): void {
    if (this.visible) return;
    setHidden(this.element, false);
    window.addEventListener('keydown', this.onKeyDown, true);
    window.addEventListener('keyup', this.onKeyUp, true);
    window.addEventListener('blur', this.onBlur);
    this.state = this.host.state();
    this.render();
    this.map.refresh();
    this.flyBtn.focus({ preventScroll: true });
  }

  hide(): void {
    if (!this.visible) return;
    window.removeEventListener('keydown', this.onKeyDown, true);
    window.removeEventListener('keyup', this.onKeyUp, true);
    window.removeEventListener('blur', this.onBlur);
    this.onBlur();
    setHidden(this.element, true);
    const a = document.activeElement;
    if (a instanceof HTMLElement && this.element.contains(a)) a.blur();
  }

  dispose(): void {
    this.hide();
    cancelAnimationFrame(this.frame);
    this.observer?.disconnect();
    this.map.dispose();
    this.element.remove();
  }

  // ---- building the controls ----

  private slider(key: RecipeNumber): HTMLElement {
    const s = recipeSlider(key);
    const row = rangeRow(s.label, s.hint, s.min, s.max, s.step, s.format, (v) => this.host.setRecipe(withValue(this.host.state().recipe, key, v)));
    this.sliders.set(key, row);
    return row.root;
  }

  private weightGroup(group: WeightGroup): HTMLElement {
    const box = el('div', 'fpv-builder-weights');
    for (const kind of weightKinds(group)) {
      const hint = group === 'features' ? FEATURE_HINTS[kind as TrackFeature] : `How often ${weightLabel(group, kind).toLowerCase()} appear, against the others.`;
      const row = rangeRow(weightLabel(group, kind), hint, WEIGHT_MIN, WEIGHT_MAX, WEIGHT_STEP, (v) => `${Math.round(v * 100)}`, (v) => this.host.setRecipe(withWeight(this.host.state().recipe, group, kind, v)), true);
      this.weights.set(`${group}.${kind}`, row);
      box.append(row.root);
    }
    const empty = el('p', 'fpv-hint', EMPTY_GROUP_TEXT[group]);
    this.emptyNotes.set(group, empty);
    return el('div', '', box, empty);
  }

  private copyButton(label: string, builder: boolean, title: string): HTMLButtonElement {
    const b = button(label, 'small', () => {
      void this.host.copyLink(builder).then((ok) => {
        setText(b, ok ? 'Copied' : 'Copy failed');
        window.setTimeout(() => setText(b, label), COPIED_MS);
      });
    }, title);
    return b;
  }

  private doSave(): void {
    const name = this.saveName.value.trim();
    this.host.save(name);
  }

  private selectTab(id: string): void {
    for (const [k, t] of this.tabs) {
      const on = k === id;
      t.button.classList.toggle('fpv-tab--on', on);
      t.button.setAttribute('aria-selected', String(on));
      setHidden(t.panel, !on);
    }
  }

  private pickedBrains(): string[] {
    return this.state.brains.map((b) => b.name).filter((n) => this.brainBoxes.get(n)?.checked);
  }

  // ---- input ----

  private wireView(view: HTMLElement): void {
    view.addEventListener('pointerdown', (e) => {
      if (e.target !== view) return;
      this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, pan: e.button !== 0 || e.shiftKey };
      view.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    view.addEventListener('pointermove', (e) => {
      const d = this.drag;
      if (d === null || d.id !== e.pointerId) return;
      const dx = e.clientX - d.x, dy = e.clientY - d.y;
      d.x = e.clientX;
      d.y = e.clientY;
      this.host.drag(dx, dy, d.pan || e.shiftKey, view.clientHeight || window.innerHeight);
    });
    const end = (e: PointerEvent): void => {
      if (this.drag?.id === e.pointerId) this.drag = null;
    };
    view.addEventListener('pointerup', end);
    view.addEventListener('pointercancel', end);
    view.addEventListener('contextmenu', (e) => e.preventDefault());
    view.addEventListener('dblclick', (e) => {
      if (e.target === view) this.host.fit();
    });
    view.addEventListener('wheel', (e) => {
      e.preventDefault();
      const scale = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1;
      this.host.wheel(e.deltaY * scale);
    }, { passive: false });
  }

  private wireMap(): void {
    const canvas = this.map.root.querySelector('canvas');
    if (canvas === null) return;
    canvas.style.cursor = 'pointer';
    canvas.title = 'Click a gate to fly the camera to it';
    canvas.addEventListener('click', (e) => {
      const track = this.state.preview.track;
      if (track === null) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const r = canvas.getBoundingClientRect();
      // The same layout TrackPreview draws with, so a click lands on the gate under it.
      const m = buildPreview(track, { width: Math.round(canvas.clientWidth * dpr), height: Math.round(canvas.clientHeight * dpr), padding: Math.round(26 * dpr) });
      const x = (e.clientX - r.left) * dpr, y = (e.clientY - r.top) * dpr;
      let best = -1, bd = (16 * dpr) ** 2;
      for (const g of m.gates) {
        const d = (g.x - x) ** 2 + (g.y - y) ** 2;
        if (d < bd) {
          bd = d;
          best = g.index;
        }
      }
      if (best >= 0) this.host.focusGate(best);
    });
  }

  private wireProfile(): void {
    const c = this.profile;
    const at = (e: MouseEvent): number => {
      const m = this.profileModel;
      if (m === null) return -1;
      const r = c.getBoundingClientRect();
      const x = e.clientX - r.left;
      const w = r.width - PROFILE_PAD.left - PROFILE_PAD.right;
      const s = ((x - PROFILE_PAD.left) / Math.max(w, 1)) * m.length;
      let best = -1, bd = (m.length / Math.max(w, 1)) * 10;
      for (const g of m.gates) {
        const d = Math.abs(g.s - s);
        if (d < bd) {
          bd = d;
          best = g.index;
        }
      }
      return best;
    };
    c.addEventListener('mousemove', (e) => {
      const m = this.profileModel;
      const i = at(e);
      const g = m?.gates.find((x) => x.index === i);
      setHidden(this.profileTip, g === undefined);
      if (g === undefined || m === null) return;
      const above = g.y - m.yMin;
      setText(this.profileTip, `Gate ${g.index + 1}${g.feature !== undefined ? ` (${g.feature})` : ''}: ${Math.round(above)} m above the lowest point, ${Math.round(g.s)} m in`);
    });
    c.addEventListener('mouseleave', () => setHidden(this.profileTip, true));
    c.addEventListener('click', (e) => {
      const i = at(e);
      if (i >= 0) this.host.focusGate(i);
    });
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target as HTMLElement | null;
    const inField = t !== null && TEXT_TAGS.has(t.tagName);
    if (e.code === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (inField) t.blur();
      else this.host.close();
      return;
    }
    if (inField || (t !== null && FORM_TAGS.has(t.tagName) && t.tagName !== 'BUTTON')) return;
    let handled = true;
    if (CAMERA_KEYS.has(e.code)) {
      this.held.add(e.code);
      this.pushKeys();
    } else if (e.code === 'KeyF' && !e.repeat) this.host.fit();
    else if (e.code === 'KeyT' && !e.repeat) this.host.setCamera('top');
    else if (e.code === 'KeyG' && !e.repeat) this.host.setCamera('fly');
    else if (e.code === 'KeyO' && !e.repeat) this.host.setCamera('orbit');
    else handled = false;
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    if (this.held.delete(e.code)) {
      this.pushKeys();
      e.stopPropagation();
    }
  };

  private readonly onBlur = (): void => {
    if (this.held.size === 0) return;
    this.held.clear();
    this.pushKeys();
  };

  private pushKeys(): void {
    const h = this.held;
    const axis = (pos: string[], neg: string[]): number => (pos.some((k) => h.has(k)) ? 1 : 0) - (neg.some((k) => h.has(k)) ? 1 : 0);
    this.host.keys(axis(['KeyW', 'ArrowUp'], ['KeyS', 'ArrowDown']), axis(['KeyD', 'ArrowRight'], ['KeyA', 'ArrowLeft']), axis(['KeyE'], ['KeyQ']), h.has('ShiftLeft') || h.has('ShiftRight'));
  }

  // ---- painting ----

  private schedule(): void {
    if (this.frame !== 0) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      if (!this.visible) return;
      this.state = this.host.state();
      this.render();
    });
  }

  private render(): void {
    const s = this.state;
    const p = s.preview;
    const busy = p.status === 'working';
    setText(this.status, busy ? `${p.stage || 'Building'}  ${Math.round(p.progress * 100)}%` : p.status === 'error' ? 'Could not build that' : s.built ? 'Ready' : 'Showing the track you had: move any control to build');
    this.status.classList.toggle('fpv-builder-status--error', p.status === 'error');
    this.statusBar.style.width = `${Math.round((busy ? p.progress : p.status === 'error' ? 0 : 1) * 100)}%`;
    setText(this.note, p.status === 'error' ? p.message : s.note);
    this.flyBtn.disabled = busy || p.track === null;
    this.revertBtn.disabled = !s.canRevert;
    if (p !== this.mapShown) {
      this.mapShown = p;
      this.map.setState(p);
    }
    setText(this.features, p.track === null ? '' : s.features);
    this.renderRecipe(s.recipe, s.terrainSeed);
    for (const [mode, b] of this.camButtons) b.classList.toggle('fpv-segment-btn--on', mode === s.camera);
    this.spin.classList.toggle('fpv-btn--on', s.spin);
    this.spin.disabled = s.camera === 'fly';
    this.renderBoard(s);
    this.renderBrains(s, busy);
    this.renderSaved(s);
    this.linkBtn.disabled = this.builderLinkBtn.disabled = !s.linkable;
    if (document.activeElement !== this.saveName && this.saveName.value === '' && s.savedName !== '') this.saveName.value = s.savedName;
    this.drawProfile(s.profile, p.track);
  }

  private renderRecipe(r: TrackRecipe, terrainSeed: number): void {
    this.seed.set(r.seed);
    this.terrain.set(terrainSeed);
    this.circuit.classList.toggle('fpv-segment-btn--on', r.closed);
    this.open.classList.toggle('fpv-segment-btn--on', !r.closed);
    for (const [key, row] of this.sliders) row.set(r[key], sliderEnabled(r, key));
    for (const group of ['gates', 'features', 'objects'] as const) {
      const shares = weightShares(r, group);
      let any = false;
      for (const kind of weightKinds(group)) {
        const v = weightOf(r, group, kind);
        if (v > 0) any = true;
        this.weights.get(`${group}.${kind}`)?.set(v, true, v > 0 ? `${Math.round(shares[kind] * 100)}%` : 'off');
      }
      const note = this.emptyNotes.get(group);
      if (note !== undefined) setHidden(note, any);
    }
  }

  private renderBoard(s: BuilderState): void {
    setText(this.boardTitle, s.boardName);
    const rows = leaderRows(s.board, s.fresh);
    const key = JSON.stringify(rows);
    if (key === this.boardShown) return;
    this.boardShown = key;
    this.boardBody.replaceChildren(...rows.map((r) => {
      const tr = el('tr', r.fresh ? 'fpv-builder-fresh' : '', el('td', '', String(r.rank)), el('td', '', el('span', `fpv-builder-kind fpv-builder-kind--${r.kind}`, r.kind === 'you' ? 'You' : 'AI'), ` ${r.kind === 'you' ? '' : r.pilot}`), el('td', 'fpv-builder-num', r.total), el('td', 'fpv-builder-num', r.best), el('td', 'fpv-builder-date', r.date));
      return tr;
    }));
    setHidden(this.boardEmpty, rows.length > 0);
  }

  private renderBrains(s: BuilderState, busy: boolean): void {
    const key = s.brains.map((b) => b.name).join('\n');
    if (key !== this.brainsKey) {
      const was = new Set(this.brainBoxes.size > 0 ? this.pickedBrains() : s.brains.map((b) => b.name));
      this.brainsKey = key;
      this.brainBoxes.clear();
      this.brainList.replaceChildren(...s.brains.map((b) => {
        const box = el('input', 'fpv-check');
        box.type = 'checkbox';
        box.checked = was.has(b.name);
        box.addEventListener('change', () => this.schedule());
        this.brainBoxes.set(b.name, box);
        const label = el('label', 'fpv-brain-pick', box, el('span', '', b.name));
        label.title = b.summary;
        return label;
      }));
      if (s.brains.length === 0) this.brainList.append(el('p', 'fpv-hint', 'No brains found. Train one with node tools/brain/train.mjs, or load a file in Settings, AI pilots.'));
    }
    const picked = this.pickedBrains().length;
    this.raceBtn.disabled = busy || picked === 0 || s.bench.running;
    this.benchBtn.disabled = busy || picked === 0 || s.bench.running;
    setHidden(this.benchStop, !s.bench.running);
    setText(this.benchNote, s.bench.note);
    const rowsKey = JSON.stringify(s.bench.rows);
    if (rowsKey === this.benchShown) return;
    this.benchShown = rowsKey;
    this.benchBody.replaceChildren(...s.bench.rows.map((r) => el('tr', r.finished ? '' : 'fpv-builder-dnf', el('td', '', r.name), el('td', 'fpv-builder-num', r.result), el('td', 'fpv-builder-num', r.gates), el('td', 'fpv-builder-num', String(r.crashes)))));
  }

  private renderSaved(s: BuilderState): void {
    if (this.savedKey === s.saved) return;
    this.savedKey = s.saved;
    if (s.saved.length === 0) {
      this.savedList.replaceChildren(el('li', 'fpv-hint', 'Nothing saved yet. Name the track and press Save.'));
      return;
    }
    this.savedList.replaceChildren(...s.saved.map((t) => {
      const when = t.savedAt > 0 ? new Date(t.savedAt).toISOString().slice(0, 10) : '';
      const what = t.recipe !== undefined ? `${t.recipe.gateCount} gates, ${t.recipe.closed ? `${t.recipe.laps} lap${t.recipe.laps === 1 ? '' : 's'}` : 'point to point'}` : 'from a file';
      return el('li', 'fpv-builder-saved-row',
        el('span', 'fpv-builder-saved-name', t.name),
        el('span', 'fpv-builder-saved-meta', `${what} · terrain ${t.terrainSeed} · ${when}`),
        button('Load', 'small', () => this.host.load(t.name)),
        confirmButton('Delete', 'Sure?', () => this.host.remove(t.name)));
    }));
  }

  /** The side view: ground under the line, the line itself, the gates as bars of their kind's colour, and the manoeuvres named on top. */
  private drawProfile(m: ProfileModel | null, track: TrackData | null): void {
    this.profileModel = m;
    const c = this.profile;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(c.clientWidth * dpr), h = Math.round(c.clientHeight * dpr);
    if (w < 2 || h < 2) return;
    const key = `${w}x${h}`;
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    } else if (this.profileKey === key && m === this.profileDrawn) return;
    this.profileKey = key;
    this.profileDrawn = m;
    const g = c.getContext('2d');
    if (g === null) return;
    g.clearRect(0, 0, w, h);
    if (m === null || track === null) return;
    const L = PROFILE_PAD.left * dpr, R = w - PROFILE_PAD.right * dpr, T = PROFILE_PAD.top * dpr, B = h - PROFILE_PAD.bottom * dpr;
    const span = m.yMax - m.yMin;
    const px = (s: number): number => L + (s / Math.max(m.length, 1)) * (R - L);
    const py = (y: number): number => B - ((y - m.yMin) / span) * (B - T);
    const n = m.line.length / 2;
    // Ground.
    g.beginPath();
    g.moveTo(px(m.ground[0]), B);
    for (let i = 0; i < n; i++) g.lineTo(px(m.ground[2 * i]), py(m.ground[2 * i + 1]));
    g.lineTo(px(m.ground[2 * (n - 1)]), B);
    g.closePath();
    g.fillStyle = 'rgba(120, 140, 100, 0.35)';
    g.fill();
    // Manoeuvres.
    g.font = `600 ${Math.round(10 * dpr)}px system-ui, sans-serif`;
    g.textBaseline = 'top';
    g.textAlign = 'center';
    for (const f of m.features) {
      const x0 = px(f.s0) - 4 * dpr, x1 = px(f.s1) + 4 * dpr;
      g.fillStyle = 'rgba(255, 255, 255, 0.06)';
      g.fillRect(x0, T, x1 - x0, B - T);
      g.fillStyle = 'rgba(255, 255, 255, 0.75)';
      g.fillText(f.label, (x0 + x1) / 2, 2 * dpr);
    }
    // The line.
    g.beginPath();
    for (let i = 0; i < n; i++) {
      const x = px(m.line[2 * i]), y = py(m.line[2 * i + 1]);
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.strokeStyle = '#4db4ff';
    g.lineWidth = 2 * dpr;
    g.lineJoin = 'round';
    g.stroke();
    // Gates.
    for (const gate of m.gates) {
      const x = px(gate.s);
      g.strokeStyle = 'rgba(0, 0, 0, 0.7)';
      g.lineWidth = 5 * dpr;
      g.beginPath();
      g.moveTo(x, py(gate.y - gate.half));
      g.lineTo(x, py(gate.y + gate.half));
      g.stroke();
      g.strokeStyle = gate.color;
      g.lineWidth = 3 * dpr;
      g.stroke();
    }
    // Height scale.
    g.fillStyle = 'rgba(255, 255, 255, 0.6)';
    g.textAlign = 'right';
    g.textBaseline = 'middle';
    g.fillText(`${Math.round(span)} m`, L - 4 * dpr, T + 4 * dpr);
    g.fillText('0', L - 4 * dpr, B);
    g.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    g.lineWidth = dpr;
    g.beginPath();
    g.moveTo(L, T);
    g.lineTo(L, B);
    g.lineTo(R, B);
    g.stroke();
  }
}
