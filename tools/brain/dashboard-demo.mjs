// The training dashboard without a GPU: builds a few real training worlds through the trainer bundle, then makes up an
// improving training run (metrics, and drones flying each track's centreline with some wobble, crashing now and then) and
// feeds it to the same dashboard server train.mjs uses, one iteration every 300 ms. Open the printed URL in a browser.
//
//   node tools/brain/dashboard-demo.mjs                      # 2 worlds on http://127.0.0.1:8787/
//   node tools/brain/dashboard-demo.mjs --worlds 6 --styles race,technical,acro --port 8790 --iters 600
//
// Options [defaults]: --port [8787], --worlds [2], --styles [technical,race] (cycled), --seed [1], --every [300] ms per
// iteration, --iters [0 = until stopped], --trace [64] traced drones, --steps [32] per iteration, --name [demo],
// --out [.bench/brain/dash-demo] (ndjson and trace files for `node tools/brain/dashboard.mjs --run <out>/<name>`).
import { resolve } from 'node:path';
import { ROOT, loadTrainer } from './bundle.mjs';
import { startDashboard } from './dashServer.mjs';

const BIT_CRASH = 1 << 24, BIT_FINISH = 1 << 25, BIT_DONE = 1 << 26;

/** Small seeded generator (the demo replays the same run for the same seed). */
export function rng(seed) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Arc length table of a track path and where each gate sits on it. */
export function courseOf(track) {
  const p = track.path;
  const s = new Float64Array(p.length);
  for (let i = 1; i < p.length; i++) s[i] = s[i - 1] + Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1], p[i][2] - p[i - 1][2]);
  const gateS = track.gates.map((g) => {
    let best = 0, bd = Infinity;
    for (let i = 0; i < p.length; i++) {
      const d = (p[i][0] - g.pos[0]) ** 2 + (p[i][1] - g.pos[1]) ** 2 + (p[i][2] - g.pos[2]) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    return s[best];
  });
  return { path: p, s, length: s[s.length - 1] || 1, gateS, closed: track.closed };
}

function pointAt(c, at, out) {
  const s = c.s;
  let lo = 0, hi = s.length - 1;
  while (lo < hi - 1) { const m = (lo + hi) >> 1; if (s[m] <= at) lo = m; else hi = m; }
  const f = s[hi] > s[lo] ? (at - s[lo]) / (s[hi] - s[lo]) : 0;
  const a = c.path[lo], b = c.path[hi];
  out[0] = a[0] + (b[0] - a[0]) * f; out[1] = a[1] + (b[1] - a[1]) * f; out[2] = a[2] + (b[2] - a[2]) * f;
  out[3] = b[0] - a[0]; out[4] = b[2] - a[2];
  return out;
}

/** Fake drones: they fly the centreline faster and crash less as `skill` (0..1) grows. */
export class FakeFleet {
  constructor(courses, K, seed = 1) {
    this.courses = courses;
    this.K = K;
    this.r = rng(seed);
    this.d = Array.from({ length: K }, (_, e) => this.spawn(e));
    this.tmp = new Float64Array(5);
  }

  spawn(e) {
    const c = this.courses[e % this.courses.length];
    const g = Math.floor(this.r() * c.gateS.length);
    return { s: Math.max(0, (c.gateS[g] ?? 0) - 2), wob: this.r() * 6.28, lane: (this.r() - 0.5) * 2 };
  }

  next(c, s) {
    for (let k = 0; k < c.gateS.length; k++) if (c.gateS[k] > s) return k;
    return c.closed ? 0 : c.gateS.length - 1;
  }

  /** Fills data (K*T*4 floats) for T steps; returns the counts the metrics need. */
  run(T, skill, data) {
    const u = new Uint32Array(data.buffer, data.byteOffset, data.length);
    const counts = { episodes: 0, crashes: 0, finishes: 0, gates: 0 };
    const speed = 7 + 15 * skill;
    const crashP = 0.006 * (1 - 0.8 * skill);
    for (let t = 0; t < T; t++) {
      for (let e = 0; e < this.K; e++) {
        const w = e % this.courses.length;
        const c = this.courses[w];
        const d = this.d[e];
        const before = this.next(c, d.s);
        d.s += (speed * (0.85 + 0.3 * this.r())) / 50;
        let finished = false;
        if (d.s >= c.length) { if (c.closed) d.s -= c.length; else { d.s = c.length; finished = true; } }
        const nx = this.next(c, d.s);
        if (nx !== before) counts.gates++;
        d.wob += 0.08;
        const p = pointAt(c, d.s, this.tmp);
        const hl = Math.hypot(p[3], p[4]) || 1;
        const side = (1 - 0.7 * skill) * (1.5 * Math.sin(d.wob) + d.lane);
        const x = p[0] - (p[4] / hl) * side, z = p[2] + (p[3] / hl) * side, y = p[1] + 0.6 * Math.sin(d.wob * 0.7);
        const crashed = this.r() < crashP;
        const done = crashed || finished;
        const o = (t * this.K + e) * 4;
        data[o] = x; data[o + 1] = y; data[o + 2] = z;
        u[o + 3] = (w | (Math.min(nx, 0xfff) << 12) | (crashed ? BIT_CRASH : 0) | (finished ? BIT_FINISH : 0) | (done ? BIT_DONE : 0)) >>> 0;
        if (done) {
          counts.episodes++;
          if (crashed) counts.crashes++;
          if (finished) counts.finishes++;
          this.d[e] = this.spawn(e);
        }
      }
    }
    return counts;
  }
}

/** Made-up metrics of iteration `it` that look like a run learning. */
export function fakeMetrics(it, r, envs, steps, counts, K) {
  const learn = 1 - Math.exp(-it / 180);
  const noise = () => (r() - 0.5) * 2;
  const scale = envs / K;
  const episodes = Math.max(1, Math.round(counts.episodes * scale + 40 * r()));
  const crashes = Math.min(episodes, Math.round(counts.crashes * scale + 10 * r()));
  const best = learn > 0.25 ? 70 - 38 * learn + 3 * noise() : 0;
  return {
    iteration: it, envSteps: it * envs * steps, episodes, crashes,
    gates: Math.round(counts.gates * scale), finishes: Math.round(counts.finishes * scale),
    laps: Math.max(0, Math.round((learn - 0.2) * 120 + 15 * noise())),
    meanReturn: -8 + 60 * learn + 4 * noise(), meanLength: 300 + 1600 * learn + 120 * noise(), bestLap: best > 0 ? best : 0,
    rewardPerStep: -0.02 + 0.06 * learn + 0.004 * noise(),
    policyLoss: -0.01 - 0.02 * Math.exp(-it / 300) + 0.004 * noise(), valueLoss: 4 * Math.exp(-it / 250) + 0.4 + 0.15 * noise(),
    approxKl: 0.012 * (1 + 0.4 * noise()) * (0.6 + 0.4 * Math.exp(-it / 400)), clipFraction: 0.12 * (1 + 0.3 * noise()),
    actorGradNorm: 0.4 + 0.15 * noise() + 0.6 * Math.exp(-it / 200), criticGradNorm: 2 + 0.6 * noise() + 4 * Math.exp(-it / 150),
    logStd: [0, 1, 2, 3].map((k) => -0.7 - 0.9 * learn - 0.08 * k + 0.02 * noise()),
    gpuMs: 340 + 12 * noise(),
  };
}

async function main() {
  const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]?.startsWith('--') ? 'true' : (all[i + 1] ?? 'true')]] : acc), []));
  const num = (k, d) => (args[k] !== undefined ? Number(args[k]) : d);
  const t = await loadTrainer();
  if (typeof t.worldGeometry !== 'function') throw new Error('the trainer bundle does not export worldGeometry (src/ai/train/node.ts)');
  const styles = (args.styles ?? 'technical,race').split(',').filter(Boolean);
  const worlds = [];
  for (let k = 0; k < num('worlds', 2); k++) {
    const style = styles[k % styles.length];
    const seed = 1000 + 7919 * k + num('seed', 1);
    let w;
    try { w = t.buildTrainWorld({ seed, style, difficulty: 0.3 + 0.1 * (k % 5) }); } catch (e) {
      console.log(`world ${k}: ${style} failed (${e.message}); using race`);
      w = t.buildTrainWorld({ seed, style: 'race', difficulty: 0.4 });
    }
    worlds.push(w);
    console.log(`world ${k}: ${w.style}, ${w.track.gates.length} gates, ${w.track.closed ? 'circuit' : 'open'}, ${w.colliders.length} colliders`);
  }
  const K = num('trace', 64), T = num('steps', 32);
  if (K % 16 !== 0) throw new Error('--trace must be a multiple of 16');
  const cfg = { ...t.DEFAULT_PPO, envs: 16384, steps: T };
  let stop = false;
  const name = args.name ?? 'demo';
  const dash = await startDashboard({
    port: num('port', 8787), name, outDir: resolve(ROOT, args.out ?? '.bench/brain/dash-demo'), config: { ppo: cfg, env: t.DEFAULT_ENV },
    worlds: worlds.map((w, i) => t.worldGeometry(w, i)),
    onCommand: (cmd) => { console.log(`command: ${cmd}`); if (cmd === 'stop') stop = true; },
  });
  const fleet = new FakeFleet(worlds.map((w) => courseOf(w.track)), K, num('seed', 1));
  const r = rng(7 + num('seed', 1));
  const every = num('every', 300), maxIters = num('iters', 0);
  const start = performance.now();
  process.on('SIGINT', () => { stop = true; });
  for (let it = 1; !stop && (!maxIters || it <= maxIters); it++) {
    const data = new Float32Array(K * T * 4);
    const counts = fleet.run(T, 1 - Math.exp(-it / 180), data);
    const metrics = fakeMetrics(it, r, cfg.envs, T, counts, K);
    const p0 = performance.now();
    dash.push({ iteration: it, elapsed: (performance.now() - start) / 1000, envSteps: metrics.envSteps, sps: (cfg.envs * T) / (metrics.gpuMs / 1000), metrics, trace: { K, T, data } });
    const pushMs = performance.now() - p0;
    if (it % 50 === 0) console.log(`iteration ${it}: push ${pushMs.toFixed(3)} ms`);
    await new Promise((done) => setTimeout(done, every));
  }
  await dash.close();
  console.log(`replay: node tools/brain/dashboard.mjs --run ${resolve(ROOT, args.out ?? '.bench/brain/dash-demo', name)}`);
  process.exit(0);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(ROOT, 'tools/brain/dashboard-demo.mjs')) await main();
