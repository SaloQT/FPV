import type { ParkData } from '../../world/park/types';
/** World-space light bins shared by direct, GI and probe shading. */
export class ParkLights {
  readonly buffer: GPUBuffer;
  private readonly roots = new Uint32Array([0xffffffff, 0xffffffff]);
  constructor(private readonly device: GPUDevice) {
    this.buffer = device.createBuffer({ label: 'park lights, rooms and spatial bins', size: 4 * 1024 * 1024, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }); this.setScene();
  }
  setScene(park?: ParkData): void {
    const lights = park?.lights ?? [], rooms = park?.rooms ?? [], cells: number[][] = Array.from({ length: 4096 }, () => []);
    lights.forEach((l, i) => {
      const x0 = Math.max(0, Math.floor((l.pos[0] - l.radius + 1024) / 32)), x1 = Math.min(63, Math.floor((l.pos[0] + l.radius + 1024) / 32));
      const z0 = Math.max(0, Math.floor((l.pos[2] - l.radius + 1024) / 32)), z1 = Math.min(63, Math.floor((l.pos[2] + l.radius + 1024) / 32));
      for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) cells[z * 64 + x].push(i);
    });
    const base = 4 + lights.length * 8 + rooms.length * 8, indices = base + 4096 * 4, total = cells.reduce((n, c) => n + c.length, 0);
    const data = new ArrayBuffer((indices + Math.ceil(total / 4) * 4) * 4), f = new Float32Array(data), u = new Uint32Array(data);
    if (data.byteLength > this.buffer.size) throw new Error('Park light spatial index exceeds its buffer');
    u.set([lights.length, rooms.length, 0xffffffff, 0xffffffff]);
    lights.forEach((l, i) => f.set([...l.pos, l.candela, ...l.color, l.radius], 4 + i * 8));
    rooms.forEach((r, i) => f.set([...r.min, 0, ...r.max, 0], 4 + lights.length * 8 + i * 8));
    let offset = 0; cells.forEach((c, i) => { u[base + i * 4] = offset; u[base + i * 4 + 1] = c.length; u.set(c, indices + offset); offset += c.length; });
    this.device.queue.writeBuffer(this.buffer, 0, u);
  }
  setRoots(staticRoot: number, dynamicRoot: number): void { this.roots[0] = staticRoot; this.roots[1] = dynamicRoot; this.device.queue.writeBuffer(this.buffer, 8, this.roots); }
  destroy(): void { this.buffer.destroy(); }
}
