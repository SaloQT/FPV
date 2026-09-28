/**
 * Betaflight-style flight controller.
 *
 * STICK SIGN CONVENTION (StickInput, all -1..1 except throttle 0..1)
 *   roll     > 0  roll right (right side down)   -> state.angVel.z < 0
 *   pitch    > 0  stick forward = nose down, flies forward -> state.angVel.x < 0
 *   yaw      > 0  nose turns right (clockwise seen from above) -> state.angVel.y < 0
 *   throttle 0..1 (0 = idle, hover is about 0.3 on QUAD_5IN_6S)
 * The FC's own axes (setpoint, gyro) use the same signs: roll right, nose down, yaw right are positive, i.e. they are the
 * negatives of the body-frame components documented on QuadState.angVel.
 *
 * MOTORS (0 FR, 1 RR, 2 RL, 3 FL): FR and RL spin clockwise seen from above, FL and RR counter-clockwise.
 */
export * from './rates';
export * from './filters';
export * from './pid';
export * from './mixer';
export * from './angle';
export * from './controller';
