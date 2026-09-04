import test from "node:test";
import assert from "node:assert/strict";
import { widgetStyles } from "./aiw-source.ts";

/**
 * The header bar follows the colour scheme, and its contrast cannot drift.
 *
 * It was pinned to navy/cream in BOTH schemes for a real reason: the buttons
 * once read --aiw-accent-contrast, which is DERIVED from the accent, and
 * against the teal all three of our apps pass that derivation returns brand
 * navy. Navy on navy is 1.00:1 — an invisible toolbar, and it shipped.
 *
 * Flipping the bar reopens exactly that risk, so the rule is: it may flip, it
 * may never be derived. Light is cream-on-navy inverted; dark is the original.
 * The same two brand values, swapped, so the contrast is identical either way
 * and no accent a host passes can move it.
 */
const NAVY = "#151D2F";
const CREAM = "#FCF7E3";

test("light gets a light bar, dark gets the dark one", () => {
  assert.match(
    widgetStyles,
    new RegExp(`--aiw-header-bg:${CREAM};--aiw-header-fg:${NAVY}`),
    "the light default must be a cream bar with navy text"
  );
  assert.match(
    widgetStyles,
    new RegExp(`\\{--aiw-header-bg:${NAVY};--aiw-header-fg:${CREAM}`),
    "the dark block must restore the navy bar"
  );
});

test("the header pair is never derived from the accent", () => {
  // The failure this exists for: --aiw-accent-contrast against our own teal
  // returns navy, and navy on navy is an invisible toolbar. A host can pass any
  // accent, so anything computed from it can land on any contrast at all.
  const headerDecls = [...widgetStyles.matchAll(/--aiw-header-(?:bg|fg):([^;}]+)/g)].map(
    (m) => m[1].trim()
  );
  assert.ok(headerDecls.length >= 4, `expected both pairs, saw ${headerDecls.length}`);
  for (const value of headerDecls) {
    assert.ok(
      /^#[0-9A-Fa-f]{6}$/.test(value),
      `header token is "${value}" — it must be a literal, not derived`
    );
    assert.ok(
      !/accent|color-mix|var\(/.test(value),
      `header token reads ${value}; anything accent-derived can be 1.00:1`
    );
  }
});

test("the bar uses only the two brand values, in one order or the other", () => {
  // Not an aesthetic rule: it is what makes the contrast identical in both
  // schemes without anyone having to measure it again.
  const values = new Set(
    [...widgetStyles.matchAll(/--aiw-header-(?:bg|fg):([^;}]+)/g)].map((m) =>
      m[1].trim().toUpperCase()
    )
  );
  assert.deepEqual(
    [...values].sort(),
    [NAVY.toUpperCase(), CREAM.toUpperCase()].sort(),
    "the header must be the brand pair swapped, so both directions are 15.66:1"
  );
});
