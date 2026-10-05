// The dashboard page: loads the run (meta, worlds, history, kept traces), follows the trainer's event stream, and keeps every
// view on one playhead: the charts' cursor, the timeline, the map and the elevation profile all move when you scrub.
import { Chart } from './chart.js';
import { Profile } from './profile.js';
import { CHARTS, Store, clock, fmt } from './series.js';
import { Timeline } from './timeline.js';
import { TopDown } from './topdown.js';
import { TraceCache, advance, chainOf, traceFor, traceStep, worldTallies } from './trace.js';

const $ = (id) => document.getElementById(id);

async function api(path) {
  const r = await fetch(path, { cache: 'no-store' });
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json();
}

async function loadTrace(it) {
  const r = await fetch(`/api/trace/${it}`, { cache: 'no-store' });
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
  live: true,
  playing: true,
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
  el.className = `pill ${mode}`;
  el.textContent = app.meta?.mode === 'replay' ? `replay (${status})` : status;
  const canCommand = app.meta?.mode !== 'replay' && status === 'running';
  $('btnSave').disabled = !canCommand;
  $('btnStop').disabled = !canCommand;
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

function updateReadouts() {
  const st = app.store;
  const i = app.live || app.scrub === null ? st.length - 1 : st.nearest(app.scrub);
  const r = st.records[i];
  if (!r) return;
  $('rIter').textContent = String(r.iteration);
  $('rElapsed').textContent = clock(r.elapsed);
  $('rSteps').textContent = fmt(r.envSteps);
  $('rSps').textContent = fmt(r.sps);
  $('rReturn').textContent = fmt(st.value('ret', i));
  $('rCrash').textContent = `${fmt(st.value('crash', i), 3)}%`;
  const best = st.value('bestRun', i, false);
  $('rBest').textContent = Number.isNaN(best) ? '–' : `${best.toFixed(2)} s`;
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
  $('btnPlay').textContent = app.playing ? '❚❚' : '▶';
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
  const es = new EventSource(app.store.eventsUrl());
  es.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      addRecord(msg.record, msg.trace);
    } catch { /* a malformed event is skipped */ }
  };
  es.addEventListener('status', (e) => {
    const s = JSON.parse(e.data);
    if (s.command === 'save') toast('Checkpoint requested');
    if (s.command === 'stop') toast('Stop requested: finishing this iteration');
    app.meta.status = s.status;
    setStatus(s.status);
    if (s.status === 'finished') { es.close(); toast('Training finished'); }
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
  $('btnSave').addEventListener('click', () => command('save'));
  $('btnStop').addEventListener('click', () => { $('confirm').hidden = false; $('confirmNo').focus(); });
  $('confirmNo').addEventListener('click', () => { $('confirm').hidden = true; });
  $('confirmYes').addEventListener('click', () => { $('confirm').hidden = true; command('stop'); });
  $('confirm').addEventListener('click', (e) => { if (e.target === $('confirm')) $('confirm').hidden = true; });
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
    $('btnTable').setAttribute('aria-expanded', String(!tv.hidden));
    $('btnTable').classList.toggle('on', !tv.hidden);
    app.chartsDirty = true;
  });
  $('profDist').addEventListener('click', () => { app.profile.setMode('distance'); $('profDist').classList.add('on'); $('profSide').classList.remove('on'); });
  $('profSide').addEventListener('click', () => { app.profile.setMode('side'); $('profSide').classList.add('on'); $('profDist').classList.remove('on'); });
  document.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    // Space on a focused button already clicks it.
    if (e.key === ' ' && e.target instanceof HTMLButtonElement) return;
    if (!$('confirm').hidden) { if (e.key === 'Escape') $('confirm').hidden = true; return; }
    if (e.key === ' ') { e.preventDefault(); app.playing = !app.playing; syncTransport(); }
    else if (e.key === 'ArrowLeft') stepTrace(-1);
    else if (e.key === 'ArrowRight') stepTrace(1);
    else if (e.key === 'l' || e.key === 'L') goLive();
    else if (e.key === 'o' || e.key === 'O') app.selectWorld(-1);
  });
  new ResizeObserver(() => app.requestDraw()).observe(document.body);
}

async function main() {
  bindControls();
  app.meta = await api('/api/meta');
  document.title = `${app.meta.name} · FPV brain training`;
  $('runName').textContent = app.meta.name;
  setStatus(app.meta.status);
  const [worlds, history, traces] = await Promise.all([api('/api/worlds'), api('/api/history'), api('/api/traces')]);
  app.worlds = worlds;
  app.traceList = traces;
  app.store = new Store({ config: app.meta.config, policyHz: hz() });
  app.store.setSmoothing(Number($('smooth').value));
  for (const r of history) app.store.append(r);
  const sel = $('worldSel');
  sel.replaceChildren(Object.assign(document.createElement('option'), { value: '-1', textContent: 'All worlds' }),
    ...worlds.map((w, k) => Object.assign(document.createElement('option'), { value: String(k), textContent: `${k} · ${w.style} · ${w.gates.length} gates` })));
  const chartsEl = $('charts');
  app.charts = CHARTS.map((def) => new Chart(chartsEl, def, app));
  app.map = new TopDown($('map'), $('mapTip'), app);
  app.profile = new Profile($('profile'), app);
  app.timeline = new Timeline($('scrub'), app);
  app.selectWorld(worlds.length === 1 ? 0 : -1);
  if (app.meta.mode === 'replay') {
    app.live = false;
    $('btnLive').disabled = true;
    // Play the last stretch of consecutive traces: how the brain flew at the end of the run.
    const list = app.traceList;
    const from = list.length ? list[Math.max(0, list.length - 400)] : app.store.last?.iteration;
    if (from !== undefined) app.scrubTo(from);
    app.playing = true;
  } else {
    connect();
    setInterval(refreshTraces, 15000);
  }
  syncTransport();
  requestAnimationFrame(tick);
}

main().catch((e) => {
  setStatus('offline');
  toast(`Dashboard failed to load: ${e.message}`);
  console.error(e);
});
