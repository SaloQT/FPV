import { describe, expect, it } from 'vitest';

/** The repo has no @types/node, so node:fs comes through the process global like in world/astro/stars.test.ts. */
type Dirent = { name: string; isDirectory(): boolean };
const fs = (globalThis as unknown as { process: { getBuiltinModule(name: 'node:fs'): { readdirSync(path: URL, o: { withFileTypes: true }): Dirent[] } } })
  .process.getBuiltinModule('node:fs');

// Git for Windows refuses to check out a path whose name, before the first dot, is a reserved DOS device
// (aux.wgsl, con.ts, nul.md, ...), so one such file makes the whole repo unclonable on Windows.
const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\.|$)/i;
const SKIP = new Set(['node_modules', '.git', 'dist']);

const walk = (dir: URL, out: string[] = []): string[] => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    if (RESERVED.test(e.name)) out.push(new URL(e.name, dir).pathname);
    if (e.isDirectory()) walk(new URL(`${e.name}/`, dir), out);
  }
  return out;
};

describe('Windows-safe paths', () => {
  it('has no file or folder named after a reserved Windows device', () => {
    expect(walk(new URL('../../', import.meta.url))).toEqual([]);
  });
});
