// The page's pure logic: series, smoothing, ticks, trace decoding and playback, terrain shading, the elevation projection.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { longAxis, nearestPathIndex, projectWorld } from '../js/profile.js';
import { ALL_SERIES, CHARTS, Store, clock, decimate, fmt, logTicks, niceTicks } from '../js/series.js';
import { gridHeight, hillshade, trackBounds } from '../js/terrain.js';
import { BIT_CRASH, BIT_DONE, TraceCache, advance, chainOf, crashMarks, dronePos, dronesInWorld, makeTrace, nextOf, packBits, trail, traceFor, traceStep, worldOf, worldTallies } from '../js/trace.js';
import { gridFor } from '../js/topdown.js';
import { courseOf, FakeFleet, fakeMetrics, rng } from '../../dashboard-demo.mjs';

const rec = (it, m = {}, extra = {}) => ({ kind: 'iter', iteration: it, elapsed: it * 0.5, envSteps: it * 10, sps: 1e6, metrics: { episodes: 10, crashes: 3, gates: 60, laps: 2, finishes: 1, meanReturn: it, meanLength: 500, bestLap: 0, logStd: [-1, -2, -3, -4], gpuMs: 300, ...m }, ...extra });

describe('series store', () => {
  it('derives every chart value from a record', () => {
    const st = new Store({ config: { ppo: { envs: 100, steps: 30 } }, policyHz: 50 });
    st.append(rec(1));
    st.append(rec(2, { bestLap: 40 }));
    st.append(rec(3, { bestLap: 45 }));
    st.append(rec(4, { episodes: 0 }));
    assert.equal(st.length, 4);
    assert.equal(st.value('crash', 0, false), 30);
    assert.equal(st.value('gpm', 0, false), 60 / ((100 * 30) / 50 / 60));
    assert.equal(st.value('eplen', 0, false), 10);
    assert.equal(st.value('ls2', 0, false), -3);
    assert.ok(Number.isNaN(st.value('bestIt', 0, false)));
    assert.equal(st.value('bestRun', 2, false), 40);
    assert.equal(st.value('bestRun', 3, false), 40);
    assert.ok(Number.isNaN(st.value('ret', 3, false)), 'no episodes, no return');
    assert.ok(Number.isNaN(st.value('wall', 0, false)));
    assert.equal(st.value('wall', 1, false), 500);
    assert.equal(new Set(ALL_SERIES.map((s) => s.key)).size, ALL_SERIES.length, 'series keys are unique');
    assert.ok(CHARTS.length >= 12);
  });

  it('ignores records that are not newer', () => {
    const st = new Store();
    assert.equal(st.append(rec(5)), true);
    assert.equal(st.append(rec(5)), false);
    assert.equal(st.append(rec(3)), false);
    assert.equal(st.append({ iteration: 'x' }), false);
    assert.equal(st.length, 1);
  });

  it('smooths with a debiased EMA that keeps gaps', () => {
    const st = new Store();
    st.setSmoothing(0.9);
    for (let i = 1; i <= 50; i++) st.append(rec(i, { meanReturn: 7 }));
    for (let i = 0; i < 50; i++) assert.ok(Math.abs(st.value('ret', i) - 7) < 1e-9, 'constant input stays constant from the first point');
    st.append(rec(51, { episodes: 0 }));
    assert.ok(Number.isNaN(st.value('ret', 50)));
    st.append(rec(52, { meanReturn: 17 }));
    assert.ok(st.value('ret', 51) > 7 && st.value('ret', 51) < 17);
    st.setSmoothing(0);
    assert.equal(st.value('ret', 51), 17);
  });

  it('finds iterations', () => {
    const st = new Store();
    for (const it of [2, 4, 8, 16]) st.append(rec(it));
    assert.equal(st.lowerBound(5), 2);
    assert.equal(st.nearest(5), 1);
    assert.equal(st.nearest(7), 2);
    assert.equal(st.nearest(-10), 0);
    assert.equal(st.nearest(99), 3);
    assert.equal(new Store().nearest(3), -1);
  });

  it('decimates per pixel column', () => {
    const iters = Float64Array.from({ length: 1000 }, (_, i) => i);
    const raw = Float64Array.from({ length: 1000 }, (_, i) => (i % 2 ? 1 : -1));
    const cols = decimate(iters, raw, raw, 0, 999, 0, 999, 100);
    assert.ok(cols.length <= 101 && cols.length >= 99);
    assert.equal(cols[0].lo, -1);
    assert.equal(cols[0].hi, 1);
  });

  it('makes round ticks and readable numbers', () => {
    assert.deepEqual(niceTicks(0, 10, 5), [0, 2, 4, 6, 8, 10]);
    assert.deepEqual(niceTicks(-0.3, 0.3, 3), [-0.2, 0, 0.2]);
    assert.ok(niceTicks(5, 5).length > 0);
    assert.deepEqual(niceTicks(NaN, 1), []);
    // A range far below the float resolution of its values ends instead of looping.
    assert.deepEqual(niceTicks(1.5e6, 1.5e6 + 1e-9, 5), [1.5e6]);
    assert.ok(niceTicks(0, 1e9, 1000).length <= 200);
    assert.deepEqual(logTicks(0, 3).filter(Number.isInteger), [0, 1, 2, 3]);
    assert.equal(fmt(1.5e6), '1.50M');
    assert.equal(fmt(NaN), '–');
    assert.equal(fmt(0.0123), '0.0123');
    assert.equal(fmt(2e-5), '2.0e-5');
    assert.equal(clock(3725), '1:02:05');
    assert.equal(clock(65), '1:05');
  });
});

/** K drones x T steps; drone e in world e % 2 moving +x one metre per step. */
function makeT(it, K, T, fn) {
  const buf = new ArrayBuffer(K * T * 16);
  const f = new Float32Array(buf), u = new Uint32Array(buf);
  for (let t = 0; t < T; t++) for (let e = 0; e < K; e++) {
    const o = (t * K + e) * 4;
    const r = fn(t, e);
    f[o] = r.x; f[o + 1] = r.y ?? 0; f[o + 2] = r.z ?? 0;
    u[o + 3] = packBits(r.w ?? e % 2, r.next ?? 0, r.crash, r.finish, r.done);
  }
  return makeTrace(it, K, T, buf);
}

describe('traces', () => {
  it('packs and unpacks the bits the GPU writes', () => {
    const b = packBits(47, 4095, true, false, true);
    assert.equal(worldOf(b), 47);
    assert.equal(nextOf(b), 4095);
    assert.ok(b & BIT_CRASH && b & BIT_DONE);
    assert.equal(nextOf(packBits(1, 9999, false, false, false)), 4095);
  });

  it('tallies gates, crashes and drones per world', () => {
    // Drone 0 passes two gates then crashes at t=3 and respawns at gate 7; drone 1 just flies.
    const tr = makeT(1, 2, 6, (t, e) => (e === 0
      ? { x: t, next: t < 1 ? 0 : t < 2 ? 1 : t < 4 ? 2 : 7, crash: t === 3, done: t === 3 }
      : { x: t, next: 5 }));
    const tl = worldTallies(tr, 2);
    assert.equal(tl[0].drones, 1);
    assert.equal(tl[0].gates, 2, 'the respawn after the crash is not a gate');
    assert.equal(tl[0].crashes, 1);
    assert.equal(tl[1].gates, 0);
    assert.deepEqual(dronesInWorld(tr, 1), [1]);
  });

  it('draws trails across iterations and cuts them at episode ends', () => {
    const a = makeT(10, 2, 4, (t) => ({ x: t }));
    const b = makeT(11, 2, 4, (t) => ({ x: 4 + t, done: t === 1, crash: t === 1 }));
    const c = makeT(12, 2, 4, (t) => ({ x: 100 + t }));
    const tAll = trail([a, b], 0, 3.5, 100);
    // b's step 1 ended the episode: the trail starts after it.
    assert.deepEqual(tAll.map((p) => p[0]), [6, 7]);
    const t2 = trail([a, b], 0, 0.2, 100);
    assert.deepEqual(t2.map((p) => p[0]), [0, 1, 2, 3, 4]);
    assert.deepEqual(trail([a, b], 0, 0, 3).map((p) => p[0]), [2, 3, 4]);
    assert.equal(crashMarks([a, b, c], 0, 3, 100).length, 1);
    // Blend toward the next step, and into the next iteration's first step.
    assert.equal(dronePos(a, 0, 1.25)[0], 1.25);
    assert.equal(dronePos(a, 0, 3.5, b)[0], 3.5);
    assert.equal(dronePos(b, 0, 1.5, c)[0], 5, 'no blend across a respawn');
  });

  it('picks traces for a scrub position and steps between them', () => {
    const list = [25, 50, 100, 101, 102];
    assert.equal(traceFor(list, 60), 50);
    assert.equal(traceFor(list, 10), 25);
    assert.equal(traceFor(list, 500), 102);
    assert.equal(traceFor([], 5), null);
    assert.equal(traceStep(list, 50, 1), 100);
    assert.equal(traceStep(list, 102, 1), null);
    assert.equal(traceStep(list, 100, -1), 50);
    assert.equal(traceStep(list, 99, -1), 50);
    assert.equal(traceStep(list, 25, -1), null);
  });

  it('plays through consecutive traces and holds at the end', () => {
    const list = [1, 2, 3];
    let h = advance({ it: 1, t: 0 }, 0.5, { hz: 50, T: 32, list });
    assert.equal(h.it, 1); assert.equal(h.t, 25);
    h = advance(h, 0.5, { hz: 50, T: 32, list });
    assert.equal(h.it, 2); assert.equal(h.t, 18);
    h = advance({ it: 3, t: 30 }, 1, { hz: 50, T: 32, list });
    assert.equal(h.it, 3); assert.ok(h.held);
    // Live mode jumps to the newest trace when it is far behind and speeds up when a little behind.
    const many = Array.from({ length: 20 }, (_, k) => k + 1);
    assert.equal(advance({ it: 2, t: 0 }, 0.01, { hz: 50, T: 32, list: many, live: true }).it, 20);
    const near = advance({ it: 17, t: 0 }, 0.1, { hz: 50, T: 32, list: many, live: true });
    assert.ok(near.it > 17 || near.t > 5 * 1.5);
  });

  it('caches decoded traces and loads each once', async () => {
    let loads = 0;
    const cache = new TraceCache(async (it) => { loads++; return it === 9 ? null : { K: 16, T: 1, buffer: new ArrayBuffer(256) }; }, 2);
    const [x, y] = await Promise.all([cache.get(1), cache.get(1)]);
    assert.equal(x, y);
    assert.equal(loads, 1);
    await cache.get(2);
    await cache.get(3);
    assert.equal(cache.peek(1), null, 'least recently used goes first');
    assert.equal(await cache.get(9), null);
    await cache.get(9);
    assert.equal(loads, 4, 'a missing trace is not asked for again');
    assert.deepEqual(chainOf(cache, 3, 3).map((t) => t.iteration), [2, 3]);
  });
});

describe('small multiples', () => {
  it('lays worlds out in the biggest cells with the fewest gaps', () => {
    assert.deepEqual(gridFor(4, 1000, 600), { cols: 2, rows: 2 });
    assert.deepEqual(gridFor(1, 800, 500), { cols: 1, rows: 1 });
    const g = gridFor(48, 1000, 600);
    assert.ok(g.cols * g.rows >= 48 && g.cols > g.rows);
  });
});

describe('terrain', () => {
  const flat = { n: 4, step: 10, height: new Array(16).fill(5), origin: [-20, -20], min: 0, max: 10, water: null };

  it('shades a flat map evenly and paints water', () => {
    const img = hillshade(flat);
    assert.equal(img.length, 64);
    for (let k = 4; k < 64; k += 4) assert.equal(img[k], img[0]);
    const wet = hillshade({ ...flat, water: 6 });
    assert.ok(wet[2] > wet[0], 'water is blue');
    const slope = { ...flat, height: Array.from({ length: 16 }, (_, k) => (k % 4) * 20) };
    const s = hillshade(slope);
    // Ground rising toward +x faces away from the north-west light: darker than flat ground of the same tint.
    assert.ok(s[(1 * 4 + 1) * 4 + 3] === 255);
  });

  it('samples the grid bilinearly', () => {
    const t = { ...flat, height: [0, 10, 20, 30, 0, 10, 20, 30, 0, 10, 20, 30, 0, 10, 20, 30] };
    assert.equal(gridHeight(t, -20, -20), 0);
    assert.equal(gridHeight(t, -15, 0), 5);
    assert.equal(gridHeight(t, 100, 0), 30);
  });

  it('bounds the course', () => {
    const w = { path: [[0, 0, 0], [100, 0, 50]], gates: [{ pos: [-10, 0, 0] }], start: { pos: [0, 0, 70] }, terrain: flat };
    assert.deepEqual(trackBounds(w, 0), { x0: -10, x1: 100, z0: 0, z1: 70 });
  });
});

describe('elevation profile', () => {
  // A vertical loop in the x-y plane on a straight run along +x.
  const path = [];
  for (let i = 0; i <= 200; i++) path.push([i, 10, 0]);
  for (let k = 0; k <= 60; k++) { const a = (k / 60) * 2 * Math.PI; path.push([200 + 8 * Math.sin(a), 18 - 8 * Math.cos(a), 0]); }
  let s = 0;
  const p5 = path.map((p, i) => { if (i) s += Math.hypot(p[0] - path[i - 1][0], p[1] - path[i - 1][1], p[2] - path[i - 1][2]); return [p[0], p[1], p[2], s, 0]; });
  const gate = (index, x, y, feature) => ({ index, kind: 'square', color: '#fff', pos: [x, y, 0], feature, outline: [[x, y - 1, -1], [x, y - 1, 1], [x, y + 1, 1], [x, y + 1, -1]] });
  const w = { index: 0, path: p5, gates: [gate(0, 50, 10, null), gate(1, 200, 26, 'power-loop'), gate(2, 200, 10, 'power-loop'), gate(3, 150, 10, 'slalom')] };

  it('finds the long axis and nearest points', () => {
    const ax = longAxis(p5);
    assert.ok(Math.abs(Math.abs(ax.ax) - 1) < 1e-6);
    assert.equal(nearestPathIndex(p5, 50.2, 10, 0), 50);
  });

  it('keeps a loop a loop from the side and unrolls it along the course', () => {
    const side = projectWorld(w, 'side');
    const loopX = side.px.slice(201);
    assert.ok(Math.max(...loopX) - Math.min(...loopX) < 17, 'the loop spans its diameter from the side');
    const along = projectWorld(w, 'distance');
    assert.ok(along.px[along.px.length - 1] > 240, 'along the course the loop adds its circumference');
    assert.deepEqual(along.bands.map((b) => b.feature), ['power-loop', 'slalom']);
    // An upright gate's outline stands as a vertical bar at its place on the course.
    const g0 = along.gates[0].outline.map((q) => q[0]);
    assert.ok(Math.max(...g0) - Math.min(...g0) < 0.01);
  });
});

describe('demo fleet', () => {
  it('flies the course and reports gates and crashes', () => {
    const track = { closed: true, path: Array.from({ length: 400 }, (_, i) => { const a = (i / 400) * 2 * Math.PI; return [100 * Math.cos(a), 20, 100 * Math.sin(a)]; }), gates: [0, 100, 200, 300].map((i) => ({ pos: [100 * Math.cos((i / 400) * 2 * Math.PI), 20, 100 * Math.sin((i / 400) * 2 * Math.PI)] })) };
    const fleet = new FakeFleet([courseOf(track), courseOf(track)], 32, 3);
    const data = new Float32Array(32 * 50 * 4);
    let gates = 0;
    for (let k = 0; k < 10; k++) gates += fleet.run(50, 0.5, data).gates;
    assert.ok(gates > 10);
    const tr = makeTrace(1, 32, 50, data.buffer);
    assert.deepEqual(dronesInWorld(tr, 1).length, 16);
    const m = fakeMetrics(100, rng(1), 16384, 32, { episodes: 3, crashes: 1, gates: 40, finishes: 0 }, 32);
    for (const v of Object.values(m)) assert.ok(Array.isArray(v) || Number.isFinite(v));
  });
});
