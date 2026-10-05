import { describe, expect, it } from 'vitest';
import { resolveShader } from '../shaderLib';
import { CONTAINER_COLOURS, KIND, STEEL_COLOURS, kindDefines } from './materials';
import { QUAD_UNIFORM_FLOATS, quadBodyDefines, quadForwardDefines } from './quadRender';
import { FLAG_FLOATS, GATE_FLOATS, TRACK_UNIFORM_FLOATS } from './trackObjects';

const balanced = (code: string): boolean => {
  let depth = 0;
  for (const ch of code) {
    if (ch === '{' || ch === '(') depth++;
    if (ch === '}' || ch === ')') depth--;
    if (depth < 0) return false;
  }
  return depth === 0;
};

const entryPoints = (code: string): string[] => Array.from(code.matchAll(/@(?:vertex|fragment)\s+fn\s+(\w+)/g), (m) => m[1]);

describe('shader sources resolve', () => {
  const cases: [string, string, Record<string, number>, string[]][] = [
    ['objects/quad.wgsl', 'quad G-buffer', quadBodyDefines(), ['vsBody', 'fsBody', 'vsProp', 'fsProp']],
    ['objects/quad_forward.wgsl', 'quad forward', quadForwardDefines(), ['vsDisc', 'fsDisc', 'vsSprite', 'fsSprite']],
    ['objects/track.wgsl', 'track G-buffer', kindDefines(), []],
    ['objects/glow.wgsl', 'glow ribbons', {}, []],
  ];
  for (const [path, label, defines, entries] of cases) {
    it(`${label} has every define substituted and every entry point`, () => {
      const code = resolveShader(path, defines);
      expect(code).not.toContain('${');
      expect(balanced(code)).toBe(true);
      const found = entryPoints(code);
      for (const e of entries) expect(found).toContain(e);
      expect(found.length).toBeGreaterThan(0);
    });
  }

  it('the QuadU struct is as long as the buffer the CPU fills', () => {
    const code = resolveShader('objects/quad_bindings.wgsl');
    const body = /struct QuadU \{([^}]*)\}/.exec(code);
    expect(body).not.toBeNull();
    let floats = 0;
    for (const line of (body as RegExpExecArray)[1].split('\n')) {
      const m = /:\s*(mat4x4f|vec4f|array<vec4f,\s*(\d+)>)/.exec(line);
      if (!m) continue;
      floats += m[1] === 'mat4x4f' ? 16 : m[1] === 'vec4f' ? 4 : 4 * Number(m[2]);
    }
    expect(floats).toBe(QUAD_UNIFORM_FLOATS);
  });

  it('the track structs are as long as the buffers the CPU fills', () => {
    const code = resolveShader('objects/track_bindings.wgsl');
    const floatsOf = (name: string): number => {
      const body = new RegExp(`struct ${name} \\{([^}]*)\\}`).exec(code);
      expect(body).not.toBeNull();
      return Array.from((body as RegExpExecArray)[1].matchAll(/:\s*vec4f/g)).length * 4;
    };
    expect(floatsOf('TrackU')).toBe(TRACK_UNIFORM_FLOATS);
    expect(floatsOf('GateInfo')).toBe(GATE_FLOATS);
    expect(floatsOf('Flag')).toBe(FLAG_FLOATS);
  });

  it('the paint palettes in the track shader match the CPU lists', () => {
    const code = resolveShader('objects/track_materials.wgsl', kindDefines());
    const palette = (fn: string): number[][] => {
      const body = new RegExp(`fn ${fn}\\(i : u32\\) -> vec3f \\{([\\s\\S]*?)\\n\\}`).exec(code);
      expect(body).not.toBeNull();
      const list = /array<vec3f, \d+>\(([\s\S]*?)\);/.exec((body as RegExpExecArray)[1]);
      expect(list).not.toBeNull();
      return Array.from((list as RegExpExecArray)[1].matchAll(/vec3f\(([^)]*)\)/g), (m) => m[1].split(',').map(Number));
    };
    expect(palette('containerColour')).toEqual(CONTAINER_COLOURS.map((c) => [...c]));
    expect(palette('steelColour')).toEqual(STEEL_COLOURS.map((c) => [...c]));
  });

  it('the track material ids leave 20-33 to the quad and every one has a shader case', () => {
    const code = resolveShader('objects/track_materials.wgsl', kindDefines());
    const quad = new Set(['CARBON', 'ALU', 'PCB', 'BATTERY', 'RUBBER', 'MOTOR_BELL', 'MOTOR_BASE', 'PLASTIC', 'LENS', 'LED', 'PROP', 'WIRE', 'STEEL', 'PROP_HUB']);
    const ids = Object.values(KIND);
    expect(new Set(ids).size).toBe(ids.length);
    for (const [name, id] of Object.entries(KIND)) {
      if (quad.has(name)) continue;
      expect(id < 20 || id > 33, name).toBe(true);
      // Leaves are vegetation; the cloth flag has its own pipeline.
      if (name !== 'LEAVES' && name !== 'CLOTH') expect(code, name).toContain(`case ${id}u:`);
    }
  });

  it('an undefined define is reported instead of reaching the GPU', () => {
    expect(() => resolveShader('objects/quad.wgsl', {})).toThrow(/Undefined WGSL define/);
  });
});
