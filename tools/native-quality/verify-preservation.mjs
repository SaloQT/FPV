import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ROOT, sha256 } from '../native-bench/common.mjs';
import { loadArtifact } from '../native-bench/artifact.mjs';
const readJson = async path => JSON.parse(await readFile(path, 'utf8'));
const evidence = resolve(ROOT, '.bench/research-20261005');
const protectedFiles = await readJson(resolve(evidence, 'protected-hashes.json'));
for (const file of protectedFiles) {
  if (sha256(await readFile(file.Path)) !== file.Hash.toLowerCase()) throw new Error(`Protected file changed: ${file.Path}`);
}
const baseline = await readJson(resolve(ROOT, '.bench/baseline.json'));
const manifest = await readJson(baseline.source.snapshotManifest);
for (const file of manifest.files) {
  if (sha256(await readFile(resolve(baseline.source.path, file.path))) !== file.sha256) throw new Error(`Frozen source changed: ${file.path}`);
}
const artifact = await loadArtifact(baseline.artifact.path);
if (artifact.id !== baseline.artifact.id) throw new Error('Frozen artifact ID changed');
const report = { checkedAt: new Date().toISOString(), passed: true, protectedFiles: protectedFiles.length,
  frozenSourceFiles: manifest.files.length, originalArtifact: artifact.id };
await writeFile(resolve(evidence, 'preservation-verification.json'), JSON.stringify(report, null, 2)+'\n');
console.log(report);
