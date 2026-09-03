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
