import type { ObstacleCollider, Quat, TerrainSampler, Vec3 } from '../contracts';
import { G0, quatRotate, quatRotateInv, quatToMat3 } from './math3d';

export interface ProxySphere {
  /** Centre in the body frame (x right, y up, -z forward), m. */
  x: number;
  y: number;
  z: number;
  r: number;
  /** Motor index whose prop strikes the ground through this sphere, or -1. */
  motor: number;
}

export interface CollisionParams {
  spheres: ProxySphere[];
  terrainFriction: number;
  terrainRestitution: number;
  obstacleFriction: number;
  obstacleRestitution: number;
  /** Closing speed above which an impact counts as a crash, m/s. */
  crashSpeed: number;
  /** Extra load torque (Nm) a motor sees while its prop is striking a surface. */
  propStrikeTorque: number;
}

// Cache only a conservative candidate list, never contacts or the exact reach test.
// At 4 kHz the drone normally remains in one 8 m cell for many solver steps.
const BOX_CACHE_CELL = 8;
const BOX_CACHE_MIN = 64;
const BOX_CACHE_LIMIT = 1e12;
const MAX_CONTACTS = 64;
const MAX_SPHERES = 16;
const ITERATIONS = 6;
const SLOP = 0.0004;
const BOUNCE_MIN_SPEED = 0.8;
const TERRAIN_REACH = 0.5;
const PROXY_REACH = 0.2;
const PROP_STRIKE_COS = 0.7;
const REST_V2 = 0.05 * 0.05;
const REST_W2 = 0.3 * 0.3;
// Decay rate (1/s) of the resting-contact damper, applied only while the contacts carry weight so liftoff is not held back
const REST_DAMP_RATE = 1000;
const SUPPORT_MIN = 0.1;
const UP: Vec3 = [0, 1, 0];

/** Sphere-proxy rigid-body contact solver against a terrain height field and oriented-box obstacles. */
export class CollisionWorld {
  terrain: TerrainSampler | null = null;
  /** Deepest closing speed seen in the last resolve() call, m/s (0 if none). */
  impactSpeed = 0;
  onGround = false;
  contactCount = 0;
  /** Prop-strike extra load per motor, Nm, from the last resolve(). */
  readonly motorLoad = new Float64Array(4);

  private readonly p: CollisionParams;
  private readonly ns: number;
  private nBox = 0;
  private boxCandidates = new Int32Array(0);
  private nCandidates = 0;
  private boxCacheDisabled = false;
  private cellX = NaN;
  private cellY = NaN;
  private cellZ = NaN;
  private bx = new Float64Array(0);
  private by = new Float64Array(0);
  private bz = new Float64Array(0);
  private bhx = new Float64Array(0);
  private bhy = new Float64Array(0);
  private bhz = new Float64Array(0);
  private bcos = new Float64Array(0);
  private bsin = new Float64Array(0);
  private bR = new Float64Array(0);
  private readonly cx = new Float64Array(MAX_SPHERES);
  private readonly cy = new Float64Array(MAX_SPHERES);
  private readonly cz = new Float64Array(MAX_SPHERES);
  private readonly sphereR = new Float64Array(MAX_SPHERES);
  private readonly sphereMotor = new Int32Array(MAX_SPHERES);
  private readonly rot = new Float64Array(9);
  private readonly tmpN: Vec3 = [0, 1, 0];
  private readonly tmpV: Vec3 = [0, 0, 0];
  private readonly tmpB: Vec3 = [0, 0, 0];
  private readonly cSphere = new Int32Array(MAX_CONTACTS);
  private readonly nearBox = new Int32Array(32);
  private readonly nB = new Float64Array(3 * MAX_CONTACTS);
  private readonly nW = new Float64Array(3 * MAX_CONTACTS);
  private readonly arm = new Float64Array(3 * MAX_CONTACTS);
  private readonly cPen = new Float64Array(MAX_CONTACTS);
  private readonly cMu = new Float64Array(MAX_CONTACTS);
  private readonly cKn = new Float64Array(MAX_CONTACTS);
  private readonly cBounce = new Float64Array(MAX_CONTACTS);
  private readonly cJn = new Float64Array(MAX_CONTACTS);
  private readonly cJt = new Float64Array(3 * MAX_CONTACTS);
  private nc = 0;
  private prevContact = false;

  constructor(params: CollisionParams) {
    this.p = params;
    this.ns = Math.min(params.spheres.length, MAX_SPHERES);
    for (let i = 0; i < this.ns; i++) {
      const s = params.spheres[i];
      this.cx[i] = s.x;
      this.cy[i] = s.y;
      this.cz[i] = s.z;
      this.sphereR[i] = s.r;
      this.sphereMotor[i] = s.motor;
    }
  }

  setColliders(list: ObstacleCollider[]): void {
    const n = list.length;
    this.nBox = n;
    this.boxCandidates = new Int32Array(n);
    this.nCandidates = 0;
    this.boxCacheDisabled = false;
    this.cellX = this.cellY = this.cellZ = NaN;
    this.bx = new Float64Array(n);
    this.by = new Float64Array(n);
    this.bz = new Float64Array(n);
    this.bhx = new Float64Array(n);
    this.bhy = new Float64Array(n);
    this.bhz = new Float64Array(n);
    this.bcos = new Float64Array(n);
    this.bsin = new Float64Array(n);
    this.bR = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const c = list[i];
      this.bx[i] = c.center[0];
      this.by[i] = c.center[1];
      this.bz[i] = c.center[2];
      this.bhx[i] = c.half[0];
      this.bhy[i] = c.half[1];
      this.bhz[i] = c.half[2];
      this.bcos[i] = Math.cos(c.yaw);
      this.bsin[i] = Math.sin(c.yaw);
      this.bR[i] = Math.hypot(c.half[0], c.half[1], c.half[2]);
    }
  }

  /** Ground height under (x, z); flat ground at y = 0 when there is no terrain. */
  groundHeight(x: number, z: number): number {
    return this.terrain ? this.terrain.heightAt(x, z) : 0;
  }

  private addContact(i: number, nx: number, ny: number, nz: number, pen: number, mu: number, e: number, q: Quat): void {
    if (this.nc >= MAX_CONTACTS) return;
    const k = this.nc++;
    const b = this.tmpB;
    quatRotateInv(q, nx, ny, nz, b);
    const o = 3 * k;
    this.nW[o] = nx;
    this.nW[o + 1] = ny;
    this.nW[o + 2] = nz;
    this.nB[o] = b[0];
    this.nB[o + 1] = b[1];
    this.nB[o + 2] = b[2];
    const r = this.sphereR[i];
    this.arm[o] = this.cx[i] - r * b[0];
    this.arm[o + 1] = this.cy[i] - r * b[1];
    this.arm[o + 2] = this.cz[i] - r * b[2];
    this.cPen[k] = pen;
    this.cMu[k] = mu;
    this.cBounce[k] = e;
    this.cJn[k] = 0;
    this.cJt[o] = 0;
    this.cJt[o + 1] = 0;
    this.cJt[o + 2] = 0;
    this.cSphere[k] = i;
  }


  private gatherNearBoxes(pos: Vec3): number {
    let nNear = 0;
    const x = pos[0], y = pos[1], z = pos[2];
    // Keep the original scan for small lists and unusual coordinates. In particular,
    // NaN, infinities and overflowing squared distances retain their old semantics.
    if (this.boxCacheDisabled || this.nBox < BOX_CACHE_MIN || !(Math.abs(x) <= BOX_CACHE_LIMIT && Math.abs(y) <= BOX_CACHE_LIMIT && Math.abs(z) <= BOX_CACHE_LIMIT)) {
      for (let b = 0; b < this.nBox && nNear < this.nearBox.length; b++) {
        const dx = pos[0] - this.bx[b];
        const dy = pos[1] - this.by[b];
        const dz = pos[2] - this.bz[b];
        const reach = this.bR[b] + PROXY_REACH;
        if (dx * dx + dy * dy + dz * dz < reach * reach) this.nearBox[nNear++] = b;
      }
      return nNear;
    }
    const cellX = Math.floor(x / BOX_CACHE_CELL) * BOX_CACHE_CELL;
    const cellY = Math.floor(y / BOX_CACHE_CELL) * BOX_CACHE_CELL;
    const cellZ = Math.floor(z / BOX_CACHE_CELL) * BOX_CACHE_CELL;
    if (cellX !== this.cellX || cellY !== this.cellY || cellZ !== this.cellZ) {
      this.cellX = cellX;
      this.cellY = cellY;
      this.cellZ = cellZ;
      let n = 0;
      for (let b = 0; b < this.nBox; b++) {
        const bx = this.bx[b], by = this.by[b], bz = this.bz[b];
        const reach = this.bR[b] + PROXY_REACH;
        // A passing sphere test implies each axis distance is less than reach.
        // Every query in this cell is <8 m from its lower corner per axis. Use
        // 16 m padding, leaving ample rounding slack within the bounded range.
        // Large/nonfinite boxes bypass pruning; no giant-box rasterization needed.
        if (!(Math.abs(bx) <= BOX_CACHE_LIMIT && Math.abs(by) <= BOX_CACHE_LIMIT && Math.abs(bz) <= BOX_CACHE_LIMIT && reach <= BOX_CACHE_LIMIT)
          || (Math.abs(cellX - bx) <= reach + 2 * BOX_CACHE_CELL
            && Math.abs(cellY - by) <= reach + 2 * BOX_CACHE_CELL
            && Math.abs(cellZ - bz) <= reach + 2 * BOX_CACHE_CELL)) {
          this.boxCandidates[n++] = b;
          // Highly overlapping sets favor the original early-exit scan. Stop the
          // rebuild rather than repeatedly scanning every box at cell boundaries.
          // Retry caching only when setColliders supplies a new collider set.
          if (n * 2 >= this.nBox) {
            this.boxCacheDisabled = true;
            return this.gatherNearBoxes(pos);
          }
        }
      }
      // Ascending source indices preserve the original first-32 selection and
      // therefore contact/impulse order even when more than 32 boxes are nearby.
      this.nCandidates = n;
    }
    for (let k = 0; k < this.nCandidates && nNear < this.nearBox.length; k++) {
      const b = this.boxCandidates[k];
      const dx = pos[0] - this.bx[b];
      const dy = pos[1] - this.by[b];
      const dz = pos[2] - this.bz[b];
      const reach = this.bR[b] + PROXY_REACH;
      if (dx * dx + dy * dy + dz * dz < reach * reach) this.nearBox[nNear++] = b;
    }
    return nNear;
  }

  private gather(pos: Vec3, q: Quat): void {
    this.nc = 0;
    const R = this.rot;
    quatToMat3(q, R);
    const terrain = this.terrain;
    const nearTerrain = pos[1] - this.groundHeight(pos[0], pos[2]) < TERRAIN_REACH;
    const nNear = this.gatherNearBoxes(pos);
    if (!nearTerrain && nNear === 0) return;
    const n = this.tmpN;
    for (let i = 0; i < this.ns; i++) {
      const cx = this.cx[i], cy = this.cy[i], cz = this.cz[i], r = this.sphereR[i];
      const wx = pos[0] + R[0] * cx + R[1] * cy + R[2] * cz;
      const wy = pos[1] + R[3] * cx + R[4] * cy + R[5] * cz;
      const wz = pos[2] + R[6] * cx + R[7] * cy + R[8] * cz;
      if (nearTerrain) {
        const s = wy - this.groundHeight(wx, wz);
        if (s < 3 * r) {
          // The contract allows a sampler to return its own vector instead of filling `out`
          const nn = terrain ? terrain.normalAt(wx, wz, n) : UP;
          const pen = r - s * nn[1];
          if (pen > 0) this.addContact(i, nn[0], nn[1], nn[2], pen, this.p.terrainFriction, this.p.terrainRestitution, q);
        }
      }
      for (let k = 0; k < nNear; k++) this.sphereBox(i, this.nearBox[k], wx, wy, wz, r, q);
    }
  }

  private sphereBox(i: number, b: number, wx: number, wy: number, wz: number, r: number, q: Quat): void {
    const c = this.bcos[b], s = this.bsin[b];
    const dx = wx - this.bx[b], dy = wy - this.by[b], dz = wz - this.bz[b];
    const lx = c * dx - s * dz, lz = s * dx + c * dz;
    const hx = this.bhx[b], hy = this.bhy[b], hz = this.bhz[b];
    if (Math.abs(lx) > hx + r || Math.abs(dy) > hy + r || Math.abs(lz) > hz + r) return;
    const qx = lx < -hx ? -hx : lx > hx ? hx : lx;
    const qy = dy < -hy ? -hy : dy > hy ? hy : dy;
    const qz = lz < -hz ? -hz : lz > hz ? hz : lz;
    let nx = lx - qx, ny = dy - qy, nz = lz - qz;
    const d2 = nx * nx + ny * ny + nz * nz;
    let pen: number;
    if (d2 > 1e-12) {
      const d = Math.sqrt(d2);
      if (d >= r) return;
      pen = r - d;
      nx /= d;
      ny /= d;
      nz /= d;
    } else {
      const px = hx - Math.abs(lx), py = hy - Math.abs(dy), pz = hz - Math.abs(lz);
      nx = 0;
      ny = 0;
      nz = 0;
      if (px <= py && px <= pz) {
        nx = lx < 0 ? -1 : 1;
        pen = r + px;
      } else if (py <= pz) {
        ny = dy < 0 ? -1 : 1;
        pen = r + py;
      } else {
        nz = lz < 0 ? -1 : 1;
        pen = r + pz;
      }
    }
    const wnx = c * nx + s * nz, wnz = -s * nx + c * nz;
    this.addContact(i, wnx, ny, wnz, pen, this.p.obstacleFriction, this.p.obstacleRestitution, q);
  }

  /**
   * Resolve contacts in place: `vel` is world, `w` is body-frame angular velocity, `invI` the body-frame inverse
   * inertia diagonal. Position is projected out of penetration; velocities receive normal + Coulomb friction impulses.
   */
  resolve(dt: number, invMass: number, invI: Vec3, pos: Vec3, vel: Vec3, q: Quat, w: Vec3): void {
    this.impactSpeed = 0;
    this.motorLoad[0] = this.motorLoad[1] = this.motorLoad[2] = this.motorLoad[3] = 0;
    this.gather(pos, q);
    const nc = this.nc;
    this.contactCount = nc;
    if (nc === 0) {
      this.onGround = this.prevContact;
      this.prevContact = false;
      return;
    }
    this.prevContact = true;
    this.onGround = true;
    const vb = this.tmpB;
    quatRotateInv(q, vel[0], vel[1], vel[2], vb);
    let vx = vb[0], vy = vb[1], vz = vb[2];
    let wx = w[0], wy = w[1], wz = w[2];
    const arm = this.arm, nB = this.nB;
    const ix = invI[0], iy = invI[1], iz = invI[2];
    for (let k = 0; k < nc; k++) {
      const o = 3 * k;
      const ax = arm[o], ay = arm[o + 1], az = arm[o + 2];
      const nx = nB[o], ny = nB[o + 1], nz = nB[o + 2];
      const ux = ay * nz - az * ny, uy = az * nx - ax * nz, uz = ax * ny - ay * nx;
      this.cKn[k] = 1 / (invMass + ix * ux * ux + iy * uy * uy + iz * uz * uz);
      const vcn = (vx + wy * az - wz * ay) * nx + (vy + wz * ax - wx * az) * ny + (vz + wx * ay - wy * ax) * nz;
      const approach = -vcn;
      if (approach > this.impactSpeed) this.impactSpeed = approach;
      const e = this.cBounce[k];
      this.cBounce[k] = approach > BOUNCE_MIN_SPEED ? e * approach : 0;
      const m = this.sphereMotor[this.cSphere[k]];
      if (m >= 0 && ny < PROP_STRIKE_COS) this.motorLoad[m] = this.p.propStrikeTorque;
    }
    for (let it = 0; it < ITERATIONS; it++) {
      for (let k = 0; k < nc; k++) {
        const o = 3 * k;
        const ax = arm[o], ay = arm[o + 1], az = arm[o + 2];
        const nx = nB[o], ny = nB[o + 1], nz = nB[o + 2];
        let cx = vx + wy * az - wz * ay, cy = vy + wz * ax - wx * az, cz = vz + wx * ay - wy * ax;
        const vn = cx * nx + cy * ny + cz * nz;
        let jn = (this.cBounce[k] - vn) * this.cKn[k];
        const acc = this.cJn[k];
        if (acc + jn < 0) jn = -acc;
        this.cJn[k] = acc + jn;
        const ux = ay * nz - az * ny, uy = az * nx - ax * nz, uz = ax * ny - ay * nx;
        vx += jn * nx * invMass;
        vy += jn * ny * invMass;
        vz += jn * nz * invMass;
        wx += ix * ux * jn;
        wy += iy * uy * jn;
        wz += iz * uz * jn;
        cx = vx + wy * az - wz * ay;
        cy = vy + wz * ax - wx * az;
        cz = vz + wx * ay - wy * ax;
        const vnn = cx * nx + cy * ny + cz * nz;
        const tx = cx - vnn * nx, ty = cy - vnn * ny, tz = cz - vnn * nz;
        const tm = Math.sqrt(tx * tx + ty * ty + tz * tz);
        if (tm < 1e-9) continue;
        const dx = tx / tm, dy = ty / tm, dz = tz / tm;
        const px = ay * dz - az * dy, py = az * dx - ax * dz, pz = ax * dy - ay * dx;
        const kt = 1 / (invMass + ix * px * px + iy * py * py + iz * pz * pz);
        let jx = -tm * kt * dx, jy = -tm * kt * dy, jz = -tm * kt * dz;
        const ox = this.cJt[o] + jx, oy = this.cJt[o + 1] + jy, oz = this.cJt[o + 2] + jz;
        const om = Math.sqrt(ox * ox + oy * oy + oz * oz);
        const lim = this.cMu[k] * this.cJn[k];
        const sc = om > lim ? lim / om : 1;
        jx = ox * sc - this.cJt[o];
        jy = oy * sc - this.cJt[o + 1];
        jz = oz * sc - this.cJt[o + 2];
        this.cJt[o] = ox * sc;
        this.cJt[o + 1] = oy * sc;
        this.cJt[o + 2] = oz * sc;
        vx += jx * invMass;
        vy += jy * invMass;
        vz += jz * invMass;
        wx += ix * (ay * jz - az * jy);
        wy += iy * (az * jx - ax * jz);
        wz += iz * (ax * jy - ay * jx);
      }
    }
    this.projectOut(pos);
    const out = this.tmpV;
    quatRotate(q, vx, vy, vz, out);
    vel[0] = out[0];
    vel[1] = out[1];
    vel[2] = out[2];
    w[0] = wx;
    w[1] = wy;
    w[2] = wz;
    let support = 0;
    for (let k = 0; k < nc; k++) support += this.cJn[k];
    if (nc >= 3 && support > (SUPPORT_MIN * G0 * dt) / invMass && vx * vx + vy * vy + vz * vz < REST_V2 && wx * wx + wy * wy + wz * wz < REST_W2) {
      const f = Math.exp(-REST_DAMP_RATE * dt);
      vel[0] *= f;
      vel[1] *= f;
      vel[2] *= f;
      w[0] *= f;
      w[1] *= f;
      w[2] *= f;
    }
  }

  private projectOut(pos: Vec3): void {
    let dx = 0, dy = 0, dz = 0;
    for (let k = 0; k < this.nc; k++) {
      const o = 3 * k;
      const eff = this.cPen[k] - (dx * this.nW[o] + dy * this.nW[o + 1] + dz * this.nW[o + 2]) - SLOP;
      if (eff > 0) {
        dx += eff * this.nW[o];
        dy += eff * this.nW[o + 1];
        dz += eff * this.nW[o + 2];
      }
    }
    pos[0] += dx;
    pos[1] += dy;
    pos[2] += dz;
  }
}
