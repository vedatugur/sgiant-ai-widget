import test from "node:test";
import assert from "node:assert/strict";
// From the BUILD: src/ uses extensionless imports node cannot resolve.
import { buildThreadReplay } from "../dist/replay.js";

/**
 * A TURN'S STEPS REPLAY BETWEEN ITS QUESTION AND ITS REPLY (sgiant-platform#504).
 *
 * A turn's question and reply are both saved when the turn ENDS. Its steps
 * ("Reading the post") are saved while it runs, so every step is older than
 * the question that started it, and a replay ordered by time alone drew a
 * turn's chips above its own question, under the previous reply.
 *
 * The timestamps are real: thread 456a1356 (wp-admin, hotelhideaway),
 * 2026-09-28, read from ai_message and ai_artifact. Turn 3 ran 50 seconds and
 * saved five steps before its question; turn 4 ran ten minutes.
 */

const T = (hms: string) => `2026-09-28T${hms}Z`;
const msg = (id: string, role: string, at: string, parentId: string | null) => ({
  id,
  parentId,
  role,
  content: `${role} ${id}`,
  createdAt: T(at),
});
const step = (label: string, at: string) => ({
  kind: "activity",
  status: "applied",
  createdAt: T(at),
  payload: { label, status: "ok" },
});

function thread() {
  return {
    messages: [
      msg("u1", "user", "11:07:19.710", null),
      msg("a1", "assistant", "11:07:19.786", "u1"),
      msg("u2", "user", "11:08:08.627", "a1"),
      msg("a2", "assistant", "11:08:08.649", "u2"),
      msg("u3", "user", "11:08:58.645", "a2"),
      msg("a3", "assistant", "11:08:58.666", "u3"),
      msg("u4", "user", "11:18:45.789", "a3"),
      msg("a4", "assistant", "11:18:45.813", "u4"),
    ],
    artifacts: [
      step("ToolSearch", "11:08:16.972"),
      step("ToolSearch", "11:08:20.160"),
      step("Reading the WordPress site", "11:08:22.458"),
      step("Reading the post", "11:08:28.003"),
      step("Reading the post", "11:08:28.193"),
      step("ToolSearch", "11:14:46.540"),
      {
        id: "p1",
        kind: "proposal",
        status: "proposed",
        createdAt: T("11:15:42.000"),
        payload: { name: "site_upsert_content", args: { id: 2061 } },
      },
    ],
    activePath: ["u1", "a1", "u2", "a2", "u3", "a3", "u4", "a4"],
  };
}

const shape = (items: ReturnType<typeof buildThreadReplay>) =>
  items.map((it) =>
    "role" in it
      ? it.id
      : it.kind === "activity"
        ? `step:${it.label}`
        : `${it.kind}:${"id" in it ? it.id : ""}`
  );

test("THE INCIDENT: each turn's steps replay after its question and before its reply", () => {
  assert.deepEqual(shape(buildThreadReplay(thread())), [
    "u1",
    "a1",
    "u2",
    "a2",
    // By time alone, all five sat here: above the question that asked for them.
    "u3",
    "step:ToolSearch",
    "step:ToolSearch",
    "step:Reading the WordPress site",
    "step:Reading the post",
    "step:Reading the post",
    "a3",
    "u4",
    "step:ToolSearch",
    "a4",
    // A decision still comes after the reply that explains it (#503).
    "proposal:p1",
  ]);
});

test("a question and reply saved in the same millisecond still hold their turn's steps between them", () => {
  const t = thread();
  t.messages[7] = { ...t.messages[7]!, createdAt: t.messages[6]!.createdAt };
  const s = shape(buildThreadReplay(t));
  assert.deepEqual(s.slice(s.indexOf("u4")), [
    "u4",
    "step:ToolSearch",
    "a4",
    "proposal:p1",
  ]);
});

test("a turn still running: its steps come last, by their own time", () => {
  const t = thread();
  t.messages = t.messages.slice(0, 6); // u4/a4 are not saved until it ends
  t.activePath = t.activePath.slice(0, 6);
  const s = shape(buildThreadReplay(t));
  assert.deepEqual(s.slice(s.indexOf("a3")), [
    "a3",
    "step:ToolSearch",
    "proposal:p1",
  ]);
});

test("steps whose reply is on ANOTHER branch leave with it", () => {
  const t = thread();
  // The owner regenerated turn 4: a4 hangs off another path now.
  t.activePath = ["u1", "a1", "u2", "a2", "u3", "a3"];
  assert.deepEqual(shape(buildThreadReplay(t)), [
    "u1",
    "a1",
    "u2",
    "a2",
    "u3",
    "step:ToolSearch",
    "step:ToolSearch",
    "step:Reading the WordPress site",
    "step:Reading the post",
    "step:Reading the post",
    "a3",
  ]);
});
