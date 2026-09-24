import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizeWidgetSpec, widgetSourceBadge } from "../dist/specs.js";
import { WIDGET_LABELS } from "../dist/labels.js";

/**
 * A WIDGET SAYS WHERE ITS NUMBERS CAME FROM (sgiant-platform#483).
 *
 * On 2026-09-23 an assistant drew a 2027 room price list it had invented and
 * the card looked exactly like measured data. The gateway now makes the model
 * declare `source` and refuses a false "fetched" — but an HONEST estimate was
 * still drawn indistinguishably from a measurement, because `source` reached
 * this package and nothing read it. Worse, the gateway was telling the model
 * its estimate was "labelled as an ESTIMATE on screen".
 */

test("an estimate is badged", () => {
  assert.equal(widgetSourceBadge({ source: "estimate" }), "estimate");
});

test("figures the person typed are badged as theirs", () => {
  assert.equal(widgetSourceBadge({ source: "admin-provided" }), "provided");
});

test("measured data carries no badge — so a badge is always news", () => {
  assert.equal(widgetSourceBadge({ source: "fetched" }), null);
});

test("a widget from before the field existed is not badged", () => {
  // Every widget in history predates `source`. Badging the absence would mark
  // months of real, measured tables as something they are not.
  assert.equal(widgetSourceBadge({}), null);
  assert.equal(widgetSourceBadge({ source: "something-new" }), null);
});

test("`source` survives normalisation of a nested payload", () => {
  // Models nest the payload under `data` (a JSON string, even). The badge
  // reads the NORMALISED spec, so source must come through the unwrap.
  const spec = normalizeWidgetSpec({
    kind: "table",
    source: "estimate",
    data: JSON.stringify({ columns: ["Ay", "Fiyat"], rows: [["Ocak", "1.200 ₺"]] }),
  } as never);
  assert.equal(widgetSourceBadge(spec), "estimate");
});

test("both badges have English defaults a host can translate", () => {
  // Hosts resolve `chatWidget.<key>`; a missing key shows this default, which
  // is why each host must also carry a Turkish string.
  assert.ok(WIDGET_LABELS.widgetSourceEstimate.length > 0);
  assert.ok(WIDGET_LABELS.widgetSourceProvided.length > 0);
});

test("the renderer draws the badge from that one function", () => {
  // The decision is tested above; this pins that the card actually asks it.
  const src = readFileSync(new URL("../src/ui-render.ts", import.meta.url), "utf8");
  assert.match(src, /const badge = widgetSourceBadge\(spec\);/);
  assert.match(src, /widgetSourceEstimate/);
  assert.match(src, /widgetSourceProvided/);
});

/**
 * THE BADGE MUST BE READABLE IN BOTH THEMES — computed, not eyeballed.
 *
 * The first version coloured it `var(--aiw-warning, #b45309)`. No theme defines
 * --aiw-warning, so it fell back to #b45309, which sits at 3,4:1 on the dark
 * card: under the 4.5:1 WCAG AA floor for small text. The caution tokens are
 * defined once per theme block, and this reads them out of the stylesheet and
 * does the arithmetic, so a later palette change cannot quietly break it.
 */
const STYLES = readFileSync(new URL("../src/styles.ts", import.meta.url), "utf8");

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const f = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

test("the estimate badge clears WCAG AA in the light AND the dark theme", () => {
  const text = [...STYLES.matchAll(/--aiw-caution-text:(#[0-9a-fA-F]{6})/g)].map((m) => m[1]);
  const bg = [...STYLES.matchAll(/--aiw-caution-bg:(#[0-9a-fA-F]{6})/g)].map((m) => m[1]);
  assert.equal(text.length, 2, "one caution palette per theme block");
  assert.equal(bg.length, 2);
  for (let i = 0; i < 2; i++) {
    const ratio = contrast(text[i], bg[i]);
    assert.ok(ratio >= 4.5, `theme ${i}: ${text[i]} on ${bg[i]} is ${ratio.toFixed(1)}:1`);
  }
});

test("the badge uses the themed tokens, not a one-theme fallback colour", () => {
  assert.match(STYLES, /-widget-source-estimate\{background:var\(--aiw-caution-bg\);border-color:var\(--aiw-caution-border\);color:var\(--aiw-caution-text\)\}/);
  assert.doesNotMatch(STYLES, /--aiw-warning,#b45309/);
});
