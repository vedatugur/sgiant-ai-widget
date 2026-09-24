import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizeWidgetSpec, widgetHasContent } from "../dist/specs.js";

/**
 * TWO DEFECTS FROM ONE CONVERSATION (sgiant-platform#483, #487).
 */

// ─── #487: rows sent as an ARRAY of objects ─────────────────────────────────

const CHANNELS = [
  { channel: "Booking.com", revenue: "1,000,000 TRY", bookings: 900 },
  { channel: "Direkt", revenue: "600,000 TRY", bookings: 700 },
];

test("rows sent as an array of objects are a table — from a JSON string", () => {
  // The prod shape, 2026-09-17: `data` was a STRING holding an array. It used
  // to fall through, leave `rows` empty, and draw nothing.
  const spec = normalizeWidgetSpec({
    kind: "table",
    title: "Rezervasyon Kanalları",
    data: JSON.stringify(CHANNELS),
  } as never);
  assert.deepEqual(spec.columns, ["channel", "revenue", "bookings"]);
  assert.deepEqual(spec.rows, [
    ["Booking.com", "1,000,000 TRY", 900],
    ["Direkt", "600,000 TRY", 700],
  ]);
  assert.equal(widgetHasContent(spec), true, "the table is drawn now");
});

test("…and from a raw array", () => {
  const spec = normalizeWidgetSpec({ kind: "table", data: CHANNELS } as never);
  assert.equal(spec.rows?.length, 2);
});

test("a cell a later row lacks is blank, not a crash or a shifted column", () => {
  const spec = normalizeWidgetSpec({
    kind: "table",
    data: [{ a: 1, b: 2 }, { a: 3 }],
  } as never);
  assert.deepEqual(spec.rows, [[1, 2], [3, ""]]);
});

test("an empty array still draws nothing — 'nothing' must stay true", () => {
  const spec = normalizeWidgetSpec({ kind: "table", data: "[]" } as never);
  assert.equal(widgetHasContent(spec), false);
});

test("explicit columns/rows win over the payload", () => {
  const spec = normalizeWidgetSpec({
    kind: "table",
    columns: ["Kanal"],
    rows: [["x"]],
    data: CHANNELS,
  } as never);
  assert.deepEqual(spec.columns, ["Kanal"]);
  assert.deepEqual(spec.rows, [["x"]]);
});

// ─── #483 item 5: no duplicate turn while one is still running ──────────────
// The widget has no DOM harness; these pin the two lines that decide it, and
// the behaviour was checked in a browser against a stub that drops the stream.
const SRC = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");

test("the stream-lost card offers no 'Try again' — the turn is still running", () => {
  assert.match(SRC, /showError\(L\("streamLostRecovering"\), \{ retry: false \}\)/);
});

test("'Try again' never sends while a turn is in flight", () => {
  const at = SRC.indexOf('retry.textContent = L("tryAgain");');
  assert.ok(at > 0);
  const handler = SRC.slice(at, at + 700);
  assert.match(handler, /if \(busy\) return;/);
  assert.ok(
    handler.indexOf("if (busy) return;") < handler.indexOf("void send(lastUserContent)"),
    "the guard must come before the send"
  );
});

test("the no-retry card leads with its own message, not 'please try again'", () => {
  // Found in the browser, not by reading: the button was gone and the headline
  // still said "couldn't answer. Please try again." above "still working".
  const at = SRC.indexOf("function showError(raw: string, show");
  const body = SRC.slice(at, at + 1200);
  assert.match(body, /show\.retry === false \? raw : L\("errorSnag"/);
});
