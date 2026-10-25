import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
// From the BUILD: src/ uses extensionless imports node cannot resolve.
import { buildThreadReplay } from "../dist/replay.js";
import { WIDGET_LABELS } from "../dist/labels.js";
import { WIDGET_LABELS_TR } from "../dist/labels-tr.js";

/**
 * sgiant-platform#661. Web search needs no switch; what it costs is said
 * where it happened: under the reply, its terms and its credits. And what
 * the account's AI page used to say (out of credits, unavailable) is a
 * notice at the top of the chat.
 */

const ROOT = join(import.meta.dirname, "..");
const src = readFileSync(join(ROOT, "src/index.ts"), "utf8");
const T = (hms: string) => `2026-10-25T${hms}Z`;

test("a reopened thread draws the searches under the reply they belong to", () => {
  const items = buildThreadReplay({
    messages: [
      {
        id: "u1",
        parentId: null,
        role: "user",
        content: "Kaş?",
        createdAt: T("10:00:00"),
      },
      {
        id: "a1",
        parentId: "u1",
        role: "assistant",
        content: "Doluluk…",
        createdAt: T("10:00:20"),
      },
      {
        id: "u2",
        parentId: "a1",
        role: "user",
        content: "Peki?",
        createdAt: T("10:01:00"),
      },
      {
        id: "a2",
        parentId: "u2",
        role: "assistant",
        content: "Tamam.",
        createdAt: T("10:01:05"),
      },
    ],
    artifacts: [
      {
        kind: "activity",
        status: "applied",
        messageId: "u1",
        createdAt: T("10:00:21"),
        payload: {
          name: "searches",
          status: "ok",
          queries: ["Kaş otel doluluk 2026", "Fethiye otel fiyatları"],
          count: 2,
          credits: 4,
        },
      },
    ],
  } as never) as Array<Record<string, unknown>>;
  const kinds = items.map((i) => (i.kind as string) ?? i.role);
  assert.deepEqual(kinds, [
    "user",
    "assistant",
    "searches",
    "user",
    "assistant",
  ]);
  assert.deepEqual(items[2], {
    kind: "searches",
    queries: ["Kaş otel doluluk 2026", "Fethiye otel fiyatları"],
    credits: 4,
  });
});

test("a record with no terms draws nothing, and an older widget's label-less step rule keeps it out", () => {
  const items = buildThreadReplay({
    messages: [
      {
        id: "u1",
        parentId: null,
        role: "user",
        content: "q",
        createdAt: T("10:00:00"),
      },
      {
        id: "a1",
        parentId: "u1",
        role: "assistant",
        content: "a",
        createdAt: T("10:00:05"),
      },
    ],
    artifacts: [
      {
        kind: "activity",
        status: "applied",
        messageId: "u1",
        createdAt: T("10:00:06"),
        payload: { name: "searches", status: "ok", queries: [], credits: 2 },
      },
    ],
  } as never) as Array<Record<string, unknown>>;
  assert.equal(items.filter((i) => i.kind === "searches").length, 0);
  assert.equal(items.filter((i) => i.kind === "activity").length, 0);
});

test("the line says the terms and the credits in the owner's words, both languages", () => {
  assert.equal(
    WIDGET_LABELS.searchedWeb,
    "Searched the web: {terms} · {credits} credits",
  );
  assert.equal(WIDGET_LABELS.searchedWebFree, "Searched the web: {terms}");
  assert.equal(
    WIDGET_LABELS_TR.searchedWeb,
    "Web'de aradı: {terms} · {credits} kredi",
  );
  assert.equal(WIDGET_LABELS_TR.searchedWebFree, "Web'de aradı: {terms}");
  // Live: the frame is read, then drawn under the reply (after the token
  // caption when there is one); a turn nobody pays for has no credits part.
  assert.match(
    src,
    /frame\.type === "searches" && Array\.isArray\(frame\.queries\)/,
  );
  assert.match(
    src,
    /credits === null\s*\?\s*L\("searchedWebFree", \{ terms \}\)/,
  );
  assert.match(src, /line\.textContent =/, "the terms are text, never markup");
  assert.match(src, /it\.kind === "searches"/);
});

test("the notice at the top is the host's words, refreshed on open and after each turn, with a safe link", () => {
  assert.match(
    src,
    /getNotice\?: \(\) => Promise<WidgetNotice \| null> \| WidgetNotice \| null;/,
  );
  assert.match(src, /chatCol\.append\(\s*header,\s*noticeEl,\s*log,/);
  assert.equal(src.match(/void refreshNotice\(\);/g)?.length, 2);
  assert.match(
    src,
    /\(external \|\| isSafeRelPath\(href\)\)/,
  );
});
