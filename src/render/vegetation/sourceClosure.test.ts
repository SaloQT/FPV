import { describe, expect, it } from 'vitest';
import { importClosure, importsOf, stableText, stripComments } from './sourceClosure';

describe('import closure', () => {
  const src = {
    'src/a/entry.ts': [
      "import { b } from './b';",
      "import type { T } from './types';",
      "import { type U, type V } from './types2';",
      "import {\n  c,\n  type W,\n} from '../c/c';",
      "// import { gone } from './gone';",
      "/* import { gone2 } from './gone2'; */",
      "export { d } from './d';",
      "export type { X } from './types3';",
      "const w = new Worker(new URL('./w.worker.ts', import.meta.url));",
      'export const e = b + c;',
    ].join('\n'),
    'src/a/b.ts': "import { r } from '../c/rng';\nexport const b = r;",
    'src/c/c.ts': 'export const c = 1;',
    'src/c/rng.ts': 'export const r = 2;',
    'src/a/d/index.ts': 'export const d = 3;',
    'src/a/w.worker.ts': "import { b } from './b';",
    'src/a/types.ts': 'export type T = 1;',
    'src/a/types2.ts': 'export type U = 1;',
    'src/a/types3.ts': 'export type X = 1;',
    'src/a/unrelated.ts': 'export const z = 0;',
  };

  it('follows value imports, re-exports, index files and worker URLs, and skips type-only imports and comments', () => {
    const c = importClosure(src, ['src/a/entry.ts']);
    expect(c.missing).toEqual([]);
    expect(c.files).toEqual(['src/a/b.ts', 'src/a/d/index.ts', 'src/a/entry.ts', 'src/a/w.worker.ts', 'src/c/c.ts', 'src/c/rng.ts']);
  });

  it('reports imports it cannot follow', () => {
    const c = importClosure({ 'src/x.ts': "import { a } from 'pkg';\nimport { b } from './nope';\nconst m = import(name);\nconst g = import.meta.glob(patterns);" }, ['src/x.ts']);
    expect(c.missing).toEqual(['src/x.ts -> pkg', 'src/x.ts -> ./nope', 'src/x.ts -> <computed name>', 'src/x.ts -> <import.meta.glob>']);
  });

  it('takes the files a glob selects: raw ones as text, code ones with their imports', () => {
    const files = {
      'src/v/cache.ts': "const S = import.meta.glob(['./*.ts', '!./*.test.ts', '../w/rng.ts'], { query: '?raw', import: 'default', eager: true });",
      'src/v/gen.ts': "import { x } from '../w/deep';", 'src/v/gen.test.ts': '', 'src/w/rng.ts': '', 'src/w/deep.ts': '', 'src/w/other.ts': '',
      'src/m/all.ts': "const M = import.meta.glob('./parts/**/*.ts');", 'src/m/parts/a/b.ts': "import { r } from '../../../w/rng';",
    };
    expect(importClosure(files, ['src/v/cache.ts']).files).toEqual(['src/v/cache.ts', 'src/v/gen.ts', 'src/w/rng.ts']);
    expect(importClosure(files, ['src/m/all.ts'])).toEqual({ files: ['src/m/all.ts', 'src/m/parts/a/b.ts', 'src/w/rng.ts'], missing: [] });
  });

  it('drops the imports of a pruned file whose names are no longer used in it', () => {
    const files = { 'src/v.ts': "import { plan } from './plan';\nimport { build } from './build';\nexport const asset = () => build();", 'src/plan.ts': '', 'src/build.ts': '' };
    expect(importClosure(files, ['src/v.ts'], new Set(['src/v.ts'])).files).toEqual(['src/build.ts', 'src/v.ts']);
    expect(importClosure(files, ['src/v.ts']).files).toEqual(['src/build.ts', 'src/plan.ts', 'src/v.ts']);
  });

  it('reads import clauses', () => {
    expect(importsOf("import A, { b as c, type D } from './x';")).toEqual([{ spec: './x', names: ['A', 'c'], typeOnly: false }]);
    expect(importsOf("import * as ns from './y';")).toEqual([{ spec: './y', names: ['ns'], typeOnly: false }]);
    expect(stripComments("const s = '//not a comment'; // gone")).toBe("const s = '//not a comment'; \n");
  });
});

describe('stable text', () => {
  it('is independent of key order and tells typed arrays, -0 and NaN apart', () => {
    expect(stableText({ a: 1, b: [2, 3] })).toBe(stableText({ b: [2, 3], a: 1 }));
    expect(stableText(new Float32Array([1, 2]))).not.toBe(stableText([1, 2]));
    expect(stableText(-0)).not.toBe(stableText(0));
    expect(stableText(NaN)).not.toBe(stableText(null));
  });

  it('refuses values it cannot render faithfully', () => {
    expect(() => stableText({ f: () => 1 })).toThrow();
    expect(() => stableText(new Map())).toThrow();
  });
});
