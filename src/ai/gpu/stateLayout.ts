/**
 * Per-drone GPU state, stored structure-of-arrays: slot `k` of drone `e` lives at `buf[k * N + e]`, so a workgroup's 64 drones read
 * each slot as one coalesced run. One field list generates the WGSL struct and its load/store functions, so the layout cannot
 * drift between TypeScript and WGSL. u32 fields are stored bit-cast in the f32 buffer.
 */

export type FieldType = 'f32' | 'u32' | 'vec3f' | 'vec4f' | `f32x${number}`;

export interface Field {
  name: string;
  type: FieldType;
}

export function fieldSlots(t: FieldType): number {
  if (t === 'f32' || t === 'u32') return 1;
  if (t === 'vec3f') return 3;
  if (t === 'vec4f') return 4;
  return Number(t.slice(4));
}

export interface StateLayout {
  fields: Field[];
  offsets: Record<string, number>;
  slots: number;
}

export function makeLayout(fields: Field[]): StateLayout {
  const offsets: Record<string, number> = {};
  let o = 0;
  for (const f of fields) {
    if (offsets[f.name] !== undefined) throw new Error(`duplicate state field ${f.name}`);
    offsets[f.name] = o;
    o += fieldSlots(f.type);
  }
  return { fields, offsets, slots: o };
}

function wgslType(t: FieldType): string {
  if (t === 'f32' || t === 'u32' || t === 'vec3f' || t === 'vec4f') return t;
  return `array<f32, ${fieldSlots(t)}>`;
}

/**
 * WGSL for one layout: `struct <name>`, a private global `v` of that type, and `fn load<name>(e)` / `fn store<name>(e)` that copy
 * drone `e` between `buf` (an `array<f32>` storage binding) and `v`; the drone count is `count` (an expression such as `P.envs`).
 */
export function layoutWgsl(name: string, l: StateLayout, buf: string, count: string, v: string): string {
  const members = l.fields.map((f) => `  ${f.name} : ${wgslType(f.type)},`).join('\n');
  const at = (slot: number): string => `${buf}[${slot}u * ${count} + e]`;
  const loads: string[] = [];
  const stores: string[] = [];
  for (const f of l.fields) {
    const o = l.offsets[f.name];
    const n = fieldSlots(f.type);
    switch (f.type) {
      case 'f32':
        loads.push(`  s.${f.name} = ${at(o)};`);
        stores.push(`  ${at(o)} = s.${f.name};`);
        break;
      case 'u32':
        loads.push(`  s.${f.name} = bitcast<u32>(${at(o)});`);
        stores.push(`  ${at(o)} = bitcast<f32>(s.${f.name});`);
        break;
      case 'vec3f':
      case 'vec4f': {
        const parts = Array.from({ length: n }, (_, k) => at(o + k));
        loads.push(`  s.${f.name} = ${f.type}(${parts.join(', ')});`);
        for (let k = 0; k < n; k++) stores.push(`  ${at(o + k)} = s.${f.name}[${k}];`);
        break;
      }
      default:
        loads.push(`  for (var k = 0u; k < ${n}u; k++) { s.${f.name}[k] = ${buf}[(${o}u + k) * ${count} + e]; }`);
        stores.push(`  for (var k = 0u; k < ${n}u; k++) { ${buf}[(${o}u + k) * ${count} + e] = s.${f.name}[k]; }`);
    }
  }
  const bind = (lines: string[]): string => lines.join('\n').replaceAll('s.', `${v}.`);
  return [
    `struct ${name} {\n${members}\n}`,
    `var<private> ${v} : ${name};`,
    `fn load${name}(e : u32) {\n${bind(loads)}\n}`,
    `fn store${name}(e : u32) {\n${bind(stores)}\n}`,
  ].join('\n\n');
}
