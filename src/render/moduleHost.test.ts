import { describe, expect, it } from 'vitest';
import type { FrameInfo, RenderContext, RenderModule } from './contracts';
import { ModuleHost } from './moduleHost';

const rc = {} as RenderContext;
const frame = {} as FrameInfo;
const enc = {} as GPUCommandEncoder;

function host(mods: RenderModule[]) {
  const reports: string[] = [];
  return { h: new ModuleHost(mods, (m) => reports.push(m)), reports };
}

describe('ModuleHost', () => {
  it('calls hooks in array order', async () => {
    const log: string[] = [];
    const mk = (name: string): RenderModule => ({ name, init: () => { log.push(`init ${name}`); }, encodePre: () => { log.push(`pre ${name}`); } });
    const { h } = host([mk('a'), mk('b'), mk('c')]);
    await h.init(rc);
    h.encodePre(enc, rc, frame);
    expect(log).toEqual(['init a', 'init b', 'init c', 'pre a', 'pre b', 'pre c']);
  });

  it('a throwing hook is reported once and disables only that hook of that module', async () => {
    let updates = 0, pres = 0, sibling = 0;
    const bad: RenderModule = {
      name: 'bad', init: () => {},
      update: () => { updates++; throw new Error('boom'); },
      encodePre: () => { pres++; },
    };
    const good: RenderModule = { name: 'good', init: () => {}, update: () => { sibling++; } };
    const { h, reports } = host([bad, good]);
    await h.init(rc);
    for (let i = 0; i < 5; i++) { h.update(rc, frame); h.encodePre(enc, rc, frame); }
    expect(updates).toBe(1);
    expect(pres).toBe(5);
    expect(sibling).toBe(5);
    expect(reports.length).toBe(1);
    expect(reports[0]).toContain('bad');
    expect(reports[0]).toContain('update');
  });

  it('keeps calling later modules in the same frame after one throws', async () => {
    const order: string[] = [];
    const a: RenderModule = { name: 'a', init: () => {}, encodeRT: () => { order.push('a'); throw new Error('x'); } };
    const b: RenderModule = { name: 'b', init: () => {}, encodeRT: () => { order.push('b'); } };
    const c: RenderModule = { name: 'c', init: () => {}, encodeRT: () => { order.push('c'); } };
    const { h } = host([a, b, c]);
    await h.init(rc);
    h.encodeRT(enc, rc, frame);
    h.encodeRT(enc, rc, frame);
    expect(order).toEqual(['a', 'b', 'c', 'b', 'c']);
  });

  it('drops a module whose init throws (sync or async) without touching the others', async () => {
    let ran = 0;
    const a: RenderModule = { name: 'a', init: () => { throw new Error('sync'); }, update: () => { ran += 100; } };
    const b: RenderModule = { name: 'b', init: async () => { throw new Error('async'); }, update: () => { ran += 100; } };
    const c: RenderModule = { name: 'c', init: () => {}, update: () => { ran++; } };
    const { h, reports } = host([a, b, c]);
    await h.init(rc);
    h.update(rc, frame);
    expect(ran).toBe(1);
    expect(reports.length).toBe(2);
    expect(h.names).toEqual(['c']);
  });

  it('drawsSky tracks whether an encodeSky hook is still enabled', async () => {
    const sky: RenderModule = { name: 'sky', init: () => {}, encodeSky: () => { throw new Error('bad'); } };
    const { h } = host([sky, { name: 'plain', init: () => {} }]);
    await h.init(rc);
    expect(h.drawsSky).toBe(true);
    h.encodeSky({} as GPURenderPassEncoder, rc, frame);
    expect(h.drawsSky).toBe(false);
  });
});
