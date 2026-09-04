import test from "node:test";
import assert from "node:assert/strict";
import { CHROME_MARK } from "../src/mark-chrome.ts";
import { readFileSync } from "node:fs";

/**
 * The mark and the motion layer are one feature split across two files, joined
 * by a class name — the quietest contract there is. `mark-motion.ts` finds the
 * eye by `pl`. Rename it and nothing throws: the mark still renders, the tilt
 * still works, and only the eye stops following. That reads as a robot which
 * has stopped paying attention rather than as a bug, which is exactly the
 * failure nobody reports.
 */
test("the chrome mark carries the hooks the motion layer looks for", () => {
  assert.match(CHROME_MARK, /class="eye pl"/, "the eye must carry `pl`");
  assert.match(CHROME_MARK, /class="lamp"/, "the lamp must carry `lamp`");
});

test("it is an inline svg the widget will accept", () => {
  // pickAvatar() THROWS on anything that is not an inline <svg> and rejects a
  // <script> outright, so a malformed mark takes the widget down at mount
  // rather than degrading to the crescent.
  assert.match(CHROME_MARK.trim(), /^<svg[\s>]/);
  assert.doesNotMatch(CHROME_MARK, /<script/i);
});

test("it stays flat, because stepped motion was chosen for its flatness", () => {
  // A gradient or a specular layer creeping in would make stepped motion look
  // broken rather than deliberate — and the fix would be mistaken for a motion
  // bug, in the file that has nothing wrong with it.
  assert.doesNotMatch(CHROME_MARK, /linearGradient|radialGradient/i);
  for (const layer of ["glint", "lit", "fore", "deep"])
    assert.ok(
      !CHROME_MARK.includes(`class="${layer}"`),
      `${layer} is a spring-mode layer and does not belong on a flat mark`
    );
});

test("the demo does not keep its own copy of the mark", () => {
  // examples/ui.html carried the mark inline until 2026-09-04. A demo with its
  // own copy of the thing it demonstrates drifts from it silently, and the
  // drift shows up as "the docs are wrong" long after the cause is cold.
  const ui = readFileSync("examples/ui.html", "utf8");
  assert.doesNotMatch(
    ui,
    /const ROBOT = `<svg/,
    "ui.html must use the exported CHROME_MARK, not a local copy"
  );
  assert.match(ui, /SgiantAiWidget\.CHROME_MARK/);
});

test("the examples bundle is not older than the package", () => {
  // examples/*.html load a SIBLING copy of the global build, because they open
  // as plain files. That copy was maintained by hand and lagged: ui.html began
  // using CHROME_MARK while the checked-in bundle predated the export. Nothing
  // errors when that happens — `avatarSvg: undefined` quietly falls back to the
  // crescent — so the demo shows the old mark while claiming to show the new
  // one. The build mirrors it now; this catches a mirror that stopped running.
  const dist = readFileSync("dist/sgiant-ai-widget.global.js", "utf8");
  const demo = readFileSync("examples/sgiant-ai-widget.global.js", "utf8");
  assert.equal(
    demo,
    dist,
    "examples/sgiant-ai-widget.global.js is out of date — run npm run build"
  );
});
