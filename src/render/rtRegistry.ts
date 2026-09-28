import type { RTPrimitive, RTSceneRegistry } from './contracts';

/**
 * Group registry for analytic RT proxies. A group id lives in exactly one of static/dynamic (setting it in one removes it
 * from the other). The concatenated arrays returned by allStatic()/allDynamic() are cached and reused: treat them as read-only
 * snapshots valid until the next mutation.
 */
export class SceneRegistry implements RTSceneRegistry {
  private readonly statics = new Map<string, RTPrimitive[]>();
  private readonly dynamics = new Map<string, RTPrimitive[]>();
  private staticCache: RTPrimitive[] = [];
  private dynamicCache: RTPrimitive[] = [];
  private staticDirty = false;
  private dynamicDirty = false;
  private ver = 0;
  private staticVer = 0;

  /** Bumps on any change. */
  get version(): number { return this.ver; }
  /** Bumps only when the static set changes (lets the RT module skip a BVH rebuild for per-frame dynamic updates). */
  get staticVersion(): number { return this.staticVer; }

  setStatic(groupId: string, prims: RTPrimitive[]): void {
    if (this.dynamics.delete(groupId)) this.dynamicDirty = true;
    this.statics.set(groupId, prims);
    this.staticDirty = true;
    this.staticVer++;
    this.ver++;
  }

  setDynamic(groupId: string, prims: RTPrimitive[]): void {
    if (this.statics.delete(groupId)) { this.staticDirty = true; this.staticVer++; }
    this.dynamics.set(groupId, prims);
    this.dynamicDirty = true;
    this.ver++;
  }

  remove(groupId: string): void {
    let changed = false;
    if (this.statics.delete(groupId)) { this.staticDirty = true; this.staticVer++; changed = true; }
    if (this.dynamics.delete(groupId)) { this.dynamicDirty = true; changed = true; }
    if (changed) this.ver++;
  }

  clear(): void {
    if (this.statics.size) { this.staticDirty = true; this.staticVer++; }
    if (this.dynamics.size) this.dynamicDirty = true;
    if (this.statics.size || this.dynamics.size) this.ver++;
    this.statics.clear();
    this.dynamics.clear();
  }

  allStatic(): RTPrimitive[] {
    if (this.staticDirty) { this.flatten(this.statics, this.staticCache); this.staticDirty = false; }
    return this.staticCache;
  }

  allDynamic(): RTPrimitive[] {
    if (this.dynamicDirty) { this.flatten(this.dynamics, this.dynamicCache); this.dynamicDirty = false; }
    return this.dynamicCache;
  }

  private flatten(src: Map<string, RTPrimitive[]>, dst: RTPrimitive[]): void {
    let n = 0;
    for (const group of src.values()) for (let i = 0; i < group.length; i++) dst[n++] = group[i];
    dst.length = n;
  }
}
