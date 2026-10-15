import test from "node:test";
import assert from "node:assert/strict";
import {
  ActionSchema,
  remember,
  assertFreshFrame,
  assertVerificationOrder,
} from "../src/protocol.js";
const object = {
  label: "mug",
  description: "A red ceramic mug",
  x: 0.2,
  y: 0.5,
  confidence: 0.9,
};

test("memory preserves an absent object and records observation provenance", () => {
  const memory = remember([], [object], 1000);
  assert.deepEqual(remember(memory, [], 2000), memory);
  const updated = remember(memory, [{ ...object, x: 0.7 }], 3000)[0];
  assert.equal(updated.first_seen, 1000);
  assert.equal(updated.last_seen, 3000);
  assert.equal(updated.observations, 2);
  assert.equal(updated.x, 0.7);
});
test("uncertain observations cannot overwrite reliable visual memory", () => {
  const memory = remember([], [object], 1000);
  assert.deepEqual(
    remember(
      memory,
      [{ ...object, description: "blue", confidence: 0.3 }],
      2000,
    ),
    memory,
  );
});
test("memory is bounded to twenty most recently observed object labels", () => {
  let memory = [];
  for (let i = 0; i < 30; i++)
    memory = remember(memory, [{ ...object, label: `object ${i}` }], 1000 + i);
  assert.equal(memory.length, 20);
  assert.equal(memory[0].label, "object 29");
});
test("action schema rejects executable commands and unbounded parameters", () => {
  const action = {
    type: "orient",
    x: 0.5,
    y: 0.5,
    brightness: 0.7,
    color: "warm",
    duration_ms: 800,
  };
  assert.equal(ActionSchema.safeParse(action).success, true);
  for (const patch of [
    { type: "shell" },
    { x: 2 },
    { brightness: -1 },
    { duration_ms: 100000 },
    { code: "execute()" },
  ])
    assert.equal(
      ActionSchema.safeParse({ ...action, ...patch }).success,
      false,
    );
});
test("verification rejects missing goals, reused frames, and pre-execution observations", () => {
  const pending = { turn_id: "goal-1", initial_capture: 1000, issued_at: 1500 };
  assert.throws(() => assertVerificationOrder(null, { turn_id: "goal-1" }));
  assert.throws(() => assertVerificationOrder(pending, { turn_id: "goal-2" }));
  assert.throws(() =>
    assertVerificationOrder(pending, {
      turn_id: "goal-1",
      completed_at: 2000,
      frame: { captured_at: 1800 },
    }),
  );
  assert.doesNotThrow(() =>
    assertVerificationOrder(pending, {
      turn_id: "goal-1",
      completed_at: 2000,
      frame: { captured_at: 2100 },
    }),
  );
});
test("expired and implausibly future frames fail closed", () => {
  assert.throws(() => assertFreshFrame({ captured_at: 1000 }, 17000));
  assert.throws(() => assertFreshFrame({ captured_at: 21000 }, 17000));
  assert.doesNotThrow(() => assertFreshFrame({ captured_at: 16000 }, 17000));
});
