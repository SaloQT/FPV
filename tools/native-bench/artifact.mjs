import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { resolve, dirname, relative, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import { build } from 'vite';
import { VERSION, ROOT, sha256, stable, readJson, writeJson, removeTemporary } from './common.mjs';

// Keep the workload in the harness so older/candidate artifacts execute the same scenario implementation.
const EXPORTS = {
  'src/render/renderer.ts': ['Renderer'], 'src/render/modules.ts': ['createDefaultModules'],
  'src/contracts.ts': ['DEFAULT_SETTINGS'], 'src/world/terrain/generate.ts': ['generateTerrain'],
  'src/world/terrain/sampler.ts': ['createTerrainSampler'], 'src/world/track/generator.ts': ['generateTrack'],
  'src/world/track/colliders.ts': ['trackColliders'], 'src/world/track/gate.ts': ['gatePassed'],
  'src/world/astro/clock.ts': ['computeAstro'], 'src/game/quat.ts': ['quatLookAlong'],
  'src/game/cameraRig.ts': ['CameraRig'], 'src/sim/quad.ts': ['QuadPhysics'],
  'src/sim/presets.ts': ['QUAD_5IN_6S'], 'src/app/scenario.ts': ['ScenarioPilot'],
};
function sourceInfo(root) {
  try {
    const git = args => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    return { head: git(['rev-parse', 'HEAD']).trim(), dirty: git(['status', '--porcelain']).length > 0,
      trackedDiffSha256: sha256(git(['diff', '--binary', 'HEAD', '--'])) };
  } catch { return { head: null, dirty: null }; }
}
export async function buildArtifact(source = ROOT, destination = resolve(ROOT, '.bench/artifacts')) {
  const root = resolve(source), temp = await mkdtemp(resolve(tmpdir(), 'fpv-native-build-'));
  try {
    const entry = resolve(temp, 'entry.ts');
    await writeFile(entry, Object.entries(EXPORTS).map(([file, names]) =>
      `export { ${names.join(', ')} } from ${JSON.stringify(resolve(root, file).replaceAll('\\', '/'))};`).join('\n'));
    const sourceBefore = sourceInfo(root);
    const built = await build({ root, configFile: false, logLevel: 'warn', mode: 'production', publicDir: false,
      define: { 'import.meta.env.DEV': 'false', 'import.meta.env.PROD': 'true' },
      ssr: { noExternal: true }, build: { ssr: entry, write: false, minify: false, target: 'es2022',
        rolldownOptions: { output: { format: 'es', entryFileNames: 'renderer.mjs', chunkFileNames: '[name]-[hash].mjs' } } } });
    if (Array.isArray(built) || !built.output) throw new Error('Unexpected native bundle output');
    const files = [];
    for (const item of built.output) {
      if (item.type === 'chunk' && (item.imports.some(x => !built.output.some(y => y.fileName === x)) || item.dynamicImports.length)) {
        throw new Error('Native artifact must have no external or dynamic imports');
      }
      const content = item.type === 'chunk' ? item.code : item.source;
      await mkdir(dirname(resolve(temp, item.fileName)), { recursive: true });
      await writeFile(resolve(temp, item.fileName), content);
      files.push({ path: item.fileName, sha256: sha256(content) });
    }
    const stars = await readFile(resolve(root, 'public/data/stars.bin'));
    await mkdir(resolve(temp, 'data'), { recursive: true });
    await writeFile(resolve(temp, 'data/stars.bin'), stars);
    files.push({ path: 'data/stars.bin', sha256: sha256(stars) });
    files.sort((a, b) => a.path.localeCompare(b.path));
    const sourceAfter = sourceInfo(root);
    if (stable(sourceBefore) !== stable(sourceAfter)) throw new Error('Source changed while bundling; retry from an isolated checkout');
    const identity = { schemaVersion: VERSION, entry: 'renderer.mjs', files };
    const id = sha256(stable(identity));
    const manifest = { ...identity, id, builtAt: new Date().toISOString(), source: sourceAfter,
      sourceNote: 'Artifact hashes identify executed bytes. Git metadata does not fingerprint all untracked source files.' };
    const output = resolve(destination, id);
    await mkdir(destination, { recursive: true });
    // Publish only a fully materialized artifact, without the temporary build entry.
    const staging = await mkdtemp(resolve(destination, '.staging-'));
    try {
      for (const file of files) {
        await mkdir(dirname(resolve(staging, file.path)), { recursive: true });
        await writeFile(resolve(staging, file.path), await readFile(resolve(temp, file.path)));
      }
      await writeJson(resolve(staging, 'manifest.json'), manifest);
      try { await rename(staging, output); }
      catch (error) {
        if (!['EEXIST', 'ENOTEMPTY', 'EPERM'].includes(error.code)) throw error;
        await loadArtifact(output); // Only reuse a verified existing artifact.
      }
    } finally { await removeTemporary(staging, destination, '.staging-'); }
    return { path: output, manifest: await loadArtifact(output) };
  } finally { await removeTemporary(temp, tmpdir(), 'fpv-native-build-'); }
}
function inside(root, path) {
  const rel = relative(root, resolve(root, path));
  return rel && !rel.startsWith('..') && !isAbsolute(rel);
}
export async function loadArtifact(directory) {
  const root = resolve(directory), manifest = await readJson(resolve(root, 'manifest.json'));
  if (manifest.schemaVersion !== VERSION || manifest.entry !== 'renderer.mjs' || !Array.isArray(manifest.files)) throw new Error('Unsupported artifact manifest');
  const paths = new Set();
  for (const file of manifest.files) {
    if (typeof file.path !== 'string' || !inside(root, file.path) || paths.has(file.path)) throw new Error('Invalid artifact path');
    paths.add(file.path);
    if (sha256(await readFile(resolve(root, file.path))) !== file.sha256) throw new Error(`Artifact hash mismatch: ${file.path}`);
  }
  if (!paths.has(manifest.entry) || !paths.has('data/stars.bin')) throw new Error('Artifact missing entry/assets');
  if (manifest.id !== sha256(stable({ schemaVersion: manifest.schemaVersion, entry: manifest.entry, files: manifest.files }))) throw new Error('Artifact identity mismatch');
  return manifest;
}
