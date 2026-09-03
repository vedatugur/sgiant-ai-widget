import test from "node:test";
import assert from "node:assert/strict";
import { widgetSrc } from "./aiw-source.ts";

/**
 * Motion discipline in the widget stylesheet (#309).
 *
 * The audit that produced this issue opened with a clean bill and it is worth
 * keeping: no `transition: all`, no `ease-in`, no `scale(0)` entrance, and a
 * shared entrance keyframe that animates opacity plus a 6px translate — exactly
 * the two properties house law allows. What was missing was the token layer on
 * top, and these are the rules that keep it there.
 */
const src = widgetSrc;

test("nothing transitions width or height", () => {
  // Both reflow on every frame. The panel was the expensive one: it tweened
  // 368x540 to 760x full-height, relaying out the whole scrolling message list
  // each frame. Progress bars are scaleX now, and the 6px carousel dot simply
  // changes instantly rather than animating the wrong property.
  const bad = [
    ...src.matchAll(/transition:[^;}"`]*\b(width|height)\b[^;}"`]*/g),
  ]
    .map((m) => m[0])
    .filter((t) => !/scaleX|transform/.test(t));
  assert.deepEqual(bad, []);
});

test("the shared entrance keyframe ships at ONE tokenised duration", () => {
  // It shipped at five literals — .14s .18s .2s .22s — none of which was
  // --duration-fast or --duration-base. That is the exact failure the tokens
  // package was written to prevent, in duration form rather than curve form,
  // inside the one file that already knows about it.
  const uses = [...src.matchAll(/animation:\$\{PREFIX\}-rise ([^;}"`]*)/g)].map(
    (m) => m[1].trim()
  );
  assert.ok(uses.length > 5, "the entrance keyframe vanished");
  assert.deepEqual(
    [...new Set(uses)],
    ["var(--duration-fast) var(--ease-out)"]
  );
});

test("no ENTRANCE animation carries a literal duration", () => {
  // Scoped to entrances on purpose. `spin` is a continuous status indicator and
  // 700ms is its own tempo, not a UI transition — house law asks constant
  // motion to be `linear`, which it is, and says nothing about matching it to a
  // transition token. Tokenising it would express a relationship that is not
  // real.
  const literals = [
    ...src.matchAll(/animation:\$\{PREFIX\}-([a-z0-9]+) (\.\d+s|\d+ms)/g),
  ]
    .filter((m) => m[1] !== "spin")
    .map((m) => m[0]);
  assert.deepEqual(literals, []);
});

test("the overflow menu transitions from its trigger, not a keyframe", () => {
  // Anchored under its button, so it must grow FROM the button. And it stays in
  // the DOM, which makes it the rapidly-retriggered case house law names:
  // keyframes restart, transitions retarget, so open-close-open stuttered.
  const rule = src.match(/\.\$\{PREFIX\}-menu\{([\s\S]*?)\}/)?.[1] ?? "";
  assert.ok(rule, "menu rule not found");
  assert.match(rule, /transform-origin:top right/);
  assert.match(rule, /transition:/);
  assert.ok(!/animation:/.test(rule), "the menu is back on a keyframe");
});

test("the sheet triggers on a landscape phone, and JS and CSS agree", () => {
  // A phone in landscape is ~844x390 — wider than 640, so the desktop corner
  // card applied and clamped the panel to ~350px tall. The two halves must
  // match: JS decides where the panel is positioned, CSS decides how it looks,
  // and a viewport that falls between them is the bug.
  assert.match(src, /\(max-height:520px\) and \(pointer:coarse\)/);
  // Prettier wraps the declaration onto its own line, so the newline matters.
  const jsQuery = src.match(/const SHEET_QUERY =\s*"([^"]+)"/)?.[1];
  assert.ok(jsQuery, "SHEET_QUERY not found");
  assert.ok(
    src.includes(`@media ${jsQuery}{`),
    `the CSS media query does not match SHEET_QUERY (${jsQuery})`
  );
});

test("the expanded-mode measure is capped in ch, not only in percent", () => {
  // A percentage cap scales WITH the container, which is the opposite of what a
  // measure should do: at 760px wide it produced a ~549px line, roughly 95-105
  // characters against a comfortable 65.
  assert.match(src, /max-width:min\(75%,\s*62ch\)/);
});
