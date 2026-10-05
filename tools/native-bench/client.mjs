import { resolve } from 'node:path';
import { ROOT, RUN_OPTIONS, checkArgs, readJson, writeJson, number } from './common.mjs';
import { COMPARE_OPTIONS } from './compare.mjs';

export async function client(command, args) {
  const allowed = command === 'submit' ? ['worker', 'artifact', 'baseline', 'wait', 'out', ...RUN_OPTIONS, ...COMPARE_OPTIONS] :
    command === 'health' ? ['worker'] : command === 'cancel' ? ['worker', 'id'] :
      command === 'result' ? ['worker', 'id', 'out'] : ['worker', 'id', 'wait', 'out'];
  checkArgs(args, allowed);
  const connection = await readJson(resolve(args.worker ?? resolve(ROOT, '.bench/worker/worker.json')));
  const url = new URL(connection.url);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') throw new Error('Worker must listen on loopback HTTP');
  async function request(path, method = 'GET', body) {
    const response = await fetch(new URL(path, url), { method, headers: { authorization: `Bearer ${connection.token}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30000) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
    return data;
  }
  if (command === 'health') return request('/health');
  if (command === 'submit') {
    if (typeof args.artifact !== 'string') throw new Error('--artifact requires a directory');
    const options = Object.fromEntries([...RUN_OPTIONS, ...COMPARE_OPTIONS].filter(key => args[key] !== undefined).map(key => [key, args[key]]));
    const submission = await request('/jobs', 'POST', { kind: args.baseline ? 'compare' : 'run', artifact: resolve(args.artifact),
      baseline: args.baseline ? resolve(args.baseline) : undefined, options });
    if (args.wait === undefined) return submission;
    console.error(`Queued ${submission.job.id}${submission.reused ? ' (reused)' : ''}`);
    return waitFor(submission.job.id);
  }
  if (typeof args.id !== 'string' || !/^[a-f0-9]{64}$/.test(args.id)) throw new Error('--id requires a job ID');
  if (command === 'cancel') return request(`/jobs/${args.id}`, 'DELETE');
  if (command === 'result') {
    const result = await request(`/jobs/${args.id}/result`); if (args.out) await writeJson(resolve(args.out), result); return result;
  }
  if (args.wait === undefined) return request(`/jobs/${args.id}`);
  return waitFor(args.id);
  async function waitFor(id) {
    const seconds = args.wait === true ? 3600 : number(args.wait, 3600, 'wait', 1, 86400);
    const deadline = Date.now() + seconds * 1000;
    while (Date.now() < deadline) {
      const job = await request(`/jobs/${id}`);
      if (job.status === 'complete') {
        const result = await request(`/jobs/${id}/result`);
        if (args.out) await writeJson(resolve(args.out), result);
        return result;
      }
      if (['cancelled', 'failed'].includes(job.status)) throw new Error(`${job.status}: ${job.error ?? id}`);
      await new Promise(accept => setTimeout(accept, 1000));
    }
    throw new Error(`Job ${id} still pending after ${seconds}s; query status later or cancel it`);
  }
}
