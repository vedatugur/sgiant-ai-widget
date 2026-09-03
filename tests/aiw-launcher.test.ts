import test from "node:test";
import assert from "node:assert/strict";
import { widgetSrc } from "./aiw-source.ts";
import { contrastRatio } from "../dist/contrast.js";

/**
 * The launcher redraw (#305).
 *
 * Two of these guard a RULE rather than an appearance, which is the part that
 * would otherwise rot: the mark must straddle navy on every ground, and only
 * two of the six states may move. A redraw that quietly reintroduced a third
 * moving state, or a brand colour that failed on one ground, would look fine in
 * the one place whoever changed it happened to look.
 */
const src = widgetSrc;

const NAVY = "#151D2F";
const CREAM = "#FCF7E3";

test("the SMIL blob is gone — reduced motion can reach everything now", () => {
  // The whole reason the mark was redrawn rather than restyled: a CSS
  // `animation:none` has no authority over SMIL, so a reader who asked their OS
  // for stillness got a permanently moving blob in the corner of every page.
  // The MARKUP, not the prose: the comments above the constants describe what
  // was removed and legitimately name <animate>. Assert on the constants.
  const defs = src.match(/const AVATAR_DEFS = `([\s\S]*?)`;/)?.[1] ?? "";
  const mark = src.match(/const AVATAR_SVG = `([\s\S]*?)`;/)?.[1] ?? "";
  assert.ok(mark, "AVATAR_SVG not found");
  for (const [name, svg] of [
    ["AVATAR_DEFS", defs],
    ["AVATAR_SVG", mark],
  ] as const) {
    assert.ok(!/<animate\b/.test(svg), `${name} carries SMIL again`);
    assert.ok(
      !/<filter\b|feGaussianBlur|feColorMatrix/.test(svg),
      `${name} carries a filter again`
    );
  }
  // One path, so it survives 26px and a host recolouring it (#306).
  assert.equal((mark.match(/<path/g) ?? []).length, 1);
});

test("the mark reads on every ground it is drawn on", () => {
  // The measured rule: navy is the only value that survives the whole brand
  // sweep, and cream is the only one that survives navy. So the mark and its
  // disc always straddle navy — which is what makes ONE inversion enough.
  const sweep = ["#60C7C8", "#FBAA34", "#FA712D"];
  for (const stop of sweep) {
    assert.ok(
      contrastRatio(stop, NAVY)! >= 3,
      `${stop} on a navy disc is ${contrastRatio(stop, NAVY)!.toFixed(2)}:1`
    );
  }
  // The ink half: navy mark on a cream disc.
  assert.ok(contrastRatio(NAVY, CREAM)! >= 3);
  // And the disc itself has to read as an object against the page.
  for (const ground of ["#ffffff", CREAM]) {
    assert.ok(contrastRatio(NAVY, ground)! >= 3, `navy disc on ${ground}`);
  }
  assert.ok(contrastRatio(CREAM, NAVY)! >= 3, "cream disc on an ink ground");
});

test("on an ink ground the whole OBJECT inverts, not just the mark", () => {
  // Inverting only the fill produced a navy mark on a navy disc — invisible,
  // and exactly the failure the ground rule exists to prevent: "a navy pebble
  // on a navy section is a hole with a moon in it". Both halves or neither.
  assert.match(
    src,
    /\.\$\{PREFIX\}-on-ink \.\$\{PREFIX\}-av-mark\{fill:#151D2F\}/,
    "the mark does not invert"
  );
  assert.match(
    src,
    // The FACT, not the declaration: the rule may also carry a shadow and a
    // hairline. Pinning the exact string made this fail on an unrelated edit.
    /\.\$\{PREFIX\}-bubble\.\$\{PREFIX\}-on-ink\{[^}]*background:#FCF7E3/,
    "the disc does not invert — the mark would be navy on navy"
  );
});

test("only two of the six launcher states move", () => {
  // The point of the redraw. The old launcher stacked eight simultaneous
  // effects at rest, so an unread reply and an idle corner animated about
  // equally — it was loud at rest and had nothing left to say.
  // Per LINE, not per rule: the stylesheet is a template literal, so every
  // selector contains `${PREFIX}` — braces and all — and any regex that tries
  // to bound a rule with [^{] stops inside the interpolation. It also has to
  // see descendant selectors: `working` animates the MARK inside the launcher,
  // not the launcher itself.
  const moving = src
    .split("\n")
    .filter((line) => /-bubble-[a-z]+/.test(line) && /animation:/.test(line))
    .flatMap((line) => [...line.matchAll(/-bubble-([a-z]+)/g)].map((m) => m[1]))
    .filter((v, i, arr) => arr.indexOf(v) === i)
    .sort();
  // `dozing` joined them on 2026-09-04, deliberately and with the owner asking
  // for it. The rule this test protects is "a launcher AT REST must not compete
  // with an unread reply" — and dozing is not at rest by default: it is earned
  // by leaving the page alone for a minute (dozeAfterMs), it only applies to a
  // resting, closed launcher, and any pointer, key, scroll or focus cancels it.
  // A still corner remains the normal case, which is the property that mattered.
  assert.deepEqual(moving, ["dozing", "unread", "working"]);
  // And `resting` is the default, so it must not carry one at all.
  const rest = src.match(/\.\$\{PREFIX\}-bubble\{([^}]*)\}/)?.[1] ?? "";
  assert.ok(!/animation:/.test(rest), "the resting launcher animates");
  // And dozing must never be reachable from the resting CLASS alone — that would
  // reinstate exactly what the redraw removed, under a new name.
  assert.doesNotMatch(
    src,
    /-bubble-resting[^\n]*animation:/,
    "dozing must be its own state, not resting with a coat of paint"
  );
});

test("hover is gated, so a tap does not leave the lift stuck", () => {
  assert.match(
    src,
    /@media \(hover: hover\) and \(pointer: fine\)\{\s*\.\$\{PREFIX\}-bubble:hover/,
    "the launcher hover is not behind a hover-capability query"
  );
});

test("the first-visit flag does not live in the 12-hour thread cache", () => {
  // "Has this person ever met the widget" is not a fact that should expire, and
  // the thread cache expires by design (RESTORE_MAX_AGE_MS).
  //
  // This used to pin the key's exact spelling (`${PREFIX}.opened`) and broke
  // when #306 moved every key onto the configurable namespace — a rename it
  // should not have had an opinion about. What it actually cares about is that
  // the flag is its OWN key rather than a field inside the expiring blob, so
  // that is what it checks now.
  assert.match(
    src,
    /const OPENED_KEY = `\$\{ns\}:[a-z]+`/,
    "OPENED_KEY is no longer a standalone key built from the namespace"
  );
  assert.match(src, /function hasOpenedBefore\(\)/);

  // saveState writes the blob under storeKey, and that blob expires. The flag
  // must not be in it.
  const saveState = src.match(
    /function saveState\(\): void \{([\s\S]*?)\n  \}/
  )?.[1];
  assert.ok(saveState, "saveState not found");
  assert.doesNotMatch(
    saveState,
    /OPENED_KEY|opened/,
    "the first-visit flag is being written into the cache that expires"
  );
});

test("working comes from the real in-flight turn, not a second flag", () => {
  // Two sources for one fact is how a spinner ends up spinning after the turn
  // finished. It is derived inside syncBusy, next to the send button's own
  // disabled state.
  const sync = src.match(/function syncBusy\(\): void \{([\s\S]*?)\n  \}/)?.[1];
  assert.ok(sync, "syncBusy not found");
  assert.match(
    sync,
    /setLauncher\(\{ state: busy \? "working" : "resting" \}\)/
  );
  assert.match(sync, /panel\.style\.display === "none"/);
});

/**
 * THE STYLESHEET IS A TEMPLATE LITERAL, and a backtick inside a CSS comment —
 * quoting a token name, which reads as ordinary prose — closes the JS string.
 *
 * This has happened FOUR times in one working session, twice after a warning
 * comment was added at the top of `injectStyles` saying exactly this. The build
 * does catch it, but it reports `';' expected` pointing at a line some distance
 * from the actual backtick, so each occurrence costs a round trip of hunting.
 *
 * The test reads the file as TEXT and never imports it, so it still runs when
 * the module does not compile — which is precisely when its message is worth
 * something. A comment was not enough; this is.
 */
test("no backtick inside the widget stylesheet", () => {
  const open = src.indexOf("const css = `");
  assert.ok(open > 0, "the stylesheet literal moved");
  const body = src.slice(open + "const css = `".length);
  const close = body.indexOf("`;");
  assert.ok(close > 0, "the stylesheet literal is unterminated");
  const sheet = body.slice(0, close);
  const line = sheet.slice(0, sheet.indexOf("`")).split("\n").length;
  assert.equal(
    sheet.includes("`"),
    false,
    `a backtick at stylesheet line ~${line} closes the template literal — CSS comments must not quote identifiers with backticks`
  );
});
