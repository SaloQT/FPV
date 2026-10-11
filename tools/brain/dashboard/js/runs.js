// The home screen and the run lifecycle: the new-run form with its templates, the previous runs, and the switch between the
// home screen and a run's page as the run manager's state changes. It never loads or plays a previous run by itself.
import { TRAINING_FIELDS, TRAINING_STYLES } from './trainingSettings.js';
import {
  COASTER_NAMES, DEFAULT_TEMPLATE, MAX_PARKS, PARK_COASTERS, PARK_SIZES, ROUTE_INFO, SIZE_NAMES, TEMPLATES, TEMPLATE_BRAINS, TEMPLATE_GOALS,
  formatSetting, normaliseParks, parkItem, parsePark, templateById, templateChanges, templateSettings,
} from './templates.js';
import { openWatch } from './watch.js';

const $ = id => document.getElementById(id);
const selected = new URLSearchParams(location.search).get('run');
const RUN_KEYS = ['minutes', 'worlds', 'iters', 'every', 'recipes'];
const GOAL_ICONS = { start: 'i-flag', speed: 'i-bolt', smooth: 'i-wave', reliable: 'i-shield' };
const RUN_GROUP = 'Run and worlds';
/** Each track style's tile: its icon and what its tracks are like (src/world/track/styles.ts and scatter.ts). */
const STYLE_INFO = {
  race: ['i-flag', 'A circuit of 10 to 18 gates, flown for 3 laps'],
  freestyle: ['i-wave', 'An open, flowing line of 6 to 10 gates'],
  mountain: ['i-mountain', 'A long run over the terrain, 1.5 to 3 km'],
  sprint: ['i-bolt', 'Short and fast: 300 to 500 m'],
  technical: ['i-slalom', 'A circuit of manoeuvres round walls and containers'],
  acro: ['i-loop', 'An open line of manoeuvres among trees and rocks'],
  industrial: ['i-factory', 'A circuit through containers, scaffolds and beams'],
};
let managed = false, busy = false, catalogAt = 0, lastBrains = '', lastRuns = '', runs = [];
let template = DEFAULT_TEMPLATE, goalFilter = 'all', openRun = null;
/** The park the picker adds next. */
const pick = { size: 'destination', route: 'race', coaster: 0 };

const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.filter(c => c !== null && c !== undefined && c !== false));
  return node;
};
const icon = (id, cls = 'icon') => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', cls); svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#${id}`); svg.append(use);
  return svg;
};
const inputFor = field => $(`setting-${field.scope}-${field.key}`);

// ---- Settings fields ------------------------------------------------------------------------------------------------------

function renderFields() {
  const panels = new Map([[RUN_GROUP, document.querySelector(`.settings-group[data-group="${RUN_GROUP}"]`)]]);
  for (const field of TRAINING_FIELDS) {
    let panel = panels.get(field.group);
    if (!panel) {
      panel = el('section', { className: 'settings-group' }, el('div', { className: 'inline-fields' }));
      panel.dataset.group = field.group; panel.setAttribute('aria-label', field.group);
      $('trainingFields').append(panel); panels.set(field.group, panel);
    }
    const id = `setting-${field.scope}-${field.key}`;
    const input = el('input', { id, name: `${field.scope}.${field.key}` });
    input.type = field.type === 'boolean' ? 'checkbox' : field.type === 'layers' ? 'text' : 'number';
    if (field.type === 'number') { input.min = field.min; input.max = field.max; input.step = field.integer ? '1' : 'any'; input.required = true; }
    if (field.type === 'layers') { input.required = true; input.pattern = '\\s*\\d+(\\s*,\\s*\\d+)*\\s*'; }
    input.setAttribute('aria-describedby', `${id}-help`);
    const row = el('div', { className: 'inline-option' }, el('label', { htmlFor: id, textContent: field.label }), input,
      el('small', { id: `${id}-help`, className: 'setting-help', textContent: field.help }));
    panel.querySelector('.inline-fields').append(row);
  }
  // One group at a time, picked from a vertical tab list (arrow keys move between groups).
  const tabs = [...panels.keys()].map((group, k) => {
    const panel = panels.get(group);
    panel.id = `group-${k}`; panel.setAttribute('role', 'tabpanel'); panel.setAttribute('aria-labelledby', `group-tab-${k}`); panel.hidden = k > 0;
    const tab = el('button', { type: 'button', id: `group-tab-${k}` }, el('span', { textContent: group }), el('span', { className: 'chip chip-accent', hidden: true }));
    tab.setAttribute('role', 'tab'); tab.setAttribute('aria-controls', panel.id); tab.setAttribute('aria-selected', String(k === 0)); tab.tabIndex = k === 0 ? 0 : -1;
    tab.dataset.group = group;
    tab.addEventListener('click', () => selectGroup(group));
    return tab;
  });
  $('groupTabs').append(...tabs);
  $('groupTabs').addEventListener('keydown', e => {
    const k = tabs.indexOf(document.activeElement);
    if (k < 0) return;
    const next = { ArrowDown: k + 1, ArrowRight: k + 1, ArrowUp: k - 1, ArrowLeft: k - 1, Home: 0, End: tabs.length - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    const tab = tabs[(next + tabs.length) % tabs.length];
    selectGroup(tab.dataset.group); tab.focus();
  });
}

function selectGroup(group) {
  for (const tab of $('groupTabs').children) {
    const on = tab.dataset.group === group;
    tab.setAttribute('aria-selected', String(on)); tab.tabIndex = on ? 0 : -1;
    $(tab.getAttribute('aria-controls')).hidden = !on;
  }
}

function groupOf(input) {
  return input.closest('.settings-group')?.dataset.group ?? null;
}

// ---- Worlds ---------------------------------------------------------------------------------------------------------------

/** One tile per track style; each holds a `styles` checkbox, so the form reads them like plain checkboxes. */
function renderStyles() {
  $('trainingStyles').replaceChildren(...TRAINING_STYLES.map(style => {
    const [iconId, text] = STYLE_INFO[style] ?? ['i-layers', ''];
    const input = el('input', { type: 'checkbox', name: 'styles', value: style, checked: true });
    input.setAttribute('aria-describedby', `style-${style}-text`);
    return el('label', { className: 'style-tile' }, input,
      el('span', { className: 'style-icon' }, icon(iconId)),
      el('span', { className: 'style-text' },
        el('span', { className: 'style-name', textContent: style }),
        el('span', { className: 'style-desc', id: `style-${style}-text`, textContent: text })),
      el('span', { className: 'tpl-check' }, icon('i-check')));
  }));
  const setAll = on => { for (const input of $('trainingStyles').querySelectorAll('input')) input.checked = on; refresh(); };
  $('stylesAll').onclick = () => setAll(true);
  $('stylesNone').onclick = () => setAll(false);
}

/** A row of toggle buttons; `pickValue` runs with the button's value when one is pressed. */
function segmented(box, options, pickValue) {
  box.replaceChildren(...options.map(({ value, label, sub, iconId }) => {
    const b = el('button', { type: 'button' }, iconId ? icon(iconId) : null, el('span', { textContent: label }), sub ? el('small', { textContent: sub }) : null);
    b.dataset.value = String(value);
    b.onclick = () => { pickValue(value); syncPicker(); };
    return b;
  }));
}

function renderCoasterPicks() {
  segmented($('parkCoasters'), COASTER_NAMES.slice(0, PARK_COASTERS[pick.size]).map((name, k) => ({ value: k, label: name })), k => { pick.coaster = k; });
}

function renderPicker() {
  segmented($('parkSize'), PARK_SIZES.map(size => ({ value: size, label: SIZE_NAMES[size], sub: `${PARK_COASTERS[size]} coasters` })), size => {
    pick.size = size; pick.coaster = Math.min(pick.coaster, PARK_COASTERS[size] - 1); renderCoasterPicks();
  });
  segmented($('parkRoute'), Object.entries(ROUTE_INFO).map(([value, [label, iconId]]) => ({ value, label, iconId })), route => { pick.route = route; });
  renderCoasterPicks();
  $('parkSeed').addEventListener('input', syncPicker);
  $('parkSeed').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addPark(); } });
  $('parkDice').onclick = () => { $('parkSeed').value = String(Math.floor(Math.random() * 1e6)); syncPicker(); };
  $('parkAdd').onclick = addPark;
}

/** The parks in the run, as `train.mjs --parks` items. */
function parkList() {
  const parks = normaliseParks($('parks').value);
  return parks ? parks.split(',') : [];
}

/** The picker's park as a `--parks` item, or null while the seed is not a whole number from 0 to 999999999. */
function pickedPark() {
  const seed = $('parkSeed').value.trim();
  if (!/^\d{1,9}$/.test(seed)) return null;
  return parkItem({ seed: Number(seed), size: pick.size, route: pick.route === 'coaster' ? pick.coaster : pick.route });
}

function syncPicker() {
  const press = (box, value) => { for (const b of box.children) b.setAttribute('aria-pressed', String(b.dataset.value === String(value))); };
  press($('parkSize'), pick.size); press($('parkRoute'), pick.route); press($('parkCoasters'), pick.coaster);
  $('parkCoasterField').hidden = pick.route !== 'coaster';
  const list = parkList(), item = pickedPark(), full = list.length >= MAX_PARKS, twice = !!item && list.includes(item);
  $('parkAdd').disabled = !item || full || twice;
  $('parkHint').textContent = full ? `A run flies at most ${MAX_PARKS} parks.` : !item ? 'The seed is a whole number from 0 to 999999999.'
    : twice ? 'This park and route are already in the run.' : '';
}

function addPark() {
  const item = pickedPark();
  if ($('parkAdd').disabled || !item) return;
  setParks([...parkList(), item]);
  say(`Added ${parkName(parsePark(item))}.`);
}

function setParks(list) {
  $('parks').value = list.join(',');
  renderParks(); refresh();
}

function routeName(p) {
  return typeof p.route === 'number' ? COASTER_NAMES[p.route] : ROUTE_INFO[p.route][0];
}

function parkName(p) {
  return `park ${p.seed} (${SIZE_NAMES[p.size].toLowerCase()}, ${typeof p.route === 'number' ? `coaster ${routeName(p)}` : routeName(p).toLowerCase()})`;
}

/** The parks in the run as cards, or a note when there are none. */
function renderParks() {
  const list = parkList();
  $('parkCount').textContent = `${list.length} of ${MAX_PARKS}`;
  $('parkList').replaceChildren(...(list.length ? list.map((item, k) => {
    const p = parsePark(item), route = typeof p.route === 'number' ? 'coaster' : p.route;
    const remove = el('button', { type: 'button', className: 'btn btn-sm btn-ghost btn-icon', title: 'Remove' }, icon('i-x'));
    remove.setAttribute('aria-label', `Remove ${parkName(p)}`);
    remove.onclick = () => {
      setParks(list.filter(i => i !== item));
      const next = $('parkList').querySelectorAll('button')[Math.min(k, list.length - 2)];
      (next ?? $('parkAdd')).focus();
    };
    const card = el('li', { className: 'park-card', title: `--parks ${item}` },
      el('span', { className: 'park-icon' }, icon(ROUTE_INFO[route][1])),
      el('span', { className: 'park-text' },
        el('strong', { textContent: `Park ${p.seed}` }),
        el('span', { textContent: `${SIZE_NAMES[p.size]} · ${route === 'coaster' ? `Coaster: ${routeName(p)}` : routeName(p)}` })),
      remove);
    card.dataset.route = route;
    return card;
  }) : [el('li', { className: 'park-empty' }, icon('i-wheel'), el('span', { textContent: 'No theme parks. The run trains on generated tracks only.' }))]));
  syncPicker();
}

/** Puts a full settings object (a template's, or a previous run's) into the form. */
function fillSettings(settings) {
  const base = templateSettings(DEFAULT_TEMPLATE);
  for (const field of TRAINING_FIELDS) {
    const value = settings[field.scope]?.[field.key] ?? settings[field.key] ?? base[field.scope][field.key], input = inputFor(field);
    if (field.type === 'boolean') input.checked = !!value; else input.value = field.type === 'layers' ? value.join(',') : value;
  }
  for (const key of RUN_KEYS) $('startForm').elements.namedItem(key).value = settings[key] ?? base[key] ?? '';
  $('parks').value = normaliseParks(settings.parks) ?? '';
  renderParks();
  for (const input of $('trainingStyles').querySelectorAll('input')) input.checked = (settings.styles || TRAINING_STYLES).includes(input.value);
  $('setting-ppo-lrEnd').dataset.previousInitial = $('setting-ppo-lr').value;
  for (const input of $('startForm').querySelectorAll('[aria-invalid]')) input.removeAttribute('aria-invalid');
  resumedBrain();
  refresh();
}

/** The form's current value of every setting, in the template settings' shape. */
function formSettings() {
  const form = $('startForm').elements, out = { ppo: {}, env: {} };
  for (const key of RUN_KEYS) out[key] = form.namedItem(key).value === '' ? null : Number(form.namedItem(key).value);
  out.parks = normaliseParks(form.namedItem('parks').value) ?? '';
  out.styles = [...$('trainingStyles').querySelectorAll('input:checked')].map(i => i.value);
  for (const field of TRAINING_FIELDS) {
    const input = inputFor(field);
    out[field.scope][field.key] = field.type === 'boolean' ? input.checked
      : field.type === 'layers' ? input.value.split(',').map(v => Number(v.trim())) : input.value === '' ? NaN : Number(input.value);
  }
  return out;
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Marks every setting that differs from the chosen template, counts them per group, and updates the summary line. */
function refresh() {
  const want = templateSettings(template), have = formSettings();
  const changed = new Map();
  const mark = (input, differs) => {
    input.closest('.inline-option')?.classList.toggle('changed', differs);
    if (differs) { const g = groupOf(input); changed.set(g, (changed.get(g) || 0) + 1); }
  };
  for (const key of RUN_KEYS) mark($('startForm').elements.namedItem(key), key !== 'minutes' && !same(have[key], want[key]));
  const worldsDiffer = !same([...have.styles].sort(), [...want.styles].sort()) || have.parks !== (normaliseParks(want.parks) ?? '');
  $('worldsChanged').hidden = !worldsDiffer;
  $('styleCount').textContent = `${have.styles.length} of ${TRAINING_STYLES.length}`;
  for (const field of TRAINING_FIELDS) {
    const input = inputFor(field);
    mark(input, !input.disabled && !same(have[field.scope][field.key], want[field.scope][field.key]));
  }
  let total = 0;
  for (const tab of $('groupTabs').children) {
    const n = changed.get(tab.dataset.group) || 0, chip = tab.lastElementChild;
    total += n; chip.hidden = !n; chip.textContent = String(n);
    chip.setAttribute('aria-label', `${n} changed`);
  }
  $('customCount').hidden = !total;
  $('customCount').textContent = `${total} changed from the template`;
  const t = templateById(template), brain = $('startBrain').value;
  const minutes = Number($('minutes').value);
  $('startSummary').textContent = [
    `${t.name}${total || worldsDiffer ? ' (customised)' : ''}`,
    Number.isFinite(minutes) && minutes > 0 ? `${formatSetting(minutes)} min` : null,
    brain ? `continues ${brain.replace(/\.json$/, '')}` : 'new brain',
  ].filter(Boolean).join(' · ');
  for (const b of document.querySelectorAll('.quick-picks button')) b.setAttribute('aria-pressed', String(Number(b.dataset.minutes) === minutes));
}

function resumedBrain() {
  const resuming = !!$('startBrain').value;
  for (const key of ['hidden', 'logStdInit']) {
    const input = $(`setting-ppo-${key}`);
    input.disabled = resuming;
    input.title = resuming ? 'A continued brain keeps its own network and action spread.' : '';
  }
  const t = templateById(template), hint = $('brainHint');
  const mismatch = t.brain === 'continue' && !resuming;
  hint.classList.toggle('warn', mismatch);
  hint.textContent = mismatch ? `${t.name} works best on a brain that already finishes laps. Choose one here.`
    : t.brain === 'new' && resuming ? `${t.name} is made for a new brain; it also works when continuing one.`
    : resuming ? 'Keeps its network size and learned action spread.' : 'Starts from fresh weights.';
}

// ---- Templates ------------------------------------------------------------------------------------------------------------

function renderFilters() {
  const goals = [['all', 'All'], ...Object.entries(TEMPLATE_GOALS)];
  $('templateFilters').replaceChildren(...goals.map(([goal, label]) => {
    const n = goal === 'all' ? TEMPLATES.length : TEMPLATES.filter(t => t.goal === goal).length;
    const b = el('button', { type: 'button' }, label, el('span', { className: 'count', textContent: n }));
    b.dataset.goal = goal;
    b.addEventListener('click', () => { goalFilter = goal; renderTemplates(); });
    return b;
  }));
}

// Cards are rebuilt only when the filter changes, so arrow keys can move through the radio group without losing focus.
function renderTemplates() {
  for (const b of $('templateFilters').children) b.setAttribute('aria-pressed', String(b.dataset.goal === goalFilter));
  const cards = TEMPLATES.filter(t => goalFilter === 'all' || t.goal === goalFilter).map(t => {
    const input = el('input', { type: 'radio', name: 'template', value: t.id, checked: t.id === template });
    input.setAttribute('aria-describedby', `tpl-${t.id}-summary`);
    input.addEventListener('change', () => chooseTemplate(t.id));
    const minutes = templateSettings(t.id).minutes;
    const card = el('label', { className: 'tpl' }, input,
      el('div', { className: 'tpl-head' },
        el('span', { className: 'tpl-icon' }, icon(GOAL_ICONS[t.goal])),
        el('div', {}, el('div', { className: 'tpl-name', textContent: t.name }), el('div', { className: 'tpl-goal', textContent: TEMPLATE_GOALS[t.goal] })),
        el('span', { className: 'tpl-check' }, icon('i-check'))),
      el('p', { className: 'tpl-summary', id: `tpl-${t.id}-summary`, textContent: t.summary }),
      el('div', { className: 'tpl-foot' },
        el('span', { className: 'chip', textContent: `${formatSetting(minutes)} min` }),
        el('span', { className: 'chip', textContent: TEMPLATE_BRAINS[t.brain] })));
    card.dataset.goal = t.goal;
    return card;
  });
  $('templateGrid').replaceChildren(...cards);
}

function renderTemplateSummary() {
  const t = templateById(template), changes = templateChanges(template);
  const notes = el('div', {}, el('h4', { textContent: `What ${t.name} does` }), el('ul', {}, ...t.notes.map(n => el('li', { textContent: n }))));
  let table;
  if (changes.length) {
    table = el('table', { className: 'changes' },
      el('thead', {}, el('tr', {}, ...['Setting', 'Default', t.name].map(h => el('th', { scope: 'col', textContent: h })))),
      el('tbody', {}, ...changes.map(c => el('tr', {},
        el('td', { textContent: c.label }), el('td', { textContent: formatSetting(c.from) }), el('td', { textContent: formatSetting(c.to) })))));
    table.setAttribute('aria-label', `Settings ${t.name} changes from the defaults`);
  } else table = el('p', { className: 'no-changes', textContent: 'Every setting is at its default.' });
  $('templateSummary').replaceChildren(notes, el('div', {}, el('h4', { textContent: changes.length ? `${changes.length} settings changed from the defaults` : 'Settings' }), table));
}

/** Selects a template; `apply` puts its settings into the form (Use settings selects without applying). */
function chooseTemplate(id, apply = true) {
  template = templateById(id) ? id : DEFAULT_TEMPLATE;
  if (goalFilter !== 'all' && templateById(template).goal !== goalFilter) { goalFilter = 'all'; renderTemplates(); }
  for (const input of $('templateGrid').querySelectorAll('input')) input.checked = input.value === template;
  renderTemplateSummary();
  if (apply) {
    fillSettings(templateSettings(template));
    $('runMessage').textContent = '';
    $('runMessage').className = '';
  } else { resumedBrain(); refresh(); }
}

// ---- Previous runs --------------------------------------------------------------------------------------------------------

function relativeTime(iso) {
  if (!iso) return '';
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (!Number.isFinite(s)) return '';
  if (s < 60) return 'just now';
  const units = [[86400 * 7, 'week'], [86400, 'day'], [3600, 'hour'], [60, 'minute']];
  for (const [size, unit] of units) if (s >= size) { const n = Math.floor(s / size); return `${n} ${unit}${n > 1 ? 's' : ''} ago`; }
  return '';
}

function duration(seconds) {
  if (!(seconds > 0)) return '';
  const m = Math.round(seconds / 60);
  return m < 60 ? `${Math.max(m, 1)} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}

function renderRuns() {
  const query = $('runFilter').value.trim().toLowerCase();
  const shown = runs.filter(run => !query || [run.name, run.status, templateById(run.template)?.name ?? ''].some(s => s.toLowerCase().includes(query)));
  $('runCount').textContent = runs.length ? String(runs.length) : '';
  if (!runs.length) { $('previousRuns').replaceChildren(el('p', { className: 'empty', textContent: 'Runs you stop or finish appear here.' })); return; }
  if (!shown.length) { $('previousRuns').replaceChildren(el('p', { className: 'empty', textContent: `No runs match “${$('runFilter').value}”.` })); return; }
  $('previousRuns').replaceChildren(...shown.map(run => {
    const t = templateById(run.template);
    const meta = el('div', { className: 'run-meta' });
    if (run.startedAt) meta.append(el('time', { dateTime: run.startedAt, title: new Date(run.startedAt).toLocaleString(), textContent: relativeTime(run.startedAt) }));
    if (run.elapsed > 0) meta.append(el('span', { textContent: duration(run.elapsed) }));
    if (run.iterations) meta.append(el('span', { textContent: `${run.iterations.toLocaleString()} iterations` }));
    if (run.bestLap) meta.append(el('span', {}, 'Best lap ', el('b', { textContent: `${run.bestLap.toFixed(2)} s` })));
    if (Number.isFinite(run.crashRate)) meta.append(el('span', {}, 'Crashes ', el('b', { textContent: `${run.crashRate.toFixed(0)}%` })));
    const tags = el('div', { className: 'run-tags' },
      t ? el('span', { className: 'chip' }, icon(GOAL_ICONS[t.goal]), t.name) : null,
      run.resumed ? el('span', { className: 'chip', textContent: `from ${run.resumed.replace(/\.json$/, '')}` }) : null,
      run.gpuErrors ? el('span', { className: 'chip', textContent: `${run.gpuErrors} GPU errors` }) : null);
    const actions = el('div', { className: 'run-actions' });
    if (run.canView) actions.append(el('a', { className: 'btn btn-sm', href: `/?run=${encodeURIComponent(run.id)}`, textContent: 'View' }));
    if (run.brain) {
      const watch = el('button', { type: 'button', className: 'btn btn-sm btn-ghost', textContent: 'Watch' });
      watch.title = `Open the game with ${run.name} flying`;
      watch.onclick = () => void openWatch({ brain: run.brain });
      actions.append(watch);
    }
    if (run.brain) {
      const resume = el('button', { type: 'button', className: 'btn btn-sm btn-ghost', textContent: 'Continue training' });
      resume.title = `Use ${run.brain} as the starting brain`;
      resume.onclick = () => {
        $('startBrain').value = run.brain; resumedBrain(); refresh();
        say(`${run.name} is the starting brain. Pick a template, then start.`);
        $('startBrain').focus();
      };
      actions.append(resume);
    }
    const reuse = el('button', { type: 'button', className: 'btn btn-sm btn-ghost', textContent: 'Use settings' });
    reuse.title = 'Copy this run\'s settings into the form';
    reuse.onclick = async () => {
      try {
        const settings = await json(`/api/runs/${encodeURIComponent(run.id)}/settings`);
        chooseTemplate(settings.template || DEFAULT_TEMPLATE, false);
        fillSettings(settings);
        $('startBrain').value = run.brain || ''; resumedBrain(); refresh();
        $('trainingOptions').open = true;
        say(`Settings copied from ${run.name}. Adjust them, then start.`);
        $('startForm').scrollIntoView({ block: 'start', behavior: 'smooth' });
      } catch (e) { say(e.message, true); }
    };
    actions.append(reuse);
    // One line per run (name, best lap, status); clicking it opens the details and closes the one open before.
    const item = el('details', { className: 'run-item', name: 'previous-run', open: run.id === openRun },
      el('summary', { className: 'run-top' }, icon('i-chevron', 'icon chev'),
        el('strong', { textContent: run.name, title: run.name }),
        run.bestLap ? el('span', { className: 'run-lap', textContent: `${run.bestLap.toFixed(2)} s`, title: 'Best lap' }) : null,
        el('span', { className: `badge ${run.status}`, textContent: run.status })),
      el('div', { className: 'run-body' }, meta, tags.childElementCount ? tags : null,
        run.error ? el('p', { className: 'run-error', textContent: run.error }) : null,
        actions));
    item.addEventListener('toggle', () => { if (item.open) openRun = run.id; else if (openRun === run.id) openRun = null; });
    return item;
  }));
}

async function catalog() {
  const data = await json('/api/runs');
  const signature = JSON.stringify(data.brains);
  if (signature !== lastBrains) {
    lastBrains = signature;
    const chosen = $('startBrain').value;
    $('startBrain').replaceChildren(el('option', { value: '', textContent: 'New brain' }),
      ...data.brains.map(brain => el('option', { value: brain, textContent: brain.replace(/\.json$/, '') })));
    if (data.brains.includes(chosen)) $('startBrain').value = chosen;
    resumedBrain(); refresh();
  }
  const runSignature = JSON.stringify(data.previous);
  if (runSignature !== lastRuns) { lastRuns = runSignature; runs = data.previous; renderRuns(); }
  catalogAt = Date.now();
}

// ---- Run state ------------------------------------------------------------------------------------------------------------

async function json(path, body) {
  const response = await fetch(path, body === undefined ? { cache: 'no-store' } : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw Error(data.error || `HTTP ${response.status}`);
  return data;
}

function say(text, error = false) {
  $('runMessage').textContent = text;
  $('runMessage').className = error ? 'error' : '';
}

function alertBody(node, iconId, title, text, spinner = false) {
  node.replaceChildren(spinner ? el('span', { className: 'spinner', ariaHidden: 'true' }) : icon(iconId), el('div', {}, el('strong', { textContent: title }), text));
}

function show(meta) {
  const active = ['starting', 'running', 'stopping'].includes(meta.status);
  const viewing = !!selected || meta.status === 'running' || (meta.status === 'stopping' && document.body.dataset.viewerReady === 'true');
  if (!active && !selected) { delete document.body.dataset.viewerReady; delete document.body.dataset.viewerRun; }
  document.body.dataset.runState = selected ? 'replay' : active ? meta.status : 'idle';
  $('runHome').hidden = !managed || !!selected || active;
  $('runPage').hidden = !selected && !active;
  // The run's own views belong to app.js; until it has loaded them (or after the run), keep them out of sight.
  if (!viewing) for (const node of [document.querySelector('.kpis'), $('viewActions'), $('runView'), $('runSettings'), $('comparePanel'), document.querySelector('.timeline')]) node.hidden = true;
  $('backLink').hidden = !selected;
  document.querySelector('.commands').hidden = !!selected || !active;
  $('btnStop').disabled = meta.status === 'stopping';
  $('btnStop').querySelector('span').textContent = meta.status === 'stopping' ? 'Saving and stopping…' : 'Stop and save';
  $('btnSave').disabled = meta.status !== 'running';
  const progress = $('runProgress');
  progress.hidden = !active || meta.status === 'running';
  if (!progress.hidden) {
    alertBody(progress, 'i-info', meta.status === 'stopping' ? 'Saving the brain' : 'Preparing training',
      meta.status === 'stopping' ? 'The trainer finishes the current iteration and saves. The run then moves to Previous runs.'
        : 'Building the worlds and compiling the GPU kernels. You can stop while it gets ready.', true);
  }
  const gpu = $('gpuAlert');
  gpu.hidden = !!selected || !active || !meta.gpuErrors?.count;
  if (!gpu.hidden) {
    alertBody(gpu, 'i-alert', `The GPU rejected ${meta.gpuErrors.count.toLocaleString()} command${meta.gpuErrors.count > 1 ? 's' : ''}: this run is probably not learning`,
      el('div', {}, 'Stop the run and try smaller rollout steps, fewer environments or more minibatches. Last error: ', el('code', { textContent: meta.gpuErrors.last })));
  }
  if (!selected) {
    $('runName').textContent = active ? meta.name : 'Runs';
    $('status').textContent = active ? meta.status : 'ready';
    $('status').className = `badge ${active ? meta.status : 'idle'}`;
    document.title = active ? `${meta.name} · ${meta.status} · FPV brain training` : 'FPV brain training';
  }
}

async function poll() {
  if (busy) return;
  busy = true;
  try {
    const meta = await json('/api/meta'); managed = !!meta.managed;
    if (!managed) return;
    show(meta);
    if (!selected && meta.status === 'running' && !document.body.dataset.viewerLoading && document.body.dataset.viewerRun !== meta.activeRunId) { location.reload(); return; }
    if (!selected && Date.now() - catalogAt > (meta.status === 'idle' ? 3000 : 15000)) await catalog();
    if ($('runMessage').dataset.offline) { delete $('runMessage').dataset.offline; say(''); }
  } catch (e) { $('runMessage').dataset.offline = '1'; say(`Connection to the trainer lost: ${e.message}. Retrying…`, true); }
  finally { busy = false; }
}

// ---- Form -----------------------------------------------------------------------------------------------------------------

/** Native validation, shown next to the start button and on the field itself (inside its settings group if hidden). */
function validate() {
  for (const input of $('startForm').querySelectorAll('[aria-invalid]')) input.removeAttribute('aria-invalid');
  for (const input of $('startForm').querySelectorAll('input:not([type="radio"]):not(:disabled):not([data-picker]), select')) {
    if (input.checkValidity()) continue;
    input.setAttribute('aria-invalid', 'true');
    const group = groupOf(input);
    if (group) { $('trainingOptions').open = true; selectGroup(group); }
    const label = $('startForm').querySelector(`label[for="${input.id}"]`)?.textContent ?? input.name;
    say(`${label}: ${input.validationMessage}`, true);
    input.focus();
    return false;
  }
  if (!$('trainingStyles').querySelector('input:checked')) {
    say('Choose at least one track style.', true);
    $('trainingStyles').querySelector('input').focus();
    return false;
  }
  return true;
}

function bindForm() {
  $('startBrain').addEventListener('change', () => { resumedBrain(); refresh(); });
  $('startForm').addEventListener('input', e => {
    if (e.target.name === 'template') return;
    if (e.target.hasAttribute('aria-invalid') && e.target.checkValidity()) e.target.removeAttribute('aria-invalid');
    refresh();
  });
  $('startForm').addEventListener('change', e => { if (e.target.name === 'styles') refresh(); });
  for (const b of document.querySelectorAll('.quick-picks button')) b.addEventListener('click', () => { $('minutes').value = b.dataset.minutes; refresh(); });
  $('resetSettings').onclick = () => { fillSettings(templateSettings(template)); say(`Settings reset to ${templateById(template).name}.`); };
  $('setting-ppo-lr').addEventListener('change', e => {
    const final = $('setting-ppo-lrEnd');
    if (final.value === final.dataset.previousInitial) final.value = e.target.value;
    final.dataset.previousInitial = e.target.value;
    refresh();
  });
  $('runFilter').addEventListener('input', renderRuns);
  $('startForm').onsubmit = async e => {
    e.preventDefault();
    if (!validate()) return;
    $('btnStart').disabled = true; say('Starting…');
    try {
      const form = new FormData(e.target), body = { ppo: {}, env: {}, styles: form.getAll('styles'), template };
      for (const [key, value] of form) {
        if (key === 'styles' || key === 'template') continue;
        if (key.includes('.')) {
          const [scope, setting] = key.split('.'), field = TRAINING_FIELDS.find(f => f.scope === scope && f.key === setting);
          body[scope][setting] = field.type === 'layers' ? value.split(',').map(v => Number(v.trim())) : field.type === 'boolean' ? true : Number(value);
        } else body[key] = ['name', 'resume', 'parks'].includes(key) ? value : key === 'recipes' && value === '' ? null : Number(value);
      }
      body.ppo.profile = $('setting-ppo-profile').checked;
      await json('/api/runs/start', body); say(''); await poll();
    } catch (error) { say(error.message, true); }
    finally { $('btnStart').disabled = false; }
  };
}

// ---- Commands -------------------------------------------------------------------------------------------------------------

// Stop asks first, in every mode; app.js sends it for a dashboard without the run manager.
$('btnStop').addEventListener('click', () => { if (!$('btnStop').disabled) $('confirm').showModal(); });
$('confirm').addEventListener('close', () => { if ($('confirm').returnValue === 'stop') document.dispatchEvent(new Event('stop-confirmed')); });
$('confirm').addEventListener('click', e => { if (e.target === $('confirm')) $('confirm').close('cancel'); });

async function managedCommand(cmd, button) {
  if (!managed || selected) return;
  button.disabled = true;
  try { await json('/api/command', { cmd }); await poll(); }
  catch (e) {
    const progress = $('runProgress'); progress.hidden = false;
    alertBody(progress, 'i-alert', 'Command failed', e.message);
    button.disabled = false;
  }
}
$('btnSave').addEventListener('click', () => managedCommand('save', $('btnSave')));
document.addEventListener('stop-confirmed', () => managedCommand('stop', $('btnStop')));
// A finished run managed here goes back to the home screen; a train.mjs dashboard keeps showing its run.
document.addEventListener('run-finished', () => {
  if (selected || !managed) return;
  for (const node of [$('runPage'), document.querySelector('.timeline'), document.querySelector('.commands')]) node.hidden = true;
  catalogAt = 0;
  if (managed) void poll();
});

renderFields();
renderStyles();
renderPicker();
bindForm();
renderFilters();
renderTemplates();
chooseTemplate(DEFAULT_TEMPLATE);
void poll();
setInterval(poll, 1000);
