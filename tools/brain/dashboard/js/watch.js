// "Watch in game": opens the game in a new tab with saved brains flying, on one of the run's training worlds (rebuilt exactly
// from its share link), on a generated track, or on a theme park's race course, tour or coaster line. One drone flies the
// player's quad; two or more race, up to MAX_DRONES.
import { COASTER_NAMES, PARK_COASTERS, PARK_SIZES, ROUTE_INFO, SIZE_NAMES } from './templates.js';
import { TRAINING_STYLES } from './trainingSettings.js';

/** Most drones in one race (the game's MAX_RACERS). */
export const MAX_DRONES = 32;
/** The game's own defaults and limits for a generated track (src/ui/settingsSchema.ts). */
export const TRACK_LIMITS = { gates: [4, 40], laps: [1, 10], diff: [0, 100], seed: [0, 4294967295] };
export const TRACK_DEFAULTS = { style: 'race', gates: 12, laps: 3, diff: 40, quality: '' };
const QUALITIES = ['low', 'medium', 'high', 'ultra'];

/**
 * The game's query string for `drones` ([{ name, count }]) on `track`: { query } for a training world's share link,
 * { park: { seed, size, route }, quality } for a theme park (route 'race', 'tour' or a zero-based coaster number), or
 * { style, seed, gates, laps, diff, quality } for a generated track ('' quality keeps the player's graphics setting).
 */
export function watchQuery(drones, track) {
  const q = new URLSearchParams(track.query ?? '');
  if (track.park) {
    const { seed, size, route } = track.park;
    q.set('world', 'theme-park');
    q.set('seed', String(seed));
    q.set('size', size);
    q.set('route', typeof route === 'number' ? 'coaster' : route);
    if (typeof route === 'number') q.set('coaster', String(route));
    if (track.quality) q.set('quality', track.quality);
  } else if (track.query === undefined) {
    q.set('seed', String(track.seed));
    q.set('style', track.style);
    q.set('gates', String(track.gates));
    q.set('laps', String(track.laps));
    q.set('diff', String(track.diff));
    if (track.quality) q.set('quality', track.quality);
  }
  const list = drones.filter((d) => d.count >= 1);
  const total = list.reduce((n, d) => n + d.count, 0);
  if (total === 1) q.set('brain', list[0].name);
  else q.set('race', list.map((d) => (d.count === 1 ? d.name : `${d.name}*${d.count}`)).join(','));
  return q.toString();
}

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...children) => {
  const n = Object.assign(document.createElement(tag), props);
  n.append(...children);
  return n;
};

let brains = [];
/** The theme park the dialog opens: route 'race', 'tour' or 'coaster' (then `coaster` is its zero-based number). */
const park = { size: 'destination', route: 'race', coaster: 0 };
const counts = new Map();
let context = () => ({});

/** What the run page knows: { brain: the run's brain name, worlds: its DashWorlds, world: the selected index }. */
export function setWatchContext(fn) {
  context = fn;
}

function total() {
  let n = 0;
  for (const c of counts.values()) n += c;
  return n;
}

function setCount(name, value) {
  const c = Math.max(0, Math.min(MAX_DRONES, Math.floor(Number(value)) || 0));
  if (c > 0) counts.set(name, c); else counts.delete(name);
  return c;
}

/** The drones in the order they were picked: the first brain's first quad is the player's, which the camera rides. */
function picked() {
  return [...counts].filter(([name]) => brains.some((b) => b.name === name)).map(([name, count]) => ({ name, count }));
}

function refresh() {
  const n = total();
  const note = $('watchTotal');
  const lead = picked()[0];
  note.textContent = n === 0 ? 'Pick at least one drone' : n === 1 ? '1 drone: it flies your quad'
    : `${n} drones race · camera on ${lead.count > 1 ? `${lead.name} #1` : lead.name}`;
  note.classList.toggle('warn', n === 0 || n > MAX_DRONES);
  if (n > MAX_DRONES) note.textContent = `${n} drones: at most ${MAX_DRONES} fit in one race`;
  $('watchGo').disabled = n === 0 || n > MAX_DRONES;
  for (const row of $('watchBrains').children) {
    const c = counts.get(row.dataset.name) ?? 0;
    row.classList.toggle('on', c > 0);
    row.querySelector('input').value = String(c);
    row.querySelector('[data-step="-1"]').disabled = c === 0;
  }
}

function renderBrains(first) {
  const list = $('watchBrains');
  if (!brains.length) {
    list.replaceChildren(el('p', { className: 'muted', textContent: 'No saved brains yet. A run saves its brain at every checkpoint and when it stops.' }));
    return;
  }
  const order = [...brains].sort((a, b) => (b.name === first) - (a.name === first));
  list.replaceChildren(...order.map((b) => {
    const input = el('input', { type: 'number', min: '0', max: String(MAX_DRONES), step: '1', inputMode: 'numeric', value: '0' });
    input.setAttribute('aria-label', `Drones flown by ${b.name}`);
    input.addEventListener('input', () => { setCount(b.name, input.value); refresh(); });
    input.addEventListener('change', () => { input.value = String(setCount(b.name, input.value)); refresh(); });
    const step = (d, label) => {
      const btn = el('button', { type: 'button', className: 'stepper-btn', textContent: d < 0 ? '−' : '+' });
      btn.dataset.step = String(d);
      btn.setAttribute('aria-label', `${label} ${b.name}`);
      btn.addEventListener('click', () => { setCount(b.name, (counts.get(b.name) ?? 0) + d); refresh(); });
      return btn;
    };
    const stats = [b.bestLap ? `best lap ${b.bestLap.toFixed(2)} s` : '', b.gatesPerMinute ? `${b.gatesPerMinute.toFixed(0)} gates/min` : ''].filter(Boolean).join(' · ');
    const row = el('div', { className: 'watch-brain' },
      el('span', { className: 'watch-brain-name' }, el('strong', { textContent: b.name }), ...(b.name === first ? [el('span', { className: 'chip', textContent: 'this run' })] : [])),
      el('span', { className: 'watch-brain-stats muted', textContent: stats || 'no lap yet' }),
      el('span', { className: 'stepper' }, step(-1, 'One drone fewer for'), input, step(1, 'One drone more for')));
    row.dataset.name = b.name;
    row.setAttribute('role', 'listitem');
    return row;
  }));
}

function trackChoice() {
  return document.querySelector('input[name="watchTrack"]:checked')?.value ?? 'generated';
}

function syncTrack() {
  const choice = trackChoice();
  $('watchWorld').disabled = choice !== 'training';
  for (const input of $('watchGenerated').querySelectorAll('input, select')) input.disabled = choice !== 'generated';
  for (const input of $('watchPark').querySelectorAll('input, select, button')) input.disabled = choice !== 'park';
  $('watchTrainingPanel').hidden = choice !== 'training';
  $('watchGenerated').hidden = choice !== 'generated';
  $('watchPark').hidden = choice !== 'park';
}

function svgIcon(id) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#${id}`);
  svg.append(use);
  return svg;
}

/** A row of toggle buttons for the park; `pickValue` runs with the pressed button's value. */
function segmented(box, options, pickValue) {
  box.replaceChildren(...options.map(({ value, label, sub, iconId }) => {
    const b = el('button', { type: 'button' }, ...(iconId ? [svgIcon(iconId)] : []), el('span', { textContent: label }), ...(sub ? [el('small', { textContent: sub })] : []));
    b.dataset.value = String(value);
    b.addEventListener('click', () => { pickValue(value); syncPark(); });
    return b;
  }));
}

function renderCoasters() {
  segmented($('watchParkCoasters'), COASTER_NAMES.slice(0, PARK_COASTERS[park.size]).map((name, k) => ({ value: k, label: name })), (k) => { park.coaster = k; });
}

function syncPark() {
  const press = (box, value) => { for (const b of box.children) b.setAttribute('aria-pressed', String(b.dataset.value === String(value))); };
  press($('watchParkSize'), park.size);
  press($('watchParkRoute'), park.route);
  press($('watchParkCoasters'), park.coaster);
  $('watchParkCoasterField').hidden = park.route !== 'coaster';
  syncTrack();
}

/** The track the form describes, or throws with what to fix. */
function readTrack(worlds) {
  if (trackChoice() === 'training') {
    const w = worlds[Number($('watchWorld').value)];
    if (!w?.game) throw Error('Choose a training world.');
    return { query: w.game };
  }
  if (trackChoice() === 'park') {
    const input = $('watchParkSeed');
    if (!/^\d{1,9}$/.test(input.value.trim())) {
      input.focus();
      throw Error('The park seed must be a whole number from 0 to 999999999.');
    }
    return { park: { seed: Number(input.value), size: park.size, route: park.route === 'coaster' ? park.coaster : park.route }, quality: $('watchParkQuality').value };
  }
  const t = { style: $('watchStyle').value, quality: $('watchQuality').value };
  for (const key of ['seed', 'gates', 'laps', 'diff']) {
    const input = $(`watch${key[0].toUpperCase()}${key.slice(1)}`);
    const v = Number(input.value);
    const [lo, hi] = TRACK_LIMITS[key];
    if (input.value === '' || !Number.isInteger(v) || v < lo || v > hi) {
      input.focus();
      throw Error(`${input.dataset.label} must be a whole number from ${lo} to ${hi}.`);
    }
    t[key] = v;
  }
  return t;
}

/** Opens the dialog; `preset.brain` (name or file) starts with one drone of that brain. */
export async function openWatch(preset = {}) {
  const ctx = { ...context(), ...preset };
  const dialog = $('watch');
  $('watchMessage').textContent = '';
  counts.clear();
  try {
    const r = await fetch('/api/game/brains', { cache: 'no-store' });
    brains = r.ok ? await r.json() : [];
  } catch {
    brains = [];
  }
  const own = ctx.brain ? brains.find((b) => b.name === ctx.brain || b.file === ctx.brain || b.file === `${ctx.brain}.json`) : null;
  if (own) counts.set(own.name, 1);
  else if (ctx.brain) $('watchMessage').textContent = `${String(ctx.brain).replace(/\.json$/, '')} has no saved brain yet: pick another below.`;
  renderBrains(own?.name);
  const linked = (ctx.worlds ?? []).map((w, k) => ({ w, k })).filter(({ w }) => w.game);
  $('watchTrainingChoice').hidden = !linked.length;
  $('watchWorld').hidden = !linked.length;
  $('watchWorld').replaceChildren(...linked.map(({ w, k }) => el('option', { value: String(k), textContent: `World ${k} · ${w.park ?? w.style} · ${w.gates.length} gates${w.closed ? ` · ${w.laps} laps` : ''}` })));
  if (linked.length) $('watchWorld').value = String(linked.some(({ k }) => k === ctx.world) ? ctx.world : linked[0].k);
  const pickTraining = linked.length > 0;
  for (const radio of document.querySelectorAll('input[name="watchTrack"]')) radio.checked = radio.value === (pickTraining ? 'training' : 'generated');
  $('watchSeed').value = String(Math.floor(Math.random() * 1e6));
  syncPark();
  refresh();
  dialog.worlds = ctx.worlds ?? [];
  if (!dialog.open) dialog.showModal();
}

async function go(e) {
  e.preventDefault();
  const dialog = $('watch');
  const message = $('watchMessage');
  let track;
  try {
    track = readTrack(dialog.worlds ?? []);
  } catch (err) {
    message.textContent = err.message;
    return;
  }
  const query = watchQuery(picked(), track);
  // Open the tab inside the click, so the browser allows it; it goes to the game once the server answers.
  const tab = window.open('', '_blank');
  if (tab) {
    tab.document.title = 'Starting the game…';
    tab.document.body.style.cssText = 'background:#0b0e14;color:#c8ced8;font:15px system-ui,sans-serif;display:grid;place-items:center;height:100vh;margin:0';
    tab.document.body.textContent = 'Starting the game…';
  }
  message.textContent = 'Starting the game…';
  $('watchGo').disabled = true;
  try {
    const r = await fetch('/api/game/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const body = await r.json();
    if (!r.ok) throw Error(body.error || `HTTP ${r.status}`);
    const href = `${body.url}?${query}`;
    if (tab && !tab.closed) {
      tab.location.href = href;
      dialog.close();
    } else {
      message.replaceChildren('The browser blocked the new tab: ', el('a', { href, target: '_blank', rel: 'noopener', textContent: 'open the game' }), '.');
    }
  } catch (err) {
    tab?.close();
    message.textContent = err.message;
  } finally {
    refresh();
  }
}

export function bindWatch() {
  const styles = $('watchStyle');
  styles.replaceChildren(...TRAINING_STYLES.map((s) => el('option', { value: s, textContent: s[0].toUpperCase() + s.slice(1) })));
  styles.value = TRACK_DEFAULTS.style;
  const qualities = () => [el('option', { value: '', textContent: 'Game setting' }), ...QUALITIES.map((q) => el('option', { value: q, textContent: q[0].toUpperCase() + q.slice(1) }))];
  $('watchQuality').replaceChildren(...qualities());
  $('watchParkQuality').replaceChildren(...qualities());
  segmented($('watchParkSize'), PARK_SIZES.map((size) => ({ value: size, label: SIZE_NAMES[size], sub: `${PARK_COASTERS[size]} coasters` })), (size) => {
    park.size = size;
    park.coaster = Math.min(park.coaster, PARK_COASTERS[size] - 1);
    renderCoasters();
  });
  segmented($('watchParkRoute'), Object.entries(ROUTE_INFO).map(([value, [label, iconId]]) => ({ value, label, iconId })), (route) => { park.route = route; });
  renderCoasters();
  $('watchParkDice').addEventListener('click', () => { $('watchParkSeed').value = String(Math.floor(Math.random() * 1e6)); });
  $('watchGates').value = String(TRACK_DEFAULTS.gates);
  $('watchLaps').value = String(TRACK_DEFAULTS.laps);
  $('watchDiff').value = String(TRACK_DEFAULTS.diff);
  for (const radio of document.querySelectorAll('input[name="watchTrack"]')) radio.addEventListener('change', syncTrack);
  $('watchForm').addEventListener('submit', go);
  $('watchCancel').addEventListener('click', () => $('watch').close());
  $('btnWatch').addEventListener('click', () => void openWatch());
}

if (typeof document !== 'undefined' && document.getElementById('watch')) bindWatch();
