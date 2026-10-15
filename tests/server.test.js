import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { app } from "../server.js";
let server, base, modelResult, releaseModel;
const originalFetch = globalThis.fetch;
const plan = {
  reply: "I will look toward the red mug, then check again.",
  intent: "goal",
  objects: [
    { label: "mug", description: "red mug", x: 0.2, y: 0.5, confidence: 0.9 },
  ],
  actions: [
    {
      type: "orient",
      x: 0.2,
      y: 0.5,
      brightness: 0.8,
      color: "warm",
      duration_ms: 600,
    },
  ],
  goal: "The red mug is still visible",
  evidence: "A red mug appears on the left.",
};
const frame = () => ({
  image: "data:image/jpeg;base64,/9j/2Q==",
  captured_at: Date.now(),
});
const request = async (path, data) => {
  const r = await originalFetch(base + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return { status: r.status, body: await r.json() };
};
before(async () => {
  process.env.GEMINI_API_KEY = "test-key-not-a-secret";
  globalThis.fetch = async (url, options) => {
    if (String(url).startsWith("https://generativelanguage.googleapis.com/")) {
      const result = modelResult;
      const waiting = releaseModel;
      if (waiting)
        await new Promise((resolve) => {
          waiting.resolve = resolve;
          waiting.signal = options.signal;
        });
      return Response.json({
        candidates: [
          {
            finishReason: "STOP",
            content: { parts: [{ text: JSON.stringify(result) }] },
          },
        ],
      });
    }
    return originalFetch(url, options);
  };
  await new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  globalThis.fetch = originalFetch;
  await new Promise((resolve) => server.close(resolve));
});

test("session -> grounded plan -> fresh verification -> memory recall works", async () => {
  const { body: session } = await request("/api/session", {});
  modelResult = plan;
  const result = await request("/api/turn", {
    session_id: session.session_id,
    text: "Find the red mug and check it",
    frame: frame(),
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.requires_verification, true);
  assert.equal(result.body.memory[0].description, "red mug");
  const overlap = await request("/api/turn", {
    session_id: session.session_id,
    text: "Another request",
    frame: null,
  });
  assert.equal(overlap.status, 409);
  const completed_at = Date.now();
  await new Promise((resolve) => setTimeout(resolve, 5));
  modelResult = {
    status: "not_confirmed",
    reply: "The mug is no longer visible.",
    evidence: "The new image is empty.",
    objects: [],
  };
  const verified = await request("/api/verify", {
    session_id: session.session_id,
    turn_id: result.body.turn_id,
    completed_at,
    frame: frame(),
  });
  assert.equal(verified.status, 200);
  assert.equal(verified.body.status, "not_confirmed");
  assert.equal(verified.body.memory[0].description, "red mug");
  const replay = await request("/api/verify", {
    session_id: session.session_id,
    turn_id: result.body.turn_id,
    completed_at,
    frame: frame(),
  });
  assert.equal(replay.status, 409);
});
test("invalid model actions are rejected before execution", async () => {
  const { body: session } = await request("/api/session", {});
  modelResult = { ...plan, actions: [{ ...plan.actions[0], x: 400 }] };
  const result = await request("/api/turn", {
    session_id: session.session_id,
    text: "Look",
    frame: frame(),
  });
  assert.equal(result.status, 502);
});
test("no-image turns cannot add invented objects to memory", async () => {
  const { body: session } = await request("/api/session", {});
  modelResult = { ...plan, intent: "conversation", goal: "" };
  const result = await request("/api/turn", {
    session_id: session.session_id,
    text: "Hello",
    frame: null,
  });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.memory, []);
});
test("cancel immediately admits a new turn; late completion cannot mutate or unlock it", async () => {
  const { body: session } = await request("/api/session", {});
  modelResult = plan;
  releaseModel = {};
  const response = request("/api/turn", {
    session_id: session.session_id,
    text: "Look",
    frame: frame(),
  });
  while (!releaseModel.resolve)
    await new Promise((resolve) => setTimeout(resolve, 1));
  const oldRequest = releaseModel;
  await request("/api/cancel", { session_id: session.session_id });
  assert.equal(oldRequest.signal.aborted, true);
  modelResult = { ...plan, intent: "recall", objects: [], goal: "" };
  releaseModel = {};
  const replacement = request("/api/turn", {
    session_id: session.session_id,
    text: "Remember?",
    frame: null,
  });
  while (!releaseModel.resolve)
    await new Promise((resolve) => setTimeout(resolve, 1));
  oldRequest.resolve();
  assert.equal((await response).status, 409);
  const overlap = await request("/api/turn", {
    session_id: session.session_id,
    text: "Too soon",
    frame: null,
  });
  assert.equal(overlap.status, 409);
  releaseModel.resolve();
  releaseModel = null;
  const next = await replacement;
  assert.equal(next.status, 200);
  assert.deepEqual(next.body.memory, []);
});
test("cross-origin requests fail and credentials are absent from public status", async () => {
  const r = await originalFetch(base + "/api/session", {
    method: "POST",
    headers: {
      Origin: "https://unrelated.example",
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  assert.equal(r.status, 403);
  const status = await (await originalFetch(base + "/api/status")).text();
  assert.ok(!status.includes("test-key-not-a-secret"));
});

test("scene goals cannot aim at remembered locations or store people as objects", async () => {
  const { body: session } = await request("/api/session", {});
  modelResult = {
    ...plan,
    objects: [
      {
        label: "Person",
        description: "person near the center",
        x: 0.2,
        y: 0.5,
        confidence: 0.99,
      },
    ],
    evidence: "The pen was previously visible on the left.",
  };
  const result = await request("/api/turn", {
    session_id: session.session_id,
    text: "Check the pen",
    frame: frame(),
  });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.memory, []);
  assert.deepEqual(result.body.objects, []);
  assert.deepEqual(result.body.actions, []);
  assert.match(result.body.reply, /can't locate/);
  assert.equal(result.body.requires_verification, true);
});
