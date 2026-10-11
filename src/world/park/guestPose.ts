/** Normalized anatomical contact points shared by the mesh, seat attachment and GPU pose. */
/**
 * Height of the seat surface above the feet, as a fraction of the guest's height: the lowest point of the seated pelvis and thighs
 * of the broadest body build. The mesh's pelvis ends exactly here, so the body sits on the cushion rather than sinking into it.
 */
export const GUEST_SEAT_Y = 0.44;
/** The tallest guest the crowd draws, metres. */
export const GUEST_MAX_HEIGHT = 1.98;
/** Half the width of the widest seated guest (the tallest, broadest build, elbows out to the lap bar), metres; guestRide.test.ts
 * skins every level of detail and build to check it. Rides space their end seats from walls by this. */
export const GUEST_SEATED_HALF_WIDTH = 0.46;
export const GUEST_HIP_Y = 0.525;
export const GUEST_KNEE_Y = 0.285;
export const GUEST_ANKLE_Y = 0.045;
/**
 * Walking pace: radians per second of the left-right step cycle for a guest of GUEST_GAIT_HEIGHT; it scales as one over the height.
 * 5.3 rad/s is 101 steps a minute. The Strathprints record 35536 ("Stride rate recommendations for moderate-intensity walking")
 * reports about 113 steps a minute at 152 cm falling to 90 at 198 cm, which this rule follows (117 and 90). Read from the record's summary only.
 */
export const GUEST_GAIT_RATE = 5.3;
export const GUEST_GAIT_HEIGHT = 1.75;
/** Half a step as a fraction of height. 0.26 lets a guest follow 1.53 m/s without a foot sliding, a little above the 1.5 m/s boarding walk. */
export const GUEST_STRIDE_LIMIT = 0.26;
/** Children's heads are larger for their stature: head height is about a sixth of stature at 5-6 years against about a seventh to an eighth for adults (see guestHeadScale). */
export const GUEST_CHILD_HEAD_GAIN = 0.3;
export const GUEST_CHILD_HEIGHT = 1.65;
export const GUEST_CHILD_SPAN = 0.6;
export const GUEST_STEP_LIFT = 0.07;
export const GUEST_KNEE_FLEX = 0.002;
export const GUEST_SEATED_ANGLE = 1.45;
export const GUEST_TRANSFER_SECONDS = 1.35;
/**
 * How quickly a guest on a boarding or exit path speeds up from standing and slows to a stop at the seat, in metres per second each second.
 * Reaching the 1.5 m/s boarding walk takes 0.6 s. Ordinary starts and stops are roughly 1 to 2 m/s squared; from memory, not looked up.
 */
export const GUEST_WALK_ACCEL = 2.5;
/**
 * Riders who straddle a mount (a carousel horse) swing each thigh outward about the vertical through the hip, so the legs hang either side of the
 * animal's body instead of through it. A 1.75 m rider needs 0.86 rad (49 degrees) for the knee to sit outside a horse barrel of half width 0.34 m
 * (src/world/park/parts.ts carouselHorse). Shorter legs reach less far sideways, so every metre of height below 1.75 m adds GUEST_STRADDLE_SPREAD
 * radians, up to GUEST_STRADDLE_SHORT metres of shortfall. Fitted to that horse by measuring the skinned meshes against it (src/world/park/guestHorse.test.ts), not taken from riding data.
 */
export const GUEST_STRADDLE_YAW = 0.92;
export const GUEST_STRADDLE_SPREAD = 0.8;
export const GUEST_STRADDLE_SHORT = 0.6;
/** Sideways distance of each hip joint from the body's centre line, as a fraction of height; the legs of the mesh are centred on it. */
export const GUEST_HIP_X = 0.057;
/** How far each thigh swings outward for a rider of this height straddling a mount, in radians. */
export function guestStraddleYaw(height: number): number {
  return GUEST_STRADDLE_YAW + GUEST_STRADDLE_SPREAD * Math.min(GUEST_STRADDLE_SHORT, Math.max(0, GUEST_HEIGHT_REFERENCE - height));
}
/** The height the straddle angle is fitted for; shorter riders swing their legs further. */
export const GUEST_HEIGHT_REFERENCE = 1.75;
/** The fastest a guest on a boarding or exit path turns to face the way it is walking, in radians per second. Chosen, not measured. */
export const GUEST_TURN_RATE = 5;

/** Radians per second of the step cycle for a guest of this height: taller guests step more slowly. */
export function guestGaitRate(height: number): number {
  return GUEST_GAIT_RATE * GUEST_GAIT_HEIGHT / Math.max(height, 0.5);
}

/** The fastest walking pace, in metres per second, at which the stride limit still keeps a planted foot still. The same for every height, since stride and step rate scale oppositely. */
export function guestMaxWalkSpeed(): number {
  return 2 * GUEST_STRIDE_LIMIT * GUEST_GAIT_RATE * GUEST_GAIT_HEIGHT / Math.PI;
}

/**
 * The walking speed the pose shader is given: how fast the body is really travelling, so the stride follows the motion through boarding,
 * seat transfers and exits, and never longer than a planted foot can follow. A guest sitting in a moving seat does not walk.
 */
export function guestRenderSpeed(vx: number, vz: number, seated: boolean): number {
  return seated ? 0 : Math.min(Math.hypot(vx, vz), guestMaxWalkSpeed());
}

/** Head size multiplier: 1 for adults, up to 1 + GUEST_CHILD_HEAD_GAIN for the smallest children. */
export function guestHeadScale(height: number): number {
  return 1 + GUEST_CHILD_HEAD_GAIN * Math.min(1, Math.max(0, (GUEST_CHILD_HEIGHT - height) / GUEST_CHILD_SPAN));
}

/** Leg-fold elevation of the horizontal sole, relative to its standing height. */
export function guestSoleLift(seating: number, angle = GUEST_SEATED_ANGLE): number {
  return (GUEST_HIP_Y - GUEST_KNEE_Y) * (1 - Math.cos(angle * seating));
}

/** A low seat raises the knees enough to place the soles on its floor, without stretching a bone. */
export function guestSeatAngle(height: number, clearance: number): number {
  // The sole drops (GUEST_HIP_Y - GUEST_KNEE_Y) * (1 - cos angle) below its standing height relative to the seat surface at GUEST_SEAT_Y.
  return Math.max(GUEST_SEATED_ANGLE, Math.acos(Math.max(-0.98, Math.min(1, 1 - (GUEST_SEAT_Y - clearance / height) / (GUEST_HIP_Y - GUEST_KNEE_Y)))));
}

/** Compensates the nonlinear knee fold: soles interpolate between deck and seated clearance. */
export function guestTransferLift(seating: number, height: number, angle = GUEST_SEATED_ANGLE): number {
  return height * (seating * guestSoleLift(1, angle) - guestSoleLift(seating, angle)) + 0.08 * Math.sin(Math.PI * seating) ** 2;
}

export interface GuestLegPose {
  /** Cosine/sine rotations about X, before the common vertical pelvis displacement. */
  hip: [number, number];
  knee: [number, number];
  ankle: [number, number];
  drop: number;
  stance: boolean;
}

/** Two equal leg segments reach a planted sole or a lifted swing foot without changing bone lengths. */
export function guestLegPose(time: number, speed: number, height: number, right: boolean): GuestLegPose {
  const fract = (x: number) => x - Math.floor(x), activity = Math.min(Math.max(speed, 0) / 1.2, 1);
  const rate = guestGaitRate(height);
  const stride = Math.min(GUEST_STRIDE_LIMIT, Math.max(speed, 0) * Math.PI / (2 * rate * Math.max(height, 0.5)));
  const phase = fract(time * rate / (2 * Math.PI) + (right ? 0.5 : 0));
  const swing = fract(phase * 2), stanceZ = (swing * 2 - 1) * stride, reach = GUEST_HIP_Y - GUEST_ANKLE_Y;
  const stance = phase < 0.5;
  // The swing Hermite curve matches the stance velocity at both foot exchanges.
  const swingZ = (1 + 2 * swing - 12 * swing * swing + 8 * swing ** 3) * stride, swingLift = GUEST_STEP_LIFT * activity * Math.sin(Math.PI * swing) ** 2;
  const drop = Math.max(reach - Math.sqrt(Math.max(0, reach * reach - stanceZ * stanceZ)), reach - Math.sqrt(Math.max(0, reach * reach - swingZ * swingZ)) - swingLift) + GUEST_KNEE_FLEX * activity;
  const z = stance ? stanceZ : swingZ, lift = stance ? 0 : swingLift;
  const y = GUEST_ANKLE_Y + lift + drop, dy = y - GUEST_HIP_Y, length = GUEST_HIP_Y - GUEST_KNEE_Y;
  const distance = Math.hypot(dy, z), cb = Math.min(1, distance / (2 * length)), sb = Math.sqrt(Math.max(0, 1 - cb * cb));
  const ca = -dy / distance, sa = -z / distance;
  return { hip: [ca * cb - sa * sb, sa * cb + ca * sb], knee: [2 * cb * cb - 1, -2 * cb * sb], ankle: [y, z], drop, stance };
}

/** Two normalized sole-Y/ankle-Z targets. Their common pelvis correction preserves both bone lengths. */
export function guestContactLeg(targets: ArrayLike<number>, right: boolean, speed = 1.2): GuestLegPose {
  const reach = GUEST_HIP_Y - GUEST_ANKLE_Y, length = GUEST_HIP_Y - GUEST_KNEE_Y;
  const hip = Math.min(GUEST_HIP_Y - (targets[4] ?? 0), targets[0] + GUEST_ANKLE_Y + Math.sqrt(Math.max(0, reach * reach - targets[1] ** 2)),
    targets[2] + GUEST_ANKLE_Y + Math.sqrt(Math.max(0, reach * reach - targets[3] ** 2))) - GUEST_KNEE_FLEX * Math.min(Math.max(speed, 0) / 1.2, 1);
  const drop = GUEST_HIP_Y - hip, o = right ? 2 : 0, y = targets[o] + GUEST_ANKLE_Y + drop, z = targets[o + 1], dy = y - GUEST_HIP_Y;
  const distance = Math.max(1e-9, Math.hypot(dy, z)), cb = Math.min(1, distance / (2 * length)), sb = Math.sqrt(Math.max(0, 1 - cb * cb)), ca = -dy / distance, sa = -z / distance;
  return { hip: [ca * cb - sa * sb, sa * cb + ca * sb], knee: [2 * cb * cb - 1, -2 * cb * sb], ankle: [y, z], drop, stance: false };
}

/** Arm joints and the palm of the rest-pose hand, as fractions of height. */
export const GUEST_SHOULDER_Y = 0.785;
export const GUEST_ELBOW_Y = 0.615;
export const GUEST_PALM_Y = 0.425;
/**
 * Where a seated guest's hands rest, in metres in the seat frame: this far above the seat surface and this far in front of the seat origin
 * (negative is forward). It is on top of the lap bar of the seat (bar centre 0.17 m above the cushion, 0.2 m forward, bar radius 0.045 m),
 * which is also where the hands lie on the thighs when a ride has no bar.
 */
export const GUEST_GRIP_Y = 0.22;
export const GUEST_GRIP_Z = -0.2;

/**
 * Seat dimensions the seated body is fitted to, metres in the seat frame (rider faces -z): the front face of the back pad, the front edge of the cushion,
 * how far in front of the hip the seated knee is per metre of height, and the widest torso depth behind the body's centre line per metre of height.
 * src/world/park/guestGrip.test.ts checks them against the seat the ride builds.
 */
export const GUEST_SEAT_BACK_FACE = 0.065;
export const GUEST_SEAT_PAN_FRONT = 0.31;
export const GUEST_KNEE_REACH = 0.188;
/**
 * The swing seat is deeper than the standard seat: its pan reaches this far in front of the seat origin, so a small child's shins, which hang at the pan's
 * front edge, need the longer setback. src/world/park/guestRide.test.ts checks it against the swing seat the generator builds.
 */
export const GUEST_SWING_PAN_FRONT = 0.45;
/** Depth of the broadest head, hair included, behind the body's centre line per metre of height; children's larger heads (guestHeadScale) scale it up. */
export const GUEST_HEAD_BACK = 0.095;
export const GUEST_TORSO_BACK = 0.0888;

/**
 * How far forward of the seat's centre a seated guest sits, in metres. Tall guests move forward until the back of the broadest build meets the back pad;
 * short guests, whose lower legs would otherwise hang down through the cushion's front, move forward until the shins clear its front edge.
 */
export function guestSeatSetback(height: number, panFront = GUEST_SEAT_PAN_FRONT): number {
  return Math.max(0, Math.max(GUEST_TORSO_BACK, GUEST_HEAD_BACK * guestHeadScale(height)) * height - GUEST_SEAT_BACK_FACE, panFront - GUEST_KNEE_REACH * height);
}

/** Seated arm: shoulder angle and elbow bend (radians, forward positive) that put the palm on the grip point, whatever the guest's height. */
export function guestGripArm(height: number, panFront = GUEST_SEAT_PAN_FRONT): [shoulder: number, elbow: number] {
  const upper = GUEST_SHOULDER_Y - GUEST_ELBOW_Y, lower = GUEST_ELBOW_Y - GUEST_PALM_Y;
  const dy = GUEST_SEAT_Y + GUEST_GRIP_Y / height - GUEST_SHOULDER_Y, dz = (GUEST_GRIP_Z + guestSeatSetback(height, panFront)) / height;
  const reach = Math.min(upper + lower - 1e-4, Math.max(Math.abs(upper - lower) + 1e-4, Math.hypot(dy, dz)));
  const toward = Math.atan2(-dz, -dy), bend = Math.acos(Math.max(-1, Math.min(1, (upper * upper + reach * reach - lower * lower) / (2 * upper * reach))));
  const shoulder = toward - bend, elbowY = -upper * Math.cos(shoulder), elbowZ = -upper * Math.sin(shoulder);
  const forearm = Math.atan2(-(dz - elbowZ), -(dy - elbowY));
  return [shoulder, forearm - shoulder];
}

/** Shader substitutions keep anatomical dimensions and gait limits authoritative in this module. */
export function guestPoseDefines(): Record<string, number> {
  return { GUEST_SEAT_Y, GUEST_SEAT_BACK_FACE, GUEST_SEAT_PAN_FRONT, GUEST_KNEE_REACH, GUEST_HEAD_BACK, GUEST_TORSO_BACK, GUEST_SHOULDER_Y, GUEST_ELBOW_Y, GUEST_PALM_Y, GUEST_GRIP_Y, GUEST_GRIP_Z, GUEST_HIP_Y, GUEST_KNEE_Y, GUEST_ANKLE_Y, GUEST_GAIT_RATE, GUEST_GAIT_HEIGHT, GUEST_STRIDE_LIMIT, GUEST_STEP_LIFT, GUEST_KNEE_FLEX, GUEST_SEATED_ANGLE, GUEST_CHILD_HEAD_GAIN, GUEST_CHILD_HEIGHT, GUEST_CHILD_SPAN, GUEST_HIP_X, GUEST_STRADDLE_YAW, GUEST_STRADDLE_SPREAD, GUEST_STRADDLE_SHORT, GUEST_HEIGHT_REFERENCE };
}
