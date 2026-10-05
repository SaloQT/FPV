import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile, rm } from 'node:fs/promises';
import { dirname, resolve, basename, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

export const VERSION = 1;
export const TOOL_DIR = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(TOOL_DIR, '../..');
export const sha256 = value => createHash('sha256').update(value).digest('hex');
export const stable = value => JSON.stringify(canonical(value));
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
  return value;
}
export const readJson = async path => JSON.parse(await readFile(path, 'utf8'));
export async function writeJson(path, value) {
  await mkdir(dirname(resolve(path)), { recursive: true });
  const temp = `${path}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
  await rename(temp, path);
}
/** Only remove a private mkdtemp child of the explicitly named parent. Never clean user outputs. */
export async function removeTemporary(path, parent, prefix) {
  const absolute = resolve(path), intendedParent = resolve(parent), rel = relative(intendedParent, absolute);
  if (dirname(absolute) !== intendedParent || !rel || rel.startsWith('..') || isAbsolute(rel) || !basename(absolute).startsWith(prefix)) {
    throw new Error(`Refusing temporary-directory cleanup outside ${intendedParent}`);
  }
  await rm(absolute, { recursive: true, force: true });
}
export function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (!key.startsWith('--')) throw new Error(`Expected an option, received ${key}`);
    const name = key.slice(2);
    if (!name || name in args) throw new Error(`Invalid or repeated option ${key}`);
    args[name] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  }
  return args;
}
export function checkArgs(args, names) {
  for (const name of Object.keys(args)) if (!names.includes(name)) throw new Error(`Unknown option --${name}`);
}
export function number(value, fallback, name, min, max, integer = false) {
  const n = value === undefined ? fallback : Number(value);
  if (typeof value === 'boolean' || !Number.isFinite(n) || n < min || n > max || (integer && !Number.isInteger(n))) {
    throw new Error(`${name} must be ${integer ? 'an integer' : 'a number'} between ${min} and ${max}`);
  }
  return n;
}
export function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b), position = (sorted.length - 1) * p;
  const lo = Math.floor(position), hi = Math.ceil(position);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (position - lo);
}
export function summary(values) {
  if (!values.length) return { samples: 0, mean: null, median: null, p95: null, min: null, max: null };
  if (!values.every(x => Number.isFinite(x) && x >= 0)) throw new Error('Invalid timing values');
  return { samples: values.length, mean: values.reduce((a, b) => a + b, 0) / values.length,
    median: percentile(values, .5), p95: percentile(values, .95), min: Math.min(...values), max: Math.max(...values) };
}
export async function toolingHash() {
  const files = ['../bench-native.mjs', 'common.mjs', 'artifact.mjs', 'runtime.mjs', 'workload.mjs', 'runner.mjs', 'compare.mjs', 'lock.mjs', 'worker.mjs', 'client.mjs'];
  return sha256(stable(await Promise.all(files.map(async file => [file, sha256(await readFile(resolve(TOOL_DIR, file)))]))));
}
export const RUN_OPTIONS = ['workload', 'size', 'quality', 'scale', 'frames', 'warmup', 'in-flight', 'profile', 'backend', 'adapter', 'timeout', 'stability', 'driver-id'];
export function runOptions(args) {
  const size = String(args.size ?? '1280x720').match(/^(\d+)x(\d+)$/);
  if (!size) throw new Error('--size must be WIDTHxHEIGHT');
  const workload = args.workload ?? 'terrain-flight', quality = args.quality ?? 'high';
  if (!['stationary', 'terrain-flight', 'fpv-flight'].includes(workload)) throw new Error('Unknown workload');
  if (!['low', 'medium', 'high', 'ultra'].includes(quality)) throw new Error('Unknown quality');
  const backend = args.backend ?? (process.platform === 'win32' ? 'd3d12' : process.platform === 'darwin' ? 'metal' : 'vulkan');
  if (!['d3d12', 'vulkan', 'metal'].includes(backend)) throw new Error('Hardware backend must be d3d12, vulkan or metal');
  if (args.profile !== undefined && args.profile !== true) throw new Error('--profile is a flag');
  for (const key of ['adapter', 'driver-id']) if (args[key] !== undefined && typeof args[key] !== 'string') throw new Error(`--${key} requires a value`);
  return { workload, workloadVersion: 1, dt: 1 / 60, seed: 1337,
    width: number(size[1], 1280, 'width', 64, 8192, true), height: number(size[2], 720, 'height', 36, 8192, true), quality,
    scale: number(args.scale, 1, 'scale', .25, 1), frames: number(args.frames, 300, 'frames', 30, 30000, true),
    warmup: number(args.warmup, 180, 'warmup', 60, 30000, true),
    inFlight: number(args['in-flight'], 2, 'in-flight', 1, 2, true), profile: args.profile === true,
    backend, adapter: args.adapter ?? null, driverId: args['driver-id'] ?? null,
    timeoutMs: number(args.timeout, 180000, 'timeout', 1000, 3600000, true),
    stability: number(args.stability, .15, 'stability', .001, 1) };
}
