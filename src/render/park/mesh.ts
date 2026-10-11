import { GUEST_SEAT_Y } from '../../world/park/guestPose';
/** Unit meshes, shared by all physical parts. Guest joints remain procedural in the vertex shader. */
export function parkMesh(shape: 'box' | 'cylinder' | 'sphere' | 'cone' | 'gable' | 'guest' | 'guestHero', sides = 12): Float32Array {
  const v: number[] = [];
  const tri = (a: number[], b: number[], c: number[], na: number[], nb = na, nc = na, joint = 0) => {
    const ab = b.map((x, i) => x - a[i]), ac = c.map((x, i) => x - a[i]);
    if ((ab[1] * ac[2] - ab[2] * ac[1]) * na[0] + (ab[2] * ac[0] - ab[0] * ac[2]) * na[1] + (ab[0] * ac[1] - ab[1] * ac[0]) * na[2] < 0) { [b, c] = [c, b]; [nb, nc] = [nc, nb]; }
    for (const [p, n] of [[a, na], [b, nb], [c, nc]]) v.push(...p, ...n, joint);
  };
  const box = (origin: number[], half: number[], joint = 0) => {
    for (let axis = 0; axis < 3; axis++) for (const sign of [-1, 1]) {
      const p: number[][] = [], u = (axis + 1) % 3, w = (axis + 2) % 3, n = [0, 0, 0]; n[axis] = sign;
      for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { const x = [...origin]; x[axis] += sign * half[axis]; x[u] += a * half[u]; x[w] += b * half[w]; p.push(x); }
      tri(p[0], p[1], p[2], n, n, n, joint); tri(p[0], p[2], p[3], n, n, n, joint);
    }
  };
  const sphere = (origin: number[], half: number[], joint = 0, segments = sides) => {
    const rings = Math.max(4, segments / 2);
    const sample = (a: number, b: number) => { const n = [Math.cos(a) * Math.sin(b), Math.cos(b), Math.sin(a) * Math.sin(b)], normal = n.map((x, k) => x / half[k]), length = Math.hypot(...normal); return { p: n.map((x, k) => origin[k] + x * half[k]), n: normal.map(x => x / length) }; };
    for (let r = 0; r < rings; r++) for (let i = 0; i < segments; i++) {
      const a = sample(i * 2 * Math.PI / segments, r * Math.PI / rings), b = sample((i + 1) * 2 * Math.PI / segments, r * Math.PI / rings), c = sample((i + 1) * 2 * Math.PI / segments, (r + 1) * Math.PI / rings), d = sample(i * 2 * Math.PI / segments, (r + 1) * Math.PI / rings);
      tri(a.p, b.p, c.p, a.n, b.n, c.n, joint); tri(a.p, c.p, d.p, a.n, c.n, d.n, joint);
    }
  };
  if (shape === 'box') box([0, 0, 0], [1, 1, 1]);
  if (shape === 'gable') {
    // The exact five-plane triangular prism shared with collision and ray tracing.
    const corners = [[-1, -1], [1, -1], [0, 1]];
    for (const z of [-1, 1]) tri([...corners[0], z], [...corners[1], z], [...corners[2], z], [0, 0, z]);
    for (let i = 0; i < 3; i++) {
      const a = corners[i], b = corners[(i + 1) % 3], n = [b[1] - a[1], a[0] - b[0], 0], len = Math.hypot(...n);
      for (let k = 0; k < 3; k++) n[k] /= len;
      tri([...a, -1], [...b, -1], [...b, 1], n); tri([...a, -1], [...b, 1], [...a, 1], n);
    }
  }
  if (shape === 'sphere') sphere([0, 0, 0], [1, 1, 1]);
  if (shape === 'cylinder') for (let i = 0; i < sides; i++) {
    const a = i * Math.PI * 2 / sides, b = (i + 1) * Math.PI * 2 / sides, na = [Math.cos(a), 0, Math.sin(a)], nb = [Math.cos(b), 0, Math.sin(b)];
    const p = [na[0], -1, na[2]], q = [nb[0], -1, nb[2]], r = [nb[0], 1, nb[2]], s = [na[0], 1, na[2]];
    tri(p, q, r, na, nb, nb); tri(p, r, s, na, nb, na); tri([0, -1, 0], q, p, [0, -1, 0]); tri([0, 1, 0], s, r, [0, 1, 0]);
  }
  if (shape === 'cone') for (let i = 0; i < sides; i++) {
    const a = i * Math.PI * 2 / sides, b = (i + 1) * Math.PI * 2 / sides, k = 1 / Math.sqrt(1.25);
    const na = [Math.cos(a) * k, 0.5 * k, Math.sin(a) * k], nb = [Math.cos(b) * k, 0.5 * k, Math.sin(b) * k];
    const p = [Math.cos(a), -1, Math.sin(a)], q = [Math.cos(b), -1, Math.sin(b)];
    tri(p, q, [0, 1, 0], na, nb, [Math.cos((a + b) / 2) * k, 0.5 * k, Math.sin((a + b) / 2) * k]); tri([0, -1, 0], q, p, [0, -1, 0]);
  }
  if (shape === 'guest' || shape === 'guestHero') {
    const hero = shape === 'guestHero', near = hero || sides > 6, bodySides = hero ? 16 : near ? 10 : 6, limbSides = hero ? 12 : near ? 8 : 4;
    // jointf packs a skeletal joint, a clothing material, and the second bone's skin weight.
    const code = (joint: number, material: number, blend = 1) => joint + material * 16 + blend * 0.5;
    type Ring = [y: number, xRadius: number, zRadius: number, x: number, z: number, joint: number];
    const profile = (inputRings: Ring[], segments: number, caps = true) => {
      const rings: Ring[] = [];
      for (let r = 0; r < inputRings.length; r++) {
        const a = inputRings[r]; rings.push(a);
        if (!hero || inputRings.length < 3 || inputRings.length > 6 || r === inputRings.length - 1) continue;
        const b = inputRings[r + 1], previous = inputRings[Math.max(0, r - 1)], next = inputRings[Math.min(inputRings.length - 1, r + 2)], mid = [...a] as Ring;
        mid[0] = (a[0] + b[0]) / 2;
        for (let k = 1; k <= 4; k++) mid[k] = (a[k] + b[k]) / 2 + (b[0] - a[0]) * 0.125 * ((b[k] - previous[k]) / (b[0] - previous[0]) - (next[k] - a[k]) / (next[0] - a[0]));
        mid[1] = Math.max(0.001, mid[1]); mid[2] = Math.max(0.001, mid[2]);
        const aj = Math.floor(a[5]) % 16, bj = Math.floor(b[5]) % 16;
        const parent = (joint: number) => joint >= 10 ? joint - 8 : joint >= 6 ? joint - 2 : -1;
        const child = parent(aj) === bj ? aj : parent(bj) === aj ? bj : -1;
        mid[5] = child < 0 ? (a[5] + b[5]) / 2 : code(child, Math.floor(a[5] / 16), ((aj === child ? (a[5] % 1) * 2 : 0) + (bj === child ? (b[5] % 1) * 2 : 0)) / 2);
        rings.push(mid);
      }
      const sample = (r: number, i: number) => {
        const a = i * 2 * Math.PI / segments, ring = rings[r], before = rings[Math.max(0, r - 1)], after = rings[Math.min(rings.length - 1, r + 1)];
        const dy = after[0] - before[0] || 1, cos = Math.cos(a), sin = Math.sin(a);
        const nx = cos / ring[1], nz = sin / ring[2];
        const ny = -(nx * ((after[3] - before[3]) + cos * (after[1] - before[1])) + nz * ((after[4] - before[4]) + sin * (after[2] - before[2]))) / dy;
        const inv = 1 / Math.hypot(nx, ny, nz);
        return { p: [ring[3] + cos * ring[1], ring[0], ring[4] + sin * ring[2]], n: [nx * inv, ny * inv, nz * inv], joint: ring[5] };
      };
      // Unlike stacked primitives, every ring is shared by its adjoining limb segments.
      for (let r = 0; r < rings.length - 1; r++) for (let i = 0; i < segments; i++) {
        const a = sample(r, i), b = sample(r, i + 1), c = sample(r + 1, i + 1), d = sample(r + 1, i);
        const emit = (points: typeof a[]) => {
          const [a, b, c] = points, ab = b.p.map((x, k) => x - a.p[k]), ac = c.p.map((x, k) => x - a.p[k]);
          if ((ab[1] * ac[2] - ab[2] * ac[1]) * a.n[0] + (ab[2] * ac[0] - ab[0] * ac[2]) * a.n[1] + (ab[0] * ac[1] - ab[1] * ac[0]) * a.n[2] < 0) [points[1], points[2]] = [points[2], points[1]];
          for (const point of points) v.push(...point.p, ...point.n, point.joint);
        };
        emit([a, b, c]); emit([a, c, d]);
      }
      if (caps) for (const r of [0, rings.length - 1]) for (let i = 0; i < segments; i++) {
        const a = sample(r, i), b = sample(r, i + 1), ring = rings[r];
        tri([ring[3], ring[0], ring[4]], a.p, b.p, [0, r === 0 ? -1 : 1, 0], undefined, undefined, ring[5]);
      }
    };
    const shirt = code(0, 0), skin = code(1, 1), pants = code(0, 2);
    // The pelvis ends on the seat surface: the lowest seated point of the thighs, so a seated body rests on the cushion instead of sinking into it.
    if (near) profile([[GUEST_SEAT_Y, 0.09, 0.058, 0, 0.01, pants], [0.55, 0.109, 0.074, 0, 0, pants]], bodySides);
    profile([[0.52, 0.116, 0.077, 0, 0, shirt], [0.63, 0.106, 0.068, 0, 0, shirt], [0.765, 0.137, 0.073, 0, 0, shirt], [0.81, 0.119, 0.061, 0, 0, shirt], [0.837, 0.042, 0.04, 0, 0, shirt]], bodySides);
    if (near) profile([[0.818, 0.031, 0.032, 0, 0, skin], [0.881, 0.034, 0.034, 0, 0, skin]], 8);
    profile(hero ? [[0.865, 0.018, 0.024, 0, -0.013, skin], [0.875, 0.034, 0.038, 0, -0.01, skin], [0.891, 0.047, 0.047, 0, -0.005, skin], [0.908, 0.052, 0.053, 0, -0.001, skin], [0.927, 0.059, 0.06, 0, 0.001, skin], [0.945, 0.059, 0.061, 0, 0.002, skin], [0.959, 0.057, 0.06, 0, 0.003, skin], [0.975, 0.05, 0.056, 0, 0.004, skin], [0.99, 0.037, 0.044, 0, 0.005, skin], [0.999, 0.016, 0.027, 0, 0.007, skin]] : near ? [[0.865, 0.034, 0.038, 0, -0.008, skin], [0.885, 0.05, 0.057, 0, -0.006, skin], [0.937, 0.058, 0.063, 0, 0, skin], [0.975, 0.05, 0.056, 0, 0.004, skin], [0.994, 0.02, 0.029, 0, 0.004, skin]] : [[0.83, 0.03, 0.033, 0, -0.004, skin], [0.93, 0.058, 0.062, 0, 0, skin], [0.965, 0.052, 0.059, 0, 0.005, code(1, 4)], [1, 0.022, 0.03, 0, 0.007, code(1, 4)]], hero ? 24 : near ? 10 : 6);
    for (const side of [-1, 1]) {
      const arm = side < 0 ? 2 : 3, forearm = side < 0 ? 10 : 11, thigh = side < 0 ? 4 : 5, shin = side < 0 ? 6 : 7, foot = side < 0 ? 8 : 9;
      // Shirts overlap the shoulder attachment; the arm surface tapers continuously through its elbow.
      if (near) {
        profile(hero ? [[0.685, 0.037, 0.043, side * 0.149, 0, code(arm, 0)], [0.735, 0.045, 0.05, side * 0.144, 0, code(arm, 0)], [0.779, 0.043, 0.05, side * 0.128, 0, code(arm, 0)], [0.806, 0.027, 0.036, side * 0.108, 0, code(arm, 0)], [0.81, 0.008, 0.018, side * 0.09, 0, code(arm, 0)]] : [[0.685, 0.038, 0.043, side * 0.149, 0, code(arm, 0)], [0.767, 0.049, 0.052, side * 0.143, 0, code(arm, 0)], [0.8, 0.027, 0.034, side * 0.127, 0, code(arm, 0)]], limbSides);
        const armRings: Ring[] = [[0.446, 0.025, 0.018, side * 0.17, -0.002, code(forearm, 1)], [0.48, 0.023, 0.024, side * 0.171, 0, code(forearm, 1)], [0.57, 0.03, 0.032, side * 0.168, 0, code(forearm, 1)], [0.615, 0.03, 0.032, side * 0.161, 0, code(forearm, 1, 0.5)], [0.7, 0.032, 0.038, side * 0.15, 0, code(arm, 1)]];
        if (hero) { armRings.unshift([0.402, 0.014, 0.009, side * 0.17, -0.007, code(forearm, 1)], [0.424, 0.025, 0.014, side * 0.17, -0.004, code(forearm, 1)]); sphere([side * 0.148, 0.443, -0.004], [0.012, 0.023, 0.013], code(forearm, 1), 8); }
        profile(armRings, limbSides);
      } else profile([[0.446, 0.025, 0.02, side * 0.17, 0, code(forearm, 1)], [0.615, 0.031, 0.033, side * 0.161, 0, code(forearm, 1, 0.5)], [0.69, 0.038, 0.043, side * 0.15, 0, code(arm, 0)], [0.785, 0.041, 0.044, side * 0.14, 0, code(arm, 0)]], limbSides);
      const leg: Ring[] = [[0.045, 0.032, 0.036, side * 0.057, 0, code(shin, 2)], [0.14, 0.04, 0.045, side * 0.057, 0, code(shin, 2)], [0.285, 0.042, 0.043, side * 0.057, 0, code(shin, 2, 0.5)], [0.395, 0.055, 0.057, side * 0.057, 0, code(thigh, 2)], [0.535, 0.056, 0.063, side * 0.057, 0, code(thigh, 2)]];
      if (!near) leg.splice(1, 1);
      profile(leg, limbSides);
      if (near) profile([[0, 0.035, 0.073, side * 0.057, -0.027, code(foot, 3)], [0.033, 0.037, 0.074, side * 0.057, -0.027, code(foot, 3)], [0.057, 0.027, 0.045, side * 0.057, -0.012, code(foot, 3)]], hero ? 12 : 6);
      else box([side * 0.057, 0.028, -0.026], [0.035, 0.028, 0.071], code(foot, 3));
    }
    if (near) {
      // Enclose the anatomical skull's broad upper rings, not just its narrower temple ring.
      // The apex closes the crown; an open first ring leaves a visible bare patch from above.
      // Every close level of detail builds the same dome, only coarser, so the hair does not change shape when the level does.
      const rows = hero ? 7 : 4, columns = hero ? 24 : 10;
      const sampleHair = (row: number, column: number) => {
        const angle = column * Math.PI * 2 / columns, front = Math.max(0, -Math.sin(angle)), end = 1.80 - 0.68 * front ** 4;
        const b = row / rows * end, s = Math.sin(b), c = Math.cos(b);
        const n = [Math.cos(angle) * s / 0.070, c / 0.075, Math.sin(angle) * s / 0.080], inv = 1 / Math.hypot(...n);
        return { p: [Math.cos(angle) * s * 0.070, 0.929 + c * 0.075, 0.004 + Math.sin(angle) * s * 0.080], n: n.map(v => v * inv) };
      };
      for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
        const a = sampleHair(row, column), b = sampleHair(row, column + 1), c = sampleHair(row + 1, column + 1), d = sampleHair(row + 1, column);
        tri(a.p, b.p, c.p, a.n, b.n, c.n, code(1, 11)); tri(a.p, c.p, d.p, a.n, c.n, d.n, code(1, 11));
      }
      // The tied-back lock that some hairstyles show (the shader folds it into the head for the others), with the same length and thickness at every close level.
      profile([[0.829, 0.008, 0.01, 0, 0.087, code(1, 10)], [0.862, 0.019, 0.018, 0, 0.09, code(1, 10)], [0.918, 0.023, 0.022, 0, 0.078, code(1, 10)], [0.955, 0.011, 0.012, 0, 0.061, code(1, 10)]], hero ? 12 : 6);
    }
    if (near && !hero) {
      box([0, 0.925, -0.061], [0.009, 0.012, 0.012], skin);
      for (const side of [-1, 1]) box([side * 0.023, 0.943, -0.058], [0.008, 0.003, 0.004], code(1, 5));
    }
    if (hero) {
      // A tapered bridge, alae and tip merge into the underlying face instead of a box or separate ball.
      profile([[0.909, 0.007, 0.002, 0, -0.054, skin], [0.915, 0.012, 0.007, 0, -0.061, skin], [0.921, 0.009, 0.009, 0, -0.064, skin], [0.932, 0.005, 0.005, 0, -0.059, skin], [0.945, 0.003, 0.002, 0, -0.058, skin]], 16);
      const face = (x: number, y: number, offset = 0) => [x, y, 0.002 - 0.061 * Math.sqrt(Math.max(0.05, 1 - (x / 0.059) ** 2)) - offset];
      const faceNormal = (x: number) => { const n = [x / 0.059, 0, -Math.sqrt(Math.max(0.05, 1 - (x / 0.059) ** 2))], length = Math.hypot(...n); return n.map(v => v / length); };
      const patch = (cx: number, cy: number, rx: number, ry: number, material: number, offset: number, segments = 16) => {
        const center = face(cx, cy, offset + 0.00045), normal = faceNormal(cx);
        for (let i = 0; i < segments; i++) {
          const a = i * 2 * Math.PI / segments, b = (i + 1) * 2 * Math.PI / segments;
          const x0 = cx + Math.cos(a) * rx, x1 = cx + Math.cos(b) * rx;
          tri(center, face(x0, cy + Math.sin(a) * ry, offset), face(x1, cy + Math.sin(b) * ry, offset), normal, faceNormal(x0), faceNormal(x1), code(1, material));
        }
      };
      for (const side of [-1, 1]) {
        sphere([side * 0.058, 0.924, 0.004], [0.01, 0.019, 0.009], skin, 12);
        sphere([side * 0.063, 0.924, 0.002], [0.0045, 0.011, 0.006], code(1, 8), 12);
        const cx = side * 0.02, cy = 0.943;
        // Small almond openings, iris and pupil sit on the curved face; their eyelids remain skin coloured.
        patch(cx, cy, 0.01, 0.0035, 6, 0.0008);
        patch(cx, cy, 0.0025, 0.003, 7, 0.0017, 12); patch(cx, cy, 0.0011, 0.0016, 5, 0.0021, 10);
        for (const upper of [-1, 1]) for (let i = 0; i < 8; i++) {
          const a = i * Math.PI / 8, b = (i + 1) * Math.PI / 8, x0 = cx + Math.cos(a) * 0.01, x1 = cx + Math.cos(b) * 0.01;
          const y0 = cy + upper * Math.sin(a) * 0.0035, y1 = cy + upper * Math.sin(b) * 0.0035;
          const p = face(x0, y0, 0.0017), q = face(x1, y1, 0.0017), r = face(x1, y1 + upper * 0.0015, 0.0002), s = face(x0, y0 + upper * 0.0015, 0.0002);
          tri(p, q, r, faceNormal(x0), faceNormal(x1), faceNormal(x1), skin); tri(p, r, s, faceNormal(x0), faceNormal(x1), faceNormal(x0), skin);
        }
        patch(cx, cy + 0.0085, 0.011, 0.0014, 4, 0.0005);
      }
      // Muted lip vermilion and a narrow oral seam, at natural adult dimensions.
      patch(0, 0.902, 0.015, 0.0025, 8, -0.0035); patch(0, 0.898, 0.014, 0.0025, 8, -0.0035);
      patch(0, 0.9002, 0.012, 0.0004, 9, -0.0032);
    }
  }
  return new Float32Array(v);
}
