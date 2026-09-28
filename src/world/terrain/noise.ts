/** Deterministic RNG and gradient noise. Nothing in the terrain pipeline may use Math.random. */

export function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

export function smoothstep(a: number, b: number, x: number): number {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}

export function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function mixBits(a: number): number {
  a = Math.imul(a ^ (a >>> 16), 0x85ebca6b);
  a = Math.imul(a ^ (a >>> 13), 0xc2b2ae35);
  return (a ^ (a >>> 16)) >>> 0;
}

/** FNV-1a of a string, used to derive independent streams from one seed. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/** xoshiro128** seeded through a splitmix-style avalanche. State lives in a typed array so hot loops never box doubles. */
export class Rng {
  private readonly s = new Uint32Array(4);

  constructor(seed: number, stream = 0) {
    const lo = seed >>> 0;
    const hi = Math.floor(seed / 4294967296) >>> 0;
    let a = (lo ^ Math.imul(hi, 0x9e3779b1) ^ Math.imul(stream + 1, 0x85ebca6b)) | 0;
    for (let k = 0; k < 4; k++) {
      a = (a + 0x9e3779b9) | 0;
      this.s[k] = mixBits(a);
    }
    if ((this.s[0] | this.s[1] | this.s[2] | this.s[3]) === 0) this.s[0] = 1;
  }

  nextU32(): number {
    const s = this.s;
    const x = Math.imul(s[1], 5);
    const result = Math.imul((x << 7) | (x >>> 25), 9) >>> 0;
    const t = s[1] << 9;
    s[2] ^= s[0];
    s[3] ^= s[1];
    s[1] ^= s[2];
    s[0] ^= s[3];
    s[2] ^= t;
    s[3] = (s[3] << 11) | (s[3] >>> 21);
    return result;
  }

  /** Uniform in [0, 1). */
  next(): number {
    return this.nextU32() * 2.3283064365386963e-10;
  }

  range(a: number, b: number): number {
    return a + (b - a) * this.next();
  }
}

const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;
// Scales the summed corner contributions of unit-length gradients to about [-1, 1].
const SIMPLEX_SCALE = 99.2;

const GRAD_X = new Float64Array(256);
const GRAD_Y = new Float64Array(256);
for (let i = 0; i < 256; i++) {
  GRAD_X[i] = Math.cos((i * 2 * Math.PI) / 256);
  GRAD_Y[i] = Math.sin((i * 2 * Math.PI) / 256);
}

/** 2D simplex noise with a seed-shuffled permutation and 256 evenly spaced unit gradients (no axis-aligned bias). */
export class Noise2D {
  private readonly perm = new Uint8Array(512);

  constructor(seed: number, stream = 0) {
    const rng = new Rng(seed, stream);
    const base = new Uint8Array(256);
    for (let i = 0; i < 256; i++) base[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = (rng.nextU32() >>> 0) % (i + 1);
      const t = base[i];
      base[i] = base[j];
      base[j] = t;
    }
    for (let i = 0; i < 512; i++) this.perm[i] = base[i & 255];
  }

  /** Roughly [-1, 1], correlation length about one unit of x/y. */
  simplex(x: number, y: number): number {
    const perm = this.perm;
    const s = (x + y) * F2;
    const fi = Math.floor(x + s);
    const fj = Math.floor(y + s);
    const t = (fi + fj) * G2;
    const x0 = x - (fi - t);
    const y0 = y - (fj - t);
    const i1 = x0 > y0 ? 1 : 0;
    const j1 = 1 - i1;
    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2;
    const y2 = y0 - 1 + 2 * G2;
    const ii = fi & 255;
    const jj = fj & 255;
    let n = 0;
    let a = 0.5 - x0 * x0 - y0 * y0;
    if (a > 0) {
      const g = perm[ii + perm[jj]];
      a *= a;
      n += a * a * (GRAD_X[g] * x0 + GRAD_Y[g] * y0);
    }
    a = 0.5 - x1 * x1 - y1 * y1;
    if (a > 0) {
      const g = perm[ii + i1 + perm[jj + j1]];
      a *= a;
      n += a * a * (GRAD_X[g] * x1 + GRAD_Y[g] * y1);
    }
    a = 0.5 - x2 * x2 - y2 * y2;
    if (a > 0) {
      const g = perm[ii + 1 + perm[jj + 1]];
      a *= a;
      n += a * a * (GRAD_X[g] * x2 + GRAD_Y[g] * y2);
    }
    return SIMPLEX_SCALE * n;
  }
}

/** FNV-1a over the raw bits of a float array; identical arrays give identical hashes. */
export function hashFloats(a: Float32Array): number {
  const u = new Uint32Array(a.buffer, a.byteOffset, a.length);
  let h = 0x811c9dc5;
  for (let i = 0; i < u.length; i++) h = Math.imul(h ^ u[i], 0x01000193);
  return h >>> 0;
}
