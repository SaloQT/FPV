// Bundles the prop code (src/prop/node.ts: blade solver, bench, optimiser and the trainer's world helpers, no GPU code) into one
// ES module Node can import, under .bench/prop-lab/bundle. Same approach as tools/brain/bundle.mjs.
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = resolve(ROOT, '.bench/prop-lab/bundle');
const SELF = fileURLToPath(import.meta.url);

async function buildBundle() {
  const { build } = await import('vite');
  const built = await build({
    root: ROOT, configFile: false, logLevel: 'warn', mode: 'production', publicDir: false,
    define: { 'import.meta.env.DEV': 'false', 'import.meta.env.PROD': 'true' },
    ssr: { noExternal: true },
    build: {
      ssr: resolve(ROOT, 'src/prop/node.ts'), write: false, minify: false, target: 'es2022',
      rolldownOptions: { output: { format: 'es', entryFileNames: 'proplab.mjs', chunkFileNames: '[name]-[hash].mjs' } },
    },
  });
  const output = Array.isArray(built) ? built[0].output : built.output;
  await mkdir(OUT, { recursive: true });
  for (const item of output) {
    const file = resolve(OUT, item.fileName);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, item.type === 'chunk' ? item.code : item.source);
  }
}

/** Rebuilds the bundle in a child process and imports it. */
export async function loadPropLab() {
  execFileSync(process.execPath, [SELF, '--build'], { stdio: 'inherit' });
  return import(`${pathToFileURL(resolve(OUT, 'proplab.mjs')).href}?t=${Date.now()}`);
}

if (process.argv[2] === '--build' && process.argv[1] === SELF) await buildBundle();
