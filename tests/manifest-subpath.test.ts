/**
 * THE MANIFEST TOOLKIT IS REACHABLE, AND COSTS NOTHING UNTIL ASKED.
 *
 * `sgiant-ai-agent-bridge` has shipped `generateManifest`, `verifySurface`,
 * `canAct` and `hashManifest` since the contract was written — a DOM walk that
 * turns dialogs into nested views, a verifier, a reasoned act decision — and
 * NOTHING CALLED ANY OF THEM (sgiant-platform#356). An implementation nobody
 * can reach from the artifact every surface already loads is the fifth instance
 * this week of a thing built and wired to nothing.
 *
 * So it is re-exported from `sgiant-ai-widget/manifest`: one import that gives a
 * host both halves — draft a manifest for its page, verify the panel's against
 * the live DOM, keep the two surfaces apart in a scan.
 *
 * SEPARATE ENTRY, deliberately. The core is one runtime dependency, zero peers
 * and no React, a property broken twice before. Nothing in the main entry
 * references this file, so a host that never touches manifests pays nothing —
 * the same reasoning `./charts` is built on.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import * as manifest from "../dist/manifest.js";
import * as core from "../dist/index.js";

test("the generator and the verifier are both reachable", () => {
  // The two halves of the rule: the manifest declares, the DOM confirms. A
  // generator without a verifier is a licence to act on fiction.
  assert.equal(typeof manifest.generateManifest, "function");
  assert.equal(typeof manifest.verifySurface, "function");
  assert.equal(typeof manifest.canAct, "function");
  assert.equal(typeof manifest.hashManifest, "function");
});

test("and so are the widget's own halves", () => {
  assert.equal(typeof manifest.verifyWidgetSurface, "function");
  assert.equal(typeof manifest.hostTargetsOnly, "function");
  assert.ok(Array.isArray(manifest.WIDGET_TARGET_DECLARATIONS));
  assert.equal(manifest.WIDGET_SURFACE, "assistant-widget");
});

test("the subpath is declared in exports, or nobody can import it", () => {
  // A file in dist that `exports` does not name is unreachable to every
  // consumer — which is the exact shape this entry exists to end.
  const pkg = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  );
  assert.deepEqual(pkg.exports["./manifest"], {
    types: "./dist/manifest.d.ts",
    default: "./dist/manifest.js",
  });
});

test("the core does not drag it in", () => {
  // The whole reason it is a subpath. If the core ever re-exports the
  // generator, every host pays for machinery it may never use.
  assert.equal(
    (core as Record<string, unknown>).generateManifest,
    undefined,
    "the generator leaked into the main entry",
  );
});
