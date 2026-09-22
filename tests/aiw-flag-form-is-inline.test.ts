import test from "node:test";
import assert from "node:assert/strict";
import { widgetSrc, widgetStyles } from "./aiw-source.ts";
import { WIDGET_LABELS } from "../src/labels.ts";

/**
 * The flag control asks for its reason INLINE, never through `window.prompt`.
 *
 * #433, found while smoke-testing visitor flags on the demo. The native prompt
 * failed in three independent ways and only one of them is cosmetic:
 *
 *  - it freezes the renderer, so browser automation could not type into it and
 *    the Chrome extension timed out on every call until the tab was closed;
 *  - it is the only native dialog in the product, so it cannot be themed and
 *    cannot be translated past its own button labels;
 *  - some embedding contexts block it outright, where the flag then silently
 *    does nothing — the failure mode with no symptom.
 *
 * A test rather than a comment because the regression is invisible to types and
 * to every other test here: `window.prompt` typechecks, returns a string, and
 * the flag path "works" on a developer's own machine.
 */

test("no dialog-blocking native prompt anywhere in the widget", () => {
  // `.replace` strips the prose in flagForm's own doc comment, which names the
  // call it replaced — an assertion that a WORD is absent would fail on the
  // explanation of why it is absent.
  const code = widgetSrc.replace(/\/\*\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
  for (const call of ["window.prompt(", "window.confirm(", "window.alert("]) {
    assert.ok(
      !code.includes(call),
      `${call} blocks the renderer and is blocked outright in some embeds — draw it in the panel instead`
    );
  }
});

test("the flag reason is a field in the transcript, with a way out", () => {
  assert.ok(
    widgetSrc.includes("function flagForm("),
    "the inline reason form must exist"
  );
  // The pieces that make it usable without a keyboard trap: a real form, a
  // cancel control, and Escape wired to the same close path.
  assert.match(widgetSrc, /flagForm\(threadId/, "the form receives the live thread id");
  assert.ok(
    /e\.key === "Escape"[\s\S]{0,120}close\(\)/.test(widgetSrc),
    "Escape must close the reason form — a field with no way out is a trap"
  );
  assert.ok(
    widgetStyles.includes(`-flag-row{`),
    "the form's button row must be styled rather than stacking full width"
  );
});

test("the host contract did not move", () => {
  // The whole point of #433 is that hosts do not change: onFlag still takes the
  // reason and the thread id, and the result still lands in flagNote.
  assert.ok(
    /opts\.onFlag!\(\{ reason, threadId \}\)/.test(widgetSrc),
    "onFlag({ reason, threadId }) is the contract three hosts already call"
  );
  assert.ok(
    /flagNote\(L\("flagged"\), true\)/.test(widgetSrc),
    "a successful flag must still confirm visibly in the transcript"
  );
});

test("every string the form draws is a translatable label", () => {
  // The widget cannot call i18next; a hard-coded string here is English in a
  // Turkish UI, forever. Each key must exist in WIDGET_LABELS so it becomes a
  // TYPE error in every host until it is translated.
  for (const key of [
    "flagPrompt",
    "flagReasonPlaceholder",
    "flagSubmit",
    "cancel",
    "sending",
  ]) {
    assert.ok(
      key in WIDGET_LABELS,
      `${key} must be a declared label, not a literal in the form`
    );
    assert.ok(
      widgetSrc.includes(`L("${key}")`),
      `${key} must be read through L() so the host's translation wins`
    );
  }
});
