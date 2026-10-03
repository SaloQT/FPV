import type { FrameInfo, RenderContext, RenderModule, SceneData } from './contracts';

type Hook = 'update' | 'encodePre' | 'encodeGBuffer' | 'encodeRT' | 'encodeSky' | 'encodeForward';
const HOOKS: readonly Hook[] = ['update', 'encodePre', 'encodeGBuffer', 'encodeRT', 'encodeSky', 'encodeForward'];

/**
 * Runs module hooks in array order. An exception in a hook is reported once and disables only that hook of that module
 * for the rest of the session; a module whose init throws is dropped entirely. Frame hooks allocate nothing.
 */
export class ModuleHost {
  private readonly modules: RenderModule[] = [];
  private readonly lists: Record<Hook, RenderModule[]> = { update: [], encodePre: [], encodeGBuffer: [], encodeRT: [], encodeSky: [], encodeForward: [] };
  private readonly reported = new Set<string>();

  constructor(private readonly candidates: readonly RenderModule[], private readonly report: (message: string) => void) {}

  /** True while at least one module still draws the sky (drives FALLBACK_SKY and whether the sky pass is recorded). */
  get drawsSky(): boolean { return this.lists.encodeSky.length > 0; }
  get drawsForward(): boolean { return this.lists.encodeForward.length > 0; }
  /** Only explicitly compatible active overlay hooks may share a resource-usage scope. */
  get sharedOverlayPass(): boolean {
    const sky = this.lists.encodeSky, forward = this.lists.encodeForward;
    for (let i = 0; i < sky.length; i++) if (sky[i].sharedOverlayPass !== true) return false;
    for (let i = 0; i < forward.length; i++) if (forward[i].sharedOverlayPass !== true) return false;
    return true;
  }
  get tracesRays(): boolean { return this.lists.encodeRT.length > 0; }
  get names(): string[] { return this.modules.map((m) => m.name); }

  async init(rc: RenderContext): Promise<void> {
    for (const m of this.candidates) {
      try {
        await m.init(rc);
      } catch (e) {
        this.fail(m, 'init', e);
        continue;
      }
      this.modules.push(m);
      for (const h of HOOKS) if (typeof m[h] === 'function') this.lists[h].push(m);
    }
  }

  resize(rc: RenderContext): void {
    for (const m of this.modules) {
      if (!m.resize) continue;
      try { m.resize(rc); } catch (e) { this.fail(m, 'resize', e); }
    }
  }

  setScene(rc: RenderContext, scene: SceneData): void {
    for (const m of this.modules) {
      if (!m.setScene) continue;
      try { m.setScene(rc, scene); } catch (e) { this.fail(m, 'setScene', e); }
    }
  }

  update(rc: RenderContext, f: FrameInfo): void {
    const list = this.lists.update;
    for (let i = 0; i < list.length; i++) {
      try { list[i].update!(rc, f); } catch (e) { this.disable(list, i--, 'update', e); }
    }
  }

  encodePre(enc: GPUCommandEncoder, rc: RenderContext, f: FrameInfo): void {
    const list = this.lists.encodePre;
    for (let i = 0; i < list.length; i++) {
      try { list[i].encodePre!(enc, rc, f); } catch (e) { this.disable(list, i--, 'encodePre', e); }
    }
  }

  encodeGBuffer(pass: GPURenderPassEncoder, rc: RenderContext, f: FrameInfo): void {
    const list = this.lists.encodeGBuffer;
    for (let i = 0; i < list.length; i++) {
      try { list[i].encodeGBuffer!(pass, rc, f); } catch (e) { this.disable(list, i--, 'encodeGBuffer', e); }
    }
  }

  encodeRT(enc: GPUCommandEncoder, rc: RenderContext, f: FrameInfo): void {
    const list = this.lists.encodeRT;
    for (let i = 0; i < list.length; i++) {
      try { list[i].encodeRT!(enc, rc, f); } catch (e) { this.disable(list, i--, 'encodeRT', e); }
    }
  }

  encodeSky(pass: GPURenderPassEncoder, rc: RenderContext, f: FrameInfo): void {
    const list = this.lists.encodeSky;
    for (let i = 0; i < list.length; i++) {
      try { list[i].encodeSky!(pass, rc, f); } catch (e) { this.disable(list, i--, 'encodeSky', e); }
    }
  }

  encodeForward(pass: GPURenderPassEncoder, rc: RenderContext, f: FrameInfo): void {
    const list = this.lists.encodeForward;
    for (let i = 0; i < list.length; i++) {
      try { list[i].encodeForward!(pass, rc, f); } catch (e) { this.disable(list, i--, 'encodeForward', e); }
    }
  }

  destroy(): void {
    for (const m of this.modules) {
      try { m.destroy?.(); } catch (e) { this.fail(m, 'destroy', e); }
    }
    this.modules.length = 0;
    for (const h of HOOKS) this.lists[h].length = 0;
  }

  private disable(list: RenderModule[], index: number, hook: Hook, e: unknown): void {
    const [m] = list.splice(index, 1);
    this.fail(m, hook, e);
  }

  private fail(m: RenderModule, hook: string, e: unknown): void {
    const key = `${m.name}.${hook}`;
    if (this.reported.has(key)) return;
    this.reported.add(key);
    const detail = e instanceof Error ? (e.stack ?? e.message) : String(e);
    this.report(`render module "${m.name}" hook ${hook} failed and is disabled: ${detail}`);
  }
}
