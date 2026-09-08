/**
 * THE MANIFEST DECLARES; THE PANEL CONFIRMS.
 *
 * `sgiant-ai-agent-bridge` has shipped `verifySurface` since the contract was
 * written and nothing called it: the manifest half was wired and the
 * verification half was not. That is the "declared but unwired" shape the
 * estate has been bitten by four times — sgiant-platform#348 (a tool routed,
 * gated and reaching no model), #365 (a whole app deploying nowhere), #367 (43
 * tools built and none accepted), and this.
 *
 * An assistant acting on a manifest the page no longer matches is #348 with a
 * click attached. So the answer is three buckets rather than a boolean, because
 * the three mean different things to a person: a conditional control the host
 * never wired is "not available here" and TRUE; a control declared
 * unconditionally and absent means the manifest is wrong; hidden or undeclared
 * is worth saying and is never a reason to refuse.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  verifyWidgetSurface,
  describeWidgetDrift,
  WIDGET_MANIFEST,
  WIDGET_CONDITIONAL_TARGETS,
} from "../dist/index.js";
// The manifest nests controls under views, so the ids come from the bridge's
// own flattener rather than a hand-walk that would drift from the shape.
import { flattenControls } from "sgiant-ai-agent-bridge/manifest";

/** A document made of exactly the ids given — the two methods `ManifestRoot`
 *  needs, so this runs with no browser and no DOM library. */
function rootWith(ids: string[]) {
  const el = (id: string) => ({
    getAttribute: (n: string) => (n === "data-ai-target" ? id : null),
    isConnected: true,
    tagName: "BUTTON",
    textContent: id,
    getBoundingClientRect: () => ({ width: 40, height: 20 }),
  });
  const nodes = ids.map(el);
  return {
    querySelectorAll: () => nodes,
    querySelector: (sel: string) => {
      const m = /\[data-ai-target="([^"]+)"\]/.exec(sel);
      return m
        ? (nodes.find((n) => n.getAttribute("data-ai-target") === m[1]) ?? null)
        : null;
    },
  };
}

/** Every control the manifest declares, conditional ones included. */
const ALL_IDS: string[] = flattenControls(WIDGET_MANIFEST).map(
  (c: { id: string }) => c.id,
);
/** A control that is NOT conditional — its absence means the manifest is wrong,
 *  not that the host declined a feature. Picked from the manifest so this stays
 *  true when the widget gains or loses controls. */
const UNCONDITIONAL = ALL_IDS.find(
  (id) => !WIDGET_CONDITIONAL_TARGETS.includes(id),
)!;

test("a complete panel drifts not at all", () => {
  const check = verifyWidgetSurface(rootWith(ALL_IDS));
  assert.equal(check.ok, true);
  assert.deepEqual(check.stale, []);
  assert.equal(
    describeWidgetDrift(check),
    "",
    "nothing to say means say nothing",
  );
});

test("a conditional control the host did not wire is EXPECTED, not stale", () => {
  // The whole reason WIDGET_CONDITIONAL_TARGETS exists: `history` is absent
  // unless the host supplies `listThreads`, and calling that a fault would cry
  // wolf on a correctly configured widget.
  const withoutConditionals = ALL_IDS.filter(
    (id) => !WIDGET_CONDITIONAL_TARGETS.includes(id),
  );
  const check = verifyWidgetSurface(rootWith(withoutConditionals));
  assert.equal(check.ok, true, "a correctly configured widget is not broken");
  assert.equal(check.stale.length, 0);
  assert.ok(check.expected.length > 0);
  assert.match(
    describeWidgetDrift(check),
    /not available in this configuration/,
  );
});

test("a control declared unconditionally and absent is STALE, and says so", () => {
  // A non-conditional control. If it is not there, the manifest is wrong about
  // the panel — and the assistant must not act on it.
  const missingOne = ALL_IDS.filter((id) => id !== UNCONDITIONAL);
  const check = verifyWidgetSurface(rootWith(missingOne));
  assert.equal(check.ok, false);
  assert.deepEqual(
    check.stale.map((d: { id: string }) => d.id),
    [UNCONDITIONAL],
  );
  const said = describeWidgetDrift(check);
  assert.match(said, /manifest is out of date/);
  assert.match(said, /do not act on them/);
});

test("the two are reported separately, in one sentence", () => {
  // A report that merged them would make a correctly configured widget look
  // broken, or a broken one look configured.
  const ids = ALL_IDS.filter(
    (id) => id !== UNCONDITIONAL && !WIDGET_CONDITIONAL_TARGETS.includes(id),
  );
  const said = describeWidgetDrift(verifyWidgetSurface(rootWith(ids)));
  assert.match(said, /manifest is out of date/);
  assert.match(said, /not available in this configuration/);
});
