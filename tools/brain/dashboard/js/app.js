// The dashboard page: loads the run (meta, worlds, history, kept traces), follows the trainer's event stream, and keeps every
// view on one playhead: the charts' cursor, the timeline, the map and the elevation profile all move when you scrub.
import { Chart } from './chart.js';
import { Profile } from './profile.js';
import { CHARTS, Store, clock, fmt } from './series.js';
import { Timeline } from './timeline.js';
import { TopDown } from './topdown.js';
import { TraceCache, advance, chainOf, traceFor, traceStep, worldTallies } from './trace.js';
import { TRAINING_FIELDS } from './trainingSettings.js';
import { DEFAULT_TEMPLATE, RUN_FIELDS, TEMPLATE_GOALS, formatSetting, templateById, templateSettings } from './templates.js';
import { setWatchContext } from './watch.js';

const $ = (id) => document.getElementById(id);
/** Charts shown under Key metrics; All metrics adds the rest. */
const KEY_CHARTS = ['return', 'crash', 'gates', 'best'];
/** Iterations in a row without a single episode ending before the page warns that the run is not learning. */
const SILENT_ITERATIONS = 20;
const TABS = [['tabTraining', 'runView', 'training'], ['tabSettings', 'runSettings', 'settings'], ['tabCompare', 'comparePanel', 'compare']];
const selectedRun = new URLSearchParams(location.search).get('run');
const runPath = path => selectedRun ? path.replace('/api/', `/api/runs/${encodeURIComponent(selectedRun)}/`) : path;

async function api(path) {
  const r = await fetch(runPath(path), { cache: 'no-store' });
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json();
}

async function loadTrace(it) {
  const r = await fetch(runPath(`/api/trace/${it}`), { cache: 'no-store' });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`trace ${it}: ${r.status}`);
  return { K: Number(r.headers.get('X-Trace-K')), T: Number(r.headers.get('X-Trace-T')), buffer: await r.arrayBuffer() };
}

const app = {
  meta: null,
  worlds: [],
  store: null,
  traceList: [],
  view: null,
  hover: null,
  hoverChart: null,
  scrub: null,
  live: false,
  playing: false,
  speed: 1,
  head: { it: null, t: 0 },
  world: -1,
  charts: [],
  dirty: true,
  chartsDirty: true,
  requestDraw() { this.dirty = true; this.chartsDirty = true; },
  /** Redraws the map and the profile only. */
  requestMap() { this.dirty = true; },
  selectedWorld() { return this.world >= 0 ? this.worlds[this.world] ?? null : null; },
  setView(v) { this.view = v; this.chartsDirty = true; this.dirty = true; },
  setHover(it, chart) { if (it !== this.hover || chart !== this.hoverChart) { this.hover = it; this.hoverChart = it === null ? null : chart; this.chartsDirty = true; } },
  /** What a click on a chart changes, so a double-click (zoom reset) can put it back. */
  playbackState() { return { live: this.live, scrub: this.scrub, head: { ...this.head } }; },
  restorePlayback(s) {
    this.live = s.live;
    this.scrub = s.scrub;
    this.head = { ...s.head };
    syncTransport();
    this.requestDraw();
  },
  scrubTo(it) {
    this.live = false;
    this.scrub = it;
    const tr = traceFor(this.traceList, it);
    if (tr !== null && tr !== this.head.it) this.head = { it: tr, t: 0 };
    syncTransport();
    this.requestDraw();
  },
  selectWorld(k) {
    this.world = k;
    $('worldSel').value = String(k);
    $('btnOverview').classList.toggle('on', k < 0);
    this.profile.view = null;
    updateWorldInfo();
    this.requestDraw();
  },
};

const cache = new TraceCache(loadTrace, 160);
let talliesFor = { it: null, data: null };

function hz() { return app.meta?.policyHz || 50; }
function traceT() { return cache.peek(app.head.it)?.T || app.meta?.traceSteps || 32; }

function setStatus(status) {
  const el = $('status');
  const mode = app.meta?.mode === 'replay' ? 'replay' : status;
  el.className = `badge ${mode}`;
  el.textContent = app.meta?.mode === 'replay' ? `replay · ${status}` : status;
  const canCommand = app.meta?.mode !== 'replay' && status === 'running';
  $('btnSave').disabled = !canCommand;
  $('btnStop').disabled = !canCommand;
  if (app.meta?.mode !== 'replay' && !app.meta?.managed) document.querySelector('.commands').hidden = status === 'finished';
}

let toastTimer = 0;
function toast(text) {
  const t = $('toast');
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3500);
}

async function command(cmd) {
  try {
    const r = await fetch('/api/command', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cmd }) });
    const body = await r.json().catch(() => ({}));
    if (!r.ok || !body.ok) throw new Error(body.error || `HTTP ${r.status}`);
    toast(cmd === 'save' ? 'Checkpoint requested: the trainer writes it after this iteration' : 'Stopping after this iteration');
  } catch (e) {
    toast(`Command failed: ${e.message}`);
  }
}

/**
 * How a smoothed series moved over the last tenth of the iterations up to `i` (at least 10): the change, the iterations it
 * spans and whether it moved the good way.
 */
function trend(key, i, higherIsBetter, smooth = true) {
  const st = app.store;
  const j = i - Math.max(10, Math.round(st.length * 0.1));
  if (j < 0) return null;
  const now = st.value(key, i, smooth), then = st.value(key, j, smooth);
  if (!Number.isFinite(now) || !Number.isFinite(then)) return null;
  const diff = now - then;
  return { diff, iters: st.iters.a[i] - st.iters.a[j], good: Math.abs(diff) < 1e-9 ? null : (diff > 0) === higherIsBetter };
}

function showTrend(id, t, unit, digits = 3) {
  const node = $(id);
  if (!t) { node.textContent = ''; node.className = 'kpi-note delta'; return; }
  const sign = t.diff > 0 ? '+' : t.diff < 0 ? '−' : '±';
  node.textContent = t.good === null ? `no change in ${t.iters} iterations` : `${sign}${fmt(Math.abs(t.diff), digits)}${unit} in ${t.iters} iterations`;
  node.className = `kpi-note delta${t.good === null ? '' : t.good ? ' good' : ' bad'}`;
}

let readoutKey = '';
function updateReadouts() {
  const st = app.store;
  const i = app.live || app.scrub === null ? st.length - 1 : st.nearest(app.scrub);
  const r = st.records[i];
  if (!r) return;
  const key = `${i}/${st.length}/${st.weight}`;
  if (key === readoutKey) return;
  readoutKey = key;
  const run = app.meta.config?.run ?? {};
  $('rIter').textContent = r.iteration.toLocaleString();
  $('rIterNote').textContent = run.iters > 0 ? `of ${run.iters.toLocaleString()}` : app.live ? 'live' : `of ${st.records[st.length - 1].iteration.toLocaleString()}`;
  $('rElapsed').textContent = clock(r.elapsed);
  const budget = run.minutes > 0 ? run.minutes * 60 : 0;
  $('rElapsedNote').textContent = budget ? `of ${clock(budget)}` : '';
  $('rElapsedBar').style.width = budget ? `${Math.min(100, (100 * r.elapsed) / budget)}%` : '0';
  $('rSteps').textContent = fmt(r.envSteps);
  $('rSps').textContent = `${fmt(r.sps)} decisions/s`;
  $('rReturn').textContent = fmt(st.value('ret', i));
  showTrend('dReturn', trend('ret', i, true), '');
  const crash = st.value('crash', i);
  $('rCrash').textContent = Number.isFinite(crash) ? `${fmt(crash, 3)}%` : '–';
  showTrend('dCrash', trend('crash', i, false), ' pts', 2);
  const best = st.value('bestRun', i, false);
  $('rBest').textContent = Number.isNaN(best) ? '–' : `${best.toFixed(2)} s`;
  showTrend('dBest', trend('bestRun', i, false, false), ' s', 3);
  updateLearnAlert();
}

/** Thousands of drones end episodes every iteration; a long run of iterations with none means the trainer is not working. */
function updateLearnAlert() {
  const st = app.store, n = st.length, node = $('learnAlert');
  let silent = n >= SILENT_ITERATIONS;
  for (let k = n - SILENT_ITERATIONS; silent && k < n; k++) if (st.records[k]?.metrics?.episodes > 0) silent = false;
  node.hidden = !silent;
  if (!silent || node.childElementCount) return;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'icon');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', '#i-alert'); svg.append(use);
  const text = document.createElement('div');
  const title = document.createElement('strong');
  title.textContent = `No episode ended in the last ${SILENT_ITERATIONS} iterations`;
  const code = document.createElement('code');
  code.textContent = `.bench/brain/runs/${app.meta.name}.stderr.log`;
  text.append(title, 'The metrics read zero, so the brain is not learning. This usually means the GPU rejected the training commands: see ', code, '.');
  node.replaceChildren(svg, text);
}

function updateTable() {
  if ($('tableView').hidden) return;
  const st = app.store;
  const i = app.hover !== null ? st.nearest(app.hover) : app.live || app.scrub === null ? st.length - 1 : st.nearest(app.scrub);
  if (i < 0) return;
  $('tableCaption').textContent = `Values at iteration ${st.iters.a[i]}`;
  const rows = [];
  for (const c of CHARTS) for (const s of c.series) {
    const tr = document.createElement('tr');
    for (const text of [c.title, s.label, fmt(st.value(s.key, i, false), 4), s.smooth === false ? '' : fmt(st.value(s.key, i, true), 4)]) {
      const td = document.createElement('td');
      td.textContent = text;
      tr.append(td);
    }
    rows.push(tr);
  }
  $('tableBody').replaceChildren(...rows);
}

function updateWorldInfo() {
  const w = app.selectedWorld();
  const info = $('mapInfo');
  const kinds = new Map();
  for (const ww of w ? [w] : app.worlds) for (const g of ww.gates) kinds.set(g.kind, g.color);
  $('gateLegend').replaceChildren(...[...kinds].map(([k, c]) => {
    const s = document.createElement('span');
    const i = document.createElement('i');
    i.style.background = c;
    s.append(i, document.createTextNode(k));
    return s;
  }));
  // The small multiples carry their own labels; the info box is for one world.
  info.hidden = !w;
  if (!w) {
    $('profInfo').textContent = '';
    return;
  }
  const features = [...new Set(w.gates.map((g) => g.feature).filter(Boolean))];
  const head = document.createElement('b');
  head.textContent = `World ${w.index}: ${w.style}`;
  const line = `${w.closed ? `circuit, ${w.laps} laps` : 'point to point'} · ${w.gates.length} gates · ${(w.length / 1000).toFixed(2)} km · seed ${w.seed}`;
  const line2 = `${w.boxes.length} track boxes, ${w.vegetationColliders} trees and rocks${features.length ? ` · ${features.join(', ')}` : ''}`;
  const d1 = document.createElement('div'); d1.textContent = line;
  const d2 = document.createElement('div'); d2.textContent = line2; d2.className = 'muted';
  info.replaceChildren(head, d1, d2);
  $('profInfo').textContent = `${Math.round(w.terrain.min)}–${Math.round(w.terrain.max)} m terrain`;
}

function syncTransport() {
  $('btnLive').classList.toggle('on', app.live);
  $('btnLive').setAttribute('aria-pressed', String(app.live));
  $('btnPlay').querySelector('use').setAttribute('href', app.playing ? '#i-pause' : '#i-play');
  $('btnPlay').setAttribute('aria-label', app.playing ? 'Pause' : 'Play');
}

/** The run page's tabs; the address keeps the open one (#settings, #compare) across reloads. */
function selectTab(name, focus = false) {
  if (!TABS.some(([, , key]) => key === name)) name = 'training';
  for (const [tabId, panelId, key] of TABS) {
    const on = key === name;
    $(tabId).setAttribute('aria-selected', String(on));
    $(tabId).tabIndex = on ? 0 : -1;
    $(panelId).hidden = !on;
    if (on && focus) $(tabId).focus();
  }
  document.querySelector('.timeline').hidden = name !== 'training';
  history.replaceState(null, '', `${location.pathname}${location.search}${name === 'training' ? '' : `#${name}`}`);
  if (name === 'compare') $('comparePanel').dispatchEvent(new Event('panel-shown'));
  app.requestDraw();
}

/** Run settings by group, values that differ from the run's template (or the defaults) highlighted. */
function renderSettings() {
  const config = app.meta.config ?? {}, run = config.run ?? {};
  const t = templateById(run.template ?? app.meta.template);
  const base = templateSettings(t?.id ?? DEFAULT_TEMPLATE);
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const groups = new Map([['Run and worlds', RUN_FIELDS.filter((f) => run[f.key] !== undefined).map((f) => [f.label, run[f.key], !same(run[f.key], base[f.key])])]]);
  for (const f of TRAINING_FIELDS) {
    const v = config[f.scope]?.[f.key];
    if (v === undefined) continue;
    if (!groups.has(f.group)) groups.set(f.group, []);
    groups.get(f.group).push([f.label, v, f.key !== 'traceEnvs' && !same(v, base[f.scope][f.key])]);
  }
  const sections = [...groups].filter(([, rows]) => rows.length).map(([group, rows]) => {
    const s = document.createElement('section');
    const h = document.createElement('h3');
    h.textContent = group;
    const table = document.createElement('table');
    for (const [label, value, changed] of rows) {
      const tr = document.createElement('tr');
      const th = document.createElement('th');
      th.scope = 'row';
      th.textContent = label;
      const td = document.createElement('td');
      td.textContent = formatSetting(value);
      if (Array.isArray(value)) td.classList.add('list');
      if (changed) { td.classList.add('changed'); td.title = t ? `Changed from the ${t.name} template` : 'Changed from the default'; }
      tr.append(th, td);
      table.append(tr);
    }
    s.append(h, table);
    return s;
  });
  $('templateBanner')?.remove();
  const banner = document.createElement('div');
  banner.className = 'template-banner';
  banner.id = 'templateBanner';
  const text = document.createElement('div');
  const strong = document.createElement('strong');
  strong.textContent = t ? `Template: ${t.name}` : 'No template recorded';
  const p = document.createElement('p');
  p.className = 'muted';
  p.textContent = t ? `${t.summary} Values marked with a dot differ from the template.` : 'This run started without a template. Values marked with a dot differ from the trainer defaults.';
  text.append(strong, p);
  banner.append(text);
  $('currentSettings').replaceChildren(...sections);
  $('currentSettings').before(banner);
  const chip = $('runTemplate');
  chip.hidden = !t;
  if (t) { chip.textContent = t.name; chip.title = `${TEMPLATE_GOALS[t.goal]} template`; }
}

function goLive() {
  app.live = true;
  app.scrub = null;
  const newest = app.traceList[app.traceList.length - 1];
  if (newest !== undefined) app.head = { it: newest, t: 0 };
  app.playing = true;
  syncTransport();
  app.requestDraw();
}

function stepTrace(dir) {
  const base = app.head.it ?? app.scrub ?? 0;
  const it = traceStep(app.traceList, base, dir);
  if (it === null) return;
  app.live = false;
  app.playing = false;
  app.head = { it, t: 0 };
  app.scrub = it;
  syncTransport();
  app.requestDraw();
}

function addRecord(rec, hasTrace) {
  if (!app.store.append(rec)) return;
  if (hasTrace) app.traceList.push(rec.iteration);
  if (app.live && hasTrace && app.head.it === null) app.head = { it: rec.iteration, t: 0 };
  app.chartsDirty = true;
  app.dirty = true;
}

function connect() {
  const es = new EventSource(runPath(app.store.eventsUrl()));
  es.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      addRecord(msg.record, msg.trace);
    } catch { /* a malformed event is skipped */ }
  };
  es.addEventListener('status', (e) => {
    const s = JSON.parse(e.data);
    if (s.command === 'save') toast('Checkpoint requested: the trainer writes it after this iteration');
    if (s.command === 'stop') toast('Stop requested: finishing this iteration');
    app.meta.status = s.status;
    setStatus(s.status);
    if (s.status === 'finished') {
      es.close(); app.playing = false; syncTransport();
      document.dispatchEvent(new Event('run-finished'));
      toast(app.meta.managed ? 'Run saved. Find it in Previous runs.' : 'Run saved. The charts, map and Compare brains stay available here.');
    }
  });
  es.onerror = () => {
    if (app.meta.status === 'finished') return;
    setStatus(es.readyState === EventSource.CLOSED ? 'offline' : 'reconnecting');
  };
  es.onopen = () => setStatus(app.meta.status);
}

/** Old traces leave the server's memory as training goes on: refresh the list now and then. */
async function refreshTraces() {
  try {
    const list = await api('/api/traces');
    const tail = app.traceList.filter((it) => it > (list[list.length - 1] ?? -1));
    app.traceList = [...list, ...tail];
    cache.forgetMissing();
  } catch { /* offline: keep the list */ }
}

function ensureTraces() {
  const it = app.head.it;
  if (it === null) return;
  const T = traceT();
  const trailSteps = Number($('trailLen').value) * hz();
  const need = [it];
  for (let k = 1; k <= Math.ceil(trailSteps / T) + 1; k++) need.push(it - k);
  for (let k = 0, n = it; k < 3; k++) { n = traceStep(app.traceList, n, 1); if (n === null) break; need.push(n); }
  for (const n of need) {
    if (n < 0 || cache.peek(n) || cache.missing.has(n)) continue;
    if (!app.traceList.includes(n)) continue;
    cache.get(n).then((tr) => { if (tr) app.dirty = true; }).catch(() => {});
  }
}

function frameData() {
  const it = app.head.it;
  const T = traceT();
  const trailSteps = Math.round(Number($('trailLen').value) * hz());
  const chain = it === null ? [] : chainOf(cache, it, Math.ceil(trailSteps / T) + 1);
  const cur = chain[chain.length - 1] ?? null;
  const nextIt = it === null ? null : traceStep(app.traceList, it, 1);
  const next = nextIt === it + 1 ? cache.peek(nextIt) : null;
  if (cur && talliesFor.it !== cur.iteration) talliesFor = { it: cur.iteration, data: worldTallies(cur, app.worlds.length) };
  return {
    chain: cur ? chain : [],
    next,
    t: app.head.t,
    trailSteps,
    hz: hz(),
    tallies: cur ? talliesFor.data : null,
    trailMode: $('trailMode').value,
    layers: { path: $('layPath').checked, obstacles: $('layObst').checked, colliders: $('layBoxes').checked },
  };
}

let lastTime = performance.now();
let lastHeadIt = null;
function tick(now) {
  const dt = Math.min((now - lastTime) / 1000, 0.25);
  lastTime = now;
  if ($('runPage').hidden) { app.playing = false; syncTransport(); return; }
  // Another tab is open: keep the readouts current and draw nothing until the training views come back.
  if ($('runView').hidden) { if (app.store.length) updateReadouts(); requestAnimationFrame(tick); return; }
  const T = traceT();
  if (app.live && app.head.it === null && app.traceList.length) app.head = { it: app.traceList[app.traceList.length - 1], t: 0 };
  if (app.playing && app.head.it !== null && cache.peek(app.head.it)) {
    const h = advance(app.head, dt, { speed: app.speed, hz: hz(), T, list: app.traceList, live: app.live });
    if (h.it === app.head.it || cache.peek(h.it)) app.head = { it: h.it, t: h.t };
    else {
      // The next trace is still loading: hold on the last step of this one.
      cache.get(h.it).catch(() => {});
      app.head = { it: app.head.it, t: T - 1e-6 };
    }
    app.dirty = true;
  }
  if (app.head.it !== lastHeadIt) {
    lastHeadIt = app.head.it;
    if (!app.live && app.head.it !== null) app.scrub = app.head.it;
    app.chartsDirty = true;
  }
  ensureTraces();
  if (app.dirty) {
    app.dirty = false;
    const f = frameData();
    app.map.draw(f);
    app.profile.draw(f);
    const cur = f.chain[f.chain.length - 1];
    const step = cur ? Math.min(Math.floor(app.head.t) + 1, cur.T) : 0;
    $('playInfo').textContent = app.head.it === null
      ? (app.traceList.length ? 'loading trace…' : 'no drone traces in this run')
      : `trace of iteration ${app.head.it} · step ${step}/${cur?.T ?? T} · ${(app.head.t / hz()).toFixed(2)} s`;
  }
  if (app.chartsDirty) {
    app.chartsDirty = false;
    for (const c of app.charts) c.draw();
    app.timeline.draw();
    updateReadouts();
    updateTable();
  }
  requestAnimationFrame(tick);
}

function bindControls() {
  // runs.js asks before stopping and handles both commands for the run manager.
  if (!app.meta.managed) {
    $('btnSave').addEventListener('click', () => command('save'));
    document.addEventListener('stop-confirmed', () => command('stop'));
  }
  const tabs = TABS.map(([tabId, , key]) => [$(tabId), key]);
  for (const [tab, key] of tabs) tab.addEventListener('click', () => selectTab(key));
  document.querySelector('.tablist').addEventListener('keydown', (e) => {
    const k = tabs.findIndex(([tab]) => tab === document.activeElement);
    const next = { ArrowRight: k + 1, ArrowLeft: k - 1, Home: 0, End: tabs.length - 1 }[e.key];
    if (k < 0 || next === undefined) return;
    e.preventDefault();
    selectTab(tabs[(next + tabs.length) % tabs.length][1], true);
  });
  // Popovers (Layers, help) close on a click elsewhere or Escape.
  document.addEventListener('click', (e) => {
    for (const d of document.querySelectorAll('details.popover[open]')) if (!d.contains(e.target)) d.open = false;
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    for (const d of document.querySelectorAll('details.popover[open]')) { d.open = false; d.querySelector('summary').focus(); }
  });
  const chartSet = (all) => {
    document.body.classList.toggle('show-details', all);
    for (const [id, on] of [['chartsKey', !all], ['chartsAll', all]]) { $(id).classList.toggle('on', on); $(id).setAttribute('aria-pressed', String(on)); }
    app.requestDraw();
  };
  $('chartsKey').addEventListener('click', () => chartSet(false));
  $('chartsAll').addEventListener('click', () => chartSet(true));
  $('btnElevation').addEventListener('click', () => {
    const show = $('elevation').hidden;
    $('elevation').hidden = !show;
    $('btnElevation').setAttribute('aria-pressed', String(show));
    app.requestDraw();
  });
  $('btnPlay').addEventListener('click', () => { app.playing = !app.playing; syncTransport(); });
  $('btnLive').addEventListener('click', goLive);
  $('btnBack').addEventListener('click', () => stepTrace(-1));
  $('btnFwd').addEventListener('click', () => stepTrace(1));
  $('speed').addEventListener('change', (e) => { app.speed = Number(e.target.value); });
  $('btnOverview').addEventListener('click', () => app.selectWorld(-1));
  $('worldSel').addEventListener('change', (e) => app.selectWorld(Number(e.target.value)));
  for (const id of ['layPath', 'layObst', 'layBoxes', 'trailMode']) $(id).addEventListener('change', () => app.requestDraw());
  $('trailLen').addEventListener('input', (e) => { $('trailOut').textContent = `${e.target.value} s`; app.requestDraw(); });
  $('smooth').addEventListener('input', (e) => {
    $('smoothOut').textContent = Number(e.target.value).toFixed(2);
    app.store.setSmoothing(Number(e.target.value));
    app.requestDraw();
  });
  $('btnResetZoom').addEventListener('click', () => app.setView(null));
  $('btnTable').addEventListener('click', () => {
    const tv = $('tableView');
    tv.hidden = !tv.hidden;
    $('btnTable').setAttribute('aria-pressed', String(!tv.hidden));
    app.chartsDirty = true;
  });
  const profMode = (mode) => {
    app.profile.setMode(mode);
    for (const [id, on] of [['profDist', mode === 'distance'], ['profSide', mode === 'side']]) { $(id).classList.toggle('on', on); $(id).setAttribute('aria-pressed', String(on)); }
  };
  $('profDist').addEventListener('click', () => profMode('distance'));
  $('profSide').addEventListener('click', () => profMode('side'));
  document.addEventListener('keydown', (e) => {
    if ($('runView').hidden || document.querySelector('dialog[open]')) return;
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    // Arrow keys on the tabs move between tabs.
    if (e.target instanceof Element && e.target.closest('[role="tablist"]')) return;
    // Space on a focused button or summary already clicks it.
    if (e.key === ' ' && (e.target instanceof HTMLButtonElement || e.target instanceof HTMLElement && e.target.tagName === 'SUMMARY')) return;
    if (e.key === ' ') { e.preventDefault(); app.playing = !app.playing; syncTransport(); }
    else if (e.key === 'ArrowLeft') stepTrace(-1);
    else if (e.key === 'ArrowRight') stepTrace(1);
    else if (e.key === 'l' || e.key === 'L') goLive();
    else if (e.key === 'o' || e.key === 'O') app.selectWorld(-1);
  });
  new ResizeObserver(() => app.requestDraw()).observe(document.body);
}

async function main() {
  document.body.dataset.viewerLoading = 'true';
  app.meta = await api('/api/meta');
  // The run manager's home screen (runs.js) owns the page until a run is training.
  if (app.meta.managed && app.meta.status !== 'running') { delete document.body.dataset.viewerLoading; return; }
  bindControls();
  document.title = `${app.meta.name} · FPV brain training`;
  $('runName').textContent = app.meta.name;
  for (const el of [$('runPage'), $('viewActions'), document.querySelector('.kpis')]) el.hidden = false;
  document.querySelector('.commands').hidden = app.meta.mode === 'replay';
  setStatus(app.meta.status);
  renderSettings();
  selectTab(location.hash.slice(1));
  const [worlds, history, traces] = await Promise.all([api('/api/worlds'), api('/api/history'), api('/api/traces')]);
  app.worlds = worlds;
  app.traceList = traces;
  // Watch in game starts from this run's brain on the world the map shows.
  setWatchContext(() => ({ brain: app.meta.activeRunId || app.meta.name, worlds: app.worlds, world: app.world }));
  app.store = new Store({ config: app.meta.config, policyHz: hz() });
  app.store.setSmoothing(Number($('smooth').value));
  for (const r of history) app.store.append(r);
  const sel = $('worldSel');
  sel.replaceChildren(Object.assign(document.createElement('option'), { value: '-1', textContent: 'All worlds' }),
    ...worlds.map((w, k) => Object.assign(document.createElement('option'), { value: String(k), textContent: `${k} · ${w.style} · ${w.gates.length} gates` })));
  const chartsEl = $('charts');
  app.charts = CHARTS.map((def) => {
    const before = chartsEl.children.length;
    const chart = new Chart(chartsEl, def, app);
    if (!KEY_CHARTS.includes(def.id)) for (const child of [...chartsEl.children].slice(before)) child.classList.add('extra-detail');
    return chart;
  });
  app.map = new TopDown($('map'), $('mapTip'), app);
  app.profile = new Profile($('profile'), app);
  app.timeline = new Timeline($('scrub'), app);
  app.selectWorld(worlds.length === 1 ? 0 : -1);
  if (app.meta.mode === 'replay') {
    app.live = false;
    $('btnLive').disabled = true;
    // Show the last stretch of traces, paused until the user presses Play.
    const list = app.traceList;
    const from = list.length ? list[Math.max(0, list.length - 400)] : app.store.last?.iteration;
    if (from !== undefined) app.scrubTo(from);
    app.playing = false;
  } else {
    app.live = true; app.playing = true;
    connect();
    setInterval(refreshTraces, 15000);
  }
  syncTransport();
  document.body.dataset.viewerReady = 'true';
  document.body.dataset.viewerRun = app.meta.activeRunId || app.meta.name;
  delete document.body.dataset.viewerLoading;
  requestAnimationFrame(tick);
}

main().catch((e) => {
  setStatus('offline');
  toast(`Dashboard failed to load: ${e.message}`);
  console.error(e);
});
