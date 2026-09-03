import test from "node:test";
import assert from "node:assert/strict";
import { widgetStyles } from "./aiw-source.ts";
import { USER_BUBBLE_INK } from "../dist/styles.js";
import {
  CONTRAST_DARK,
  CONTRAST_LIGHT,
  contrastRatio,
  relativeLuminance,
  resolveAccentContrast,
  mixSrgb,
  accentInk,
} from "../dist/contrast.js";
// INLINED from the host's design tokens, deliberately.
//
// These were `import { COLORS, ASSISTANT } from "@sgiant/tokens"` while this
// package lived in that monorepo. It does not any more, and a public package
// cannot reach a private registry — the same constraint that sent the widget
// here in the first place.
//
// A copy nothing checks is a copy that drifts, so the monorepo asserts these
// exact values against its own tokens by reading this package's SHIPPED dist.
// If you change one here, that check goes red there, which is the point.
const ASSISTANT = { accent: "#60C7C8" };
const COLORS = { amber: "#FBAA34", teal: "#60C7C8" };

/**
 * THE REGRESSION THIS EXISTS TO CATCH.
 *
 * The widget shipped `--aiw-accent-contrast: #fff`, which is right against its
 * own violet default (7.10:1) and wrong against every accent a host actually
 * passes. All three of ours send teal `#60C7C8`, where white measures
 * **2.00:1** — under a 4.5:1 floor, across thirteen controls on four surfaces —
 * and it survived review for exactly that reason: nothing was wrong on the
 * widget's own terms, and no host ever set the token.
 *
 * So the pairing is derived now, and this file asserts the derivation over the
 * accents the REPO SHIPS rather than over invented ones. A brand-colour change
 * that reintroduces an illegible pair fails here instead of on a customer's
 * screen. #307.
 */

/** Every accent this repo actually paints an accent-filled control with. */
const SHIPPED_ACCENTS: Record<string, string> = {
  "ASSISTANT.accent (all three hosts)": ASSISTANT.accent,
  "COLORS.teal": COLORS.teal,
  "the widget's own default": "#6d28d9",
};

test("every shipped accent resolves to a foreground at or above 4.5:1", () => {
  for (const [name, accent] of Object.entries(SHIPPED_ACCENTS)) {
    const fg = resolveAccentContrast(accent);
    assert.ok(fg, `${name} (${accent}) could not be resolved at all`);
    const ratio = contrastRatio(accent, fg)!;
    assert.ok(
      ratio >= 4.5,
      `${name}: ${fg} on ${accent} is ${ratio.toFixed(2)}:1, below the 4.5:1 floor`
    );
  }
});

test("the exact pairing that shipped broken is now legible", () => {
  // The bug, pinned by its numbers so the fix cannot silently revert.
  assert.ok(
    contrastRatio("#60C7C8", "#ffffff")! < 2.1,
    "teal/white was 2.00:1"
  );
  assert.equal(resolveAccentContrast("#60C7C8"), CONTRAST_DARK);
  assert.ok(contrastRatio("#60C7C8", CONTRAST_DARK)! > 8);
});

test("the violet default still picks the light foreground, not navy", () => {
  // Guards against a fix that simply hardcodes dark: navy on violet is 2.37:1,
  // so a picker that ignored the accent would break the one case that worked.
  assert.equal(resolveAccentContrast("#6d28d9"), CONTRAST_LIGHT);
});

test("an unparseable accent yields null, so the host's value is left alone", () => {
  // A host may pass color-mix(), a var(), or a named colour. Overwriting those
  // with a guess is worse than leaving them: the caller keeps its own token.
  for (const bad of [
    "color-mix(in srgb, red 50%, blue)",
    "var(--brand)",
    "rebeccapurple",
    "#12345",
    "",
  ]) {
    assert.equal(resolveAccentContrast(bad), null, `${bad} should not resolve`);
  }
});

test("shorthand and alpha hex parse the same as full hex", () => {
  assert.equal(relativeLuminance("#fff"), relativeLuminance("#ffffff"));
  // Alpha is ignored rather than rejected: the ratio is against the accent's
  // own colour, and a caller passing #rrggbbaa still deserves an answer.
  assert.equal(relativeLuminance("#60C7C8ff"), relativeLuminance("#60C7C8"));
});

test("the gradient header is legible at BOTH stops, not just the accent", () => {
  // The header paints --aiw-gradient (accent → amber) and puts
  // accent-contrast text on it, so deriving from the accent alone is only
  // sound if the result also clears the far stop. It does — but nothing else
  // checks it, and #305 may restyle this chrome later.
  const fg = resolveAccentContrast(ASSISTANT.accent)!;
  for (const stop of [ASSISTANT.accent, COLORS.amber]) {
    const ratio = contrastRatio(stop, fg)!;
    assert.ok(
      ratio >= 4.5,
      `header text ${fg} on gradient stop ${stop} is ${ratio.toFixed(2)}:1`
    );
  }
});

test("the user's own bubble is derived against the MIX, not the accent", () => {
  // #307 one level down, and it survived that fix for a year of the widget's
  // most-drawn element: the user's message bubble is not accent-filled. It is
  // `color-mix(in srgb, var(--aiw-accent) 76%, #04191b)`, which lands somewhere
  // the raw accent's foreground was never measured against. Over the teal all
  // three hosts pass it resolves to #4a9d9e, where the sheet's literal `#fff`
  // is 3.18:1 — under the floor, on every message the user types.
  //
  // The accents below deliberately include the two ends. A WHITE accent is the
  // case that proves the point: `#fff` on its bubble is 1.69:1, and #306 says
  // outright that we will not control the accent once this publishes.
  const PROBE = {
    ...SHIPPED_ACCENTS,
    "the widget's own default violet": "#6d28d9",
    "brand amber": COLORS.amber,
    "a white accent (#306: we will not control it)": "#ffffff",
    "a black accent": "#000000",
  };
  for (const [name, accent] of Object.entries(PROBE)) {
    const bg = mixSrgb(accent, USER_BUBBLE_INK, 0.76);
    assert.ok(bg, `${name}: the bubble background must resolve`);
    const fg = resolveAccentContrast(bg as string);
    assert.ok(fg, `${name}: the bubble foreground must resolve`);
    const ratio = contrastRatio(fg as string, bg as string)!;
    assert.ok(
      ratio >= 4.5,
      `${name} (${accent}): bubble ${fg} on ${bg} is ${ratio.toFixed(2)}:1`
    );
  }
});

test("the bubble's ink has ONE definition, shared by the paint and the maths", () => {
  // The mix is computed in JS and handed to CSS as a resolved value; the
  // `color-mix()` in the sheet is only the no-accent fallback. Both must read
  // the same near-black, or the foreground is derived against one background
  // and painted on another — which is this whole bug, one level further down.
  assert.match(
    widgetStyles,
    /\$\{USER_BUBBLE_INK\}/,
    "the stylesheet must interpolate the shared constant, not repeat the hex"
  );
  // Read the rule by hand rather than with `[^}]*`: the interpolation
  // `${USER_BUBBLE_INK}` contains a closing brace, so a "not a brace" class
  // stops halfway through the very declaration list being checked.
  const at = widgetStyles.indexOf("-user{align-self:flex-end;background:");
  assert.ok(at > 0, "the user-bubble rule moved");
  const rule = widgetStyles.slice(at, widgetStyles.indexOf("\n", at));
  assert.ok(
    rule.includes("background:var(--aiw-user-bg,"),
    "the bubble must prefer the derived background"
  );
  assert.ok(
    rule.includes("color:var(--aiw-user-contrast,"),
    "the bubble must prefer the derived foreground"
  );
});

test("the accent is legible as INK on both surfaces, for any accent", () => {
  // `--aiw-accent` is a FILL colour, and twenty rules also used it as TEXT —
  // links, hover states, the focused input, chips, KPI deltas, the menu icons,
  // the active vote. A fill is not an ink:
  //
  //   teal   #60C7C8 (all three hosts)   2.00:1 on the light surface
  //   violet #6d28d9 (our own default)   2.55:1 on the dark one
  //   amber  #FBAA34                     1.93:1 on the light one
  //
  // The shape of that table is the finding. It is NOT "the teal is a bad
  // accent" — every accent is illegible as ink on one of the two schemes, and
  // which one depends only on where the colour sits between the surfaces. The
  // widget's own default is the one that fails in the dark, which is why this
  // survived: whoever picked violet was looking at a light theme.
  const SURFACES = { light: "#ffffff", dark: "#161616" };
  const PROBE = {
    ...SHIPPED_ACCENTS,
    "the widget's own default violet": "#6d28d9",
    "brand amber": COLORS.amber,
    "a white accent": "#ffffff",
    "a black accent": "#000000",
  };
  for (const [name, accent] of Object.entries(PROBE))
    for (const [scheme, surface] of Object.entries(SURFACES)) {
      const inkColor = accentInk(accent, surface);
      assert.ok(inkColor, `${name} on ${scheme}: ink must resolve`);
      const r = contrastRatio(inkColor as string, surface)!;
      assert.ok(
        r >= 4.5,
        `${name} (${accent}) ink ${inkColor} on ${scheme} ${surface} is ${r.toFixed(2)}:1`
      );
    }
});

test("an accent already legible as ink is returned UNCHANGED", () => {
  // The adjustment returns the first step that clears the floor, so it stays as
  // close to the brand accent as legibility allows. Where no adjustment is
  // needed the accent must come back untouched, or every host silently gets a
  // slightly-off brand colour in the scheme that was already fine.
  assert.equal(accentInk("#60C7C8", "#161616"), "#60c7c8", "teal in dark");
  assert.equal(accentInk("#6d28d9", "#ffffff"), "#6d28d9", "violet in light");
  assert.equal(
    accentInk(COLORS.amber, "#161616")?.toLowerCase(),
    COLORS.amber.toLowerCase(),
    "amber in dark"
  );
});

test("the ink token is wired to both schemes, and the fill is not", () => {
  // The surface flips and an inline token would not, so there are TWO derived
  // values and the sheet picks between them. If the dark block stopped
  // redefining --aiw-accent-ink, every one of those twenty rules would use the
  // light ink on the dark surface — which is the bug, inverted.
  assert.match(
    widgetStyles,
    /--aiw-accent-ink:var\(--aiw-accent-ink-light,var\(--aiw-accent\)\)/,
    "the base block must define the ink from the light derivation"
  );
  assert.match(
    widgetStyles,
    /--aiw-accent-ink:var\(--aiw-accent-ink-dark,var\(--aiw-accent\)\)/,
    "the dark block must redefine it from the dark derivation"
  );
  // And nothing paints TEXT from the raw fill any more.
  const rules = widgetStyles.match(/[^\n{}]*\{[^{}]*\}/g) ?? [];
  const offenders = rules
    .filter((r) => /(?<![-\w])color:var\(--aiw-accent\)/.test(r))
    .map((r) => r.split("{")[0].trim());
  assert.deepEqual(
    offenders,
    [],
    "these paint text with the FILL colour — use --aiw-accent-ink"
  );
});
