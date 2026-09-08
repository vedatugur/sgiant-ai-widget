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
  WIDGET_TARGETS,
  splitSurfaceTargets,
  hostTargetsOnly,
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

/**
 * AND THE TWO SURFACES MUST NOT BE ONE LIST.
 *
 * `scanAiTargets` walks the whole document for `[data-ai-target]`, and the
 * widget stamps that attribute on its own controls. A host passing the scan
 * straight through as `uiTargets` therefore hands the assistant a list where
 * its own panel's buttons are indistinguishable from the page's — "click the
 * close button" becomes ambiguous in a way prompting cannot fix.
 *
 * And the scan is CAPPED. On a rich page the widget's own controls can push the
 * host's out of the list entirely, silently — the same truncation this issue
 * was opened about, arriving from the other end.
 */
test("a scan splits into the host's controls and the widget's own", () => {
  const scan = [
    { id: "assets-upload", label: "Upload" },
    { id: WIDGET_TARGETS.composer, label: "Message" },
    { id: "assets-delete", label: "Delete" },
    { id: WIDGET_TARGETS.close, label: "Close" },
  ];
  const { host, widget } = splitSurfaceTargets(scan);
  assert.deepEqual(
    host.map((t: { id: string }) => t.id),
    ["assets-upload", "assets-delete"],
  );
  assert.deepEqual(
    widget.map((t: { id: string }) => t.id),
    [WIDGET_TARGETS.composer, WIDGET_TARGETS.close],
  );
});

test("hostTargetsOnly is the call a host makes", () => {
  // Separate from the split because `splitSurfaceTargets(...).host` at a call
  // site is one refactor away from sending `.widget` by mistake.
  const scan = [{ id: "page-save" }, { id: WIDGET_TARGETS.newChat }];
  assert.deepEqual(
    hostTargetsOnly(scan).map((t: { id: string }) => t.id),
    ["page-save"],
  );
});

test("every id the widget stamps is claimed by the widget", () => {
  // The authority is WIDGET_TARGETS, not a prefix convention: an id the widget
  // stamps is the widget's whatever the page around it looks like. If a control
  // is ever added to the panel without going through WIDGET_TARGETS, it lands
  // in the host's list and this fails.
  const scan = Object.values(WIDGET_TARGETS).map((id) => ({
    id: id as string,
  }));
  const { host, widget } = splitSurfaceTargets(scan);
  assert.deepEqual(host, [], "a widget control leaked into the host's list");
  assert.equal(widget.length, scan.length);
});
