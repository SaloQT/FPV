// The dashboard's way into the game: lists the brains the game can fly (public/brains/index.json) and serves the game itself
// (Vite's dev server, as `npm run dev`) on first use, so "Watch in game" opens it with a brain flying.
//
// Routes: GET /api/game/brains, POST /api/game/start -> { url }. A game this checkout already serves on the port (npm run dev)
// is used as it is.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const GAME_PORT = 5173;
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1']);

export function gameService({ root = ROOT, brainsDir = resolve(root, 'public/brains'), host = '127.0.0.1', port = GAME_PORT, log = console.log, createServer = null } = {}) {
  let vite = null;
  let base = null;
  let starting = null;
  const send = (res, code, data) => {
    res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(JSON.stringify(data));
  };
  const indexText = () => readFile(resolve(brainsDir, 'index.json'), 'utf8');

  /** Whether `url` serves this checkout's game: its brain list is this checkout's. */
  async function ours(url) {
    try {
      const r = await fetch(new URL('brains/index.json', url), { signal: AbortSignal.timeout(1500) });
      return r.ok && (await r.text()) === (await indexText());
    } catch {
      return false;
    }
  }

  /** The game's base URL, starting the dev server the first time. */
  function start() {
    if (base) return Promise.resolve(base);
    starting ??= (async () => {
      const existing = `http://127.0.0.1:${port}/`;
      if (await ours(existing)) return (base = existing);
      const make = createServer ?? (await import('vite')).createServer;
      vite = await make({ root, configFile: resolve(root, 'vite.config.ts'), clearScreen: false, logLevel: 'warn', server: { host, port, strictPort: false } });
      await vite.listen();
      base = vite.resolvedUrls?.local?.[0] ?? `http://127.0.0.1:${vite.config.server.port}/`;
      log?.(`game: ${base}`);
      return base;
    })().finally(() => { starting = null; });
    return starting;
  }

  return {
    async handle(req, res, path) {
      if (!path.startsWith('/api/game/')) return false;
      try {
        if (req.method === 'GET' && path === '/api/game/brains') {
          let brains = [];
          try { brains = JSON.parse(await indexText()).brains ?? []; } catch { /* no brain saved yet */ }
          send(res, 200, brains.map((b) => ({ name: b.name, file: b.file, bestLap: b.stats?.bestLap || null, evalLap: b.stats?.evalLap || null, gatesPerMinute: b.stats?.gatesPerMinute || null })));
          return true;
        }
        if (req.method === 'POST' && path === '/api/game/start') {
          if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) {
            send(res, 403, { error: 'Cross-origin request' });
            return true;
          }
          const url = new URL(await start());
          // On a dashboard served to the network the game is too: the page reaches it under the name it reached the dashboard.
          const name = (req.headers.host ?? '').replace(/:\d+$/, '');
          if (!LOOPBACK.has(host) && name) url.hostname = name;
          send(res, 200, { url: url.href });
          return true;
        }
        send(res, 405, { error: 'Method not allowed' });
      } catch (e) {
        send(res, 500, { error: `The game could not start: ${e.message}` });
      }
      return true;
    },
    async close() {
      const v = vite;
      vite = null;
      base = null;
      await v?.close();
    },
  };
}
