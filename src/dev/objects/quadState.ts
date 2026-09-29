import type { QuadState, Quat, Vec3 } from '../../contracts';

/** A hovering, armed quad with every motor at `omega` rad/s; the dev page mutates it in place each frame. */
export function makeQuadState(pos: Vec3, quat: Quat, omega: number): QuadState {
  return {
    time: 0,
    pos: [pos[0], pos[1], pos[2]],
    vel: [0, 0, 0],
    quat: [quat[0], quat[1], quat[2], quat[3]],
    angVel: [0, 0, 0],
    motorOmega: [omega, omega, omega, omega],
    motorCmd: [0.5, 0.5, 0.5, 0.5],
    batteryVoltage: 16,
    batteryCurrent: 20,
    batteryMah: 0,
    gForce: [0, 1, 0],
    armed: true,
    onGround: false,
    crashed: false,
    impactSpeed: 0,
  };
}
