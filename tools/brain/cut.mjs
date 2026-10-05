// Cuts .bench/brain/env.wgsl down to probe variants: `node tools/brain/cut.mjs <variant>`; writes .bench/brain/cut.wgsl.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT } from './bundle.mjs';

const full = readFileSync(resolve(ROOT, '.bench/brain/env.wgsl'), 'utf8');
const v = process.argv[2];
const at = (s) => full.indexOf(s);
const bind = '@group(0) @binding(0) var<storage, read_write> S : array<f32>;\n@group(0) @binding(1) var<storage, read_write> E : array<f32>;\n';
let code;
if (v === 'consts') code = full.slice(0, at('struct Quad {')) + bind + '@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) g : vec3u) { S[g.x] = DT + SPHERE_R[g.x % 13u]; }';
else if (v === 'quadload') code = full.slice(0, at('struct Env {')) + bind + '@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) g : vec3u) { loadQuad(g.x); q.pos.x += 1.0; storeQuad(g.x); }';
else if (v === 'quadpos') code = full.slice(0, at('struct Env {')) + bind + '@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) g : vec3u) { q.pos = vec3f(S[g.x], 0.0, 0.0); S[g.x] = q.pos.x; }';
else if (v === 'head') code = full.slice(0, at('struct Track {')) + bind + '@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) g : vec3u) { loadQuad(g.x); storeQuad(g.x); loadEnv(g.x); storeEnv(g.x); }';
else throw new Error(`unknown variant ${v}`);
writeFileSync(resolve(ROOT, '.bench/brain/cut.wgsl'), code);
console.log(`${v}: ${code.split('\n').length} lines`);
