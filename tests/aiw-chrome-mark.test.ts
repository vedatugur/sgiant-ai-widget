import test from "node:test";
import assert from "node:assert/strict";
import { CHROME_MARK } from "../src/mark-chrome.ts";
import { readFileSync, readdirSync } from "node:fs";

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

test("the attachment feature has an example", () => {
  // Uploads shipped complete — uploadEndpoint, six files a turn, a 25 MB cap
  // for documents and 100 MB for video, an error chip per rejected file — and
  // were documented NOWHERE. No example, no README line. A feature nobody can
  // find is one nobody asks for, which is the same failure CHROME_MARK had in
  // reverse: that one lived only in an example, this one lived only in code.
  const page = readFileSync("examples/uploads.html", "utf8");
  assert.match(page, /uploadEndpoint/, "the example must show the option");
  assert.match(page, /session/, "and that uploads are session-scoped");
  // The limits are the part a host cannot discover by reading the option name.
  for (const fact of ["25 MB", "100 MB", "6"])
    assert.ok(page.includes(fact), `the example should state the ${fact} limit`);
});

test("every example is reachable from every other one", () => {
  // A page nothing links to is a page nobody opens. uploads.html was added to
  // eight navs by hand; this is what catches the ninth.
  //
  // "Every example" means every page that CARRIES the nav. app.html is not one:
  // it is the demo app the agent bridge drives, linked from advanced.html as
  // the thing being driven, and it would be wrong in a list of documents to
  // read. Membership is the nav itself, not the file extension.
  const pages = readdirSync("examples")
    .filter((f) => f.endsWith(".html"))
    .filter((f) => readFileSync(`examples/${f}`, "utf8").includes('class="exnav"'));
  assert.ok(pages.length >= 8, `expected the full set of example pages, saw ${pages.length}`);
  for (const p of pages) {
    const s = readFileSync(`examples/${p}`, "utf8");
    for (const other of pages)
      assert.ok(
        s.includes(`./${other}`),
        `examples/${p} does not link to ${other}`
      );
  }
});
