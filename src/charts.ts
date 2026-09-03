/**
 * An optional, dependency-free chart renderer for `renderChartFallback`.
 *
 * WHY THIS IS A SEPARATE ENTRY POINT. The widget core deliberately contains no
 * chart code: hosts that have a real charting stack (ours mounts the same
 * component its dashboards use) should render with it, and a core that carried
 * a second implementation would make every consumer pay for one they do not
 * use. This is opt-in, imported from `sgiant-ai-widget/charts`, and nothing in
 * the main entry references it — so it costs zero bytes unless you ask.
 *
 * WHO IT IS FOR. Surfaces with no charting stack and no build step: a WordPress
 * admin page loading the global bundle, a third-party embed, a documentation
 * example. It exists so those three do not each write their own — which is the
 * drift this package has spent its short life avoiding elsewhere.
 *
 * WHO IT IS NOT FOR. A React app that already has charts. Use those instead:
 * they will be better than this, and they are already in your bundle.
 *
 * It draws with inline SVG and reads the widget's own `--aiw-*` custom
 * properties, so a chart follows whatever theme the host set rather than
 * carrying a palette of its own.
 */

const NS = "http://www.w3.org/2000/svg";

/** One row of a `widget` frame. Values are whatever the backend sent. */
export type ChartRow = Record<string, unknown>;

/** The `spec` half of a `widget` frame. */
export interface ChartSpec {
  title?: string;
  chartType?: string;
}

export interface ChartFallbackOptions {
  /**
   * Animate on first paint. Default true.
   *
   * Animation is also disabled automatically when the reader has asked for
   * reduced motion — this option is for hosts that want it off regardless, such
   * as a print view or a dense dashboard where six charts arriving at once is
   * noise rather than delight.
   */
  animate?: boolean;
  /** Height of the drawing area in px. Default 140. */
  height?: number;
}

function el<K extends keyof SVGElementTagNameMap>(
  name: K,
  attrs: Record<string, string | number> = {}
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

/**
 * The numeric value of a row.
 *
 * The LAST numeric field, matching what the widget's own built-in stat does, so
 * a backend that works with one works with the other. A row of
 * `{period, revenue}` measures revenue; `{label, value}` measures value.
 */
function valueOf(row: ChartRow): number {
  const keys = Object.keys(row).filter((k) => typeof row[k] === "number");
  return keys.length ? Number(row[keys[keys.length - 1]]) : 0;
}

/** The label of a row: an explicit `label`, else the first field. */
function labelOf(row: ChartRow): string {
  const v = row.label ?? Object.values(row)[0];
  return v == null ? "" : String(v);
}

function prefersReducedMotion(): boolean {
  try {
    return matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    // A host without matchMedia is not a reason to refuse to draw.
    return false;
  }
}

function animateAttr(
  target: SVGElement,
  attributeName: string,
  from: string | number,
  to: string | number,
  begin: number
): void {
  target.appendChild(
    el("animate", {
      attributeName,
      from,
      to,
      dur: "0.6s",
      begin: `${begin}s`,
      fill: "freeze",
    })
  );
}

function drawBars(rows: ChartRow[], H: number, animate: boolean): SVGSVGElement {
  const W = 320;
  const pad = 22;
  const max = Math.max(...rows.map(valueOf), 1);
  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, width: "100%", role: "img" });
  const slot = (W - pad * 2) / Math.max(rows.length, 1);
  rows.forEach((row, i) => {
    const h = ((H - pad * 2) * valueOf(row)) / max;
    const x = pad + i * slot + 4;
    const w = Math.max(slot - 8, 2);
    const bar = el("rect", {
      x,
      y: animate ? H - pad : H - pad - h,
      width: w,
      height: animate ? 0 : h,
      rx: 3,
      fill: "var(--aiw-accent)",
    });
    if (animate) {
      animateAttr(bar, "height", 0, h, i * 0.07);
      animateAttr(bar, "y", H - pad, H - pad - h, i * 0.07);
    }
    svg.appendChild(bar);
    const text = el("text", {
      x: x + w / 2,
      y: H - 6,
      "text-anchor": "middle",
      "font-size": 9,
      fill: "var(--aiw-muted)",
    });
    text.textContent = labelOf(row).slice(0, 9);
    svg.appendChild(text);
  });
  return svg;
}

function points(rows: ChartRow[], W: number, H: number, pad: number, max: number): string {
  return rows
    .map((row, i) => {
      const x = pad + (i * (W - pad * 2)) / Math.max(rows.length - 1, 1);
      const y = H - pad - ((H - pad * 2) * valueOf(row)) / max;
      return `${x},${y}`;
    })
    .join(" ");
}

function drawLine(
  rows: ChartRow[],
  comparison: ChartRow[] | undefined,
  H: number,
  animate: boolean
): SVGSVGElement {
  const W = 320;
  const pad = 22;
  const max = Math.max(...[...rows, ...(comparison ?? [])].map(valueOf), 1);
  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, width: "100%", role: "img" });
  if (comparison?.length)
    svg.appendChild(
      el("polyline", {
        points: points(comparison, W, H, pad, max),
        fill: "none",
        stroke: "var(--aiw-muted)",
        "stroke-width": 1.5,
        "stroke-dasharray": "4 4",
        opacity: 0.7,
      })
    );
  const line = el("polyline", {
    points: points(rows, W, H, pad, max),
    fill: "none",
    stroke: "var(--aiw-accent)",
    "stroke-width": 2.5,
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
  });
  svg.appendChild(line);
  if (animate)
    // The length can only be measured once the node is in a document, so this
    // waits a frame rather than guessing — a guessed length either clips the
    // line or leaves it visibly finishing late.
    requestAnimationFrame(() => {
      const len = typeof line.getTotalLength === "function" ? line.getTotalLength() : 0;
      if (!len) return;
      line.setAttribute("stroke-dasharray", String(len));
      line.setAttribute("stroke-dashoffset", String(len));
      animateAttr(line, "stroke-dashoffset", len, 0, 0);
    });
  return svg;
}

function drawDonut(rows: ChartRow[], animate: boolean): SVGSVGElement {
  const S = 140;
  const r = 46;
  const C = 2 * Math.PI * r;
  const total = rows.reduce((sum, row) => sum + valueOf(row), 0) || 1;
  const svg = el("svg", { viewBox: `0 0 ${S} ${S}`, width: "100%", height: S + 10, role: "img" });
  let acc = 0;
  rows.forEach((row, i) => {
    const frac = valueOf(row) / total;
    const arc = el("circle", {
      cx: S / 2,
      cy: S / 2,
      r,
      fill: "none",
      stroke: i === 0 ? "var(--aiw-accent)" : "var(--aiw-muted)",
      opacity: i === 0 ? 1 : Math.max(0.8 - i * 0.22, 0.25),
      "stroke-width": 16,
      "stroke-dasharray": animate ? `0 ${C}` : `${C * frac} ${C}`,
      "stroke-dashoffset": -C * acc,
      transform: `rotate(-90 ${S / 2} ${S / 2})`,
    });
    if (animate)
      animateAttr(arc, "stroke-dasharray", `0 ${C}`, `${C * frac} ${C}`, i * 0.12);
    svg.appendChild(arc);
    acc += frac;
  });
  return svg;
}

/**
 * Chart types this renderer draws WELL, mapped from the vocabulary a backend
 * already speaks.
 *
 * The names on the left are the dashboard widget types — `time_series`,
 * `breakdown`, `kpi`, `table`, `pivot_grid`, `heatmap`, `scatter`, `content` —
 * because that is what a `widget` frame's `spec.chartType` carries. A renderer
 * that invented its own names would draw bars for a time series, which is not a
 * styling difference but a wrong chart.
 *
 * `line` / `bar` / `donut` / `pie` are accepted too, for hosts whose backend
 * speaks in shapes rather than in dashboard types.
 */
const DRAWS: Record<string, "line" | "bars" | "donut"> = {
  time_series: "line",
  line: "line",
  breakdown: "bars",
  bar: "bars",
  donut: "donut",
  pie: "donut",
};

/**
 * Build a `renderChartFallback` implementation.
 *
 * ```ts
 * import { createChartFallback } from "sgiant-ai-widget/charts";
 * createAiChatWidget({ renderChartFallback: createChartFallback() });
 * ```
 *
 * IT REFUSES WHAT IT CANNOT DRAW WELL, and that is the important part. `kpi`,
 * `table`, `pivot_grid`, `heatmap`, `scatter` and `content` throw, which the
 * widget catches and falls through to its own built-in — a stat tile for a kpi,
 * a readable table for the rest. A bad heatmap made of rectangles is worse than
 * a table of the same numbers, and a `kpi` is already better served by the
 * built-in stat than by a chart of one bar.
 *
 * This is a FLOOR for surfaces with no charting stack. A host with real chart
 * components should mount those through `renderDataWidget` instead — eight
 * dashboard widget types exist and this draws three of them.
 */
export function createChartFallback(options: ChartFallbackOptions = {}) {
  const { animate = true, height = 140 } = options;

  return function renderChartFallback(
    host: HTMLElement,
    spec: unknown,
    rows: unknown,
    comparisonRows?: unknown
  ): void {
    const s = (spec ?? {}) as ChartSpec;
    const data = Array.isArray(rows) ? (rows as ChartRow[]) : [];
    const draw = DRAWS[String(s.chartType ?? "")];

    // Throwing is how this seam says "not mine" — the widget catches it and
    // renders its built-in instead. Returning quietly would leave an empty box.
    if (!draw || !data.length)
      throw new Error(
        `sgiant-ai-widget/charts does not draw "${String(s.chartType)}" — ` +
          `falling through to the built-in renderer.`
      );

    const moving = animate && !prefersReducedMotion();
    const wrap = document.createElement("div");

    if (s.title) {
      const title = document.createElement("div");
      title.textContent = s.title;
      title.style.cssText =
        "font-size:var(--aiw-font-xs,11px);font-weight:700;text-transform:uppercase;" +
        "letter-spacing:.05em;color:var(--aiw-muted,#6e6e6e);margin-bottom:6px";
      wrap.appendChild(title);
    }

    wrap.appendChild(
      draw === "line"
        ? drawLine(
            data,
            Array.isArray(comparisonRows) ? (comparisonRows as ChartRow[]) : undefined,
            height,
            moving
          )
        : draw === "donut"
          ? drawDonut(data, moving)
          : drawBars(data, height, moving)
    );
    host.appendChild(wrap);
  };
}
