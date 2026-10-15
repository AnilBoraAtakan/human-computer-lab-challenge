import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  AttentionGate,
  HOME,
  REST,
  safePose,
  orientPose,
  trajectorySeconds,
  interpolatePose,
} from "../public/control.js";

const xml = readFileSync(
  new URL("../public/robot/dummy_lamp_5dof.urdf", import.meta.url),
  "utf8",
);
const limits = {};
for (const match of xml.matchAll(
  /<joint name="([^"]+)" type="revolute">([\s\S]*?)<\/joint>/g,
)) {
  const attr = (name) =>
    Number(match[2].match(new RegExp(`${name}="([^"]+)"`))[1]);
  limits[match[1]] = {
    lower: attr("soft_lower_limit"),
    upper: attr("soft_upper_limit"),
    velocity: attr("velocity"),
  };
}

test("all five joints remain within supplied soft limits across the image field", () => {
  assert.equal(Object.keys(limits).length, 5);
  for (const pose of [
    HOME,
    REST,
    ...Array.from({ length: 25 }, (_, i) =>
      orientPose((i % 5) / 4, Math.floor(i / 5) / 4),
    ),
  ]) {
    assert.deepEqual(safePose(pose, limits), pose);
  }
});
test("out-of-range positions clamp; unknown and non-finite commands fail closed", () => {
  assert.equal(safePose({ base_yaw_joint: 100 }, limits).base_yaw_joint, 2.45);
  assert.throws(() => safePose({ gripper: 1 }, limits));
  assert.throws(() => safePose({ base_yaw_joint: NaN }, limits));
});
test("interpolation respects velocity and acceleration across extreme poses", () => {
  const from = Object.fromEntries(
    Object.entries(limits).map(([name, l]) => [name, l.lower]),
  );
  const to = Object.fromEntries(
    Object.entries(limits).map(([name, l]) => [name, l.upper]),
  );
  const duration = trajectorySeconds(from, to, limits);
  const dt = duration / 1000;
  let previous = from,
    previousVelocity;
  for (let step = 1; step <= 1000; step++) {
    const pose = interpolatePose(from, to, step / 1000);
    const velocity = Object.fromEntries(
      Object.keys(pose).map((name) => [
        name,
        (pose[name] - previous[name]) / dt,
      ]),
    );
    for (const name of Object.keys(pose)) {
      assert.ok(
        Math.abs(velocity[name]) <= limits[name].velocity * 0.75 + 1e-6,
      );
      if (previousVelocity)
        assert.ok(
          Math.abs(velocity[name] - previousVelocity[name]) / dt <= 3 + 1e-6,
        );
    }
    previous = pose;
    previousVelocity = velocity;
  }
  assert.deepEqual(interpolatePose(from, to, 1), to);
});
test("attention requires sustained presence and tolerates brief look-away", () => {
  const gate = new AttentionGate();
  assert.equal(gate.update(true, 0), null);
  assert.equal(gate.update(true, 699), null);
  assert.equal(gate.update(true, 700), "engage");
  gate.update(false, 800);
  gate.update(true, 1100);
  assert.equal(gate.engaged, true);
  gate.update(false, 1200);
  assert.equal(gate.update(false, 2999), null);
  assert.equal(gate.update(false, 3000), "disengage");
});
test("intermittent detections do not accumulate into false engagement", () => {
  const gate = new AttentionGate();
  for (let time = 0; time < 5000; time += 100)
    assert.equal(gate.update(time % 400 < 300, time), null);
  assert.equal(gate.engaged, false);
});
