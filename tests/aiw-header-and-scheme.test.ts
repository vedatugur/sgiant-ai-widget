import test from "node:test";
import assert from "node:assert/strict";
import { widgetStyles } from "./aiw-source.ts";
import {
  contrastRatio,
  resolveAccentContrast,
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
 * Two defects reported from the product on 2026-08-30, both invisible to every
 * gate this repo has, and both in the same file.
 *
 * 1. THE TOOLBAR WAS UNREADABLE, at 1.00:1.
 *
 *    #307 made `--aiw-accent-contrast` DERIVED rather than defaulted, which was
 *    right: white on the teal all three hosts pass is 2.00:1. But the header
 *    buttons read that token while sitting on a FIXED NAVY bar, not on the
 *    accent — and the derivation, over that same teal, returns brand navy. The
 *    fix that made thirteen accent-filled controls legible made the toolbar
 *    invisible, because a token meaning "readable on the ACCENT" was used on a
 *    surface that is not the accent.
 *
 * 2. LIGHT MODE DID NOT WORK INSIDE OUR APPS.
 *
 *    The sheet expressed dark only as `@media (prefers-color-scheme:dark)`,
 *    while the apps carry their own light/dark/system switch. OS dark + app set
 *    to light gave a dark widget in a light app, and the reverse broke as hard.
 *
 * Neither is a type error, an unused export, or a failing assertion — which is
 * this repo's recorded lesson about reachability, arriving again as colour.
 */

test("the header pair is legible, and it is a PAIR (not the accent's)", () => {
  const bg = /--aiw-header-bg:(#[0-9A-Fa-f]{3,8})/.exec(widgetStyles)?.[1];
  const fg = /--aiw-header-fg:(#[0-9A-Fa-f]{3,8})/.exec(widgetStyles)?.[1];
  assert.ok(bg && fg, "the header must declare its own background/foreground");
  const ratio = contrastRatio(fg as string, bg as string);
  assert.ok(
    ratio >= 4.5,
    `header foreground ${fg} on ${bg} is ${ratio.toFixed(2)}:1, under 4.5:1`
  );

  // The bug itself, as an assertion: the accent's derived foreground, over the
  // accent this repo actually ships, must not be the header's background.
  const derived = resolveAccentContrast(ASSISTANT.accent);
  assert.ok(derived, "the shipped accent must derive a foreground");
  const collision = contrastRatio(derived as string, bg as string);
  assert.ok(
    collision < 4.5,
    `this test is vacuous: the accent's derived foreground (${derived}) is ` +
      `legible on the header (${collision.toFixed(2)}:1), so using the wrong ` +
      `token here would no longer be visibly broken. Re-derive the check.`
  );
});

test("no control on the header bar reads the ACCENT's foreground token", () => {
  // The header, its buttons and the close control sit on --aiw-header-bg. Any
  // of them reading --aiw-accent-contrast is the reported bug returning.
  const rules = widgetStyles.match(/[^\n{}]*\{[^{}]*\}/g) ?? [];
  const onHeader = /-header\{|-icon\{|-icon:hover|-icon-on|-close\{|-hactions/;
  const offenders = rules.filter(
    (r) => onHeader.test(r) && r.includes("--aiw-accent-contrast")
  );
  assert.deepEqual(
    offenders,
    [],
    "a header control is painting itself with the accent's foreground"
  );
});

test("the header's chip is drawn from the bar's own pair, not the surface", () => {
  // WAS "the header does not flip with the colour scheme", asserting exactly one
  // declaration of each token. That encoded a DECISION, and the decision changed
  // on 2026-09-04: a dark bar on a light page was reported as wrong, and the bar
  // now follows the scheme. A test that pins a decision fails the day the
  // decision is revisited, which tells you nothing about whether the code is
  // right.
  //
  // What must still hold is the failure underneath it: --aiw-surface flips, and
  // the active-icon chip once painted #161616 on the #151D2F bar in dark mode
  // because it read the surface instead of the bar. The chip belongs to the bar,
  // whatever colour the bar is.
  const rules = widgetStyles.match(/[^\n{}]*\{[^{}]*\}/g) ?? [];
  const chip = rules.filter((r) => /-icon-on/.test(r));
  assert.ok(chip.length > 0, "no active-icon rule found");
  for (const rule of chip)
    assert.ok(
      !/--aiw-surface/.test(rule),
      `the active chip reads --aiw-surface: ${rule.slice(0, 90)}`
    );
});

test("dark follows the host's switch, with the OS only as a fallback", () => {
  // Both scopes come from ONE source string (`darkRules`), so they cannot
  // drift; what this pins is that both exist and that the OS query EXCLUDES
  // widgets whose host owns the scheme.
  const host = /const darkWhenHostSaysSo = darkRules\(([\s\S]{0,160}?)\);/.exec(
    widgetStyles
  );
  assert.ok(host, "no host-driven dark scope");
  assert.match(
    host[1],
    /`\.dark /,
    "the host scope must key off `.dark` — an app switched to dark while the " +
      "OS is light must not stay light"
  );

  const os = /const darkWhenNobodySaid = darkRules\(([\s\S]{0,220}?)\);/.exec(
    widgetStyles
  );
  assert.ok(os, "the OS fallback must still exist for third-party embeds");
  assert.match(
    os[1],
    /:not\(\.\$\{PREFIX\}-host-tokens\)/,
    "the OS query must not apply where the host owns the scheme — that is the " +
      "reported bug: OS dark + app set to light gave a dark widget"
  );

  // And it is actually wired into the sheet, not merely computed.
  assert.match(widgetStyles, /\$\{darkWhenHostSaysSo\}/);
  assert.match(
    widgetStyles,
    /@media \(prefers-color-scheme:dark\)\{\$\{darkWhenNobodySaid\}\}/
  );
});

test("the advanced pane reads tokens, not a parallel palette", () => {
  // #306 measured this pane as not participating in the token system at all:
  // it carried a complete second palette in literals (#f4f5f7 / #eef0f3 /
  // #e7e8ec / #777 light, #121212 / #1a1a1a / #262626 / #9b9b9b dark), so a
  // themed host repainted the whole widget and the pane stayed grey. Every one
  // of those eight was the light or dark reading of a token that already
  // existed.
  //
  // The URL strip was also the concrete accessibility failure: #777 on #eef0f3
  // is 3.92:1, under the 4.5:1 body-text floor. --aiw-muted is documented in
  // the sheet as a CONTRAST FLOOR and clears it on both surfaces (4.76 / 5.02).
  const paneRules = (widgetStyles.match(/[^\n{}]*\{[^{}]*\}/g) ?? []).filter(
    (r) => /-pane\{|-pane-bar\{|-pane-url\{|-pane-frame\{/.test(r)
  );
  assert.ok(paneRules.length >= 4, "the pane rules moved or were renamed");
  for (const rule of paneRules) {
    // rgba() in a shadow is not a colour token question; a hex IS.
    const hexes = rule.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
    assert.deepEqual(
      hexes,
      [],
      `the advanced pane is painting a literal again: ${rule.slice(0, 120)}`
    );
  }
});

test("status colour goes through the semantic tokens, both schemes", () => {
  // #306: "the semantic tokens exist and are bypassed". Two systems for one
  // idea, and the one being skipped is the one with a dark-mode answer — so
  // these were not untidiness, they were failures, in BOTH directions:
  //
  //   #10b981 (ok text)      2.54:1 in LIGHT   -> --aiw-ok-text      5.08
  //   #ef4444 (danger text)  3.76:1 in LIGHT   -> --aiw-danger-text  5.95
  //   #d93f0b (error text)   4.02:1 in DARK    -> --aiw-danger-text  8.81
  //   #a32020 (danger btn)   2.40:1 in DARK    -> --aiw-danger-text  8.81
  //
  // The check is on the LITERALS, not on the ratios: a ratio test would pass
  // the moment someone picked a different illegible hex, and the defect being
  // guarded is a second palette existing at all.
  const BYPASSED = ["#10b981", "#ef4444", "#d93f0b"];
  const rules = widgetStyles.match(/[^\n{}]*\{[^{}]*\}/g) ?? [];
  for (const hex of BYPASSED) {
    const offenders = rules.filter((r) =>
      r.toLowerCase().includes(hex.toLowerCase())
    );
    assert.deepEqual(
      offenders.map((r) => r.split("{")[0].trim()),
      [],
      `${hex} is a status colour with no dark counterpart — use the token`
    );
  }

  // #a32020 survives in exactly one place: the FILLED failed-badge, which is an
  // opaque chip carrying white text at 7.54:1. It does not flip with the scheme
  // and must not become --aiw-danger-bg, which is a pale card surface.
  const a32020 = rules.filter((r) => r.includes("#a32020"));
  assert.equal(
    a32020.length,
    1,
    `#a32020 belongs in exactly one rule, found ${a32020.length}`
  );
  assert.match(
    a32020[0].split("{")[0],
    /-ui-badge-failed/,
    "the only remaining #a32020 must be the filled badge"
  );
});
