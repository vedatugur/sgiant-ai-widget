/**
 * A WIDGET WITH DATA MUST NOT DRAW AS AN EMPTY BOX.
 *
 * Measured on the sgiant hub, 2026-09-08. A staff turn read the estate, had ten
 * sites with their status, and emitted:
 *
 *   { kind: "table", title: "Site durumu (canlı)",
 *     data: "{\"columns\":[…],\"rows\":[…]}" }
 *
 * `data` is a field neither the tool schema nor `WidgetSpec` has, so the payload
 * was dropped and the card rendered a heading over an empty bullet list. The
 * person reading it sees "there was nothing to show" — the exact opposite of
 * what happened, and unfalsifiable from the outside.
 *
 * Two properties, and the second matters as much as the first: unwrap the
 * envelope, and when there is genuinely nothing, draw NOTHING. An empty card is
 * a claim about the data; an absent one claims less and is always true.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { normalizeWidgetSpec, widgetHasContent } from "../dist/specs.js";

const HUB_ROWS = {
  columns: ["Site", "Domain", "Durum"],
  rows: [
    ["Luna Kaş", "lunakas.com", "up"],
    ["Mavilim Otel", "mavilimotel.com", "up"],
  ],
};

test("a stringified data envelope is lifted into the spec", () => {
  const spec = normalizeWidgetSpec({
    kind: "table",
    title: "Site durumu (canlı)",
    data: JSON.stringify(HUB_ROWS),
  });
  assert.deepEqual(spec.columns, HUB_ROWS.columns);
  assert.deepEqual(spec.rows, HUB_ROWS.rows);
  assert.equal(spec.title, "Site durumu (canlı)");
  assert.equal(spec.data, undefined, "the envelope is consumed, not carried");
  assert.ok(widgetHasContent(spec));
});

test("an object envelope works the same", () => {
  const spec = normalizeWidgetSpec({ kind: "table", data: HUB_ROWS });
  assert.deepEqual(spec.rows, HUB_ROWS.rows);
});

test("the envelope cannot restyle the card", () => {
  // Only the payload fields are lifted. An envelope naming `kind` or `title`
  // would let a nested blob reshape the card the producer asked for, which is a
  // different thing from filling in its data.
  const spec = normalizeWidgetSpec({
    kind: "table",
    title: "Mine",
    data: { kind: "stat", title: "Theirs", rows: HUB_ROWS.rows },
  });
  assert.equal(spec.kind, "table");
  assert.equal(spec.title, "Mine");
  assert.deepEqual(spec.rows, HUB_ROWS.rows);
});

test("real fields win over the envelope", () => {
  const spec = normalizeWidgetSpec({
    kind: "table",
    rows: [["kept"]],
    data: { rows: [["dropped"]] },
  });
  assert.deepEqual(spec.rows, [["kept"]]);
});

test("a malformed envelope changes nothing and stays empty", () => {
  const spec = normalizeWidgetSpec({ kind: "table", data: "{not json" });
  assert.equal(spec.rows, undefined);
  assert.equal(
    widgetHasContent(spec),
    false,
    "and having nothing to draw is what stops the empty card",
  );
});

test("each kind knows whether it has anything to show", () => {
  assert.equal(widgetHasContent({ kind: "table", rows: [] }), false);
  assert.equal(widgetHasContent({ kind: "table", columns: ["a"] }), false);
  assert.equal(widgetHasContent({ kind: "kpis", items: [] }), false);
  assert.equal(widgetHasContent({ kind: "stat", value: "" }), false);
  assert.equal(widgetHasContent({ kind: "list", lines: [] }), false);
  assert.equal(widgetHasContent({ kind: "stat", value: 0 }), true);
  assert.equal(widgetHasContent({ kind: "list", lines: ["a"] }), true);
  assert.equal(widgetHasContent({ title: "just a title" }), false);
});

/**
 * AND A WIDE TABLE SCROLLS INSIDE ITS OWN CARD.
 *
 * The first table the hub ever drew was five columns of ten domains in a 380px
 * panel: it painted past the card and put a horizontal scrollbar on the whole
 * conversation. Measured in a browser against the built stylesheet — table
 * 651px, card 380px — the scroller now takes the overflow (356 → 651) and the
 * log does not move. Asserted here on the source, because a stylesheet is not
 * something the node suite can lay out.
 */
test("the table has a scroll container and the card cannot be stretched", async () => {
  const { readFileSync } = await import("node:fs");
  const styles = readFileSync(
    new URL("../src/styles.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    styles,
    /-widget-scroll\{overflow-x:auto/,
    "the table needs a box of its own to scroll in",
  );
  assert.match(
    styles,
    /-widget\{align-self:stretch;max-width:100%;min-width:0/,
    "and the card must not be widened by what is inside it",
  );
  const render = readFileSync(
    new URL("../src/ui-render.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    render,
    /scroller\.appendChild\(table\)/,
    "the table goes INTO the scroller — appending it to the card is the bug",
  );
});
