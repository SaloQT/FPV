/**
 * The AI pilots tab: pick a trained brain and let it fly your quad, load a brain file, and start a spectator race between
 * several brains. The app's brain hub does the work; this only shows its state and forwards the clicks.
 */
import { el, setText } from './dom';
import { rowFor, type BuiltControl } from './menuHost';
import type { CustomControl, MenuTab } from './menuSchema';
import './brains.css';

export interface BrainListing {
  name: string;
  /** One line about how it was trained and how it flies. */
  summary: string;
}

/** What the tab needs from the app's brain hub. */
export interface BrainMenuHost {
  list(): readonly BrainListing[];
  /** The brain flying the player's quad, or null. */
  flying(): string | null;
  /** The brains in the running race, the player's quad first; empty without a race. */
  racing(): readonly string[];
  /** Index into `racing()` of the quad the camera follows. */
  following(): number;
  /** Status or error line. */
  message(): string;
  /** Listens for any change of the above; returns the unsubscribe. */
  subscribe(fn: () => void): () => void;
  fly(name: string): void;
  stop(): void;
  loadFile(file: File): void;
  race(names: readonly string[]): void;
  follow(index: number): void;
}

const FLY_HINT = 'The brain takes the sticks of your quad in acro mode, arms on the pad and flies the track. Your sticks do nothing until you stop it.';
const LOAD_HINT = 'A brain file written by the trainer (tools/brain/train.mjs). It joins the list for this visit.';
const RACE_HINT = 'Tick two or more brains. The first flies your quad, the others race beside it as ghosts on the same track and wind. Restart run (or Backspace) restarts the race.';
const FOLLOW_HINT = 'The quad the camera rides with. C still switches between first person, chase and free.';

function button(label: string, tone: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', `fpv-btn fpv-btn--${tone}`, label);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

function flyControl(hub: BrainMenuHost): BuiltControl {
  const r = rowFor({ label: 'Brain', hint: FLY_HINT }, 'select');
  const select = el('select', 'fpv-select');
  select.id = r.id;
  r.describe(select);
  const fly = button('Fly', 'primary', () => { if (select.value) hub.fly(select.value); });
  const stop = button('Stop', 'default', () => hub.stop());
  const info = el('p', 'fpv-hint fpv-brain-info', '');
  r.ctl.append(select, fly, stop);
  r.root.append(info);
  const sync = (): void => {
    const list = hub.list();
    const keep = select.value || hub.flying() || '';
    select.replaceChildren(...list.map((b) => new Option(b.name, b.name)));
    if (list.some((b) => b.name === keep)) select.value = keep;
    const flying = hub.flying();
    fly.disabled = list.length === 0;
    stop.disabled = flying === null;
    const shown = list.find((b) => b.name === select.value);
    setText(info, [flying ? `Flying: ${flying}.` : '', shown?.summary ?? (list.length ? '' : 'No brains found. Train one with node tools/brain/train.mjs, or load a file below.'), hub.message()].filter(Boolean).join(' '));
  };
  select.addEventListener('change', sync);
  hub.subscribe(sync);
  return { root: r.root, sync };
}

function loadControl(hub: BrainMenuHost): BuiltControl {
  const r = rowFor({ label: 'Load a brain file', hint: LOAD_HINT }, 'button');
  const input = el('input', 'fpv-file');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.id = r.id;
  input.hidden = true;
  const pick = button('Choose file', 'default', () => input.click());
  input.addEventListener('change', () => {
    const f = input.files?.[0];
    if (f) hub.loadFile(f);
    input.value = '';
  });
  r.ctl.append(input, pick);
  return { root: r.root, sync: () => {} };
}

function raceControl(hub: BrainMenuHost): BuiltControl {
  const r = rowFor({ label: 'Racers', hint: RACE_HINT }, 'list');
  const list = el('div', 'fpv-brain-list');
  const start = button('Start race', 'primary', () => hub.race(picked()));
  const stop = button('Stop race', 'default', () => hub.race([]));
  r.ctl.append(list, el('div', 'fpv-brain-actions', start, stop));
  const boxes = new Map<string, HTMLInputElement>();
  const picked = (): string[] => hub.list().map((b) => b.name).filter((n) => boxes.get(n)?.checked);
  const sync = (): void => {
    const names = hub.list().map((b) => b.name);
    const racing = hub.racing();
    const was = new Set(boxes.size ? picked() : racing.length ? racing : names.slice(0, 4));
    boxes.clear();
    list.replaceChildren(...names.map((n) => {
      const box = el('input', 'fpv-check');
      box.type = 'checkbox';
      box.checked = was.has(n);
      box.addEventListener('change', () => { start.disabled = picked().length < 2; });
      boxes.set(n, box);
      return el('label', 'fpv-brain-pick', box, el('span', '', n));
    }));
    start.disabled = picked().length < 2;
    stop.disabled = racing.length === 0;
  };
  hub.subscribe(sync);
  return { root: r.root, sync };
}

function followControl(hub: BrainMenuHost): BuiltControl {
  const r = rowFor({ label: 'Camera follows', hint: FOLLOW_HINT }, 'select');
  const select = el('select', 'fpv-select');
  select.id = r.id;
  r.describe(select);
  r.ctl.append(select);
  select.addEventListener('change', () => hub.follow(Number(select.value)));
  const sync = (): void => {
    const racing = hub.racing();
    select.replaceChildren(...(racing.length ? racing : ['Your quad']).map((n, i) => new Option(i === 0 && racing.length ? `${n} (your quad)` : n, String(i))));
    select.value = String(racing.length ? hub.following() : 0);
    select.disabled = racing.length === 0;
  };
  hub.subscribe(sync);
  return { root: r.root, sync };
}

const custom = (id: string, label: string, build: (hub: BrainMenuHost) => BuiltControl, hub: BrainMenuHost): CustomControl => ({ kind: 'custom', id, label, build: () => build(hub) });

/** The AI pilots tab, bound to the app's brain hub. */
export function brainTab(hub: BrainMenuHost): MenuTab {
  return {
    id: 'ai',
    label: 'AI pilots',
    sections: [
      { title: 'Fly a brain', controls: [custom('brain.fly', 'Brain', flyControl, hub), custom('brain.load', 'Load a brain file', loadControl, hub)] },
      { title: 'Spectator race', controls: [custom('brain.race', 'Racers', raceControl, hub), custom('brain.follow', 'Camera follows', followControl, hub)] },
    ],
  };
}
