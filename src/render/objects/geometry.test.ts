import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../../contracts';
import { plate } from './extrude';
import { MeshBuilder, VERTEX_FLOATS, affineFromBasis, affineRotY, affineTranslate } from './meshBuilder';
import { checkMesh } from './meshCheck';
import { bevelBox, ellipsoid, lathe, surface } from './primitives';
import { bar, circleSection, rectSection, sweep } from './sweep';

describe('primitives', () => {
  it('bevelBox is closed, outward wound and loses only the chamfer volume', () => {
    const b = new MeshBuilder();
    bevelBox(b, [0.1, 0.2, -0.3], [0.5, 0.3, 0.2], 0.05);
    const r = checkMesh(b.finish(), true);
    const box = 8 * 0.5 * 0.3 * 0.2;
    expect(r.volume).toBeLessThan(box);
    expect(r.volume).toBeGreaterThan(box * 0.9);
  });

  it('plain bevelBox equals the box volume', () => {
    const b = new MeshBuilder();
    bevelBox(b, [0, 0, 0], [0.5, 0.25, 0.1], 0);
    expect(checkMesh(b.finish(), true).volume).toBeCloseTo(8 * 0.5 * 0.25 * 0.1, 6);
  });

  it('lathe cylinder is closed with outward normals', () => {
    const b = new MeshBuilder();
    lathe(b, [[0, 0], [0.2, 0], [0.2, 1], [0, 1]], 48);
    const r = checkMesh(b.finish(), true);
    expect(r.volume).toBeCloseTo(Math.PI * 0.04, 1);
  });

  it('lathe smooths gentle profile turns and keeps creases', () => {
    const smooth = new MeshBuilder();
    lathe(smooth, [[0.1, 0], [0.11, 0.5], [0.1, 1]], 8);
    const crease = new MeshBuilder();
    lathe(crease, [[0.1, 0], [0.3, 0.5], [0.1, 1]], 8);
    expect(smooth.vertexCount).toBe(3 * 9);
    expect(crease.vertexCount).toBe(4 * 9);
  });

  it('ellipsoid volume approaches 4/3 pi abc', () => {
    const b = new MeshBuilder();
    ellipsoid(b, [0, 0, 0], [1, 0.5, 0.75], 48, 24);
    const r = checkMesh(b.finish(), true);
    expect(r.volume / ((4 / 3) * Math.PI * 0.375)).toBeGreaterThan(0.97);
  });

  it('surface grid normals face the side of the right-hand rule', () => {
    const b = new MeshBuilder();
    surface(b, (u, v): Vec3 => [u, 0, -v], 4, 4);
    const m = b.finish();
    checkMesh(m);
    expect(m.vertices[4]).toBeCloseTo(1, 6);
  });
});

describe('sweep and plate', () => {
  it('a capped bar is a closed prism of the right volume', () => {
    const b = new MeshBuilder();
    bar(b, [0, 0, 0], [2, 0, 0], rectSection(0.06, 0.04, 0.005), { up: [0, 1, 0], capStart: true, capEnd: true });
    const r = checkMesh(b.finish(), true);
    expect(r.volume).toBeCloseTo(2 * (0.06 * 0.04 - 4 * 0.005 * 0.005 * 0.5), 6);
  });

  it('a closed ring sweeps a torus', () => {
    const b = new MeshBuilder();
    const path: Vec3[] = [];
    for (let i = 0; i <= 64; i++) path.push([Math.cos((i / 64) * Math.PI * 2) * 0.5, Math.sin((i / 64) * Math.PI * 2) * 0.5, 0]);
    sweep(b, path, circleSection(0.02, 12), { up: [0, 0, 1] });
    const r = checkMesh(b.finish(), true);
    expect(r.volume / (2 * Math.PI * 0.5 * Math.PI * 0.0004)).toBeGreaterThan(0.95);
  });

  it('plate with holes keeps the walls outward on both loops', () => {
    const b = new MeshBuilder();
    const hole = Array.from({ length: 12 }, (_, i) => [0.3 + 0.1 * Math.cos((i / 12) * 6.283), 0.1 * Math.sin((i / 12) * 6.283)] as [number, number]);
    plate(b, [[-1, -0.5], [1, -0.5], [1, 0.5], [-1, 0.5]], [hole], 0, 0.01);
    const r = checkMesh(b.finish(), true);
    const holeArea = 0.5 * 12 * 0.1 * 0.1 * Math.sin(Math.PI / 6);
    expect(r.volume).toBeCloseTo((2 - holeArea) * 0.01, 6);
  });

  const rect: [number, number][] = [[-1, -0.5], [1, -0.5], [1, 0.5], [-1, 0.5]];
  // Cutting a 45 degree chamfer c off every top edge of an a by b prism removes c^2 (a + b) - 4 c^3 / 3.
  const chamferLoss = (c: number): number => c * c * 3 - (4 * c * c * c) / 3;

  it('a chamfered plate loses exactly the bevel volume on each face', () => {
    const c = 0.01;
    const flat = 2 * 0.05;
    const both = new MeshBuilder();
    plate(both, rect, [], 0, 0.05, { chamfer: c });
    expect(checkMesh(both.finish(), true).volume).toBeCloseTo(flat - 2 * chamferLoss(c), 8);
    const top = new MeshBuilder();
    plate(top, rect, [], 0, 0.05, { chamfer: c, noBottom: true });
    expect(checkMesh(top.finish(), true).volume).toBeCloseTo(flat - chamferLoss(c), 8);
  });

  it('a chamfer keeps hole walls outward and only adds faces', () => {
    const hole = Array.from({ length: 16 }, (_, i) => [0.4 * Math.cos((i / 16) * 6.283), 0.15 * Math.sin((i / 16) * 6.283)] as [number, number]);
    const plain = new MeshBuilder();
    plate(plain, rect, [hole], 0, 0.05);
    const cut = new MeshBuilder();
    plate(cut, rect, [hole], 0, 0.05, { chamfer: 0.008 });
    const a = checkMesh(plain.finish(), true);
    const b = checkMesh(cut.finish(), true);
    expect(b.volume).toBeLessThan(a.volume);
    expect(b.triangles).toBeGreaterThan(a.triangles);
  });

  it('wallKind only recolours the side walls', () => {
    const b = new MeshBuilder();
    b.kind = 5;
    plate(b, rect, [], 0, 0.05, { wallKind: 9 });
    const m = b.finish();
    const kinds = new Set<number>();
    for (let i = 0; i < m.vertices.length; i += VERTEX_FLOATS) kinds.add(m.vertices[i + 8]);
    expect(Array.from(kinds).sort()).toEqual([5, 9]);
    expect(b.kind).toBe(5);
  });
});

describe('MeshBuilder', () => {
  it('transform stack moves and rotates vertices', () => {
    const b = new MeshBuilder();
    b.push(affineTranslate(1, 2, 3));
    b.push(affineRotY(Math.PI / 2));
    bevelBox(b, [0, 0, 0], [0.1, 0.1, 0.1]);
    b.pop();
    b.pop();
    const m = b.finish();
    expect(checkMesh(m, true).volume).toBeCloseTo(0.008, 6);
    expect(m.vertices[0]).toBeGreaterThan(0.8);
  });

  it('a mirrored basis still produces outward-wound triangles', () => {
    const b = new MeshBuilder();
    b.push(affineFromBasis([-1, 0, 0], [0, 1, 0], [0, 0, 1], [0.5, 0, 0]));
    bevelBox(b, [0.2, 0, 0], [0.1, 0.05, 0.05], 0.01);
    b.pop();
    const m = b.finish();
    checkMesh(m, true);
    expect(m.vertices[0]).toBeLessThan(0.5);
  });

  it('pop without push throws', () => {
    expect(() => new MeshBuilder().pop()).toThrow();
  });
});
