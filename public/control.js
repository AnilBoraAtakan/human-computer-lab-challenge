// Pure motion/attention logic shared with the regression tests.
export const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value));
export const HOME = {
  base_yaw_joint: 0,
  shoulder_pitch_joint: 0.45,
  elbow_pitch_joint: -1.1,
  neck_yaw_joint: 0,
  head_pitch_joint: -0.55,
};
export const REST = {
  ...HOME,
  shoulder_pitch_joint: 0.6,
  elbow_pitch_joint: -1.35,
  head_pitch_joint: -0.25,
};
export const COLORS = {
  warm: "#ffd68c",
  mint: "#a0e5c3",
  blue: "#95caff",
  rose: "#ffabc2",
};
export function safePose(pose, limits) {
  const result = {};
  for (const [name, value] of Object.entries(pose)) {
    if (!limits[name] || !Number.isFinite(value))
      throw new Error(`Invalid joint command: ${name}`);
    result[name] = clamp(value, limits[name].lower, limits[name].upper);
  }
  return result;
}
export function trajectorySeconds(from, to, limits, minimum = 0.3) {
  // Cubic ease: max velocity = 1.5*d/T, max acceleration = 6*d/T².
  return Object.keys(to).reduce((duration, name) => {
    const distance = Math.abs(to[name] - from[name]);
    return Math.max(
      duration,
      (1.5 * distance) / (limits[name].velocity * 0.75),
      Math.sqrt((6 * distance) / 3),
    );
  }, minimum);
}
export function interpolatePose(from, to, t) {
  if (t >= 1) return { ...to };
  if (t <= 0) return { ...from };
  const u = clamp(t, 0, 1);
  const eased = u * u * (3 - 2 * u);
  return Object.fromEntries(
    Object.keys(to).map((name) => [
      name,
      from[name] + (to[name] - from[name]) * eased,
    ]),
  );
}
export function orientPose(x, y) {
  return {
    ...HOME,
    base_yaw_joint: (0.5 - clamp(x, 0, 1)) * 1.5,
    neck_yaw_joint: (0.5 - clamp(x, 0, 1)) * 0.35,
    head_pitch_joint: clamp(-0.55 + (y - 0.5) * 0.65, -0.75, 0.2),
  };
}
export class AttentionGate {
  constructor({ engageMs = 700, disengageMs = 1800 } = {}) {
    this.engageMs = engageMs;
    this.disengageMs = disengageMs;
    this.reset();
  }
  reset() {
    this.engaged = false;
    this.candidate = null;
    this.since = 0;
  }
  update(facing, now) {
    if (facing !== this.candidate) {
      this.candidate = facing;
      this.since = now;
    }
    const threshold = facing ? this.engageMs : this.disengageMs;
    if (facing !== this.engaged && now - this.since >= threshold) {
      this.engaged = facing;
      return facing ? "engage" : "disengage";
    }
    return null;
  }
}
