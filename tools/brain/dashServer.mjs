// Live training dashboard: a node:http server inside the trainer process (never Vite there: it crashes Dawn) that serves the
// page in tools/brain/dashboard/, the world geometry, every iteration's metrics, a live event stream and the drone traces.
//
//   const dash = await startDashboard({ port, name, outDir, config: { ppo: cfg, env }, worlds, onCommand });
//   dash.push({ iteration, elapsed, envSteps, sps, metrics, trace });   // once per iteration, well under 1 ms
//   await dash.close();
//
// Routes: / and the static files, GET /api/meta, /api/worlds, /api/history[?after=n], /api/traces (iterations with a trace),
// /api/events (SSE, one event per iteration; ?after=n or Last-Event-ID backfills), /api/trace/<iteration> (K*T*16 bytes:
// x, y, z, packed bits per traced drone and step, [t][e]), POST /api/command {"cmd":"save"|"stop"}.
//
// Files (so tools/brain/dashboard.mjs can replay a run): <outDir>/<name>.train.ndjson holds a meta line, a worlds line, one line
// per iteration and the commands; <outDir>/<name>.trace.bin holds every keyframe trace, plus the last RECENT_TRACES ones when
// the run closes cleanly (see TRACE_FILE below). A run that
// reuses a name moves the old pair aside with its date in the name.
import { createServer } from 'node:http';
import { createWriteStream, existsSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { open, readFile } from 'node:fs/promises';
import { extname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzip } from 'node:zlib';
import { promisify } from 'node:util';

const gzipAsync = promisify(gzip);
export const STATIC_DIR = fileURLToPath(new URL('./dashboard/', import.meta.url));

/** Traces kept in memory: the last RECENT_TRACES iterations, older ones only every KEYFRAME_EVERY-th, at most TRACE_CAP in all. */
export const RECENT_TRACES = 400;
export const KEYFRAME_EVERY = 25;
export const TRACE_CAP = 2000;

/**
 * Trace file layout, little-endian. Header (32 bytes): 'FPVTRACE', u32 version 1, u32 header bytes 32, u32 record header bytes
 * 16, 12 zero bytes. Each record: u32 'TRC1', u32 iteration, u32 K (traced drones), u32 T (steps), then K*T vec4f. close()
 * appends an index: u32 'TIDX', u32 count, count x (u32 iteration, u32 0, f64 record offset), then the trailer: u32 'TEND',
 * u32 count, f64 index offset. A file without the trailer (the trainer was killed) is read by walking the records.
 */
export const TRACE_FILE = { magic: 'FPVTRACE', version: 1, header: 32, record: 16, rec: 0x31435254, idx: 0x58444954, end: 0x444e4554 };

const SSE_LIMIT = 8 << 20;
const GZIP_MIN = 32 << 10;
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };
const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
/** A page load gets at most this many history records: the newest HISTORY_RECENT exactly, older ones evenly thinned. */
export const HISTORY_CAP = 20000;
const HISTORY_RECENT = 5000;

/** The records a full /api/history sends (resume requests with ?after= stay exact). */
export function thinHistory(lines, cap = HISTORY_CAP, recent = Math.min(HISTORY_RECENT, cap >> 1)) {
  if (lines.length <= cap) return lines;
  const old = lines.length - recent;
  const k = Math.ceil(old / (cap - recent));
  const out = [];
  for (let i = 0; i < old; i += k) out.push(lines[i]);
  return out.concat(lines.slice(old));
}

/** Which traces stay: in memory for the recent window, as file offsets (or in memory without a file) for older keyframes. */
export class TraceStore {
  constructor({ recent = RECENT_TRACES, every = KEYFRAME_EVERY, cap = TRACE_CAP, file = null } = {}) {
    this.recentMax = recent;
    this.stride = every;
    this.cap = cap;
    this.file = file;
    /** iteration -> { K, T, data: Float32Array, key: boolean } in push order. */
    this.recent = new Map();
    /** iteration -> { K, T, data?: Float32Array, offset?: number } */
    this.keys = new Map();
  }

  /** Takes a copy of `data` (the caller may reuse or unmap its buffer). Returns true when stored. */
  add(iteration, K, T, data) {
    const n = K * T * 4;
    if (!(K > 0 && T > 0) || !data || data.length < n || this.recent.has(iteration) || this.keys.has(iteration)) return false;
    const copy = data.slice(0, n);
    const key = iteration % this.stride === 0;
    const offset = key && this.file ? this.file.append(iteration, K, T, copy) : undefined;
    this.recent.set(iteration, { K, T, data: copy, key, offset });
    while (this.recent.size > this.recentMax) {
      const [it, e] = this.recent.entries().next().value;
      this.recent.delete(it);
      if (e.key && it % this.stride === 0) this.keys.set(it, e.offset !== undefined ? { K: e.K, T: e.T, offset: e.offset } : { K: e.K, T: e.T, data: e.data });
    }
    while (this.recent.size + this.keys.size > this.cap && this.keys.size > 0) this.thin();
    return true;
  }

  /** Writes the recent window's traces that are not keyframes to the file, so a replay can play the end of the run smoothly. */
  flushRecent() {
    if (!this.file) return;
    for (const [it, e] of this.recent) if (e.offset === undefined) e.offset = this.file.append(it, e.K, e.T, e.data);
  }

  /** Halves the older keyframes: the stride doubles and only its multiples stay. */
  thin() {
    this.stride *= 2;
    for (const it of [...this.keys.keys()]) if (it % this.stride !== 0) this.keys.delete(it);
  }

  has(iteration) {
    return this.recent.has(iteration) || this.keys.has(iteration);
  }

  get size() {
    return this.recent.size + this.keys.size;
  }

  /** Ascending iterations that have a trace. */
  list() {
    return [...this.keys.keys(), ...this.recent.keys()].sort((a, b) => a - b);
  }

  /** { K, T, bytes: Buffer } or null. */
  async get(iteration) {
    const e = this.recent.get(iteration) ?? this.keys.get(iteration);
    if (!e) return null;
    if (e.data) return { K: e.K, T: e.T, bytes: Buffer.from(e.data.buffer, e.data.byteOffset, e.data.byteLength) };
    const bytes = await this.file.read(e.offset + TRACE_FILE.record, e.K * e.T * 16);
    return bytes ? { K: e.K, T: e.T, bytes } : null;
  }
}

/** Appends trace records through a write stream and reads them back by offset. */
export class TraceFileWriter {
  constructor(path) {
    this.path = path;
    this.stream = createWriteStream(path, { flags: 'w' });
    this.stream.on('error', (e) => { this.error = e; });
    const h = Buffer.alloc(TRACE_FILE.header);
    h.write(TRACE_FILE.magic, 0, 'latin1');
    h.writeUInt32LE(TRACE_FILE.version, 8);
    h.writeUInt32LE(TRACE_FILE.header, 12);
    h.writeUInt32LE(TRACE_FILE.record, 16);
    this.stream.write(h);
    this.bytes = TRACE_FILE.header;
    this.index = [];
    this.fd = null;
  }

  /** Writes one record; returns the offset of its header. */
  append(iteration, K, T, data) {
    const at = this.bytes;
    const h = Buffer.alloc(TRACE_FILE.record);
    h.writeUInt32LE(TRACE_FILE.rec, 0);
    h.writeUInt32LE(iteration >>> 0, 4);
    h.writeUInt32LE(K, 8);
    h.writeUInt32LE(T, 12);
    this.stream.write(h);
    this.stream.write(Buffer.from(data.buffer, data.byteOffset, data.byteLength));
    this.bytes += TRACE_FILE.record + data.byteLength;
    this.index.push([iteration, at]);
    return at;
  }

  async read(offset, length) {
    // Records leave the recent window long after they were written, so they are on disk by the time anyone reads them here.
    this.fd ??= await open(this.path, 'r');
    const buf = Buffer.alloc(length);
    const { bytesRead } = await this.fd.read(buf, 0, length, offset);
    return bytesRead === length ? buf : null;
  }

  async close() {
    const idx = Buffer.alloc(8 + 16 * this.index.length + 16);
    idx.writeUInt32LE(TRACE_FILE.idx, 0);
    idx.writeUInt32LE(this.index.length, 4);
    this.index.forEach(([it, off], k) => {
      idx.writeUInt32LE(it >>> 0, 8 + 16 * k);
      idx.writeDoubleLE(off, 8 + 16 * k + 8);
    });
    const t = 8 + 16 * this.index.length;
    idx.writeUInt32LE(TRACE_FILE.end, t);
    idx.writeUInt32LE(this.index.length, t + 4);
    idx.writeDoubleLE(this.bytes, t + 8);
    await new Promise((done) => this.stream.end(idx, done));
    await this.fd?.close();
    this.fd = null;
  }
}

/** Reads a trace file written by TraceFileWriter: Map iteration -> { K, T, offset } plus a read(offset, length) function. */
export async function openTraceFile(path) {
  const fd = await open(path, 'r');
  const size = (await fd.stat()).size;
  const entries = new Map();
  const head = Buffer.alloc(TRACE_FILE.header);
  if (size < TRACE_FILE.header || (await fd.read(head, 0, TRACE_FILE.header, 0)).bytesRead < TRACE_FILE.header || head.toString('latin1', 0, 8) !== TRACE_FILE.magic) {
    await fd.close();
    throw new Error(`${path}: not a trace file`);
  }
  const rh = Buffer.alloc(TRACE_FILE.record);
  const readRecordHead = async (off) => {
    if (off + TRACE_FILE.record > size) return null;
    await fd.read(rh, 0, TRACE_FILE.record, off);
    if (rh.readUInt32LE(0) !== TRACE_FILE.rec) return null;
    const K = rh.readUInt32LE(8), T = rh.readUInt32LE(12);
    if (off + TRACE_FILE.record + K * T * 16 > size) return null;
    return { iteration: rh.readUInt32LE(4), K, T };
  };
  let indexed = false;
  if (size >= TRACE_FILE.header + 16) {
    const tail = Buffer.alloc(16);
    await fd.read(tail, 0, 16, size - 16);
    if (tail.readUInt32LE(0) === TRACE_FILE.end) {
      const count = tail.readUInt32LE(4);
      const at = tail.readDoubleLE(8);
      const idx = Buffer.alloc(8 + 16 * count);
      if (at + idx.length + 16 === size && (await fd.read(idx, 0, idx.length, at)).bytesRead === idx.length && idx.readUInt32LE(0) === TRACE_FILE.idx) {
        for (let k = 0; k < count; k++) {
          const off = idx.readDoubleLE(8 + 16 * k + 8);
          const r = await readRecordHead(off);
          if (r) entries.set(r.iteration, { K: r.K, T: r.T, offset: off });
        }
        indexed = true;
      }
    }
  }
  if (!indexed) {
    for (let off = TRACE_FILE.header; ;) {
      const r = await readRecordHead(off);
      if (!r) break;
      entries.set(r.iteration, { K: r.K, T: r.T, offset: off });
      off += TRACE_FILE.record + r.K * r.T * 16;
    }
  }
  return {
    entries,
    indexed,
    async read(offset, length) {
      const buf = Buffer.alloc(length);
      const { bytesRead } = await fd.read(buf, 0, length, offset);
      return bytesRead === length ? buf : null;
    },
    close: () => fd.close(),
  };
}

/** Moves an earlier run's files aside (`<name>.<date>.train.ndjson`) so a new run under the same name never overwrites one. */
function setAside(outDir, name) {
  const files = ['train.ndjson', 'trace.bin'].map((ext) => resolve(outDir, `${name}.${ext}`));
  if (!files.some((f) => existsSync(f))) return;
  const when = statSync(files.find((f) => existsSync(f))).mtime;
  const p = (n) => String(n).padStart(2, '0');
  const stamp = `${when.getFullYear()}${p(when.getMonth() + 1)}${p(when.getDate())}-${p(when.getHours())}${p(when.getMinutes())}${p(when.getSeconds())}`;
  for (const [k, ext] of ['train.ndjson', 'trace.bin'].entries()) if (existsSync(files[k])) renameSync(files[k], resolve(outDir, `${name}.${stamp}.${ext}`));
}

/**
 * The HTTP side shared by the live trainer and the replay tool. `source` supplies the data:
 *   meta: object (sent as /api/meta, `status` kept current), worldsJson: string, history: { iters: number[], lines: string[] },
 *   traces: { has(it), get(it) -> {K,T,bytes}|null, list() }, onCommand?: (cmd) => unknown (absent: commands are refused).
 */
export async function serveDashboard(source, { port = 8787, host = '127.0.0.1', log = console.log, portTries = 10 } = {}) {
  const clients = new Set();
  let worldsGz = null;
  const loopbackOnly = LOOPBACK.has(host);

  const send = (res, status, body, type = 'application/json', extra = {}) => {
    res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra });
    res.end(body);
  };
  const sendJson = async (req, res, text) => {
    if (text.length >= GZIP_MIN && /\bgzip\b/.test(req.headers['accept-encoding'] ?? '')) {
      send(res, 200, await gzipAsync(text), 'application/json', { 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding' });
    } else send(res, 200, text);
  };
  const historyAfter = (after) => {
    const { iters, lines } = source.history;
    let lo = 0, hi = iters.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (iters[mid] <= after) lo = mid + 1; else hi = mid;
    }
    return lo;
  };
  const sseWrite = (res, text) => {
    if (res.writableLength > SSE_LIMIT) { clients.delete(res); res.destroy(); return; }
    res.write(text);
  };

  const handle = async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://local');
    const hostName = (req.headers.host ?? '').replace(/:\d+$/, '').toLowerCase();
    // A page on another site must not reach the trainer through DNS rebinding: on a loopback bind only loopback names answer.
    if (loopbackOnly && !LOOPBACK.has(hostName)) return send(res, 403, 'forbidden host', 'text/plain');
    const path = url.pathname;
    if (req.method === 'POST' && path === '/api/command') return command(req, res);
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'method not allowed', 'text/plain');
    if (path === '/api/meta') return send(res, 200, JSON.stringify({ ...source.meta, traces: source.traces.size ?? source.traces.list().length, iterations: source.history.iters.length }));
    if (path === '/api/worlds') {
      if (/\bgzip\b/.test(req.headers['accept-encoding'] ?? '')) {
        worldsGz ??= gzipAsync(source.worldsJson);
        return send(res, 200, await worldsGz, 'application/json', { 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding' });
      }
      return send(res, 200, source.worldsJson);
    }
    if (path === '/api/history') {
      const after = Number(url.searchParams.get('after') ?? -Infinity);
      const lines = source.history.lines;
      return sendJson(req, res, `[${(Number.isFinite(after) ? lines.slice(historyAfter(after)) : thinHistory(lines)).join(',')}]`);
    }
    if (path === '/api/traces') return send(res, 200, JSON.stringify(source.traces.list()));
    if (path === '/api/events') return events(req, res, url);
    const tm = /^\/api\/trace\/(\d+)$/.exec(path);
    if (tm) {
      const t = await source.traces.get(Number(tm[1]));
      if (!t) return send(res, 404, 'no trace kept for that iteration', 'text/plain');
      return send(res, 200, t.bytes, 'application/octet-stream', { 'X-Trace-K': String(t.K), 'X-Trace-T': String(t.T), 'Access-Control-Expose-Headers': 'X-Trace-K, X-Trace-T' });
    }
    if (path.startsWith('/api/')) return send(res, 404, 'unknown route', 'text/plain');
    return staticFile(res, path);
  };

  const staticFile = async (res, path) => {
    const rel = decodeURIComponent(path === '/' ? '/index.html' : path);
    const file = resolve(STATIC_DIR, `.${rel}`);
    const type = MIME[extname(file).toLowerCase()];
    // Judge the resolved path, not the URL: Windows also splits on a backslash (%5C) and NTFS ignores case (/TEST/).
    const inside = relative(STATIC_DIR, file);
    const parts = inside.split(/[\\/]/);
    if (!inside || isAbsolute(inside) || parts[0] === '..' || parts.some((s) => s.toLowerCase() === 'test') || !type) return send(res, 404, 'not found', 'text/plain');
    try {
      send(res, 200, await readFile(file), type);
    } catch {
      send(res, 404, 'not found', 'text/plain');
    }
  };

  const events = (req, res, url) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write(`retry: 2000\nevent: status\ndata: ${JSON.stringify({ status: source.meta.status })}\n\n`);
    const resume = req.headers['last-event-id'] ?? url.searchParams.get('after');
    if (resume !== undefined && resume !== null && resume !== '' && Number.isFinite(Number(resume))) {
      const { iters, lines } = source.history;
      for (let k = historyAfter(Number(resume)); k < lines.length; k++) res.write(eventText(iters[k], lines[k], source.traces.has(iters[k])));
    }
    clients.add(res);
    req.on('close', () => clients.delete(res));
  };

  const command = async (req, res) => {
    const origin = req.headers.origin;
    if (origin && origin !== `http://${req.headers.host}`) return send(res, 403, JSON.stringify({ ok: false, error: 'cross-origin' }));
    if (!/application\/json/.test(req.headers['content-type'] ?? '')) return send(res, 415, JSON.stringify({ ok: false, error: 'send JSON' }));
    let body = '';
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 1024) return send(res, 413, JSON.stringify({ ok: false, error: 'too long' }));
    }
    let cmd;
    try { cmd = JSON.parse(body).cmd; } catch { /* reported below */ }
    if (cmd !== 'save' && cmd !== 'stop') return send(res, 400, JSON.stringify({ ok: false, error: 'cmd must be "save" or "stop"' }));
    if (!source.onCommand || source.meta.status !== 'running') return send(res, 409, JSON.stringify({ ok: false, error: `training is ${source.meta.status}` }));
    try {
      await source.onCommand(cmd);
    } catch (e) {
      return send(res, 500, JSON.stringify({ ok: false, error: String(e?.message ?? e) }));
    }
    send(res, 200, JSON.stringify({ ok: true, cmd }));
  };

  const server = createServer((req, res) => {
    handle(req, res).catch((e) => {
      if (!res.headersSent) send(res, 500, String(e?.message ?? e), 'text/plain');
      else res.destroy();
    });
  });
  let bound = port;
  for (let attempt = 0; ; attempt++) {
    try {
      await new Promise((ok, fail) => {
        server.once('error', fail);
        server.listen(bound, host, () => { server.off('error', fail); ok(); });
      });
      break;
    } catch (e) {
      if (e.code !== 'EADDRINUSE' || port === 0 || attempt + 1 >= portTries) throw e;
      bound++;
    }
  }
  const actual = server.address().port;
  const url = `http://${host.includes(':') ? `[${host}]` : host === '0.0.0.0' ? '127.0.0.1' : host}:${actual}/`;
  const heartbeat = setInterval(() => { for (const c of clients) sseWrite(c, ': ping\n\n'); }, 15000);
  heartbeat.unref();
  log?.(`dashboard: ${url}`);

  return {
    url,
    port: actual,
    server,
    clients,
    /** One iteration event to every connected page. */
    broadcast(iteration, line, hasTrace) {
      if (clients.size === 0) return;
      const text = eventText(iteration, line, hasTrace);
      for (const c of clients) sseWrite(c, text);
    },
    /** A status change (running, stopping, finished, or a command) to every page. */
    status(extra = {}) {
      const text = `event: status\ndata: ${JSON.stringify({ status: source.meta.status, ...extra })}\n\n`;
      for (const c of clients) sseWrite(c, text);
    },
    async close() {
      clearInterval(heartbeat);
      for (const c of clients) c.end();
      clients.clear();
      await new Promise((done) => {
        server.close(() => done());
        server.closeAllConnections?.();
      });
    },
  };
}

function eventText(iteration, line, hasTrace) {
  return `id: ${iteration}\ndata: {"trace":${hasTrace ? 'true' : 'false'},"record":${line}}\n\n`;
}

/**
 * Starts the dashboard for a training run. Options: port (8787; 0 picks a free one; a busy port tries the next few), host
 * ('127.0.0.1'), name, outDir (null keeps nothing on disk), config ({ ppo, env }), worlds (worldGeometry of each world),
 * onCommand(cmd) for 'save' and 'stop', policyHz (50), log (console.log).
 */
export async function startDashboard(opts) {
  const { port = 8787, host = '127.0.0.1', name = 'brain', outDir = null, config = {}, worlds = [], onCommand, policyHz = 50, log = console.log } = opts ?? {};
  const meta = {
    kind: 'meta', name, mode: 'live', status: 'running', startedAt: new Date().toISOString(), config, policyHz,
    worlds: worlds.length, traceEnvs: 0, traceSteps: 0, recentTraces: RECENT_TRACES, keyframeEvery: KEYFRAME_EVERY, traceCap: TRACE_CAP, files: null,
  };
  let log$ = null;
  let file = null;
  if (outDir) {
    mkdirSync(outDir, { recursive: true });
    setAside(outDir, name);
    meta.files = { ndjson: resolve(outDir, `${name}.train.ndjson`), trace: resolve(outDir, `${name}.trace.bin`) };
    log$ = createWriteStream(meta.files.ndjson, { flags: 'w' });
    log$.on('error', (e) => log?.(`dashboard: cannot write ${meta.files.ndjson}: ${e.message}`));
    file = new TraceFileWriter(meta.files.trace);
  }
  const worldsJson = JSON.stringify(worlds);
  log$?.write(`${JSON.stringify(meta)}\n{"kind":"worlds","worlds":${worldsJson}}\n`);
  const history = { iters: [], lines: [] };
  const traces = new TraceStore({ file });
  let closed = false;
  const source = {
    meta, worldsJson, history, traces,
    onCommand: async (cmd) => {
      log$?.write(`${JSON.stringify({ kind: 'event', cmd, time: Date.now() })}\n`);
      if (cmd === 'stop') meta.status = 'stopping';
      http.status({ command: cmd });
      await onCommand?.(cmd);
    },
  };
  const http = await serveDashboard(source, { port, host, log });

  return {
    url: http.url,
    port: http.port,
    /** Records one iteration: metrics go to the history, the event stream and the ndjson file, the trace to the store. */
    push({ iteration, elapsed, envSteps, sps, metrics, trace }) {
      if (closed) return;
      const { trace: _drop, ...m } = metrics ?? {};
      let kept = false;
      if (trace && trace.data) {
        kept = traces.add(iteration, trace.K, trace.T, trace.data);
        if (kept && !meta.traceEnvs) { meta.traceEnvs = trace.K; meta.traceSteps = trace.T; }
      }
      const line = JSON.stringify({ kind: 'iter', iteration, elapsed, envSteps, sps, time: Date.now(), metrics: m });
      history.iters.push(iteration);
      history.lines.push(line);
      log$?.write(`${line}\n`);
      http.broadcast(iteration, line, kept);
    },
    async close() {
      if (closed) return;
      closed = true;
      meta.status = 'finished';
      http.status();
      log$?.write(`${JSON.stringify({ kind: 'end', time: Date.now(), iterations: history.iters.length })}\n`);
      await http.close();
      if (log$) await new Promise((done) => log$.end(done));
      traces.flushRecent();
      await file?.close();
    },
  };
}
