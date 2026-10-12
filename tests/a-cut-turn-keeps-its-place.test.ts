import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
// From the BUILD: src/ uses extensionless imports node cannot resolve.
import { buildThreadReplay, endsWithQuestion } from "../dist/replay.js";
import { SKIP_WITHOUT_CHROME, withBrowser } from "./aiw-browser.ts";

/**
 * A CUT TURN'S STEPS STAY UNDER THEIR OWN QUESTION, AND A SAVED QUESTION IS
 * DRAWN ONCE (sgiant-platform#639).
 *
 * A replay placed a step by "the first reply saved after it", which is its own
 * turn's reply only while every turn HAS a reply. A turn whose connection was
 * cut has none, so on reload its steps and its decision cards were drawn
 * inside the NEXT turn, under a question that never asked for them.
 *
 * A server that saves the question when the turn starts can say whose they
 * are: a step's or a decision's `messageId` is then the id of its question.
 * These hold both orders, so the window can ship before such a server does:
 * with the id, by the question; without it, exactly as before.
 */

const T = (hms: string) => `2026-10-12T${hms}Z`;
const msg = (id: string, role: string, at: string, parentId: string | null) => ({
  id,
  parentId,
  role,
  content: `${role} ${id}`,
  createdAt: T(at),
});
const step = (label: string, at: string, messageId: string | null) => ({
  kind: "activity",
  status: "applied",
  messageId,
  createdAt: T(at),
  payload: { label, status: "ok" },
});
const card = (id: string, at: string, messageId: string | null) => ({
  id,
  kind: "proposal",
  status: "proposed",
  messageId,
  createdAt: T(at),
  payload: { name: "site_upsert_content", args: { id: 1 } },
});
const shape = (items: ReturnType<typeof buildThreadReplay>) =>
  items.map((it) =>
    "role" in it
      ? it.id
      : it.kind === "activity"
        ? `step:${it.label}`
        : `${it.kind}:${"id" in it ? it.id : ""}`
  );

/**
 * Turn 2 was cut: its question was saved when it started, it took two steps
 * and proposed a write, and no reply was ever saved. Then the person asked
 * again, and turn 3 ran to its end.
 */
function cutThenAsked(ids: boolean) {
  const of = (q: string) => (ids ? q : null);
  return {
    messages: [
      msg("u1", "user", "10:00:00.000", null),
      msg("a1", "assistant", "10:00:20.000", "u1"),
      msg("u2", "user", "10:01:00.000", "a1"),
      msg("u3", "user", "10:05:00.000", "u2"),
      msg("a3", "assistant", "10:05:40.000", "u3"),
    ],
    artifacts: [
      step("one", "10:00:05.000", of("u1")),
      step("two-a", "10:01:05.000", of("u2")),
      step("two-b", "10:01:09.000", of("u2")),
      card("p2", "10:01:12.000", of("u2")),
      step("three", "10:05:10.000", of("u3")),
      card("p3", "10:05:30.000", of("u3")),
    ],
    activePath: ["u1", "a1", "u2", "u3", "a3"],
  };
}

test("THE FAULT: a cut turn's steps and card stay under its own question", () => {
  assert.deepEqual(shape(buildThreadReplay(cutThenAsked(true))), [
    "u1",
    "step:one",
    "a1",
    "u2",
    "step:two-a",
    "step:two-b",
    "proposal:p2",
    "u3",
    "step:three",
    "a3",
    "proposal:p3",
  ]);
});

test("without the question's id the old rule runs, fault and all", () => {
  // What every server sends today. The cut turn's steps take turn 3's reply:
  // this is the fault, held here so that the old rule is seen to be untouched.
  assert.deepEqual(shape(buildThreadReplay(cutThenAsked(false))), [
    "u1",
    "step:one",
    "a1",
    "u2",
    "u3",
    "step:two-a",
    "step:two-b",
    "step:three",
    "a3",
    "proposal:p2",
    "proposal:p3",
  ]);
});

test("a turn still running: its steps follow its saved question, in their own order", () => {
  const t = cutThenAsked(true);
  t.messages = t.messages.slice(0, 3);
  t.artifacts = t.artifacts.slice(0, 4);
  t.activePath = ["u1", "a1", "u2"];
  assert.deepEqual(shape(buildThreadReplay(t)), [
    "u1",
    "step:one",
    "a1",
    "u2",
    "step:two-a",
    "step:two-b",
    "proposal:p2",
  ]);
});

test("a regenerated answer: the replaced answer's steps leave with it", () => {
  // Both answers have the SAME question, so its id alone cannot tell their
  // steps apart; the reply each step belongs to can.
  const t = {
    messages: [
      msg("u1", "user", "10:00:00.000", null),
      msg("a1", "assistant", "10:00:30.000", "u1"),
      msg("a1b", "assistant", "10:02:30.000", "u1"),
    ],
    artifacts: [
      step("first try", "10:00:10.000", "u1"),
      card("pA", "10:00:20.000", "u1"),
      step("second try", "10:02:10.000", "u1"),
      card("pB", "10:02:20.000", "u1"),
    ],
    activePath: ["u1", "a1b"],
  };
  assert.deepEqual(shape(buildThreadReplay(t)), [
    "u1",
    "step:second try",
    "a1b",
    "proposal:pB",
  ]);
  // And the other way round, when the person steps back to the first answer.
  t.activePath = ["u1", "a1"];
  assert.deepEqual(shape(buildThreadReplay(t)), [
    "u1",
    "step:first try",
    "a1",
    "proposal:pA",
  ]);
});

test("a question on another branch takes its steps with it", () => {
  const t = cutThenAsked(true);
  // The person edited question 2 into u2b; u2 and all under it are off.
  t.messages.push(msg("u2b", "user", "10:08:00.000", "a1"));
  t.activePath = ["u1", "a1", "u2b"];
  assert.deepEqual(shape(buildThreadReplay(t)), ["u1", "step:one", "a1", "u2b"]);
});

test("rows between a reply and its question are walked past", () => {
  const t = {
    messages: [
      msg("u1", "user", "10:00:00.000", null),
      msg("tool1", "tool", "10:00:05.000", "u1"),
      msg("tool2", "tool", "10:00:08.000", "tool1"),
      msg("a1", "assistant", "10:00:30.000", "tool2"),
    ],
    artifacts: [step("one", "10:00:04.000", "u1")],
    activePath: ["u1", "tool1", "tool2", "a1"],
  };
  assert.deepEqual(shape(buildThreadReplay(t)), ["u1", "step:one", "a1"]);
});

test("a turn saved as several rows: a card waits for the reply that has words", () => {
  // One worker saves a row per round of tool calls (an assistant row with no
  // text, then a tool row per call), each under the one before, and the reply
  // last. The card was proposed during the first round.
  const empty = (id: string, at: string, parentId: string) => ({
    ...msg(id, "assistant", at, parentId),
    content: "",
  });
  const t = {
    messages: [
      msg("u1", "user", "10:00:00.000", null),
      empty("r1", "10:00:10.000", "u1"),
      msg("t1", "tool", "10:00:11.000", "r1"),
      empty("r2", "10:00:20.000", "t1"),
      msg("t2", "tool", "10:00:21.000", "r2"),
      msg("a1", "assistant", "10:00:30.000", "t2"),
    ],
    artifacts: [
      step("reading", "10:00:05.000", "u1"),
      card("p1", "10:00:08.000", "u1"),
      step("writing", "10:00:15.000", "u1"),
    ],
    activePath: ["u1", "r1", "t1", "r2", "t2", "a1"],
  };
  assert.deepEqual(shape(buildThreadReplay(t)), [
    "u1",
    "step:reading",
    "step:writing",
    "a1",
    "proposal:p1",
  ]);
});

test("a step stamped before its own question still sits after it", () => {
  const t = cutThenAsked(true);
  t.artifacts[1] = step("two-a", "10:00:59.990", "u2");
  const s = shape(buildThreadReplay(t));
  assert.deepEqual(s.slice(s.indexOf("a1"), s.indexOf("u3")), [
    "a1",
    "u2",
    "step:two-a",
    "step:two-b",
    "proposal:p2",
  ]);
});

test("an id that names no question changes nothing", () => {
  const plain = shape(buildThreadReplay(cutThenAsked(false)));
  for (const id of ["a1", "nobody"]) {
    const t = cutThenAsked(false);
    // "a1" is a reply; "nobody" is not in the thread and, being off the
    // active path, hides the artifact as it always has.
    t.artifacts = t.artifacts.map((a) =>
      a.kind === "activity" && a.payload.label === "three"
        ? { ...a, messageId: id }
        : a
    );
    const got = shape(buildThreadReplay(t));
    assert.deepEqual(
      got,
      id === "a1" ? plain : plain.filter((x) => x !== "step:three"),
      id
    );
  }
});

test("a chart is placed by its own time, whatever its messageId says", () => {
  const t = cutThenAsked(true);
  (t.artifacts as unknown[]).push({
    kind: "widget",
    messageId: "u2",
    createdAt: T("10:05:35.000"),
    payload: { spec: { type: "kpi" }, rows: [] },
  });
  const s = shape(buildThreadReplay(t));
  // In turn 3, where its time puts it (a step is anchored to its reply, so
  // the chart's own time comes first); not pulled up to question 2.
  assert.deepEqual(s.slice(s.indexOf("u3")), [
    "u3",
    "widget:",
    "step:three",
    "a3",
    "proposal:p3",
  ]);
});

test("the saved list ends with the question: it is not drawn a second time", () => {
  const saved = buildThreadReplay({
    messages: [
      msg("u1", "user", "10:00:00.000", null),
      msg("a1", "assistant", "10:00:20.000", "u1"),
      { ...msg("u2", "user", "10:01:00.000", "a1"), content: "  And May? " },
    ],
    artifacts: [step("two-a", "10:01:05.000", "u2")],
    activePath: ["u1", "a1", "u2"],
  });
  // Steps after it do not hide it: it is the last MESSAGE that counts.
  assert.equal(endsWithQuestion(saved, "And May?"), true);
  assert.equal(endsWithQuestion(saved, "And June?"), false);
  // A list that ends with a reply has not got THIS question, even when an
  // earlier one read the same.
  assert.equal(endsWithQuestion(saved.slice(0, 2), "user u1"), false);
  assert.equal(endsWithQuestion([], "anything"), false);
});

test("the window asks before it adds the question it remembers", () => {
  const code = readFileSync("src/index.ts", "utf8");
  const fn = code.slice(code.indexOf("function withPendingQuestion("));
  assert.match(
    fn.slice(0, fn.indexOf("let lastMsg")),
    /turnLanded\(items, f\.content\) \|\|[\s\S]*endsWithQuestion\(items, f\.content\)/
  );
});

/* ---------------------------------------------------------- in a browser */

const Q = "Bu ay kaç rezervasyon aldık?";

/**
 * Runs in the page: a window with a history. The server names the
 * conversation and drops the connection; `again` is the same page being
 * loaded a second time (the window is torn down and made anew, and finds
 * what it kept in the browser's storage).
 */
const MOUNT = (again: boolean): void => {
  const g = globalThis as any;
  if (again) g.T.w.destroy();
  else {
    g.T = { saved: [] as unknown[], w: null };
    g.fetch = async (input: any) => {
      const url = typeof input === "string" ? input : input.url;
      if (!String(url).includes("/demo-chat"))
        return new Response("{}", { status: 404 });
      const body = new ReadableStream({
        start(c) {
          c.enqueue(
            new TextEncoder().encode(JSON.stringify({ threadId: "th-1" }) + "\n")
          );
          setTimeout(() => c.error(new TypeError("network error")), 50);
        },
      });
      return new Response(body, {
        status: 200,
        headers: { "content-type": "application/x-ndjson" },
      });
    };
  }
  g.T.w = g.SgiantAiWidget.createAiChatWidget({
    endpoint: "/demo-chat",
    title: "AYCA",
    // What makes the window keep its conversation across page loads.
    persistKey: "reload-test",
    getToken: () => Promise.resolve("tok"),
    listThreads: async () => [{ id: "th-1", title: "Rezervasyonlar" }],
    loadThread: async () => g.T.saved,
  });
  g.T.w.open();
};

const ASK = (q: string): void => {
  const input = document.querySelector(
    '[data-ai-target="widget-composer"]'
  ) as HTMLInputElement;
  input.value = q;
  input.closest("form")!.requestSubmit();
};

/** Runs in the page, after `ms`: the log, top to bottom. */
const LOG = async (ms: number): Promise<string[]> => {
  await new Promise((r) => setTimeout(r, ms));
  const P = "sgiant-aiw";
  return [
    ...document.querySelectorAll(
      `.${P}-panel .${P}-msg.${P}-user, .${P}-panel .${P}-msg.${P}-assistant`
    ),
  ].map(
    (m) =>
      (m.classList.contains(`${P}-user`) ? "Q: " : "A: ") +
      (m.textContent ?? "")
  );
};

test(
  "in a browser: a page loaded again while its turn is cut",
  { skip: SKIP_WITHOUT_CHROME },
  async (t) => {
    await withBrowser(async (page) => {
      const cutThenLoadedAgain = async (saved: unknown[]) => {
        await page.open([1280, 800]);
        await page.evaluate(`localStorage.clear()`);
        await page.evaluate(`(${MOUNT})(false)`);
        await page.evaluate(`(${ASK})(${JSON.stringify(Q)})`);
        await page.evaluate(`(${LOG})(300)`);
        await page.evaluate(`T.saved = ${JSON.stringify(saved)}`);
        await page.evaluate(`(${MOUNT})(true)`);
        return page.evaluate<string[]>(`(${LOG})(500)`);
      };

      await t.test("the server saved the question at the start: it is drawn once", async () => {
        const log = await cutThenLoadedAgain([
          { role: "user", content: "Merhaba" },
          { role: "assistant", content: "Merhaba!" },
          { role: "user", content: Q },
        ]);
        assert.deepEqual(log, ["Q: Merhaba", "A: Merhaba!", `Q: ${Q}`]);
      });

      await t.test("the server has not saved it (today): the window still draws it", async () => {
        const log = await cutThenLoadedAgain([
          { role: "user", content: "Merhaba" },
          { role: "assistant", content: "Merhaba!" },
        ]);
        assert.deepEqual(log, ["Q: Merhaba", "A: Merhaba!", `Q: ${Q}`]);
      });
    });
  }
);
