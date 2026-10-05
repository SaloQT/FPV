import { mkdir, open, readFile, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

// Direct runs and queue workers share one machine-wide lock, independent of checkout.
export async function acquireGpuLock() {
  const directory = resolve(homedir(), '.fpv-native-bench');
  await mkdir(directory, { recursive: true });
  const path = resolve(directory, 'gpu.lock'), token = randomUUID();
  let handle;
  try { handle = await open(path, 'wx'); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    let owner = 'unknown';
    try { owner = await readFile(path, 'utf8'); } catch { /* Owner may be releasing. */ }
    throw new Error(`GPU benchmark is locked at ${path}. Submit to the existing worker. If its owner has exited, remove this stale lock manually. Owner: ${owner}`);
  }
  try { await handle.writeFile(JSON.stringify({ pid: process.pid, token, startedAt: new Date().toISOString() })); }
  finally { await handle.close(); }
  return async () => {
    try {
      const owner = JSON.parse(await readFile(path, 'utf8'));
      if (owner.token === token) await unlink(path);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  };
}
