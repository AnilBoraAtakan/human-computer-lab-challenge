import { z } from "zod";

export const ObjectSchema = z
  .object({
    label: z.string().max(80),
    description: z.string().max(240),
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    confidence: z.number().min(0).max(1),
  })
  .strict();
export const ActionSchema = z
  .object({
    type: z.enum(["orient", "nod", "light", "celebrate", "rest"]),
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    brightness: z.number().min(0).max(1),
    color: z.enum(["warm", "mint", "blue", "rose"]),
    duration_ms: z.number().int().min(300).max(3000),
  })
  .strict();
export const PlanSchema = z
  .object({
    reply: z.string().max(450),
    intent: z.enum(["conversation", "remember", "recall", "goal", "celebrate"]),
    objects: z.array(ObjectSchema).max(6),
    actions: z.array(ActionSchema).max(4),
    goal: z.string().max(250),
    evidence: z.string().max(300),
  })
  .strict();
export const VerifySchema = z
  .object({
    status: z.enum(["confirmed", "not_confirmed", "uncertain"]),
    reply: z.string().max(400),
    evidence: z.string().max(300),
    objects: z.array(ObjectSchema).max(6),
  })
  .strict();
export const FrameSchema = z
  .object({
    image: z
      .string()
      .max(1_500_000)
      .regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/),
    captured_at: z.number().int().positive(),
  })
  .strict();
export const TurnSchema = z
  .object({
    session_id: z.string().uuid(),
    text: z.string().trim().min(1).max(1000),
    frame: FrameSchema.nullable(),
  })
  .strict();
export const VerificationInput = z
  .object({
    session_id: z.string().uuid(),
    turn_id: z.string().uuid(),
    frame: FrameSchema,
    completed_at: z.number().int().positive(),
  })
  .strict();

export function remember(previous, objects, capturedAt) {
  const memory = new Map(
    previous.map((item) => [item.label.toLowerCase(), item]),
  );
  for (const object of objects.filter((o) => o.confidence >= 0.6)) {
    const key = object.label.toLowerCase();
    const old = memory.get(key);
    memory.set(key, {
      ...object,
      first_seen: old?.first_seen ?? capturedAt,
      last_seen: capturedAt,
      observations: (old?.observations ?? 0) + 1,
    });
  }
  return [...memory.values()]
    .sort((a, b) => b.last_seen - a.last_seen)
    .slice(0, 20);
}
export function assertFreshFrame(frame, now = Date.now()) {
  if (frame.captured_at > now + 3000 || now - frame.captured_at > 15000) {
    throw Object.assign(
      new Error("Camera frame is stale. Capture a new frame and try again."),
      { status: 409 },
    );
  }
}
export function assertVerificationOrder(pending, input) {
  if (!pending || pending.turn_id !== input.turn_id)
    throw Object.assign(new Error("No matching pending goal."), {
      status: 409,
    });
  if (
    pending.initial_capture >= input.frame.captured_at ||
    input.completed_at < pending.issued_at ||
    input.frame.captured_at <= input.completed_at
  ) {
    throw Object.assign(
      new Error(
        "Verification requires a fresh frame captured after the actions finish.",
      ),
      { status: 409 },
    );
  }
}
export function schemaFor(schema) {
  const result = z.toJSONSchema(schema);
  delete result.$schema;
  return result;
}
