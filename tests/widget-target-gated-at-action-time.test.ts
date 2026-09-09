import test from "node:test";
import assert from "node:assert/strict";
import { checkWidgetTarget, WIDGET_TARGETS } from "../dist/index.js";
import { createHostActions } from "../dist/host-actions.js";
import type {
  ManifestRoot,
  ManifestElement,
} from "sgiant-ai-agent-bridge/manifest";

/**
 * THE VERIFIER HAD NO CALLER, WHICH IS THE BUG IT WAS WRITTEN TO PREVENT.
 *
 * `verifyWidgetSurface` and `describeWidgetDrift` were written, exported, and
 * re-exported twice through `./manifest` — and measured on 2026-09-09, nothing
 * in this package or any consumer called either one. #356's own checklist asks
 * that the manifest "verifies at action time" and that a stale manifest is
 * "detected and reported, never acted on silently"; both were true of the code
 * and false of the running widget. That is the fifth instance of the estate's
 * house defect, inside the issue that documents it.
 *
 * `checkWidgetTarget` is the caller: one target, at the moment it is about to
 * be used. It answers with a SENTENCE rather than a boolean because the three
 * outcomes mean different things to the person reading them — a control that
 * this configuration never wired is not a fault, and a control the manifest
 * declares but the panel lacks is our bug, not the model's bad guess.
 */
const root = (ids: string[]): ManifestRoot => {
  const els: ManifestElement[] = ids.map((id) => ({
    getAttribute: (n: string) => (n === "data-ai-target" ? id : null),
    isConnected: true,
    tagName: "BUTTON",
    textContent: id,
  }));
  const has = (sel: string) =>
    els.filter((e) => sel.includes(`"${e.getAttribute("data-ai-target")}"`));
  return {
    querySelectorAll: (sel: string) =>
      sel.includes("data-ai-target=") ? has(sel) : els,
    querySelector: (sel: string) => has(sel)[0] ?? null,
  };
};

const ALL = Object.values(WIDGET_TARGETS);

test("a target the panel really has is allowed through", () => {
  assert.equal(checkWidgetTarget(WIDGET_TARGETS.history, root(ALL)), null);
});

test("an id that is not the widget's own is not our business", () => {
  assert.equal(checkWidgetTarget("sites-table", root(ALL)), null);
});

// `close` is declared UNCONDITIONALLY — every configuration has it — so its
// absence can only mean the manifest is wrong. `history`/`attach`/`expand` are
// in WIDGET_CONDITIONAL_TARGETS and would (correctly) read as "not here".
test("a declared control the panel lacks is refused, and says the manifest is wrong", () => {
  const missing = ALL.filter((id) => id !== WIDGET_TARGETS.close);
  const refusal = checkWidgetTarget(WIDGET_TARGETS.close, root(missing));
  assert.ok(refusal, "a stale declaration was acted on silently");
  assert.match(refusal, /manifest is out of date/);
  assert.match(refusal, new RegExp(WIDGET_TARGETS.close));
});

test("a conditional control the host did not wire reads as unavailable, not broken", () => {
  const without = ALL.filter((id) => id !== WIDGET_TARGETS.attach);
  const refusal = checkWidgetTarget(WIDGET_TARGETS.attach, root(without));
  assert.ok(refusal, "an unwired optional control reported itself usable");
  assert.doesNotMatch(
    refusal,
    /out of date/,
    "a correctly configured widget was accused of a stale manifest",
  );
});

/**
 * And the gate must be IN THE PATH, not merely available next to it. The three
 * tests above would pass unchanged with `checkWidgetTarget` exported and called
 * by nobody, which is the exact state this whole change is fixing — so these
 * two drive the real dispatcher and read the sentence it throws.
 */
const dispatcherOver = (present: string[]) =>
  createHostActions({
    navigate: () => {},
    manifestRoot: root(present) as never,
  });

test("the dispatcher refuses a click on a control the manifest got wrong", async () => {
  const act = dispatcherOver(ALL.filter((id) => id !== WIDGET_TARGETS.close));
  await assert.rejects(
    () => act("click", { target: WIDGET_TARGETS.close }),
    /manifest is out of date/,
    "a stale declaration was clicked, or refused with the wrong reason",
  );
});

test("the dispatcher blames the configuration, not the model, for an unwired control", async () => {
  const act = dispatcherOver(ALL.filter((id) => id !== WIDGET_TARGETS.attach));
  await assert.rejects(
    () => act("highlight", { target: WIDGET_TARGETS.attach }),
    /not available in this configuration/,
  );
});

test("a control the panel has is NOT stopped by the gate — it reaches the DOM layer", async () => {
  const act = dispatcherOver(ALL);
  // No `document` in node, so the DOM layer is what refuses here. The point is
  // WHICH refusal comes back: reaching "no such control on this page" proves
  // the manifest gate let it through rather than swallowing every target.
  await assert.rejects(
    () => act("highlight", { target: WIDGET_TARGETS.close }),
    /no such control on this page/,
  );
});
