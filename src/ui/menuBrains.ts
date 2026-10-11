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

/** A brain in a race and how many quads it flies. */
export interface RaceEntry {
  name: string;
  count: number;
}

/** Most quads in one race (the app's MAX_RACERS), and so the most one brain can fly. */
const MAX_QUADS = 32;

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
  /** Starts a race with this many quads of each brain (two or more in all); an empty list ends the race. */
  race(entries: readonly RaceEntry[]): void;
  follow(index: number): void;
}

const FLY_HINT = 'The brain takes the sticks of your quad in acro mode, arms on the pad and flies the track. Your sticks do nothing until you stop it.';
const LOAD_HINT = 'A brain file written by the trainer (tools/brain/train.mjs). It joins the list for this visit.';
const RACE_HINT = 'Tick brains and set how many quads each flies (up to 32 in all). The first brain ticked flies your quad; the others race beside it as ghosts on the same track and wind, and copies of a brain each fly their own line. Restart run (or Backspace) restarts the race.';
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

/** Quads per brain in a running race, from its labels ("ultimate #3" or a lone brain's name), in race order. */
export function raceCounts(names: readonly string[], labels: readonly string[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const label of labels) {
    const name = names.find((n) => label === n || label.startsWith(`${n} #`));
    if (name) out.set(name, (out.get(name) ?? 0) + 1);
  }
  return out;
}

function raceControl(hub: BrainMenuHost): BuiltControl {
  const r = rowFor({ label: 'Racers', hint: RACE_HINT }, 'list');
  const list = el('div', 'fpv-brain-list fpv-brain-list--counts');
  const total = el('p', 'fpv-hint fpv-brain-total', '');
  const start = button('Start race', 'primary', () => hub.race(picked()));
  const stop = button('Stop race', 'default', () => hub.race([]));
  r.ctl.append(list, total, el('div', 'fpv-brain-actions', start, stop));
  const rows = new Map<string, { box: HTMLInputElement; count: HTMLInputElement }>();
  const countOf = (input: HTMLInputElement): number => Math.max(1, Math.min(MAX_QUADS, Math.floor(Number(input.value)) || 1));
  // Ticked brains in race order, then in the order ticked: the first one flies the player's quad.
  let order: string[] = [];
  const picked = (): RaceEntry[] => order.flatMap((name) => {
    const row = rows.get(name);
    return row?.box.checked ? [{ name, count: countOf(row.count) }] : [];
  });
  const refresh = (): void => {
    const p = picked();
    const n = p.reduce((a, e) => a + e.count, 0);
    for (const { box, count } of rows.values()) count.disabled = !box.checked;
    setText(total, n === 0 ? 'No quads picked.' : `${n} quad${n === 1 ? '' : 's'} in all${n > MAX_QUADS ? `: only the first ${MAX_QUADS} race` : ''}. ${p[0].name} flies your quad.`);
    start.disabled = n < 2;
  };
  let shownRace = '';
  const sync = (): void => {
    const names = hub.list().map((b) => b.name);
    const racing = hub.racing();
    // A race that just started (from here, the URL or the dashboard) shows its brains, labels "name #k" counting up; otherwise
    // keep what the pilot set, and at first the first four brains.
    const race = racing.join('\n');
    let was = new Map<string, number>();
    if (racing.length && race !== shownRace) was = raceCounts(names, racing);
    else if (rows.size) for (const e of picked()) was.set(e.name, e.count);
    else for (const n of names.slice(0, 4)) was.set(n, 1);
    shownRace = race;
    order = [...was.keys()].filter((n) => names.includes(n));
    const counts = new Map([...rows].map(([n, row]) => [n, countOf(row.count)]));
    rows.clear();
    list.replaceChildren(...names.map((n) => {
      const box = el('input', 'fpv-check');
      box.type = 'checkbox';
      box.checked = was.has(n);
      const count = el('input', 'fpv-input fpv-brain-count');
      count.type = 'number';
      count.min = '1';
      count.max = String(MAX_QUADS);
      count.step = '1';
      count.inputMode = 'numeric';
      count.value = String(was.get(n) ?? counts.get(n) ?? 1);
      count.setAttribute('aria-label', `Quads flown by ${n}`);
      box.addEventListener('change', () => {
        order = order.filter((x) => x !== n);
        if (box.checked) order.push(n);
        refresh();
      });
      count.addEventListener('input', refresh);
      rows.set(n, { box, count });
      return el('div', 'fpv-brain-row', el('label', 'fpv-brain-pick', box, el('span', '', n)), count);
    }));
    refresh();
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
