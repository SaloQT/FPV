import { describe, expect, it } from 'vitest';
import type { GateKind, ObstacleKind } from '../../contracts';
import { checkMesh } from '../../render/objects/meshCheck';
import { RT_PRIM_CAP, buildTrackProxies } from '../../render/objects/trackProxies';
import { buildTrackMesh } from '../../render/objects/trackMesh';
import { trackColliders } from '../../world/track/colliders';
import { makeDevScene } from './scene';

describe('dev object yard', () => {
  const dev = makeDevScene('row', 1, 1.5);
  const track = dev.scene.track!;

  it('lines up every gate kind and every obstacle kind', () => {
    const gates: GateKind[] = ['square', 'arch', 'hoop', 'dive', 'flag', 'start', 'finish', 'window', 'ladder', 'tunnel', 'hurdle', 'drop'];
    const obstacles: ObstacleKind[] = ['pole', 'cone', 'tree', 'rock', 'wall', 'flagpole', 'tower', 'container', 'pillar', 'beam', 'bridge', 'scaffold'];
    for (const k of gates) expect(track.gates.some((g) => g.kind === k), k).toBe(true);
    for (const k of obstacles) expect(track.obstacles.some((o) => o.kind === k), k).toBe(true);
    track.gates.forEach((g, i) => expect(g.index).toBe(i));
    expect(dev.gates).toBe(track.gates.length);
  });

  it('builds a sound mesh, finite colliders and RT proxies under the cap', () => {
    const built = buildTrackMesh(track, dev.scene.sampler);
    checkMesh(built.mesh);
    expect(built.strips.length).toBeGreaterThan(track.gates.length * 2);
    for (const b of trackColliders(track, dev.scene.sampler)) expect([...b.center, ...b.half, b.yaw].every(Number.isFinite)).toBe(true);
    expect(buildTrackProxies(track, dev.scene.sampler).length).toBeLessThanOrEqual(RT_PRIM_CAP);
  });
});
