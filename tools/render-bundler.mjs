#!/usr/bin/env node
// Bundles the shot entry (render-core.mjs EXPORTS) for the render server. It runs in its own process: Vite's native bundler loaded next
// to Dawn crashes Dawn's pipeline compiler (tools/brain/bundle.mjs).
//
//   node tools/render-bundler.mjs --once <dir> [source]   one build into <dir>/shots.mjs, then exit
//   (forked with an IPC channel)                          stays up; each message { id, dir, source } builds into <dir> one file per
//                                                         source module, named by content hash, and replies { id, ok, ms, file (the
//                                                         entry), written, modules (source files bundled), codeChanged (source files
//                                                         whose own code differs from the last build) }
//
// One file per module, named by its hash, is what lets the server swap a single render module: a module whose code and imports did not
// change keeps its file name, so Node hands the new build the instance it already has (and its module-level state, such as a registry
// another module reads), and only the edited files and the files importing them are new instances.
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { ROOT, entryText } from './render-core.mjs';

const { build } = await import('vite');

const sourceModules = (outputs, source) => [...new Set(outputs.flatMap((o) => o.moduleIds ?? Object.keys(o.modules ?? {})))]
  .map((id) => id.split('?')[0]).filter((id) => !id.startsWith('\0') && !id.includes('node_modules'))
  .map((id) => relative(source, id).replaceAll('\\', '/')).filter((id) => id.startsWith('src/')).sort();

async function bundleOnce(dir, source) {
  const t0 = performance.now();
  await mkdir(dir, { recursive: true });
  const entry = resolve(dir, 'entry.ts');
  await writeFile(entry, entryText(source));
  const out = await build({
    root: source, configFile: false, logLevel: 'warn', publicDir: false,
    build: { ssr: entry, outDir: dir, emptyOutDir: false, target: 'es2022', rolldownOptions: { output: { entryFileNames: 'shots.mjs' } } },
  });
  const outputs = (Array.isArray(out) ? out : [out]).flatMap((o) => o.output ?? []);
  return { file: resolve(dir, 'shots.mjs'), ms: performance.now() - t0, modules: sourceModules(outputs, source) };
}

/**
 * WGSL files come in as `?raw` modules. In the per-module build each one reads its text from globalThis.__FPV_WGSL__ (the worker fills it
 * from disk), so a shader edit leaves every module file as it was: the worker hands the new text to the live shaderLib instead
 * (setShaderSource), and nothing above shaderLib becomes a new instance.
 */
const wgslFromGlobal = (source) => ({
  name: 'fpv-wgsl-from-global',
  enforce: 'pre',
  load(id) {
    const [file, query] = id.split('?');
    if (query !== 'raw' || !file.endsWith('.wgsl')) return null;
    const rel = relative(resolve(source, 'src/render/shaders'), file).replaceAll('\\', '/');
    return `const text = globalThis.__FPV_WGSL__?.[${JSON.stringify(rel)}];\nif (text === undefined) throw new Error(${JSON.stringify(`render server: no WGSL loaded for ${rel}`)});\nexport default text;\n`;
  },
});

/** Each module's code with the hashes in its import paths taken out, by source path, from the last build: what tells an edit that changed code from one that only renamed imports. */
const lastCode = new Map();
const IMPORT_HASH = /-[A-Za-z0-9_-]{8}\.mjs/g;

async function bundleModules(dir, source) {
  const t0 = performance.now();
  await mkdir(dir, { recursive: true });
  const entry = resolve(dir, 'entry.ts');
  await writeFile(entry, entryText(source));
  const out = await build({
    root: source, configFile: false, logLevel: 'warn', publicDir: false, plugins: [wgslFromGlobal(source)],
    build: {
      ssr: entry, write: false, target: 'es2022', minify: false,
      rolldownOptions: { output: { preserveModules: true, preserveModulesRoot: source, entryFileNames: '[name]-[hash].mjs', chunkFileNames: '[name]-[hash].mjs', assetFileNames: '[name]-[hash][extname]' } },
    },
  });
  const outputs = (Array.isArray(out) ? out : [out]).flatMap((o) => o.output ?? []);
  let written = 0, file = null;
  const codeChanged = [];
  for (const o of outputs) {
    const path = resolve(dir, o.fileName);
    if (o.type === 'chunk' && o.isEntry) file = path;
    if (o.type === 'chunk' && o.facadeModuleId) {
      // Keyed with the query: a file's code module and its '?raw' text module (treeCache.ts reads sources as text) are separate.
      const id = relative(source, o.facadeModuleId).replaceAll('\\', '/');
      const code = o.code.replace(IMPORT_HASH, '.mjs');
      if (lastCode.get(id) !== code) { if (lastCode.has(id)) codeChanged.push(id.split('?')[0]); lastCode.set(id, code); }
    }
    if (existsSync(path)) continue;
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, o.type === 'chunk' ? o.code : o.source);
    written++;
  }
  if (!file) throw new Error('render-bundler: the build has no entry chunk');
  return { file, written, codeChanged: [...new Set(codeChanged)].sort(), ms: performance.now() - t0, modules: sourceModules(outputs, source) };
}

if (process.argv[2] === '--once') {
  await bundleOnce(resolve(process.argv[3]), process.argv[4] ? resolve(process.argv[4]) : ROOT);
  process.exit(0);
} else if (process.send) {
  process.on('message', async ({ id, dir, source }) => {
    try { process.send({ id, ok: true, ...(await bundleModules(resolve(dir), source ? resolve(source) : ROOT)) }); }
    catch (error) { process.send({ id, ok: false, error: String(error?.stack ?? error) }); }
  });
  process.on('disconnect', () => process.exit(0));
} else {
  console.error('usage: node tools/render-bundler.mjs --once <dir> [source]');
  process.exit(2);
}
