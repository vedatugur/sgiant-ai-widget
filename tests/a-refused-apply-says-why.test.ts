import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { widgetSrc } from "./aiw-source.ts";
import { readApplyRefusal } from "../dist/apply-refusal.js";
import { WIDGET_LABELS } from "../dist/labels.js";
import * as entry from "../dist/index.js";

/**
 * A REFUSED APPLY SAYS WHY (sgiant-platform#581).
 *
 * The card caught a failed apply and threw the reason away:
 *
 *     } catch {
 *       apply.disabled = false;
 *       apply.textContent = ctx.L("tryAgain");
 *     }
 *
 * A post the site would not take because it was not connected, a write this
 * person may not make, a full storage: each became the same renamed button,
 * and pressing it was refused again for as long as anyone pressed.
 *
 * The widget cannot know why and must not guess from an Error's message, which
 * is written for a log. The host says it, with `userMessage`.
 */
const CARDS = readFileSync(
  join(import.meta.dirname, "..", "src", "decision-cards.ts"),
  "utf8"
);
/** The Apply handler's catch block, to its closing brace. */
const CATCH = CARDS.slice(
  CARDS.indexOf("} catch (thrown) {"),
  CARDS.indexOf("row.append(apply, cancel);")
);

test("a rejection that carries a sentence for the person is read; its retry defaults to yes", () => {
  assert.deepEqual(
    readApplyRefusal({ userMessage: "Bu site henüz bağlı değil." }),
    { userMessage: "Bu site henüz bağlı değil.", retry: true }
  );
  assert.deepEqual(
    readApplyRefusal({ userMessage: "  Not connected.  ", retry: false }),
    { userMessage: "Not connected.", retry: false }
  );
  // An Error with the property is the ordinary way to throw one.
  const thrown = Object.assign(new Error("409 WORDPRESS_NOT_CONNECTED"), {
    userMessage: "This site is not connected yet.",
    retry: false,
  });
  assert.deepEqual(readApplyRefusal(thrown), {
    userMessage: "This site is not connected yet.",
    retry: false,
  });
  // Only `false` means "do not offer to try again".
  for (const retry of [undefined, null, 0, "false", true])
    assert.equal(readApplyRefusal({ userMessage: "x", retry })!.retry, true);
});

test("nothing else on a rejection is ever taken for a sentence", () => {
  // The message of an Error is for a log: a status line, a path, English.
  assert.equal(readApplyRefusal(new Error("POST /sites/7 409: {…}")), null);
  assert.equal(readApplyRefusal({ message: "Not connected." }), null);
  assert.equal(readApplyRefusal({ error: "WORDPRESS_NOT_CONNECTED" }), null);
  // A sentence that is not one.
  for (const userMessage of ["", "   ", 404, null, undefined, {}, ["x"]])
    assert.equal(readApplyRefusal({ userMessage }), null);
  for (const thrown of [null, undefined, "boom", 500, true])
    assert.equal(readApplyRefusal(thrown), null);
});

test("the card prints the host's sentence, or its own label, under the buttons", () => {
  assert.ok(CATCH.length > 100, "could not find the Apply handler's catch");
  assert.match(CATCH, /const refusal = readApplyRefusal\(thrown\);/);
  assert.match(
    CATCH,
    /failNote\.textContent = refusal\?\.userMessage \?\? ctx\.L\("applyFailed"\);/
  );
  assert.match(CATCH, /failNote\.style\.display = "";/);
  // It is text, never markup, and never the thrown thing's own message.
  assert.doesNotMatch(CATCH, /innerHTML/);
  assert.doesNotMatch(CATCH, /\.message\b/);
  // Under the buttons: appended after the row.
  assert.match(
    CARDS,
    /wrap\.appendChild\(row\);\s*wrap\.appendChild\(failNote\);/
  );
  // Announced to a screen reader without stealing focus from the button.
  assert.match(CARDS, /failNote\.setAttribute\("role", "status"\);/);
});

test('the button says "Try again" only when trying again can work', () => {
  assert.match(
    CATCH,
    /apply\.textContent =\s*refusal && !refusal\.retry \? ctx\.L\("apply"\) : ctx\.L\("tryAgain"\);/
  );
  // Either way the person can press it again: the card is never left dead.
  assert.match(CATCH, /apply\.disabled = false;/);
});

test("the sentence is brought into view: on the last card it would land below the fold", () => {
  // Seen in a browser: the reason appeared under the button of the last card
  // and the conversation did not move, so half of it was behind the composer.
  assert.match(
    CATCH,
    /failNote\.scrollIntoView\?\.\(\{ block: "nearest" \}\);/
  );
});

test("a new attempt clears the last one's reason", () => {
  const start = CARDS.indexOf('apply.textContent = ctx.L("applying");');
  assert.notEqual(start, -1);
  assert.match(
    CARDS.slice(start - 200, start),
    /failNote\.style\.display = "none";/
  );
});

test("the reason is not thrown away anywhere in the card any more", () => {
  // The shape that lost it: a catch that binds nothing.
  assert.doesNotMatch(CATCH, /\} catch \{/);
});

test("the fallback sentence is a label a host can translate, and the helper is public", () => {
  assert.ok("applyFailed" in WIDGET_LABELS);
  assert.match(widgetSrc, /L\("applyFailed"\)/);
  assert.equal(typeof entry.readApplyRefusal, "function");
});

test("the backend guide says how to refuse with a reason", () => {
  const guide = readFileSync(
    join(import.meta.dirname, "..", "BACKEND.md"),
    "utf8"
  );
  assert.match(guide, /### When an apply is refused/);
  assert.match(guide, /userMessage/);
  assert.match(guide, /retry: false/);
});
