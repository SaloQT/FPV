import { describe, expect, it } from 'vitest';
import type { RTMaterial, RTPrimitive } from './contracts';
import { SceneRegistry } from './rtRegistry';

const mat: RTMaterial = { albedo: [0.5, 0.5, 0.5], roughness: 0.5, metalness: 0 };
const sphere = (x: number): RTPrimitive => ({ type: 'sphere', center: [x, 0, 0], radius: 1, material: mat });

describe('SceneRegistry', () => {
  it('starts empty at version 0', () => {
    const r = new SceneRegistry();
    expect(r.version).toBe(0);
    expect(r.allStatic()).toEqual([]);
    expect(r.allDynamic()).toEqual([]);
  });

  it('concatenates groups in insertion order and bumps the version on every change', () => {
    const r = new SceneRegistry();
    r.setStatic('gates', [sphere(1), sphere(2)]);
    r.setStatic('trees', [sphere(3)]);
    expect(r.version).toBe(2);
    expect(r.allStatic().map((p) => (p as { center: number[] }).center[0])).toEqual([1, 2, 3]);
    r.setStatic('gates', [sphere(9)]);
    expect(r.version).toBe(3);
    expect(r.allStatic().map((p) => (p as { center: number[] }).center[0])).toEqual([9, 3]);
    r.remove('trees');
    expect(r.version).toBe(4);
    expect(r.allStatic().length).toBe(1);
  });

  it('keeps static and dynamic sets separate and bumps staticVersion only for static changes', () => {
    const r = new SceneRegistry();
    r.setStatic('rocks', [sphere(1)]);
    const sv = r.staticVersion;
    r.setDynamic('quad', [sphere(5)]);
    r.setDynamic('quad', [sphere(6)]);
    expect(r.staticVersion).toBe(sv);
    expect(r.version).toBe(3);
    expect(r.allDynamic().length).toBe(1);
    expect((r.allDynamic()[0] as { center: number[] }).center[0]).toBe(6);
    expect(r.allStatic().length).toBe(1);
  });

  it('moves a group id between static and dynamic instead of duplicating it', () => {
    const r = new SceneRegistry();
    r.setStatic('thing', [sphere(1)]);
    r.setDynamic('thing', [sphere(2)]);
    expect(r.allStatic().length).toBe(0);
    expect(r.allDynamic().length).toBe(1);
    r.setStatic('thing', [sphere(3)]);
    expect(r.allStatic().length).toBe(1);
    expect(r.allDynamic().length).toBe(0);
  });

  it('remove of an unknown id is a no-op and does not bump the version', () => {
    const r = new SceneRegistry();
    r.setStatic('a', [sphere(1)]);
    const v = r.version;
    r.remove('nope');
    expect(r.version).toBe(v);
  });

  it('returns a cached array while unchanged and a fresh view of contents after change', () => {
    const r = new SceneRegistry();
    r.setStatic('a', [sphere(1)]);
    const first = r.allStatic();
    expect(r.allStatic()).toBe(first);
    r.setStatic('b', [sphere(2)]);
    expect(r.allStatic().length).toBe(2);
  });

  it('clear drops everything and bumps the version once', () => {
    const r = new SceneRegistry();
    r.setStatic('a', [sphere(1)]);
    r.setDynamic('b', [sphere(2)]);
    const v = r.version;
    r.clear();
    expect(r.version).toBe(v + 1);
    expect(r.allStatic().length + r.allDynamic().length).toBe(0);
  });
});
