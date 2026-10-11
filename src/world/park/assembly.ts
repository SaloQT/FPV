import type { Vec3 } from '../../contracts';
import { insertEnd } from './construction';
import { add, cross, dot, mul, sub, unit } from './math';
import { Parts, type PartOptions } from './parts';
import type { ParkPart } from './types';

/** Shared rules for how members end. Each helper sizes both sides of a connection from the same
 * dimensions, so a member never ends in a part too small to hold its end, and declares the contract
 * the construction audit then checks.
 *
 * Welded or cast-in member ends need a little material around them. 50 mm is an assumed fabrication
 * allowance (bearing-housing wall, concrete cover over an embedded leg), not a sourced figure. */
export const END_COVER = 0.05;

/** Vertical half-extent of a rod's end disc: a tilted round end reaches above and below its centre. */
export function endDiscRise(direction: Vec3, radius: number): number {
  const d = unit(direction); return radius * Math.sqrt(Math.max(0, 1 - d[1] * d[1]));
}

/** A leg cast into a concrete footing. The leg's round end sits deep enough that its whole end disc is
 * covered, and the footing is sized to hold that end plus cover on every side. `top` is where the leg's
 * axis meets the footing's top face; `head` is the leg's upper end. Returns the leg and its footing. */
export function legInFooting(b: Parts, top: Vec3, head: Vec3, radius: number, color: Vec3, name: string,
  options: PartOptions = {}, footing: { color: Vec3; halfHeight?: number; baseY?: number; halfWidth?: number } = { color: [0.36, 0.35, 0.32] }): { leg: ParkPart; footing: ParkPart; direction: Vec3 } {
  // With `baseY` the footing stands on that level and is exactly as tall as the cast-in end needs:
  // its top rises to baseY + 2·(end-disc rise + cover), found by a few fixed-point steps.
  if (footing.baseY !== undefined) { top = [...top]; for (let i = 0; i < 8; i++) top[1] = footing.baseY + 2 * Math.max(footing.halfHeight ?? 0, endDiscRise(sub(head, top), radius) + END_COVER); }
  const d = unit(sub(head, top));
  if (d[1] <= 0.2) throw new Error(`${name}: a leg must rise out of its footing`);
  const rise = endDiscRise(d, radius), depth = (rise + END_COVER) / d[1], foot = add(top, mul(d, -depth));
  const halfHeight = footing.baseY !== undefined ? (top[1] - footing.baseY) / 2 : Math.max(footing.halfHeight ?? 0, (top[1] - foot[1] + rise + END_COVER) / 2);
  // The footing spans the leg where it crosses the top face and where it ends, plus cover (or halfWidth).
  const spread = Math.max(radius + END_COVER, footing.halfWidth ?? 0), reach = (p: Vec3, k: 0 | 2) => [p[k] - spread, p[k] + spread];
  const [x0, x1] = [Math.min(reach(top, 0)[0], reach(foot, 0)[0]), Math.max(reach(top, 0)[1], reach(foot, 0)[1])];
  const [z0, z1] = [Math.min(reach(top, 2)[0], reach(foot, 2)[0]), Math.max(reach(top, 2)[1], reach(foot, 2)[1])];
  const pad = b.box([(x0 + x1) / 2, top[1] - halfHeight, (z0 + z1) / 2], [(x1 - x0) / 2, halfHeight, (z1 - z0) / 2], footing.color, { metalness: 0, roughness: 0.9, surface: 'concrete' });
  const leg = b.rod(foot, head, radius, color, options);
  insertEnd(b.park, pad, leg, -1, `${name}/footing`, 'Leg end is cast into its concrete footing with cover around the whole end.');
  return { leg, footing: pad, direction: d };
}

/** Where two legs of an A-frame end, either side of its apex. Legs rising from mirrored feet to one point
 * would overlap for a long way below it; ending them `spread` apart (along the line between the feet) keeps
 * the two legs a cover apart all the way up. Returns the top end for the leg from `foot`. */
export function legTop(foot: Vec3, apex: Vec3, radius: number, axis: Vec3): Vec3 {
  const level = [foot[0] - apex[0], 0, foot[2] - apex[2]] as Vec3, a = unit(axis), out = unit(sub(level, mul(a, dot(level, a))));
  let top = apex;
  // The axes are closest at the top, 2·spread·cos(rake) apart; a few fixed-point steps settle the rake.
  for (let i = 0; i < 6; i++) { const d = unit(sub(top, foot)); top = add(apex, mul(out, (radius + END_COVER / 2) / d[1])); }
  return top;
}

/** A bearing housing or node at the apex where members meet, sized from them: its radius holds every
 * member's end disc (where it actually ends, `at`, default the centre) and the shaft with a wall, and its
 * length holds each tilted end disc. */
export function apexHousing(b: Parts, center: Vec3, axis: Vec3, members: { part: ParkPart; end: -1 | 1; direction: Vec3; radius: number; at?: Vec3 }[],
  shaftRadius: number, color: Vec3, name: string, extraHalf = 0): ParkPart {
  const a = unit(axis);
  let reach = 0, along = 0;
  for (const m of members) {
    const d = unit(m.direction), u = unit(cross(d, Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0])), w = cross(d, u), off = sub(m.at ?? center, center);
    for (let k = 0; k < 64; k++) {
      const t = k * Math.PI / 32, p = add(off, add(mul(u, m.radius * Math.cos(t)), mul(w, m.radius * Math.sin(t)))), s = dot(p, a);
      reach = Math.max(reach, Math.hypot(...sub(p, mul(a, s)))); along = Math.max(along, Math.abs(s));
    }
  }
  const radius = Math.max(shaftRadius, reach) + END_COVER;
  const half = Math.max(shaftRadius, along) + END_COVER + extraHalf;
  const housing = b.rod(add(center, mul(a, -half)), add(center, mul(a, half)), radius, color);
  members.forEach((m, i) => insertEnd(b.park, housing, m.part, m.end, `${name}/member/${i}`, 'Frame member ends inside the welded apex housing, which is sized to hold its whole end.'));
  return housing;
}

/** A rod whose two ends sit inside two receiving parts (a post between a footing and a deck, a spoke
 * between a hub and a rim). Each end is declared and checked. */
export function memberBetween(b: Parts, receiverA: ParkPart, a: Vec3, receiverB: ParkPart, bEnd: Vec3, radius: number, color: Vec3, name: string, options: PartOptions = {}): ParkPart {
  const rod = b.rod(a, bEnd, radius, color, options);
  insertEnd(b.park, receiverA, rod, -1, `${name}/a`, 'Member end is received inside the supporting part.');
  insertEnd(b.park, receiverB, rod, 1, `${name}/b`, 'Member end is received inside the supported part.');
  return rod;
}

/** Guard fence: posts standing on (or cast into) a base, rails passing into the posts. Rails stop at
 * posts that exist, and every rail end lies on a post axis below the post top, so the round rail end is
 * hidden inside the post. Post feet bear flush on the base top (`embed` 0) or are cast `embed` deep. */
export function guardFence(b: Parts, feet: Vec3[], height: number, railHeights: number[], radius: number, color: Vec3, name: string,
  options: { closed?: boolean; base?: ParkPart; embed?: number; railRadius?: number } = {}): { posts: ParkPart[]; rails: ParkPart[] } {
  const railRadius = options.railRadius ?? radius;
  if (railRadius > radius) throw new Error(`${name}: rails thicker than posts cannot end inside them`);
  if (railHeights.some(h => h + railRadius > height)) throw new Error(`${name}: a rail must run below the post top`);
  const embed = options.embed ?? 0;
  const posts = feet.map((f, i) => {
    const post = b.rod([f[0], f[1] - embed, f[2]], [f[0], f[1] + height, f[2]], radius, color);
    if (embed > 0 && options.base) insertEnd(b.park, options.base, post, -1, `${name}/post/${i}`, 'Fence post is set into the paving.');
    return post;
  });
  const rails: ParkPart[] = [];
  const count = options.closed ? feet.length : feet.length - 1;
  for (let i = 0; i < count; i++) {
    const j = (i + 1) % feet.length;
    for (const h of railHeights) {
      const rail = b.rod([feet[i][0], feet[i][1] + h, feet[i][2]], [feet[j][0], feet[j][1] + h, feet[j][2]], railRadius, color);
      insertEnd(b.park, posts[i], rail, -1, `${name}/rail/${i}/${h}/a`, 'Rail end passes into the post it is welded to.');
      insertEnd(b.park, posts[j], rail, 1, `${name}/rail/${i}/${h}/b`, 'Rail end passes into the post it is welded to.');
      rails.push(rail);
    }
  }
  return { posts, rails };
}

/** Stair limits from the 2010 ADA Standards for Accessible Design, whose text is quoted in docs/park-construction-sources.md:
 * risers at most 7 in (504.2), the top of the handrail grip 34 to 38 in above the stair nosings (505.4), and a round grip
 * 1.25 to 2 in across (505.7.1). The handrail top is set at 0.9 m, inside that band. */
export const STAIR_MAX_RISER = 7 * 0.0254, STAIR_HANDRAIL_TOP = 0.9;
/** Handrail brackets on guarded stairs: the grip stands 1.5 in clear of the balusters (505.5), and the bracket arm runs
 * 1.5 in below the bottom of the grip (505.6). The stem is a 30 mm round bar and the arm a 20 mm one, so the arm end sits
 * wholly inside the stem. */
const STAIR_HANDRAIL_CLEARANCE = 1.5 * 0.0254, STAIR_BRACKET_STEM = 0.015, STAIR_BRACKET_ARM = 0.01;
/** Handrail and baluster tube radius on cast stairs: a 50 mm grip. */
export const STAIR_RAIL_RADIUS = 0.025;
export interface StairFlight { treads: ParkPart[]; handrails: ParkPart[]; guards: ParkPart[]; steps: number; length: number }
/** Cast concrete stair from a slab up to a deck edge, climbing toward -z in the builder frame: the first
 * riser is at `topZ + steps·going`, the last tread is level with the deck and butts its edge at `topZ`.
 * Every step is a solid block standing on the slab, so each tread is carried to the ground and touches
 * its neighbours face to face. Balusters stand on the middle of a tread and end inside an inclined handrail
 * whose grip top is `STAIR_HANDRAIL_TOP` above the nosing line. With `guardHeight`, a guard rail runs above it
 * with its axis that far above the nosings, carried on baluster pieces that rise from inside the handrail. */
export function stairFlight(b: Parts, options: { x?: number; halfWidth: number; bottomY: number; topY: number; topZ: number; going?: number;
  color: Vec3; railColor: Vec3; ride?: number; name: string; guardHeight?: number; railInset?: number }): StairFlight {
  const going = options.going ?? 0.35, rise = options.topY - options.bottomY, steps = Math.max(1, Math.ceil(rise / STAIR_MAX_RISER - 1e-9)), riser = rise / steps;
  const x = options.x ?? 0, length = steps * going;
  const treads: ParkPart[] = [];
  for (let i = 0; i < steps; i++) {
    const top = options.bottomY + (i + 1) * riser;
    treads.push(b.box([x, (options.bottomY + top) / 2, options.topZ + (steps - i - 0.5) * going], [options.halfWidth, (top - options.bottomY) / 2, going / 2], options.color,
      { metalness: 0, roughness: 0.9, surface: 'concrete', ...(options.ride !== undefined ? { walkSurface: { kind: 'tread' as const, ride: options.ride } } : {}) }));
  }
  // On the slope the top of the round grip stands radius / cos(pitch) above the rail axis.
  const handrailAxis = STAIR_HANDRAIL_TOP - STAIR_RAIL_RADIUS * Math.hypot(1, riser / going), radius = STAIR_RAIL_RADIUS, inset = options.railInset ?? 0.08, handrails: ParkPart[] = [], guards: ParkPart[] = [];
  if (options.guardHeight !== undefined && options.guardHeight - radius <= handrailAxis + radius) throw new Error(`${options.name}: the guard rail must run above the handrail`);
  const nosing = (z: number) => options.bottomY + riser + (options.topZ + length - z) * riser / going;
  if (steps >= 2) for (const side of [-1, 1]) {
    // Without a guard the balusters carry the handrail from below. With one, they carry the guard, and the handrail hangs on
    // brackets on their stair side, 1.5 in (505.5) clear of them, so nothing touches its grip except from below.
    const guarded = options.guardHeight !== undefined, bx = x + side * (options.halfWidth - inset);
    const hx = guarded ? bx - side * (radius + STAIR_HANDRAIL_CLEARANCE + radius) : bx;
    // The rails run a little past the end balusters so the baluster ends land inside them, not on their end caps.
    const z0 = options.topZ + length - going / 2 + 4 * radius, z1 = options.topZ + going / 2 - 4 * radius;
    const inclined = (railX: number, height: number) => b.rod([railX, nosing(z0) + height, z0], [railX, nosing(z1) + height, z1], radius, options.railColor);
    const rail = inclined(hx, handrailAxis), guard = guarded ? inclined(bx, options.guardHeight!) : undefined;
    handrails.push(rail); if (guard) guards.push(guard);
    const every = Math.max(1, Math.round(steps / 4)), stations = new Set<number>([0, steps - 1]);
    for (let i = every; i < steps - 1; i += every) stations.add(i);
    for (const i of stations) {
      const z = options.topZ + (steps - i - 0.5) * going, railY = nosing(z) + handrailAxis, tread = options.bottomY + (i + 1) * riser;
      // The rail's round end disc is tilted; the baluster end sits on the rail axis so the disc stays inside.
      const post = b.rod([bx, tread, z], [bx, guard ? nosing(z) + options.guardHeight! : railY, z], radius, options.railColor);
      insertEnd(b.park, guard ?? rail, post, 1, `${options.name}/baluster/${side}/${i}`, `Baluster top passes into the ${guard ? 'guard rail' : 'handrail'} it carries.`);
      if (!guard) continue;
      // The bracket arm leaves the baluster below the handrail and ends in a stem that rises into the handrail's underside.
      // Measured square to the sloping rail, the arm top is 1.5 in from the grip.
      const armY = railY - (radius + STAIR_HANDRAIL_CLEARANCE + STAIR_BRACKET_ARM) * Math.hypot(1, riser / going);
      const stem = b.rod([hx, armY - STAIR_BRACKET_STEM, z], [hx, railY, z], STAIR_BRACKET_STEM, options.railColor);
      const arm = b.rod([bx, armY, z], [hx, armY, z], STAIR_BRACKET_ARM, options.railColor);
      insertEnd(b.park, rail, stem, 1, `${options.name}/bracket-stem/${side}/${i}`, 'Bracket stem top ends on the handrail axis, inside the handrail.');
      insertEnd(b.park, post, arm, -1, `${options.name}/bracket-arm/${side}/${i}`, 'Bracket arm starts on the baluster axis, inside the baluster.');
      insertEnd(b.park, stem, arm, 1, `${options.name}/bracket-arm/${side}/${i}`, 'Bracket arm ends on the stem axis, above the stem foot, and is thinner than the stem.');
    }
  }
  return { treads, handrails, guards, steps, length };
}

