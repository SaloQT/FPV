// node --test tools/brain/dashboard/test
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, truncateSync, statSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { TraceStore, openTraceFile, startDashboard, thinHistory } from '../../dashServer.mjs';
import { parseRunLog, replayRun } from '../../dashboard.mjs';
import { Store } from '../js/series.js';

const dirs = [];
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'fpv-dash-')); dirs.push(d); return d; };
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

const WORLD = { index: 0, style: 'race', seed: 1, closed: true, laps: 3, length: 100, start: { pos: [0, 0, 0], yaw: 0 }, terrain: { n: 2, step: 1, height: [0, 0, 0, 0], origin: [0, 0], min: 0, max: 0, water: null }, gates: [], path: [], obstacles: [], boxes: [], vegetationColliders: 0 };

function traceData(it, K, T) {
  const d = new Float32Array(K * T * 4);
  const u = new Uint32Array(d.buffer);
  for (let t = 0; t < T; t++) for (let e = 0; e < K; e++) { const o = (t * K + e) * 4; d[o] = it; d[o + 1] = t; d[o + 2] = e; u[o + 3] = e % 3; }
  return d;
}

function metrics(it) {
  return { iteration: it, envSteps: it * 100, episodes: 10, crashes: 2, gates: 30, finishes: 0, laps: 1, meanReturn: it / 10, meanLength: 400, bestLap: 0, rewardPerStep: 0.1, policyLoss: -0.01, valueLoss: 1, approxKl: 0.01, clipFraction: 0.1, actorGradNorm: 0.5, criticGradNorm: 2, logStd: [-1, -1, -1, -1], gpuMs: 300 };
}

/** Raw HTTP so the tests can set any Host and Origin header. */
function http(port, path, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((ok, fail) => {
    const req = request({ host: '127.0.0.1', port, path, method, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => ok({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', fail);
    if (body) req.write(body);
    req.end();
  });
}
const json = async (port, path) => JSON.parse((await http(port, path)).body.toString());

/** Reads SSE events until `count` iteration events arrived. */
function sse(port, path, count, onOpen) {
  return new Promise((ok, fail) => {
    const req = request({ host: '127.0.0.1', port, path }, (res) => {
      let buf = '';
      const got = [];
      res.setEncoding('utf8');
      res.on('data', (c) => {
        buf += c;
        let k;
        while ((k = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, k);
          buf = buf.slice(k + 2);
          if (/^event: status/m.test(block)) { onOpen?.(); onOpen = null; continue; }
          const data = /^data: (.*)$/m.exec(block);
          if (data) got.push(JSON.parse(data[1]));
          if (got.length >= count) { req.destroy(); ok(got); return; }
        }
      });
    });
    req.on('error', (e) => { if (e.code !== 'ECONNRESET') fail(e); });
    req.end();
  });
}

describe('trace retention', () => {
  it('keeps the recent window, every k-th older one, and thins to the cap', () => {
    const s = new TraceStore({ recent: 4, every: 2, cap: 8 });
    for (let it = 1; it <= 40; it++) assert.equal(s.add(it, 16, 1, new Float32Array(64)), true);
    assert.ok(s.size <= 8);
    const list = s.list();
    assert.deepEqual(list.slice(-4), [37, 38, 39, 40]);
    for (const it of list.slice(0, -4)) assert.equal(it % s.stride, 0);
    assert.ok(s.stride > 2, 'stride doubled');
    // Older keyframes still spread over the run.
    assert.ok(list[0] <= 16);
  });

  it('refuses bad or repeated traces and copies the data', () => {
    const s = new TraceStore();
    const d = new Float32Array(16 * 2 * 4).fill(3);
    assert.equal(s.add(1, 16, 2, d), true);
    assert.equal(s.add(1, 16, 2, d), false);
    assert.equal(s.add(2, 16, 2, new Float32Array(10)), false);
    assert.equal(s.add(3, 0, 2, d), false);
    d.fill(9);
    return s.get(1).then((t) => assert.equal(new Float32Array(t.bytes.buffer, t.bytes.byteOffset, 4)[0], 3));
  });
});

describe('dashboard server', async () => {
  const out = tmp();
  const commands = [];
  const K = 16, T = 4;
  const dash = await startDashboard({ port: 0, name: 'run', outDir: out, config: { ppo: { envs: 256, steps: T }, env: {} }, worlds: [WORLD, { ...WORLD, index: 1 }], onCommand: (c) => commands.push(c), log: null });
  const port = dash.port;
  for (let it = 1; it <= 450; it++) dash.push({ iteration: it, elapsed: it * 0.3, envSteps: it * 100, sps: 1.5e6, metrics: { ...metrics(it), trace: 'dropped' }, trace: { K, T, data: traceData(it, K, T) } });

  it('serves meta, worlds and the whole history', async () => {
    const meta = await json(port, '/api/meta');
    assert.equal(meta.name, 'run');
    assert.equal(meta.mode, 'live');
    assert.equal(meta.status, 'running');
    assert.equal(meta.traceEnvs, K);
    assert.equal(meta.iterations, 450);
    const worlds = await json(port, '/api/worlds');
    assert.equal(worlds.length, 2);
    const hist = await json(port, '/api/history');
    assert.equal(hist.length, 450);
    assert.equal(hist[449].metrics.meanReturn, 45);
    assert.equal(hist[0].metrics.trace, undefined);
    assert.equal((await json(port, '/api/history?after=440')).length, 10);
  });

  it('gzips large responses when asked', async () => {
    const r = await http(port, '/api/history', { headers: { 'Accept-Encoding': 'gzip' } });
    assert.equal(r.headers['content-encoding'], 'gzip');
  });

  it('keeps 400 recent traces plus older keyframes', async () => {
    const list = await json(port, '/api/traces');
    assert.deepEqual(list.slice(0, 2), [25, 50]);
    assert.equal(list.length, 402);
    assert.equal(list[2], 51);
    const r = await http(port, '/api/trace/450');
    assert.equal(r.status, 200);
    assert.equal(r.body.length, K * T * 16);
    assert.equal(r.headers['x-trace-k'], String(K));
    const f = new Float32Array(r.body.buffer, r.body.byteOffset, K * T * 4);
    assert.equal(f[0], 450);
    assert.equal(f[(3 * K + 5) * 4 + 2], 5);
    assert.equal((await http(port, '/api/trace/30')).status, 404);
    // A keyframe that left the recent window is read back from the trace file.
    const k = await http(port, '/api/trace/25');
    assert.equal(k.status, 200);
    assert.equal(new Float32Array(k.body.buffer, k.body.byteOffset, 4)[0], 25);
  });

  it('streams iterations with backfill after a given iteration', async () => {
    const got = await sse(port, '/api/events?after=447', 4, () => {
      dash.push({ iteration: 451, elapsed: 1, envSteps: 1, sps: 1, metrics: metrics(451), trace: null });
    });
    assert.deepEqual(got.map((g) => g.record.iteration), [448, 449, 450, 451]);
    assert.equal(got[0].trace, true);
    assert.equal(got[3].trace, false);
  });

  it('gives a page that loaded before iteration 1 every iteration pushed while it was loading', async () => {
    const d4 = await startDashboard({ port: 0, name: 'early', outDir: null, worlds: [WORLD], log: null });
    const page = new Store();
    for (const rec of await json(d4.port, '/api/history')) page.append(rec);
    assert.equal(page.length, 0);
    // The trainer pushes while the page builds its charts, before the event stream opens.
    for (const it of [1, 2]) d4.push({ iteration: it, elapsed: it, envSteps: it, sps: 1, metrics: metrics(it) });
    const got = await sse(d4.port, page.eventsUrl(), 3, () => d4.push({ iteration: 3, elapsed: 3, envSteps: 3, sps: 1, metrics: metrics(3) }));
    assert.deepEqual(got.map((g) => g.record.iteration), [1, 2, 3]);
    await d4.close();
  });

  it('takes commands only as same-origin JSON', async () => {
    const post = (body, headers = {}) => http(port, '/api/command', { method: 'POST', body, headers: { 'Content-Type': 'application/json', ...headers } });
    assert.equal((await post('{"cmd":"save"}')).status, 200);
    assert.deepEqual(commands, ['save']);
    assert.equal((await post('{"cmd":"explode"}')).status, 400);
    assert.equal((await post('not json')).status, 400);
    assert.equal((await post('{"cmd":"save"}', { 'Content-Type': 'text/plain' })).status, 415);
    assert.equal((await post('{"cmd":"save"}', { Origin: 'http://evil.example' })).status, 403);
    assert.equal((await http(port, '/api/meta', { headers: { Host: 'evil.example' } })).status, 403);
    assert.equal((await post('{"cmd":"stop"}')).status, 200);
    assert.deepEqual(commands, ['save', 'stop']);
    assert.equal((await json(port, '/api/meta')).status, 'stopping');
    assert.equal((await post('{"cmd":"save"}')).status, 409);
  });

  it('serves the page and nothing outside it', async () => {
    const r = await http(port, '/');
    assert.equal(r.status, 200);
    assert.match(r.headers['content-type'], /text\/html/);
    assert.equal((await http(port, '/js/app.js')).status, 200);
    assert.equal((await http(port, '/../dashServer.mjs')).status, 404);
    assert.equal((await http(port, '/%2e%2e/dashServer.mjs')).status, 404);
    assert.equal((await http(port, '/test/server.test.mjs')).status, 404);
    // Windows splits on a backslash and NTFS ignores case, so neither may reach test/ either.
    assert.equal((await http(port, '/test%5Cserver.test.mjs')).status, 404);
    assert.equal((await http(port, '/TEST/server.test.mjs')).status, 404);
    assert.equal((await http(port, '/js%5C..%5C..%5CdashServer.mjs')).status, 404);
    assert.equal((await http(port, '/api/nope')).status, 404);
  });

  it('pushes in well under a millisecond with full-size traces', async () => {
    const d2 = await startDashboard({ port: 0, name: 'speed', outDir: tmp(), worlds: [WORLD], log: null });
    const data = new Float32Array(256 * 32 * 4);
    const n = 200;
    const t0 = performance.now();
    for (let it = 1; it <= n; it++) d2.push({ iteration: it, elapsed: it, envSteps: it, sps: 1, metrics: metrics(it), trace: { K: 256, T: 32, data } });
    const per = (performance.now() - t0) / n;
    await d2.close();
    assert.ok(per < 1, `push took ${per.toFixed(3)} ms`);
  });

  it('writes files a replay reads back, and closes cleanly', async () => {
    await dash.close();
    dash.push({ iteration: 999, elapsed: 0, envSteps: 0, sps: 0, metrics: metrics(999) });
    const text = readFileSync(join(out, 'run.train.ndjson'), 'utf8');
    const run = parseRunLog(text);
    assert.equal(run.meta.name, 'run');
    assert.equal(run.history.iters.length, 451);
    assert.equal(run.ended, true);
    assert.deepEqual(run.commands.map((c) => c.cmd), ['save', 'stop']);
    assert.equal(JSON.parse(run.worldsJson).length, 2);
    const tf = await openTraceFile(join(out, 'run.trace.bin'));
    assert.equal(tf.indexed, true);
    // Every keyframe, then the recent window (51..450) written at close.
    const kept = [25, 50, ...Array.from({ length: 400 }, (_, k) => 51 + k)];
    assert.deepEqual([...tf.entries.keys()].sort((a, b) => a - b), kept);
    await tf.close();

    const rp = await replayRun(join(out, 'run'), { port: 0, log: null });
    const meta = await json(rp.port, '/api/meta');
    assert.equal(meta.mode, 'replay');
    assert.equal(meta.status, 'finished');
    assert.equal((await json(rp.port, '/api/history')).length, 451);
    assert.equal((await json(rp.port, '/api/traces')).length, 402);
    const tr = await http(rp.port, '/api/trace/450');
    assert.equal(new Float32Array(tr.body.buffer, tr.body.byteOffset, 4)[0], 450);
    assert.equal((await http(rp.port, '/api/command', { method: 'POST', body: '{"cmd":"save"}', headers: { 'Content-Type': 'application/json' } })).status, 409);
    await rp.close();
  });

  it('reads a trace file whose index never got written', async () => {
    const path = join(out, 'run.trace.bin');
    const size = statSync(path).size;
    truncateSync(path, size - (16 * 402 + 8 + 16) - 10);
    const tf = await openTraceFile(path);
    assert.equal(tf.indexed, false);
    // The index and trailer are gone and the last record is cut short: the 401 whole records remain.
    assert.equal(tf.entries.size, 401);
    await tf.close();
  });

  it('moves an earlier run with the same name aside', async () => {
    const d3 = await startDashboard({ port: 0, name: 'run', outDir: out, worlds: [], log: null });
    await d3.close();
    const names = readdirSync(out);
    assert.ok(names.some((n) => /^run\.\d{8}-\d{6}\.train\.ndjson$/.test(n)), names.join(', '));
    assert.ok(existsSync(join(out, 'run.train.ndjson')));
  });
});

describe('history thinning', () => {
  it('sends short runs whole and long runs as thinned old records plus the exact recent ones', () => {
    const short = Array.from({ length: 50 }, (_, i) => String(i));
    assert.equal(thinHistory(short, 100, 20), short);
    const long = Array.from({ length: 1000 }, (_, i) => String(i));
    const t = thinHistory(long, 100, 20);
    assert.ok(t.length <= 100, `${t.length} records`);
    assert.deepEqual(t.slice(-20), long.slice(-20));
    assert.equal(t[0], '0');
    const nums = t.map(Number);
    for (let i = 1; i < nums.length; i++) assert.ok(nums[i] > nums[i - 1]);
  });
});
