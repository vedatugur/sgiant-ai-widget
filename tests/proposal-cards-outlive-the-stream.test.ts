import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
// From the BUILD: src/ uses extensionless imports node cannot resolve.
import { buildThreadReplay } from "../dist/replay.js";
import { isHttpUrl } from "../dist/safe-url.js";

/**
 * AN APPLY CARD OUTLIVES ITS STREAM (sgiant-platform#503).
 *
 * 2026-09-28, wp-admin on hotelhideaway: a turn proposed two WordPress edits at
 * 11:15:42 and 11:15:46. A page load at 11:18:29 cut the stream, and the reply
 * landed at 11:18:45 telling the owner the changes were waiting in approval
 * cards. There were none. The widget held cards until the reply's text was
 * drawn, a lost stream returned without drawing them, and nothing could draw
 * them again, because a proposal existed only as a frame.
 *
 * The server now keeps each proposal. These pin the widget's half: the replay
 * draws a kept proposal in the right place with the right state, and the live
 * paths stop dropping cards.
 */

const T = (hms: string) => `2026-09-28T${hms}.000Z`;

/** The incident's thread, as the transcript read returns it. */
function incident(opts: { status?: string; result?: unknown } = {}) {
  return {
    messages: [
      {
        id: "u1",
        parentId: null,
        role: "user",
        content: "Evcil hayvan politikasını güncelle",
        createdAt: T("11:10:00"),
      },
      {
        id: "a1",
        parentId: "u1",
        role: "assistant",
        content: "Sayfaları buldum. Devam edeyim mi?",
        createdAt: T("11:10:30"),
      },
      // A turn's question and reply are both saved when the turn ENDS.
      {
        id: "u2",
        parentId: "a1",
        role: "user",
        content: "Devam edebilirsin",
        createdAt: T("11:18:45"),
      },
      {
        id: "a2",
        parentId: "u2",
        role: "assistant",
        content: "İki değişiklik onay kartlarında sizi bekliyor.",
        createdAt: T("11:18:45"),
      },
    ],
    artifacts: [
      {
        id: "p1",
        kind: "proposal",
        status: opts.status ?? "proposed",
        createdAt: T("11:15:42"),
        payload: {
          name: "site_upsert_content",
          args: { id: 2061, status: "draft" },
          agent: "Copilot",
          ...(opts.result ? { result: opts.result } : {}),
        },
      },
      {
        id: "p2",
        kind: "proposal",
        status: "proposed",
        createdAt: T("11:15:46"),
        payload: {
          name: "site_upsert_content",
          args: { id: 1275, status: "draft" },
          fields: [{ arg: "title" }],
        },
      },
    ],
    activePath: ["u1", "a1", "u2", "a2"],
  };
}

const shape = (items: ReturnType<typeof buildThreadReplay>) =>
  items.map((it) =>
    "role" in it
      ? `${it.role}:${it.id}`
      : it.kind === "proposal"
        ? `proposal:${it.id}`
        : it.kind
  );

test("THE INCIDENT: both kept proposals replay, after the reply of their own turn, not above the question", () => {
  const items = buildThreadReplay(incident());
  // By createdAt alone they would sit between a1 and u2: above the very
  // "Devam edebilirsin" that asked for them.
  assert.deepEqual(shape(items), [
    "user:u1",
    "assistant:a1",
    "user:u2",
    "assistant:a2",
    "proposal:p1",
    "proposal:p2",
  ]);
  const p1 = items[4] as Extract<(typeof items)[number], { kind: "proposal" }>;
  assert.equal(p1.status, "proposed", "a live Apply card");
  assert.equal(p1.name, "site_upsert_content");
  assert.deepEqual(p1.args, { id: 2061, status: "draft" });
  assert.equal(p1.agent, "Copilot");
  const p2 = items[5] as typeof p1;
  assert.deepEqual(
    p2.fields,
    [{ arg: "title" }],
    "the fields the assistant asked for travel raw"
  );
});

test("an applied proposal replays as its outcome, link and all; a dismissed one not at all", () => {
  const applied = buildThreadReplay(
    incident({
      status: "applied",
      result: {
        message: "Draft saved ✓",
        href: "https://hotelhideaway.com/wp-admin/post.php?post=2061&action=edit",
        hrefLabel: "Open in WordPress",
      },
    })
  );
  const p1 = applied.find(
    (it) => "kind" in it && it.kind === "proposal" && it.id === "p1"
  ) as { status: string; result?: unknown };
  assert.equal(p1.status, "applied");
  assert.deepEqual(p1.result, {
    message: "Draft saved ✓",
    href: "https://hotelhideaway.com/wp-admin/post.php?post=2061&action=edit",
    hrefLabel: "Open in WordPress",
  });
  const dismissed = buildThreadReplay(incident({ status: "discarded" }));
  assert.deepEqual(
    shape(dismissed).filter((s) => s.startsWith("proposal")),
    ["proposal:p2"],
    "dismissing removed it from the live chat, so the replay does too"
  );
});

test("a turn still running: its kept proposals come last, by their own time", () => {
  const t = incident();
  t.messages = t.messages.slice(0, 2); // u2/a2 are not saved until the turn ends
  t.activePath = ["u1", "a1"];
  assert.deepEqual(shape(buildThreadReplay(t)), [
    "user:u1",
    "assistant:a1",
    "proposal:p1",
    "proposal:p2",
  ]);
});

test("a proposal whose reply is on ANOTHER branch belongs to that branch", () => {
  const t = incident();
  // The owner regenerated a1's answer: a2 now hangs off another path.
  t.activePath = ["u1", "a1"];
  assert.deepEqual(shape(buildThreadReplay(t)), ["user:u1", "assistant:a1"]);
});

test("a proposal with nothing to draw is skipped, not drawn empty", () => {
  const t = incident();
  t.artifacts = [
    {
      id: "",
      kind: "proposal",
      status: "proposed",
      createdAt: T("11:15:42"),
      payload: { name: "x", args: {} },
    },
    {
      id: "p9",
      kind: "proposal",
      status: "proposed",
      createdAt: T("11:15:42"),
      payload: { args: {} },
    },
  ] as never;
  assert.deepEqual(
    shape(buildThreadReplay(t)).filter((s) => s.startsWith("proposal")),
    []
  );
});

test("an outcome link must be http(s): it is kept and replayed, so a script URL would run on every reopen", () => {
  assert.equal(
    isHttpUrl(
      "https://hotelhideaway.com/wp-admin/post.php?post=2061&action=edit"
    ),
    true
  );
  assert.equal(isHttpUrl("http://localhost:8080/x"), true);
  for (const bad of [
    "javascript:alert(1)",
    "data:text/html,x",
    "/wp-admin/post.php",
    "",
    undefined,
    42,
  ])
    assert.equal(isHttpUrl(bad), false, String(bad));
});

// ─── the live paths ─────────────────────────────────────────────────────────
// No DOM here, so these read the code the way frame-contract-documented does.

const src = readFileSync(
  join(import.meta.dirname, "..", "src", "index.ts"),
  "utf8"
);
const cards = readFileSync(
  join(import.meta.dirname, "..", "src", "decision-cards.ts"),
  "utf8"
);

test("THE INCIDENT'S LIVE HALF: a lost stream draws its held cards before it waits", () => {
  const lost = src.slice(
    src.indexOf("if (transportLost && turnThread && opts.loadThread)")
  );
  const branch = lost.slice(0, lost.indexOf("return;"));
  assert.match(
    branch,
    /drawDeferred\(\)/,
    "the branch that used to return with the cards still held"
  );
  assert.ok(
    branch.indexOf("drawDeferred()") < branch.indexOf("recoverLostTurn"),
    "drawn first, then waited on"
  );
});

test("every transcript read goes through ONE normalizer — wp-admin handed the widget the raw payload", () => {
  const calls = src.match(/opts\.loadThread!?\(/g) ?? [];
  assert.equal(
    calls.length,
    1,
    `only loadThreadItems may call opts.loadThread, found ${calls.length}`
  );
  const fn = src.slice(src.indexOf("async function loadThreadItems"));
  assert.match(
    fn.slice(0, 900),
    /buildThreadReplay\(/,
    "the server's own shape is replayed, not iterated as items"
  );
});

test("a reload keeps the card on screen by its id — same node, typed values and all", () => {
  const render = src.slice(src.indexOf("function renderThreadItems"));
  const body = render.slice(
    0,
    render.indexOf("function renderReplayedProposal")
  );
  assert.match(body, /dataset\.proposalId/);
  assert.match(body, /carriedProposals/);
});

test("a replayed card is never auto-applied — the person was not there when it was proposed", () => {
  assert.match(src, /replayed: true/);
  const auto = cards.slice(cards.indexOf("AUTO-APPLY"));
  assert.match(auto.slice(0, 1600), /!replayed &&/);
});

test("Apply and Dismiss both report back, and only for a card the server kept", () => {
  assert.match(cards, /reportResolved\(proposalId, "applied"/);
  assert.match(cards, /reportResolved\(proposalId, "discarded"\)/);
  const fn = cards.slice(cards.indexOf("const reportResolved"));
  assert.match(fn.slice(0, 600), /if \(!proposalId \|\| !cb\) return;/);
});

test("a page load mid-turn waits for the turn, as a dropped connection does", () => {
  assert.match(src, /inflight = \{/, "the turn is remembered when sent");
  const restore = src.slice(src.indexOf("function paintOpeningView"));
  assert.match(
    restore.slice(0, 4000),
    /resumeInflight\(/,
    "and resumed when the page paints"
  );
});
