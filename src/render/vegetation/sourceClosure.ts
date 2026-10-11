/**
 * The runtime import closure of a module, read from raw sources (import.meta.glob '?raw'), for cache keys that must change whenever any
 * code a result depends on changes, and only then (treeCache.ts). Paths are posix and relative to the repo root ('src/...').
 *
 * Type-only imports (`import type`, `export type ... from`, or a brace list of `type` names only) are left out: they erase at build time.
 * import.meta.glob calls with literal patterns add the files they select (a '?raw' glob as text only, a code glob with its imports). An
 * import that resolves to no file in `sources` (a package, a path outside the globbed set, a computed specifier or glob) is listed in
 * `missing`, so the caller can refuse to cache rather than miss a dependency.
 */

export interface Closure {
  /** Every file reached, entries included, sorted. */
  files: string[];
  /** Imports that could not be followed, as `importer -> specifier`. */
  missing: string[];
}

/** One static import or re-export (or dynamic import, worker URL) of a module: its specifier and the local names it binds ([] when none). */
interface ImportRef { spec: string; names: string[]; typeOnly: boolean }

const STATIC = /(?:^|[;}\n])[ \t]*(import|export)\s+(type\s+)?([\w$*{}\s,]*?)\s*from\s*['"]([^'"\n]+)['"]/g;
const BARE = /(?:^|[;}\n])[ \t]*import\s*['"]([^'"\n]+)['"]/g;
const DYNAMIC = /\bimport\s*\(\s*(['"]?)([^'")\n]*)\1\s*\)/g;
const WORKER_URL = /\bnew\s+URL\s*\(\s*['"]([^'"\n]+)['"]\s*,\s*import\.meta\.url\s*\)/g;

/** `text` with comments blanked (strings and template literals kept), so a commented-out import is not followed. */
export function stripComments(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i], n = text[i + 1];
    if (c === '/' && n === '/') { while (i < text.length && text[i] !== '\n') i++; out += '\n'; continue; }
    if (c === '/' && n === '*') { const end = text.indexOf('*/', i + 2); const stop = end < 0 ? text.length : end + 2; out += text.slice(i, stop).replace(/[^\n]/g, ' '); i = stop - 1; continue; }
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < text.length && text[j] !== c) { if (text[j] === '\\') j++; if (c !== '`' && text[j] === '\n') break; j++; }
      out += text.slice(i, j + 1); i = j; continue;
    }
    out += c;
  }
  return out;
}

/** The imports of a module's (comment-free) text. */
export function importsOf(text: string): ImportRef[] {
  const refs: ImportRef[] = [];
  for (const m of text.matchAll(STATIC)) {
    const clause = m[3].trim();
    // `export { a }` without `from` is not matched; `export * from` and `export { a } from` bind no local names.
    const names: string[] = [];
    let typeOnly = !!m[2];
    if (m[1] === 'import' && !typeOnly) {
      const brace = /\{([^}]*)\}/.exec(clause);
      const outside = clause.replace(/\{[^}]*\}/, '').split(',').map((s) => s.trim()).filter(Boolean);
      for (const o of outside) names.push(o.replace(/^\*\s+as\s+/, ''));
      const specs = brace ? brace[1].split(',').map((s) => s.trim()).filter(Boolean) : [];
      for (const s of specs) if (!s.startsWith('type ')) names.push(s.split(/\s+as\s+/).pop()!.trim());
      typeOnly = outside.length === 0 && specs.length > 0 && specs.every((s) => s.startsWith('type '));
    } else if (m[1] === 'export' && !typeOnly) {
      const brace = /\{([^}]*)\}/.exec(clause);
      if (brace) {
        const specs = brace[1].split(',').map((s) => s.trim()).filter(Boolean);
        typeOnly = specs.length > 0 && specs.every((s) => s.startsWith('type '));
      }
    }
    refs.push({ spec: m[4], names, typeOnly });
  }
  for (const m of text.matchAll(BARE)) refs.push({ spec: m[1], names: [], typeOnly: false });
  // A dynamic import of anything but a plain string literal cannot be followed: it is reported as missing.
  for (const m of text.matchAll(DYNAMIC)) refs.push({ spec: m[1] ? m[2] : `<computed ${m[2].trim()}>`, names: [], typeOnly: false });
  for (const m of text.matchAll(WORKER_URL)) refs.push({ spec: m[1], names: [], typeOnly: false });
  for (const g of globsOf(text)) refs.push({ spec: g, names: [], typeOnly: false });
  return refs;
}

/**
 * The import.meta.glob calls of a module, each as a specifier `<glob raw|code pattern,pattern,...>` (raw: the files are read as text, so
 * they are dependencies without their own imports), or `<import.meta.glob>` when a call's patterns are not string literals.
 */
function globsOf(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\bimport\.meta\.glob\s*(?:<[^>]*>)?\s*\(/g)) {
    // The argument list up to the matching parenthesis.
    let depth = 1, j = m.index! + m[0].length;
    for (; j < text.length && depth; j++) depth += text[j] === '(' ? 1 : text[j] === ')' ? -1 : 0;
    const call = text.slice(m.index! + m[0].length, j - 1);
    const first = /^\s*(\[[^\]]*\]|'[^']*'|"[^"]*")/.exec(call);
    const patterns = first ? [...first[1].matchAll(/'([^']*)'|"([^"]*)"/g)].map((p) => p[1] ?? p[2]) : [];
    if (!first || !patterns.length || /\$\{/.test(first[1])) { out.push('<import.meta.glob>'); continue; }
    const raw = /query\s*:\s*['"]\?raw['"]/.test(call.slice(first[0].length));
    out.push(`<glob ${raw ? 'raw' : 'code'} ${patterns.join(',')}>`);
  }
  return out;
}

/** The files of `sources` a glob's patterns (relative to `from`, `!` excludes, `*` within a name, `**` across folders) select. */
function globFiles(from: string, patterns: readonly string[], sources: Readonly<Record<string, string>>): string[] {
  const toRe = (p: string): RegExp | null => {
    const path = join(from, p);
    if (path === null) return null;
    const body = path.split('/').map((s) => (s === '**' ? '(?:.*/)?' : `${s.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]')}/`)).join('');
    return new RegExp(`^${body.replace(/\(\?:\.\*\/\)\?$|\/$/, '')}$`);
  };
  const inc = patterns.filter((p) => !p.startsWith('!')).map(toRe), exc = patterns.filter((p) => p.startsWith('!')).map((p) => toRe(p.slice(1)));
  return Object.keys(sources).filter((f) => inc.some((r) => r?.test(f)) && !exc.some((r) => r?.test(f)));
}

/** `rel` (posix, may start with ./ or ../) against the directory of `from`, normalised; null when it climbs above the root. */
function join(from: string, rel: string): string | null {
  const parts = from.split('/').slice(0, -1);
  for (const p of rel.split('/')) {
    if (p === '' || p === '.') continue;
    if (p === '..') { if (!parts.length) return null; parts.pop(); } else parts.push(p);
  }
  return parts.join('/');
}

function resolveSpec(from: string, spec: string, sources: Readonly<Record<string, string>>): string | null {
  if (!spec.startsWith('.')) return null;
  const base = join(from, spec.replace(/\?.*$/, ''));
  if (base === null) return null;
  for (const p of [base, `${base}.ts`, `${base}/index.ts`]) if (p in sources) return p;
  return null;
}

/**
 * The closure of `entries` over `sources` (path -> text). `prune` lists files whose imports count only when one of the names they bind is
 * used in the file's own text outside the import statements: the caller has cut part of that file's text out (treeCache.ts drops the
 * variant table, whose effect it keys on each variant's plan output instead).
 */
export function importClosure(sources: Readonly<Record<string, string>>, entries: readonly string[], prune: ReadonlySet<string> = new Set()): Closure {
  const seen = new Set<string>(), raw = new Set<string>(), missing: string[] = [], queue = [...entries];
  for (const e of entries) if (!(e in sources)) missing.push(`<entry> -> ${e}`);
  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file) || !(file in sources)) continue;
    seen.add(file);
    const text = stripComments(sources[file]);
    const body = prune.has(file) ? text.replace(STATIC, '\n').replace(BARE, '\n') : '';
    for (const ref of importsOf(text)) {
      if (ref.typeOnly) continue;
      const glob = /^<glob (raw|code) (.*)>$/.exec(ref.spec);
      if (glob) {
        for (const f of globFiles(file, glob[2].split(','), sources)) if (glob[1] === 'raw') raw.add(f); else queue.push(f);
        continue;
      }
      if (prune.has(file) && ref.names.length && !ref.names.some((n) => new RegExp(`(^|[^\\w$.])${n.replace(/\$/g, '\\$')}(?![\\w$])`).test(body))) continue;
      const to = resolveSpec(file, ref.spec, sources);
      if (to === null) missing.push(`${file} -> ${ref.spec}`);
      else queue.push(to);
    }
  }
  return { files: [...new Set([...seen, ...raw])].sort(), missing };
}

/** FNV-1a over `text` in two 32-bit lanes with different seeds, as 16 hex digits. */
export function hash64(text: string): string {
  let a = 0x811c9dc5, b = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x01000193 + 2) >>> 0;
  }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}

/**
 * A deterministic text of a plain data value (objects by sorted key, arrays and typed arrays element by element, -0 and NaN kept apart),
 * for hashing a generator's output. Throws on a value it cannot render faithfully (a function, a Map, a class instance with hidden state).
 */
export function stableText(value: unknown): string {
  const out: string[] = [];
  const seen = new Set<object>();
  const walk = (v: unknown): void => {
    if (v === null) { out.push('null'); return; }
    switch (typeof v) {
      case 'number': out.push(Object.is(v, -0) ? '-0' : String(v)); return;
      case 'string': out.push(JSON.stringify(v)); return;
      case 'boolean': out.push(v ? 'true' : 'false'); return;
      case 'undefined': out.push('undefined'); return;
      case 'bigint': out.push(`${v}n`); return;
      case 'object': break;
      default: throw new Error(`stableText: cannot render a ${typeof v}`);
    }
    const o = v as object;
    if (seen.has(o)) throw new Error('stableText: cyclic value');
    seen.add(o);
    if (Array.isArray(o)) { out.push('['); for (const x of o) { walk(x); out.push(','); } out.push(']'); }
    else if (ArrayBuffer.isView(o) && !(o instanceof DataView)) {
      out.push(`${o.constructor.name}[`);
      for (const x of o as unknown as Iterable<number>) { walk(x); out.push(','); }
      out.push(']');
    } else if (Object.getPrototypeOf(o) === Object.prototype) {
      out.push('{');
      for (const k of Object.keys(o).sort()) { out.push(JSON.stringify(k), ':'); walk((o as Record<string, unknown>)[k]); out.push(','); }
      out.push('}');
    } else throw new Error(`stableText: cannot render a ${o.constructor?.name ?? 'object'}`);
    seen.delete(o);
  };
  walk(value);
  return out.join('');
}
