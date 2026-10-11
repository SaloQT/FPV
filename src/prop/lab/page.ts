/**
 * The prop lab page (?mode=proplab). It needs no GPU: it edits props, draws the blade, compares variants on the same static-bench
 * curves the CLI uses, runs the surrogate search in a worker, and stores the prop you pick for the game to load.
 */
import { el, setText } from '../../ui/dom';
import { benchProp, type BenchReport } from '../bench';
import { propCurves, type CurvePoint } from '../curves';
import { chordAt, DEFAULT_PROP, designFromVector, INCH, PROP_VARS, twistAt, vectorFromDesign, type PropDesign, type PropVar } from '../design';
import { parseProp, PROP_STORAGE_KEY, serializeProp } from '../files';
import { DEFAULT_WEIGHTS } from '../optimize';
import type { LabReply, LabRow, LabRunRequest } from './worker';
import './lab.css';


const COLORS = ['#4cc2ff', '#f0b429', '#5fd38d', '#ff7a90', '#b69cff', '#ff9f5a', '#6ee7d8', '#d4d86a'];

interface Variant { d: PropDesign; color: string; bench: BenchReport; curves: CurvePoint[]; open: boolean }

const LABELS: Record<PropVar['key'], string> = {
  diameter: 'diameter in', pitch: 'pitch in', pitchTilt: 'pitch tilt', blades: 'blades', chordRatio: 'chord',
  chordTaper: 'taper', thicknessRatio: 'thickness', clMax: 'max lift', cd0: 'drag',
};
const inUnits = (k: PropVar['key'], v: number): number => (k === 'diameter' || k === 'pitch' ? v / INCH : v);
const fromUnits = (k: PropVar['key'], v: number): number => (k === 'diameter' || k === 'pitch' ? v * INCH : v);
const fmt = (n: number, p = 2): string => (Number.isFinite(n) ? n.toFixed(p) : '-');

function withVar(d: PropDesign, key: PropVar['key'], value: number): PropDesign {
  const x = vectorFromDesign(d);
  x[PROP_VARS.findIndex((v) => v.key === key)] = value;
  return designFromVector(x, d, d.name);
}

function makeVariant(d: PropDesign, color: string): Variant {
  return { d, color, bench: benchProp(d, undefined, false), curves: propCurves(d), open: false };
}

/** A canvas that keeps its pixel size equal to its box, so drawing is crisp at any window size. */
function fitCanvas(box: HTMLElement, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void): { redraw(): void } {
  const cv = el('canvas');
  box.append(cv);
  const redraw = (): void => {
    const r = box.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.floor(r.width)), h = Math.max(1, Math.floor(r.height));
    if (cv.width !== Math.floor(w * dpr) || cv.height !== Math.floor(h * dpr)) { cv.width = Math.floor(w * dpr); cv.height = Math.floor(h * dpr); }
    const g = cv.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    draw(g, w, h);
  };
  new ResizeObserver(redraw).observe(box);
  return { redraw };
}

function box(caption: string): HTMLElement {
  return el('div', 'pl-cv', el('span', 'cap', caption));
}

export function mountPropLab(root: HTMLElement): void {
  root.replaceChildren();
  // The game page layers a canvas under a click-through overlay; the lab hides the canvases and takes the clicks.
  for (const id of ['view', 'osd']) document.getElementById(id)?.setAttribute('hidden', '');
  root.style.pointerEvents = 'auto';
  const page = el('div', 'pl');
  root.append(page);

  const variants: Variant[] = [makeVariant({ ...DEFAULT_PROP, name: 'stock' }, COLORS[0])];
  let sel = 0;
  let yaw = 0.6, tilt = 0.9;

  // ---- left column: variants and sliders ----
  const list = el('div', 'pl-list');
  const sliders = el('div', 'pl-list');
  const status = el('div', 'pl-status');
  const fileIn = el('input');
  fileIn.type = 'file'; fileIn.accept = '.json'; fileIn.hidden = true;
  const btn = (label: string, on: () => void, cls = ''): HTMLButtonElement => {
    const b = el('button', cls, label);
    b.type = 'button';
    b.addEventListener('click', on);
    return b;
  };
  const left = el('section', 'pl-col',
    el('h2', '', 'Variants'), list, el('h2', '', 'Edit selected'), sliders,
    el('div', 'pl-btns',
      btn('Copy', () => addVariant({ ...variants[sel].d, name: `${variants[sel].d.name}+`, airfoil: { ...variants[sel].d.airfoil } })),
      btn('Load file', () => fileIn.click()),
      btn('Save file', () => saveFile()),
      btn('Remove', () => { if (variants.length > 1) { variants.splice(sel, 1); sel = Math.min(sel, variants.length - 1); refresh(); } })),
    el('div', 'pl-btns', btn('Fly this prop in the game', () => flyIt(), 'go'), btn('Back to stock', () => { localStorage.removeItem(PROP_STORAGE_KEY); setText(status, 'Game will use the stock prop.'); })),
    status, fileIn);

  function addVariant(d: PropDesign): void {
    variants.push(makeVariant(d, COLORS[variants.length % COLORS.length]));
    sel = variants.length - 1;
    refresh();
  }
  function saveFile(): void {
    const a = el('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(serializeProp(variants[sel].d), null, 1)], { type: 'application/json' }));
    a.download = `${variants[sel].d.name}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }
  function flyIt(): void {
    localStorage.setItem(PROP_STORAGE_KEY, JSON.stringify(serializeProp(variants[sel].d)));
    setText(status, `Game will fly "${variants[sel].d.name}" (reload the game page).`);
  }
  fileIn.addEventListener('change', async () => {
    const f = fileIn.files?.[0];
    fileIn.value = '';
    if (!f) return;
    try { const d = parseProp(await f.text()); addVariant({ ...d, name: d.name || f.name.replace(/\.json$/, '') }); } catch (e) { setText(status, `Could not load: ${(e as Error).message}`); }
  });

  // ---- middle column: blade views and curves ----
  const planBox = box('Blade plan (top) and pitch');
  const wireBox = box('Rotor, drag to turn');
  const thrustBox = box('Thrust g vs throttle');
  const powerBox = box('Battery watts vs throttle');
  const effBox = box('g per watt vs throttle');
  const mid = el('section', 'pl-col', el('div', 'pl-view', planBox, wireBox), el('div', 'pl-curves', thrustBox, powerBox, effBox));

  const plan = fitCanvas(planBox, (g, w, h) => {
    const d = variants[sel].d;
    g.fillStyle = '#8795a6'; g.font = '11px system-ui';
    const R = d.diameter / 2, hub = d.hubRatio;
    const sx = (w - 40) / (R * (1 - hub * 0.5)), sy = sx;
    const x0 = 20, yc = h / 2;
    const pts = (side: number): [number, number][] => {
      const out: [number, number][] = [];
      for (let i = 0; i <= 24; i++) { const x = hub + (1 - hub) * (i / 24); out.push([x0 + (x - hub * 0.5) * R * sx, yc + side * chordAt(d, x) * sy * (side < 0 ? 0.25 : 0.75) * 2]); }
      return out;
    };
    g.beginPath();
    pts(-1).forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    pts(1).reverse().forEach(([x, y]) => g.lineTo(x, y));
    g.closePath();
    g.fillStyle = `${variants[sel].color}55`; g.fill(); g.strokeStyle = variants[sel].color; g.stroke();
    g.fillStyle = '#8795a6';
    g.fillText(`${fmt(d.diameter / INCH, 2)} x ${fmt(d.pitch / INCH, 2)} x ${d.blades}`, 8, h - 8);
    // twist along the radius, drawn as a small strip along the bottom third
    g.strokeStyle = '#8795a6'; g.beginPath();
    for (let i = 0; i <= 20; i++) {
      const x = hub + (1 - hub) * (i / 20), a = twistAt(d, x) * (180 / Math.PI);
      const px = x0 + (x - hub * 0.5) * R * sx, py = h - 28 - a * 1.2;
      i ? g.lineTo(px, py) : g.moveTo(px, py);
    }
    g.stroke();
    g.fillText('blade angle', w - 70, h - 14);
  });

  const wire = fitCanvas(wireBox, (g, w, h) => {
    const d = variants[sel].d;
    const R = d.diameter / 2, scale = Math.min(w, h) * 0.46 / R;
    const cy = Math.cos(yaw), sy = Math.sin(yaw), ct = Math.cos(tilt), st = Math.sin(tilt);
    const project = (x: number, y: number, z: number): [number, number] => {
      const a = x * cy - y * sy, b = x * sy + y * cy;
      return [w / 2 + a * scale, h / 2 - (b * st + z * ct) * scale];
    };
    g.strokeStyle = variants[sel].color; g.fillStyle = `${variants[sel].color}33`;
    for (let k = 0; k < d.blades; k++) {
      const az = (k / d.blades) * Math.PI * 2, ca = Math.cos(az), sa = Math.sin(az);
      const le: [number, number][] = [], te: [number, number][] = [];
      for (let i = 0; i <= 16; i++) {
        const x = d.hubRatio + (1 - d.hubRatio) * (i / 16), r = x * R, c = chordAt(d, x), th = twistAt(d, x);
        for (const [s, arr] of [[-0.25, le], [0.75, te]] as const) {
          const along = s * c * Math.cos(th), up = s * c * Math.sin(th);
          arr.push(project(r * ca - along * sa, r * sa + along * ca, up));
        }
      }
      g.beginPath();
      le.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
      te.reverse().forEach(([x, y]) => g.lineTo(x, y));
      g.closePath(); g.fill(); g.stroke();
    }
  });
  let drag: { x: number; y: number } | null = null;
  wireBox.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; wireBox.setPointerCapture(e.pointerId); });
  wireBox.addEventListener('pointerup', () => { drag = null; });
  wireBox.addEventListener('pointermove', (e) => {
    if (!drag) return;
    yaw += (e.clientX - drag.x) * 0.01; tilt = Math.min(1.5, Math.max(0.1, tilt + (e.clientY - drag.y) * 0.01));
    drag = { x: e.clientX, y: e.clientY };
    wire.redraw();
  });

  const lineChart = (b: HTMLElement, pick: (p: CurvePoint) => number): { redraw(): void } => fitCanvas(b, (g, w, h) => {
    const padL = 38, padB = 18, padT = 24, padR = 8;
    let hi = 0;
    for (const v of variants) for (const p of v.curves) hi = Math.max(hi, pick(p));
    hi = hi > 0 ? hi * 1.08 : 1;
    g.strokeStyle = '#2b3644'; g.fillStyle = '#8795a6'; g.font = '11px system-ui';
    for (let i = 0; i <= 4; i++) {
      const y = padT + ((h - padT - padB) * i) / 4;
      g.beginPath(); g.moveTo(padL, y); g.lineTo(w - padR, y); g.stroke();
      g.fillText(fmt(hi * (1 - i / 4), hi < 10 ? 1 : 0), 4, y + 4);
    }
    g.fillText('throttle 0 to 100%', padL, h - 4);
    variants.forEach((v, vi) => {
      g.strokeStyle = v.color; g.lineWidth = vi === sel ? 2.5 : 1.3; g.beginPath();
      v.curves.forEach((p, i) => {
        const x = padL + (w - padL - padR) * p.duty, y = padT + (h - padT - padB) * (1 - pick(p) / hi);
        i ? g.lineTo(x, y) : g.moveTo(x, y);
      });
      g.stroke();
    });
    g.lineWidth = 1;
  });
  const cThrust = lineChart(thrustBox, (p) => p.thrustG);
  const cPower = lineChart(powerBox, (p) => p.watts);
  const cEff = lineChart(effBox, (p) => p.gramsPerWatt);

  // ---- right column: optimiser ----
  const w = { efficiency: DEFAULT_WEIGHTS.efficiency, thrustToWeight: DEFAULT_WEIGHTS.thrustToWeight, flightTime: DEFAULT_WEIGHTS.flightTime, lapTime: 0 };
  const optBox = el('div', 'pl-list');
  const bar = el('i');
  const progress = el('div', 'pl-bar', bar);
  const optStatus = el('div', 'pl-status');
  const chartBox = el('div', 'pl-cv pl-chart', el('span', 'cap', 'cost of each design (lower is better)'));
  const results = el('div', 'pl-list');
  const budget = el('input'); budget.type = 'number'; budget.value = '80'; budget.min = '30'; budget.max = '400'; budget.style.width = '64px';
  const seed = el('input'); seed.type = 'number'; seed.value = '1'; seed.style.width = '56px';
  const run = btn('Run optimiser', () => start(), 'go');
  const stop = btn('Stop', () => halt());
  stop.disabled = true;
  const right = el('section', 'pl-col', el('h2', '', 'Optimiser'), optBox,
    el('div', 'pl-btns', el('span', '', 'evaluations'), budget, el('span', '', 'seed'), seed, run, stop),
    progress, optStatus, chartBox, el('h2', '', 'Best designs'), results);

  for (const [key, label] of [['efficiency', 'efficiency'], ['thrustToWeight', 'thrust / weight'], ['flightTime', 'flight time']] as const) {
    const out = el('output'); out.textContent = String(w[key]);
    const inp = el('input'); inp.type = 'range'; inp.min = '0'; inp.max = '3'; inp.step = '0.5'; inp.value = String(w[key]);
    inp.addEventListener('input', () => { w[key] = Number(inp.value); out.textContent = inp.value; });
    optBox.append(el('label', 'pl-sl', el('span', '', label), inp, out));
  }
  optBox.append(el('div', 'pl-status', 'Limits: fits a 5 inch frame, tip Mach under 0.75, blade stress under 1.25x stock.'));

  let worker: Worker | null = null;
  let rows: LabRow[] = [];
  let bestCost = Infinity;
  const trace: { cost: number; best: number }[] = [];
  const chart = fitCanvas(chartBox, (g, cw, ch) => {
    if (!trace.length) return;
    const padL = 6, padB = 6, padT = 18;
    const hi = Math.max(1.5, ...trace.map((t) => Math.min(t.cost, 3)));
    const lo = Math.min(-0.5, ...trace.map((t) => t.best));
    const X = (i: number): number => padL + ((cw - padL - 6) * i) / Math.max(1, trace.length - 1);
    const Y = (c: number): number => padT + (ch - padT - padB) * (1 - (Math.min(c, hi) - lo) / (hi - lo));
    g.fillStyle = '#8795a6';
    trace.forEach((t, i) => g.fillRect(X(i) - 1, Y(t.cost) - 1, 2, 2));
    g.strokeStyle = '#5fd38d'; g.beginPath();
    trace.forEach((t, i) => (i ? g.lineTo(X(i), Y(t.best)) : g.moveTo(X(i), Y(t.best))));
    g.stroke();
  });

  function showResults(): void {
    results.replaceChildren();
    const ok = rows.filter((r) => r.violation === 0).sort((a, b) => a.cost - b.cost).slice(0, 8);
    for (const r of ok) {
      const n = r.design;
      const more = el('div', 'pl-more',
        el('span', '', 'diameter ', el('b', '', `${fmt(n.diameterIn)} in`)), el('span', '', 'pitch ', el('b', '', `${fmt(n.pitchIn)} in`)),
        el('span', '', 'blades ', el('b', '', String(n.blades))), el('span', '', 'chord ', el('b', '', fmt(n.chordRatio))),
        el('span', '', 'tip Mach ', el('b', '', fmt(r.tipMach))), el('span', '', 'hover ', el('b', '', `${fmt(r.hoverMinutes, 1)} min`)),
        btn('Use as variant', () => addVariant({ ...parseProp(n), name: `opt-${r.id}` })));
      more.hidden = true;
      const row = el('div', 'pl-row', el('div', 'pl-line', el('span', 'nm', `#${r.id}  ${fmt(n.diameterIn, 1)}x${fmt(n.pitchIn, 1)}x${n.blades}`),
        el('span', 'num', `${fmt(r.gramsPerWattHover)} g/W`), el('span', 'num', `T/W ${fmt(r.thrustToWeight, 1)}`)), more);
      row.addEventListener('click', (e) => { if (!(e.target instanceof HTMLButtonElement)) more.hidden = !more.hidden; });
      results.append(row);
    }
  }
  function halt(): void {
    worker?.terminate(); worker = null;
    run.disabled = false; stop.disabled = true;
    setText(optStatus, `Stopped after ${rows.length} evaluations.`);
  }
  function start(): void {
    halt();
    rows = []; trace.length = 0; bestCost = Infinity; bar.style.width = '0';
    run.disabled = false; stop.disabled = false; run.disabled = true;
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (ev: MessageEvent<LabReply>): void => {
      const m = ev.data;
      if (m.type === 'progress') {
        rows.push(m.row);
        const c = m.row.violation > 0 ? m.row.cost : m.row.cost;
        bestCost = Math.min(bestCost, c);
        trace.push({ cost: c, best: bestCost });
        bar.style.width = `${(100 * m.done) / m.budget}%`;
        setText(optStatus, `${m.done}/${m.budget} evaluated, best cost ${fmt(bestCost, 3)}`);
        chart.redraw();
        if (m.done % 8 === 0) showResults();
      } else {
        rows = m.rows;
        showResults();
        setText(optStatus, `Done in ${fmt(m.seconds, 1)} s. Surrogate correlation ${fmt(m.surrogateCorr)}.`);
        worker?.terminate(); worker = null;
        run.disabled = false; stop.disabled = true;
      }
    };
    const req: LabRunRequest = { type: 'run', seed: Number(seed.value) || 1, budget: Math.max(30, Number(budget.value) || 80), weights: { ...w } };
    worker.postMessage(req);
  }

  page.append(
    el('header', 'pl-head', el('h1', '', 'Propeller lab'), el('span', '', '5 inch quad, blade element model, same sim as the game'),
      Object.assign(el('a'), { href: location.pathname, textContent: 'Back to the game' })),
    left, mid, right);

  // ---- list and slider rendering ----
  function refresh(): void {
    list.replaceChildren();
    variants.forEach((v, i) => {
      const b = v.bench;
      const more = el('div', 'pl-more',
        el('span', '', 'static ', el('b', '', `${fmt(b.staticThrustG, 0)} g`)), el('span', '', 'thrust/weight ', el('b', '', fmt(b.thrustToWeight, 1))),
        el('span', '', 'hover ', el('b', '', `${fmt(b.hoverDuty * 100, 0)} %`)), el('span', '', 'hover current ', el('b', '', `${fmt(b.hoverCurrent, 1)} A`)),
        el('span', '', 'hover time ', el('b', '', `${fmt(b.hoverMinutes, 1)} min`)), el('span', '', 'tip Mach ', el('b', '', fmt(b.tipMach))),
        el('span', '', 'prop mass ', el('b', '', `${fmt(b.propGrams, 1)} g`)), el('span', '', 'blades ', el('b', '', String(v.d.blades))));
      more.hidden = !v.open;
      const dot = el('span', 'dot'); dot.style.background = v.color;
      const row = el('div', i === sel ? 'pl-row sel' : 'pl-row', el('div', 'pl-line', dot, el('span', 'nm', v.d.name),
        el('span', 'num', `${fmt(b.gramsPerWattHover)} g/W`), el('span', 'num', `${fmt(b.hoverMinutes, 1)} min`)), more);
      row.addEventListener('click', () => { if (sel === i) v.open = !v.open; sel = i; refresh(); });
      list.append(row);
    });
    sliders.replaceChildren();
    const v = variants[sel];
    for (const pv of PROP_VARS) {
      const cur = inUnits(pv.key, pv.key === 'clMax' ? v.d.airfoil.clMax : pv.key === 'cd0' ? v.d.airfoil.cd0 : v.d[pv.key]);
      const lo = inUnits(pv.key, pv.min), hi = inUnits(pv.key, pv.max);
      const inp = el('input'); inp.type = 'range'; inp.min = String(lo); inp.max = String(hi);
      inp.step = pv.integer ? '1' : String((hi - lo) / 200); inp.value = String(cur);
      const out = el('output', '', fmt(cur, pv.integer ? 0 : pv.key === 'cd0' || pv.key === 'thicknessRatio' ? 3 : 2));
      inp.addEventListener('input', () => {
        v.d = withVar(v.d, pv.key, fromUnits(pv.key, Number(inp.value)));
        out.textContent = fmt(Number(inp.value), pv.integer ? 0 : pv.key === 'cd0' || pv.key === 'thicknessRatio' ? 3 : 2);
        plan.redraw(); wire.redraw();
      });
      inp.addEventListener('change', () => { Object.assign(v, makeVariant(v.d, v.color), { open: v.open }); refresh(); });
      sliders.append(el('label', 'pl-sl', el('span', '', LABELS[pv.key]), inp, out));
    }
    plan.redraw(); wire.redraw(); cThrust.redraw(); cPower.redraw(); cEff.redraw();
  }
  refresh();
}
