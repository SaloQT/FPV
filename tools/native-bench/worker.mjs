import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { readdir, mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { VERSION, ROOT, RUN_OPTIONS, checkArgs, runOptions, stable, sha256, readJson, writeJson, number } from './common.mjs';
import { COMPARE_OPTIONS, compareOptions, compareArtifacts } from './compare.mjs';
import { loadArtifact } from './artifact.mjs';
import { runChild, probeChild } from './runner.mjs';
import { acquireGpuLock } from './lock.mjs';

export async function startWorker(args) {
  checkArgs(args, ['dir', 'port', 'cache-seconds', 'max-queued', 'backend', 'adapter', 'driver-id']);
  const directory = resolve(args.dir ?? resolve(ROOT, '.bench/worker'));
  const port = number(args.port, 0, 'port', 0, 65535, true);
  const cacheMs = number(args['cache-seconds'], 3600, 'cache-seconds', 0, 86400) * 1000;
  const maxQueued = number(args['max-queued'], 1000, 'max-queued', 1, 10000, true);
  const fixedArgs = Object.fromEntries(['backend', 'adapter', 'driver-id'].filter(k => args[k] !== undefined).map(k => [k, args[k]]));
  const fixed = runOptions(fixedArgs), release = await acquireGpuLock();
  const startupController = new AbortController();
  const stopStartup = () => startupController.abort();
  process.once('SIGINT', stopStartup); process.once('SIGTERM', stopStartup);
  let server, stopping = false, active = null, pumping = false, closing = false, finish;
  const finished = new Promise(accept => { finish = accept; });
  const jobs = new Map(), queue = [];
  const token = randomBytes(32).toString('hex');
  try {
    await mkdir(resolve(directory, 'jobs'), { recursive: true });
    const { environment, adapter } = await probeChild(fixed, resolve(directory, 'capabilities.json'), startupController.signal);
    const identity = { environment, adapter }, identityHash = sha256(stable(identity));
    const reusableCache = environment.driver.source !== 'unknown';
    const persist = job => writeJson(resolve(directory, 'jobs', `${job.id}.json`), job);
    // Pending/running jobs from a crashed coordinator are not silently re-executed.
    for (const name of await readdir(resolve(directory, 'jobs'))) {
      if (!/^[a-f0-9]{64}\.json$/.test(name)) continue;
      const job = await readJson(resolve(directory, 'jobs', name));
      if (['queued', 'running'].includes(job.status)) {
        job.status = 'failed'; job.error = 'Worker exited before completing the job'; job.finishedAt = new Date().toISOString();
        await persist(job);
      }
      jobs.set(job.id, job);
    }
    async function pump() {
      if (pumping || stopping) return;
      pumping = true;
      try {
        while (queue.length && !stopping) {
          const job = queue.shift();
          if (job.status !== 'queued') continue;
          const controller = new AbortController(); active = { job, controller };
          job.status = 'running'; job.startedAt = new Date().toISOString(); await persist(job);
          try {
            const out = resolve(directory, 'results', job.id, 'result.json');
            await mkdir(resolve(directory, 'results', job.id), { recursive: true });
            const result = job.kind === 'compare' ?
              await compareArtifacts(job.baseline, job.artifact, job.options, job.comparison, out, controller.signal) :
              await runChild(job.artifact, job.options, out, controller.signal);
            if (controller.signal.aborted) throw new Error('Job cancelled');
            if (result.status !== 'valid') throw new Error(result.fault ?? result.faults?.join('; ') ?? 'Invalid measurement');
            const observed = job.kind === 'compare' ? result.identity : { environment: result.environment, adapter: result.adapter };
            if (stable(observed) !== stable(identity)) throw new Error('Device/driver/runtime identity changed; restart the worker');
            job.status = 'complete'; job.resultFile = out; job.verdict = result.verdict ?? null;
            job.resultSha256 = sha256(await readFile(out));
          } catch (error) {
            job.status = controller.signal.aborted ? 'cancelled' : 'failed'; job.error = error.stack ?? String(error);
          }
          job.finishedAt = new Date().toISOString(); await persist(job); active = null;
        }
      } finally { pumping = false; }
    }
    async function submit(body) {
      if (stopping) throw new Error('Worker is stopping');
      if (!body || typeof body !== 'object' || !['run', 'compare'].includes(body.kind) || typeof body.artifact !== 'string') throw new Error('Expected kind run|compare and artifact directory');
      const flags = body.options ?? {};
      checkArgs(flags, body.kind === 'compare' ? [...RUN_OPTIONS, ...COMPARE_OPTIONS] : RUN_OPTIONS);
      if (Object.entries(fixedArgs).some(([key, value]) => flags[key] !== undefined && flags[key] !== value)) throw new Error('Job cannot change worker backend/adapter/driver');
      const options = runOptions({ ...flags, ...fixedArgs });
      // Default backend is also fixed even when the worker used no explicit --backend flag.
      if (options.backend !== fixed.backend || options.adapter !== fixed.adapter || options.driverId !== fixed.driverId) throw new Error('Job must use worker runtime options');
      const artifact = resolve(body.artifact), manifest = await loadArtifact(artifact);
      const baseline = body.kind === 'compare' ? resolve(body.baseline ?? '') : null;
      if (body.kind === 'compare' && typeof body.baseline !== 'string') throw new Error('Comparison requires baseline directory');
      const base = baseline ? await loadArtifact(baseline) : null;
      const comparison = body.kind === 'compare' ? compareOptions(flags) : null;
      const requestIdentity = { schemaVersion: VERSION, kind: body.kind, artifact: manifest.id, baseline: base?.id ?? null,
        options, comparison, identityHash };
      const id = sha256(stable(requestIdentity)), existing = jobs.get(id);
      if (existing && (['queued', 'running'].includes(existing.status) ||
        (existing.status === 'complete' && reusableCache && Date.now() - Date.parse(existing.finishedAt) < cacheMs))) {
        if (existing.status === 'complete') {
          try {
            if (sha256(await readFile(existing.resultFile)) !== existing.resultSha256) throw new Error('Cached result changed');
          } catch { /* Missing/changed results must be regenerated. */
            existing.status = 'failed'; }
        }
        if (existing.status !== 'failed') return { job: existing, reused: true };
      }
      if (queue.filter(job => job.status === 'queued').length >= maxQueued) throw new Error('Worker queue is full');
      const job = { id, ...requestIdentity, artifactId: manifest.id, baselineId: base?.id ?? null,
        artifact, baseline, status: 'queued', submittedAt: new Date().toISOString() };
      // Reserve synchronously before persisting, so overlapping identical requests deduplicate.
      jobs.set(id, job);
      try { await persist(job); } catch (error) { jobs.delete(id); throw error; }
      if (stopping) { job.status = 'cancelled'; await persist(job); throw new Error('Worker is stopping'); }
      queue.push(job); void pump().catch(error => { console.error('Worker persistence failure:', error); void shutdown(); });
      return { job, reused: false };
    }
    const json = (response, status, body) => { response.writeHead(status, { 'content-type': 'application/json' }); response.end(JSON.stringify(body)); };
    server = http.createServer(async (request, response) => {
      try {
        if (request.headers.authorization !== `Bearer ${token}`) { json(response, 401, { error: 'Worker token required' }); return; }
        const path = new URL(request.url, 'http://127.0.0.1').pathname;
        if (request.method === 'GET' && path === '/health') {
          json(response, 200, { identity, reusableCache, cacheSeconds: cacheMs / 1000, queued: queue.filter(j => j.status === 'queued').length, active: active?.job.id ?? null }); return;
        }
        if (request.method === 'POST' && path === '/jobs') {
          let text = '';
          for await (const chunk of request) { text += chunk; if (Buffer.byteLength(text) > 65536) throw new Error('Request exceeds 64 KiB'); }
          json(response, 202, await submit(JSON.parse(text))); return;
        }
        const match = path.match(/^\/jobs\/([a-f0-9]{64})(\/result)?$/), job = match ? jobs.get(match[1]) : null;
        if (!job) { json(response, 404, { error: 'Unknown job or route' }); return; }
        if (request.method === 'GET') {
          if (match[2]) {
            if (job.status !== 'complete') { json(response, 409, { error: 'Job has no completed result', status: job.status }); return; }
            const bytes = await readFile(job.resultFile);
            if (sha256(bytes) !== job.resultSha256) throw new Error('Result integrity mismatch');
            json(response, 200, { ...JSON.parse(bytes), resultFile: job.resultFile });
          } else json(response, 200, job);
          return;
        }
        if (request.method === 'DELETE' && !match[2]) {
          if (job.status === 'running') active?.controller.abort();
          else if (job.status === 'queued') { job.status = 'cancelled'; job.finishedAt = new Date().toISOString(); await persist(job); }
          json(response, 200, { id: job.id, status: job.status, cancellationRequested: job.status === 'running' }); return;
        }
        json(response, 405, { error: 'Method not allowed' });
      } catch (error) { if (!response.headersSent) json(response, 400, { error: error.message }); else response.destroy(); }
    });
    server.requestTimeout = 15000; server.headersTimeout = 10000;
    await new Promise((accept, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', accept); });
    const info = { url: `http://127.0.0.1:${server.address().port}`, token, pid: process.pid, directory, identityHash };
    await writeJson(resolve(directory, 'worker.json'), info);
    console.log(JSON.stringify({ url: info.url, connectionFile: resolve(directory, 'worker.json'), identity, reusableCache }, null, 2));
    async function shutdown() {
      if (closing) return;
      closing = true; stopping = true;
      server.close(); server.closeIdleConnections(); active?.controller.abort();
      for (const job of queue) if (job.status === 'queued') { job.status = 'cancelled'; job.finishedAt = new Date().toISOString(); await persist(job); }
      // Wait only for the killed child to finalize/persist, while keeping the lock held.
      while (pumping) await new Promise(accept => setTimeout(accept, 50));
      finish();
    }
    const onStop = () => { void shutdown().catch(error => { console.error(error); finish(); }); };
    process.removeListener('SIGINT', stopStartup); process.removeListener('SIGTERM', stopStartup);
    process.once('SIGINT', onStop); process.once('SIGTERM', onStop);
    if (startupController.signal.aborted) onStop();
    await finished;
    process.removeListener('SIGINT', onStop); process.removeListener('SIGTERM', onStop);
  } finally {
    process.removeListener('SIGINT', stopStartup); process.removeListener('SIGTERM', stopStartup);
    server?.close(); await release();
  }
}
