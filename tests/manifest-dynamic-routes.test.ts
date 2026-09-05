import test from "node:test";
import assert from "node:assert/strict";
// From `dist`, like every other behavioural test here: `npm test` builds
// first, and the built output has the extensions Node's ESM resolver needs.
import { matchManifest } from "../dist/host-actions.js";
import type { PageManifestEntry } from "../dist/host-actions.js";

/**
 * Dynamic routes, and why the tie-break is not a detail.
 *
 * `matchManifest` has supported `:param` segments since it was written — the
 * docblock says so, and gives `/reports/<uuid>` as the reason. No manifest in
 * the estate ever used one, so every dynamic route missed entirely and the
 * assistant was told the last URL segment was the page's name: "The user is
 * currently on: abc-123".
 *
 * Adding the entries is half the fix. The other half is that `/reports/all`
 * and `/reports/:reportId` are BOTH two segments and both match `/reports/all`
 * — so scoring on depth alone leaves the winner decided by which one someone
 * happened to type first.
 */
const M: PageManifestEntry[] = [
  { path: "/", title: "Home", purpose: "root" },
  { path: "/reports", title: "Reports", purpose: "the list" },
  // Deliberately written BEFORE the literal, which is the ordering that used
  // to lose. If this test ever passes only because the order was changed, it
  // has stopped testing anything.
  { path: "/reports/:reportId", title: "One report", purpose: "a report" },
  { path: "/reports/all", title: "All reports", purpose: "every report" },
  { path: "/dashboards/:dashId/edit", title: "Builder", purpose: "build" },
];

test("a literal segment beats a parameter regardless of file order", () => {
  assert.equal(matchManifest("/reports/all", M)?.title, "All reports");
  assert.equal(matchManifest("/reports/abc-123", M)?.title, "One report");
});

test("a dynamic route resolves instead of missing entirely", () => {
  // The defect: with no `:reportId` entry this returned undefined, `pageInfo`
  // was absent, and the hint fell through to the last URL segment.
  const m = matchManifest("/reports/8f3c1d2e-uuid", M);
  assert.ok(m, "a concrete report path must match its pattern");
  assert.equal(m.purpose, "a report");
});

test("depth still wins — a deeper entry beats a shallower one", () => {
  assert.equal(matchManifest("/dashboards/d1/edit", M)?.title, "Builder");
});

test("the list page is not swallowed by its own parameter entry", () => {
  assert.equal(matchManifest("/reports", M)?.title, "Reports");
});

test("the root entry describes only the root", () => {
  assert.equal(matchManifest("/", M)?.title, "Home");
  assert.notEqual(matchManifest("/reports", M)?.title, "Home");
});

test("an unknown path still matches nothing rather than guessing", () => {
  // Suffix matching means a longer path does NOT fall back to a shorter entry.
  // That is deliberate: a wrong page is worse than no page.
  assert.equal(matchManifest("/nothing-here", M), undefined);
});
