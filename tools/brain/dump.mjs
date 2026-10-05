// Writes the generated env shader to .bench/brain/env.wgsl (for compiler probes and reading).
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadTrainer, ROOT } from './bundle.mjs';

const t = await loadTrainer();
const code = t.envShader({ envs: Number(process.argv[2] ?? 1024), worlds: 1, quad: t.QUAD_5IN_6S, rates: t.DEFAULT_RATES, env: t.DEFAULT_ENV });
writeFileSync(resolve(ROOT, '.bench/brain/env.wgsl'), code);
console.log(`${code.split('\n').length} lines`);
