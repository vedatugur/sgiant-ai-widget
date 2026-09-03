/**
 * THE OPT-IN CHART RENDERER KNOWS WHAT IT CANNOT DRAW.
 *
 * `sgiant-ai-widget/charts` exists for surfaces with no charting stack — a
 * WordPress admin page, a plain embed. It draws three of the eight dashboard
 * widget types and REFUSES the rest by throwing, which the widget catches and
 * falls through to its own built-in: a stat tile for a kpi, a readable table
 * for the others.
 *
 * That refusal is the part worth testing. A bad heatmap made of rectangles is
 * worse than a table of the same numbers, and the failure mode of getting this
 * wrong is silent — a chart that is drawn but means nothing.
 *
 * The refusal path throws BEFORE touching the DOM, which is why it can be tested
 * in bare Node. The drawing paths need a document and are exercised in a browser
 * against examples/charts.html.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { createChartFallback } from "../dist/charts.js";

/** A host that fails loudly if anything tries to draw into it. */
const noDom = {
  appendChild() {
    throw new Error("drew into the host when it should have refused");
  },
} as unknown as HTMLElement;

const ROWS = [{ label: "a", value: 1 }];

test("it refuses every type it cannot draw well", () => {
  const render = createChartFallback();
  // kpi is better as the built-in stat tile than as a chart of one bar; the
  // table shapes are better as the built-in table than as anything this draws.
  for (const chartType of [
    "kpi",
    "table",
    "pivot_grid",
    "heatmap",
    "scatter",
    "content",
    "something_new",
  ])
    assert.throws(
      () => render(noDom, { chartType }, ROWS),
      /does not draw/,
      `"${chartType}" must fall through to the widget's built-in, not be approximated`
    );
});

test("it refuses an empty result rather than drawing an empty chart", () => {
  const render = createChartFallback();
  assert.throws(
    () => render(noDom, { chartType: "breakdown" }, []),
    /does not draw/,
    "no rows must reach the built-in, which says '(no data)'"
  );
});

test("it accepts the dashboard vocabulary, not just chart shapes", () => {
  // The backend sends `time_series` and `breakdown` — the dashboard widget
  // types — not `line` and `bar`. A renderer that only knew shape names would
  // draw BARS for a time series, which is a wrong chart rather than a styling
  // difference. Both vocabularies are accepted.
  const render = createChartFallback();
  for (const chartType of ["time_series", "breakdown", "donut", "line", "bar", "pie"]) {
    let refused = false;
    try {
      render(noDom, { chartType }, ROWS);
    } catch (err) {
      refused = /does not draw/.test(String(err));
      // Anything else means it TRIED to draw and only failed for lack of a DOM,
      // which is what we want to see here.
    }
    assert.equal(
      refused,
      false,
      `"${chartType}" was refused — the widget would fall back to a table for a type this can draw`
    );
  }
});

/**
 * The smallest document this renderer can draw into.
 *
 * Enough to record what was drawn and nothing more — the point is to assert the
 * NUMBERS the shapes encode, which needs no layout, no CSS and no browser.
 */
function fakeDocument() {
  const made: Array<{ tag: string; attrs: Record<string, string>; text?: string }> = [];
  const node = (tag: string) => {
    const attrs: Record<string, string> = {};
    const rec = { tag, attrs } as { tag: string; attrs: Record<string, string>; text?: string };
    made.push(rec);
    return {
      setAttribute: (k: string, v: string) => void (attrs[k] = String(v)),
      appendChild: () => {},
      set textContent(v: string) { rec.text = v; },
      style: { cssText: "" },
    };
  };
  return {
    made,
    doc: {
      createElementNS: (_ns: string, tag: string) => node(tag),
      createElement: (tag: string) => node(tag),
    },
  };
}

test("it plots the metric the model NAMED, not the last numeric column", () => {
  // The dashboard renderer takes `metrics` and `dimension` off the spec. This
  // guessed "the last numeric field" until 2026-09-03, so a row of
  // {period, revenue, bookings} plotted BOOKINGS here and revenue there — same
  // data, two different pictures, and no error on either side.
  const { made, doc } = fakeDocument();
  const prev = (globalThis as { document?: unknown }).document;
  (globalThis as { document?: unknown }).document = doc;
  try {
    createChartFallback({ animate: false })(
      { appendChild: () => {} } as unknown as HTMLElement,
      { chartType: "breakdown", metrics: ["revenue"], dimension: "period" },
      [
        { period: "Sep", revenue: 900, bookings: 3 },
        { period: "Oct", revenue: 100, bookings: 9 },
      ]
    );
  } finally {
    (globalThis as { document?: unknown }).document = prev;
  }

  const bars = made.filter((m) => m.tag === "rect").map((m) => Number(m.attrs.height));
  assert.equal(bars.length, 2, "two rows must draw two bars");
  assert.ok(
    bars[0] > bars[1],
    `September (revenue 900) must be the TALLER bar. Got ${bars[0]} vs ${bars[1]} — ` +
      `which is the shape of plotting \`bookings\` (3 vs 9) instead of the named metric.`
  );

  const labels = made.filter((m) => m.tag === "text").map((m) => m.text);
  assert.deepEqual(
    labels,
    ["Sep", "Oct"],
    "the axis must come from the named `dimension`, not from whichever field happens to be first"
  );
});
