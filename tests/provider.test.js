import { test, after } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { geminiRequest } from "../src/provider.js";

const originalFetch = globalThis.fetch;
const previousKey = process.env.GEMINI_API_KEY;
process.env.GEMINI_API_KEY = "test-only";
after(() => {
  globalThis.fetch = originalFetch;
  if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = previousKey;
});
const schema = z.object({ text: z.string() }).strict();
const success = () =>
  Response.json({
    candidates: [
      {
        finishReason: "STOP",
        content: { parts: [{ text: '{"text":"hello"}' }] },
      },
    ],
  });

test("a transient provider overload is retried once", async () => {
  let calls = 0;
  globalThis.fetch = async () =>
    ++calls === 1 ? new Response("", { status: 503 }) : success();
  assert.deepEqual(await geminiRequest("test", [{ text: "test" }], schema), {
    text: "hello",
  });
  assert.equal(calls, 2);
});
test("quota errors are not retried and never expose the provider error body", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response("sensitive diagnostic", { status: 429 });
  };
  await assert.rejects(
    geminiRequest("test", [], schema),
    /quota or rate limit/,
  );
  assert.equal(calls, 1);
});
test("truncated output is rejected instead of being treated as an action", async () => {
  globalThis.fetch = async () =>
    Response.json({ candidates: [{ finishReason: "MAX_TOKENS" }] });
  await assert.rejects(geminiRequest("test", [], schema), /complete response/);
});
