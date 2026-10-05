#!/usr/bin/env node
import { mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ROOT, RUN_OPTIONS, parseArgs, checkArgs, runOptions, readJson, writeJson } from './native-bench/common.mjs';
import { buildArtifact } from './native-bench/artifact.mjs';
import { capabilities } from './native-bench/runtime.mjs';
import { runChild, runNative, probeChild } from './native-bench/runner.mjs';
import { compareArtifacts, compareOptions, COMPARE_OPTIONS } from './native-bench/compare.mjs';
import { acquireGpuLock } from './native-bench/lock.mjs';
import { startWorker } from './native-bench/worker.mjs';
import { client } from './native-bench/client.mjs';

const HELP = `Native WebGPU benchmark (no browser)
  build        --source <checkout> --out <artifact-parent>
  capabilities --backend d3d12|vulkan|metal [--adapter <name>] [--driver-id <id>]
  run          [--artifact <directory>] [--out <result.json>]
  compare      --baseline <artifact> --candidate <artifact> [--out <result.json>]
  worker       [--dir <spool>] [--port <n>] [--cache-seconds 3600] [--max-queued 1000]
  submit       --artifact <directory> [--baseline <directory>] [--wait [seconds]]
  status       --id <job> [--wait [seconds]]
  result       --id <job> [--out <result.json>]
  cancel       --id <job>
  health
Client commands accept --worker <worker.json>. Hardware options: --backend, --adapter, --driver-id.
Run options: --workload stationary|terrain-flight|fpv-flight --size 1280x720 --quality high
  --scale 1 --frames 300 --warmup 180 --in-flight 2 --profile --timeout 180000 --stability .15
Comparison options: --pairs 3 --max-pairs 9 --threshold 2 --metric gpuFrameMs
  --image-rmse 0 --image-max 0 --keep-images (defaults require exact output)
See tools/native-bench/README.md for measurement scope and queue behavior.`;

async function main() {
  let [command, ...argv] = process.argv.slice(2);
  if (!command || command.startsWith('--')) { argv = process.argv.slice(2); command = 'run'; }
  const args = parseArgs(argv);
  if (args.help || command === 'help') { console.log(HELP); return; }
  let result;
  if (command === 'build') {
    checkArgs(args, ['source', 'out']);
    result = await buildArtifact(args.source, args.out);
  } else if (command === 'internal-run') {
    checkArgs(args, ['request']);
    const request = await readJson(args.request);
    await mkdir(dirname(request.output), { recursive: true });
    if (request.mode === 'capabilities') {
      result = await capabilities(request.options); await writeJson(request.output, result);
    } else result = await runNative(request.artifact, request.options, request.output);
    // Dawn retains native threads; explicit exit follows readback, device teardown and result write.
    process.exit(['valid', 'ready'].includes(result.status) ? 0 : 1);
  } else if (command === 'worker') {
    await startWorker(args); return;
  } else if (['submit', 'status', 'result', 'cancel', 'health'].includes(command)) {
    result = await client(command, args);
  } else if (['run', 'compare', 'capabilities'].includes(command)) {
    const allowed = command === 'capabilities' ? ['backend', 'adapter', 'driver-id', 'timeout', 'out'] :
      command === 'compare' ? [...RUN_OPTIONS, ...COMPARE_OPTIONS, 'baseline', 'candidate', 'out'] : [...RUN_OPTIONS, 'artifact', 'out'];
    checkArgs(args, allowed);
    const options = runOptions(args);
    if (command === 'compare' && (typeof args.baseline !== 'string' || typeof args.candidate !== 'string')) throw new Error('--baseline and --candidate require artifact directories');
    const artifact = command === 'run' ? args.artifact ?? (await buildArtifact()).path : null;
    const output = resolve(args.out ?? resolve(ROOT, '.bench/runs', `${command}-${randomUUID()}.json`));
    await mkdir(dirname(output), { recursive: true });
    const release = await acquireGpuLock(), controller = new AbortController();
    const stop = () => controller.abort();
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
    try {
      if (command === 'capabilities') {
        // Capability probe runs in a child too, so hung drivers can be terminated.
        result = await probeChild(options, output, controller.signal);
      } else if (command === 'compare') result = await compareArtifacts(resolve(args.baseline), resolve(args.candidate), options, compareOptions(args), output, controller.signal);
      else result = await runChild(resolve(artifact), options, output, controller.signal);
    } finally { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); await release(); }
    result = { ...result, ...(command !== 'capabilities' ? { resultFile: output } : {}) };
  } else throw new Error(`Unknown command ${command}\n${HELP}`);
  console.log(JSON.stringify(result, null, 2));
  if (result.status === 'invalid' || result.verdict === 'regressed') process.exitCode = 1;
}
main().catch(error => {
  console.error(error.stack ?? String(error)); process.exitCode = 2;
  // A fatal native setup failure may leave Dawn threads alive. The coordinator still owns the lock.
  if (process.argv[2] === 'internal-run') process.exit(2);
});
