/**
 * THE WIDGET'S OWN MANIFEST, AND THE THING THAT KEEPS IT TRUE.
 *
 * A manifest that drifts from what it describes is the failure the whole
 * contract exists to prevent — it is how an application ends up declaring 28
 * pages while 211 of its controls are invisible. Drift is not prevented by
 * discipline; it is prevented by a test that fails.
 *
 * So the interesting assertions here are not "the manifest has a bubble entry".
 * They are the two directions of agreement between the manifest and the render
 * code, and the safety properties that only a hand-written manifest can carry.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  WIDGET_MANIFEST,
  WIDGET_TARGETS,
  WIDGET_CONDITIONAL_TARGETS,
  WIDGET_SURFACE,
} from "../dist/widget-manifest.js";
import {
  flattenControls,
  flattenViews,
  effectiveMutates,
  canAct,
  verifySurface,
} from "sgiant-ai-agent-bridge/manifest";

const SRC = readFileSync("src/index.ts", "utf8");

/** Every id the render code actually stamps, read from the source. */
function stampedIds(): string[] {
  const keys = [
    ...SRC.matchAll(/data-ai-target",\s*WIDGET_TARGETS\.(\w+)\)/g),
  ].map((m) => m[1]);
  return keys.map((k) => (WIDGET_TARGETS as Record<string, string>)[k]);
}

test("every control the manifest declares is actually stamped on the DOM", () => {
  const declared = flattenControls(WIDGET_MANIFEST).map((c) => c.id);
  const stamped = new Set(stampedIds());
  const missing = declared.filter((id) => !stamped.has(id));

  assert.deepEqual(
    missing,
    [],
    `declared but never rendered: ${missing.join(", ")} — the assistant would offer a control that does not exist`
  );
});

test("every control the widget stamps is declared in the manifest", () => {
  const declared = new Set(flattenControls(WIDGET_MANIFEST).map((c) => c.id));
  const undeclared = stampedIds().filter((id) => !declared.has(id));

  // The other direction, and the one that rots quietly: a control gets added,
  // nobody updates the manifest, and it is unreachable for no stated reason.
  assert.deepEqual(
    undeclared,
    [],
    `stamped but undeclared: ${undeclared.join(", ")}`
  );
});

test("every id in WIDGET_TARGETS is used, so the list cannot accumulate ghosts", () => {
  const used = new Set(stampedIds());
  const unused = Object.values(WIDGET_TARGETS).filter((id) => !used.has(id));
  assert.deepEqual(unused, [], `never stamped: ${unused.join(", ")}`);
});

test("the widget declares states that are not URLs", () => {
  const views = flattenViews(WIDGET_MANIFEST);
  const ids = views.map((v) => v.id);

  // The whole reason the contract needed generalising: none of these is a path,
  // and a flat page-shaped manifest cannot say any of them.
  for (const id of ["launcher", "panel", "history", "menu"])
    assert.ok(ids.includes(id), `missing view: ${id}`);

  assert.ok(
    views.every((v) => v.path === undefined),
    "the widget has no routes — a path here would be describing the host, not itself"
  );
});

test("history is nested inside the panel, not offered beside it", () => {
  const panel = flattenViews(WIDGET_MANIFEST).find((v) => v.id === "panel");
  assert.ok(panel, "no panel view");
  assert.ok(
    panel!.views?.some((v) => v.id === "history"),
    "history must be reachable FROM the panel — a flat list would offer it while the chat is shut"
  );
});

test("mutates is decided per control, which is the point of declaring it", () => {
  // A DOM walk sees two buttons with icons. Only a person knows that one of
  // them throws away what is on screen.
  assert.equal(effectiveMutates(WIDGET_MANIFEST, WIDGET_TARGETS.newChat), true);
  assert.equal(effectiveMutates(WIDGET_MANIFEST, WIDGET_TARGETS.history), false);
  assert.equal(effectiveMutates(WIDGET_MANIFEST, WIDGET_TARGETS.close), false);
  // Filling someone's message box puts words in their mouth; focusing it does
  // not. The old gate keyed on the ACTION name and could not tell them apart.
  assert.equal(effectiveMutates(WIDGET_MANIFEST, WIDGET_TARGETS.composer), true);
});

test("new chat is reversible, not destructive — and says so", () => {
  const newChat = flattenControls(WIDGET_MANIFEST).find(
    (c) => c.id === WIDGET_TARGETS.newChat
  );
  // It abandons the visible conversation but history keeps it. The distinction
  // decides how the confirm is phrased, so it is worth carrying.
  assert.equal(newChat!.severity, "reversible");
});

test("nothing in the widget's own manifest is inferred", () => {
  const inferred = flattenControls(WIDGET_MANIFEST).filter((c) => c.inferred);
  assert.deepEqual(
    inferred.map((c) => c.id),
    [],
    "this manifest ships beside the code it describes — there is nothing here to guess at"
  );
  assert.equal(WIDGET_MANIFEST.trust, "owned");
});

test("a conditional control missing is 'not available here', not a bug", () => {
  // expand/attach/history only exist when the host wires them. A caller that
  // treated every `missing` as a fault would cry wolf on a correct widget.
  for (const id of WIDGET_CONDITIONAL_TARGETS) {
    const c = flattenControls(WIDGET_MANIFEST).find((x) => x.id === id);
    assert.ok(c, `${id} is listed as conditional but not declared`);
  }
  // And they are a strict subset of what is declared.
  const declared = new Set(flattenControls(WIDGET_MANIFEST).map((c) => c.id));
  for (const id of WIDGET_CONDITIONAL_TARGETS) assert.ok(declared.has(id));
});

test("the contract's own guards work on this surface", () => {
  // An empty document: every declared control is missing, and the manifest
  // says so rather than letting the assistant act.
  const empty = {
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  const drift = verifySurface(WIDGET_MANIFEST, empty);
  assert.equal(
    drift.length,
    flattenControls(WIDGET_MANIFEST).length,
    "an unrendered widget must report every control missing"
  );
  assert.ok(drift.every((d) => d.kind === "missing"));

  const decision = canAct(WIDGET_MANIFEST, WIDGET_TARGETS.close, empty);
  assert.equal(decision.ok, false);
  assert.match(decision.reason!, /not actually here|not available to you/);
});

test("the surface name cannot collide with a host's", () => {
  assert.equal(WIDGET_SURFACE, "assistant-widget");
  assert.equal(WIDGET_MANIFEST.surface, WIDGET_SURFACE);
  // Both manifests can be loaded at once, so a control must never be ambiguous
  // about which surface it belongs to.
  for (const generic of ["org", "admin", "marketing", "page", "site"])
    assert.notEqual(WIDGET_SURFACE, generic);
});
