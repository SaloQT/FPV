/** Screen-space (RT resolution) textures owned by the RT module. Everything is created zeroed, which reads as "no history". */
export interface Img { texture: GPUTexture; view: GPUTextureView }

/** Temporal state of one denoised signal: accumulated value (rgba16f) and moments (m1, m2, history length, variance), both ping-ponged. */
export interface History { hist: [Img, Img]; mom: [Img, Img] }

const BYTES_PER_TEXEL = { r32float: 4, rg32float: 8, rgba16float: 8 } as const;

export class RtTextures {
  readonly auxDepth: [Img, Img];
  readonly auxNormal: [Img, Img];
  /** Raw trace output (out0 / out1 of the trace passes). */
  readonly raw0: Img;
  readonly raw1: Img;
  /** A-trous ping-pong between the temporal output and the G-buffer target. */
  readonly tmpA: Img;
  readonly tmpB: Img;
  readonly shadow: History;
  readonly gi: History;
  spec: History | null = null;
  giHits: [Img, Img] | null = null;
  giVisibility: [Img, Img] | null = null;
  /**
   * Per-texel a-trous scratch (one f32 per RT texel): the neighbourhood moment sum, which every iteration of a signal would otherwise
   * recompute from the same moments texture. A f32 buffer round-trips a f32 value bit-exactly, so the later iterations read back exactly
   * what they would have recomputed. A buffer, so it is not counted in `bytes`.
   */
  readonly varSum: GPUBuffer;
  bytes = 0;
  private readonly all: GPUTexture[] = [];

  constructor(private readonly device: GPUDevice, readonly width: number, readonly height: number) {
    this.auxDepth = [this.make('rt depth 0', 'r32float'), this.make('rt depth 1', 'r32float')];
    this.auxNormal = [this.make('rt normal 0', 'rgba16float'), this.make('rt normal 1', 'rgba16float')];
    this.raw0 = this.make('rt raw 0', 'rgba16float');
    this.raw1 = this.make('rt raw 1', 'rgba16float');
    this.tmpA = this.make('rt tmp A', 'rgba16float');
    this.tmpB = this.make('rt tmp B', 'rgba16float');
    this.shadow = this.history('shadow');
    this.gi = this.history('gi');
    this.varSum = device.createBuffer({ label: 'rt a-trous variance', size: this.width * this.height * 4, usage: GPUBufferUsage.STORAGE });
  }

  /** The specular history is only allocated once the quality tier asks for it. */
  ensureSpec(): History {
    return (this.spec ??= this.history('spec'));
  }

  ensureGiHits(): [Img, Img] {
    return (this.giHits ??= [this.make('rt gi hit 0', 'rg32float'), this.make('rt gi hit 1', 'rg32float')]);
  }

  ensureGiVisibility(): [Img, Img] {
    return (this.giVisibility ??= [this.make('rt gi visibility 0', 'r32float'), this.make('rt gi visibility 1', 'r32float')]);
  }

  private history(name: string): History {
    const pair = (what: string): [Img, Img] => [this.make(`rt ${name} ${what} 0`, 'rgba16float'), this.make(`rt ${name} ${what} 1`, 'rgba16float')];
    return { hist: pair('history'), mom: pair('moments') };
  }

  private make(label: string, format: keyof typeof BYTES_PER_TEXEL): Img {
    const U = GPUTextureUsage;
    const texture = this.device.createTexture({ label, format, size: [this.width, this.height], usage: U.STORAGE_BINDING | U.TEXTURE_BINDING | U.COPY_SRC });
    this.all.push(texture);
    this.bytes += this.width * this.height * BYTES_PER_TEXEL[format];
    return { texture, view: texture.createView() };
  }

  destroy(): void {
    for (const t of this.all) t.destroy();
    this.all.length = 0;
    this.varSum.destroy();
  }
}
