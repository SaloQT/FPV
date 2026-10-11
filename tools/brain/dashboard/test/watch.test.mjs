import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { serveDashboard } from '../../dashServer.mjs';
import { MAX_DRONES, watchQuery } from '../js/watch.js';
import { PARK_COASTERS, PARK_SIZES } from '../js/templates.js';

test('the game query flies one brain, races copies of several, and carries a training world link or a generated track', () => {
  const generated = { style: 'acro', seed: 42, gates: 12, laps: 3, diff: 40, quality: '' };
  const one = new URLSearchParams(watchQuery([{ name: 'ultimate', count: 1 }, { name: 'g', count: 0 }], generated));
  assert.equal(one.get('brain'), 'ultimate'); assert.equal(one.get('race'), null);
  assert.deepEqual([one.get('seed'), one.get('style'), one.get('gates'), one.get('laps'), one.get('diff'), one.get('quality')], ['42', 'acro', '12', '3', '40', null]);
  const race = new URLSearchParams(watchQuery([{ name: 'ultimate', count: 15 }, { name: 'g', count: 10 }, { name: 'x', count: 5 }], { ...generated, quality: 'high' }));
  assert.equal(race.get('race'), 'ultimate*15,g*10,x*5'); assert.equal(race.get('brain'), null); assert.equal(race.get('quality'), 'high');
  const world = new URLSearchParams(watchQuery([{ name: 'ace', count: 2 }], { query: 'seed=1001&tseed=1003&style=race&gates=12&laps=3&diff=30&quality=low' }));
  assert.deepEqual([world.get('seed'), world.get('tseed'), world.get('quality'), world.get('race')], ['1001', '1003', 'low', 'ace*2']);
  assert.equal(MAX_DRONES, 32);
});

test('the game query opens every park size on its race course, its tour and each of its coasters', () => {
  const read = (q) => Object.fromEntries(new URLSearchParams(q));
  for (const size of PARK_SIZES) {
    assert.deepEqual(read(watchQuery([{ name: 'ace', count: 1 }], { park: { seed: 7, size, route: 'race' }, quality: '' })), { world: 'theme-park', seed: '7', size, route: 'race', brain: 'ace' });
    assert.deepEqual(read(watchQuery([{ name: 'ace', count: 2 }], { park: { seed: 1337, size, route: 'tour' }, quality: 'low' })), { world: 'theme-park', seed: '1337', size, route: 'tour', quality: 'low', race: 'ace*2' });
    for (let k = 0; k < PARK_COASTERS[size]; k++) {
      const q = read(watchQuery([{ name: 'ace', count: 1 }], { park: { seed: 0, size, route: k }, quality: '' }));
      assert.deepEqual([q.world, q.size, q.route, q.coaster], ['theme-park', size, 'coaster', String(k)]);
    }
  }
});

test('the dashboard lists the brains the game can fly and starts the game once, refusing other sites', async t => {
  const root = await mkdtemp(join(tmpdir(), 'fpv-game-'));
  await writeFile(join(root, 'index.json'), JSON.stringify({ brains: [{ name: 'ace', file: 'ace.json', stats: { bestLap: 10.5, gatesPerMinute: 40 } }, { name: 'rookie', file: 'rookie.json', stats: {} }] }));
  // A free port with nothing on it: the service finds no game there and starts its own.
  const probe = createServer(); await new Promise(r => probe.listen(0, '127.0.0.1', r)); const freePort = probe.address().port; await new Promise(r => probe.close(r));
  let started = 0, closed = 0;
  const fakeVite = async (options) => {
    started++;
    assert.equal(options.server.port, freePort); assert.equal(options.server.host, '127.0.0.1');
    return { listen: async () => {}, resolvedUrls: { local: ['http://127.0.0.1:5999/'] }, config: { server: { port: 5999 } }, close: async () => { closed++; } };
  };
  const dash = await serveDashboard({ meta: { name: 't', status: 'idle' }, worldsJson: '[]', history: { iters: [], lines: [] }, traces: { list: () => [], get: () => null, has: () => false } },
    { port: 0, log: null, game: { brainsDir: root, port: freePort, createServer: fakeVite, log: null } });
  t.after(() => dash.close());
  const brains = await (await fetch(new URL('/api/game/brains', dash.url))).json();
  assert.deepEqual(brains.map(b => [b.name, b.bestLap]), [['ace', 10.5], ['rookie', null]]);
  const post = (headers = {}) => fetch(new URL('/api/game/start', dash.url), { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: '{}' });
  assert.equal((await post({ Origin: 'http://evil.invalid' })).status, 403);
  assert.equal(started, 0);
  const [a, b] = await Promise.all([post(), post()]);
  assert.equal((await a.json()).url, 'http://127.0.0.1:5999/'); assert.equal((await b.json()).url, 'http://127.0.0.1:5999/');
  assert.equal(started, 1, 'two clicks start one game');
  assert.equal((await fetch(new URL('/api/game/start', dash.url))).status, 405);
  await dash.close();
  assert.equal(closed, 1, 'closing the dashboard stops the game it started');
});

test('a game this checkout already serves is used as it is', async t => {
  const root = await mkdtemp(join(tmpdir(), 'fpv-game-'));
  const index = JSON.stringify({ brains: [{ name: 'ace', file: 'ace.json' }] });
  await writeFile(join(root, 'index.json'), index);
  const running = createServer((req, res) => { res.end(req.url === '/brains/index.json' ? index : 'game'); });
  await new Promise(r => running.listen(0, '127.0.0.1', r));
  t.after(() => new Promise(r => running.close(r)));
  const port = running.address().port;
  const dash = await serveDashboard({ meta: { name: 't', status: 'idle' }, worldsJson: '[]', history: { iters: [], lines: [] }, traces: { list: () => [], get: () => null, has: () => false } },
    { port: 0, log: null, game: { brainsDir: root, port, createServer: () => { throw Error('started a second game'); }, log: null } });
  t.after(() => dash.close());
  const r = await fetch(new URL('/api/game/start', dash.url), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).url, `http://127.0.0.1:${port}/`);
});
