/**
 * Tiny WGSL preprocessor. Sources live in src/render/shaders/**.wgsl and are bundled as raw strings.
 * Supported directives:
 *   #include "path/relative/to/shaders/root.wgsl"   (each file is included at most once per module)
 *   #ifdef NAME / #ifndef NAME / #else / #endif        (NAME defined via the `defines` argument, truthy value)
 *   ${NAME}                                            replaced by the define's value anywhere in the text
 */

const files = import.meta.glob('./shaders/**/*.wgsl', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

const sources = new Map<string, string>();
for (const [k, v] of Object.entries(files)) sources.set(k.replace(/^\.\/shaders\//, ''), v);

export type Defines = Record<string, string | number | boolean>;

export function hasShader(path: string): boolean {
  return sources.has(path);
}

export function resolveShader(path: string, defines: Defines = {}): string {
  const included = new Set<string>();
  const out: string[] = [];
  const emit = (p: string, stack: string[]) => {
    if (included.has(p)) return;
    included.add(p);
    const src = sources.get(p);
    if (src === undefined) throw new Error(`WGSL include not found: "${p}" (from ${stack.join(' -> ') || 'root'})`);
    const skip: boolean[] = [];
    const lines = src.split('\n');
    for (let n = 0; n < lines.length; n++) {
      const line = lines[n];
      const t = line.trim();
      let m: RegExpMatchArray | null;
      if ((m = t.match(/^#ifdef\s+(\w+)/))) { skip.push(!defines[m[1]]); continue; }
      if ((m = t.match(/^#ifndef\s+(\w+)/))) { skip.push(!!defines[m[1]]); continue; }
      if (t.startsWith('#else')) { skip.push(!skip.pop()); continue; }
      if (t.startsWith('#endif')) { skip.pop(); continue; }
      if (skip.some(Boolean)) continue;
      if ((m = t.match(/^#include\s+"([^"]+)"/))) { emit(m[1], [...stack, p]); continue; }
      out.push(line.replace(/\$\{(\w+)\}/g, (_, k) => String(defines[k] ?? (() => { throw new Error(`Undefined WGSL define ${k} in ${p}:${n + 1}`); })())));
    }
  };
  emit(path, []);
  return out.join('\n');
}

export async function compileShader(device: GPUDevice, label: string, code: string): Promise<GPUShaderModule> {
  const module = device.createShaderModule({ label, code });
  const info = await module.getCompilationInfo();
  const errors = info.messages.filter((m) => m.type === 'error');
  if (errors.length) {
    const lines = code.split('\n');
    const msg = errors.map((e) => `${label}:${e.lineNum}:${e.linePos} ${e.message}\n    ${lines[e.lineNum - 1] ?? ''}`).join('\n');
    throw new Error(`WGSL compile errors\n${msg}`);
  }
  return module;
}
