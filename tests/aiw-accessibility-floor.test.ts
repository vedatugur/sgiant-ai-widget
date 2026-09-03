import test from "node:test";
import assert from "node:assert/strict";
import { widgetSrc } from "./aiw-source.ts";

/**
 * The widget's accessibility floor (#308).
 *
 * House law puts the accessibility floor above everything, including a brand
 * file. These three were below it, and each one is the kind of regression that
 * reappears silently: a new button, a smaller icon, one more animated selector.
 *
 * Source-level, because the widget is vanilla DOM built at runtime — there is
 * no component tree to render and no DOM in this runner. What is asserted is
 * the RULE that makes the floor hold for controls nobody has written yet.
 */
const src = widgetSrc;

test("every button gets the focus base at creation, not at 40 call sites", () => {
  // The whole point. Enumerating call sites is how the widget ended up with
  // forty buttons and no designed focus state — the list falls behind the code
  // the first time someone adds a control.
  assert.match(
    src,
    /if \(tag === "button"\) node\.classList\.add\(`\$\{PREFIX\}-btn`\)/,
    "el() must attach the focus base to every button it creates"
  );
  assert.match(src, /\.\$\{PREFIX\}-btn:focus-visible\{[^}]*outline:/);
});

test("the focus ring is two-toned, so it cannot vanish into a themed panel", () => {
  // A single-colour ring is measurable against ONE ground. The host is
  // explicitly allowed to repaint the panel, and once the widget is public
  // (#306) we will not control the accent at all.
  const rule = src.match(/\.\$\{PREFIX\}-btn:focus-visible\{([^}]*)\}/)?.[1];
  assert.ok(rule, "no focus rule found");
  assert.match(rule, /outline:2px solid var\(--aiw-accent\)/);
  assert.match(rule, /outline-offset:2px/);
  assert.match(rule, /box-shadow:0 0 0 4px #151D2F/);
});

test("the two undersized controls carry a 24x24 hit area", () => {
  for (const sel of ["vote", "ui-dot"]) {
    const re = new RegExp(
      `\\.\\$\\{PREFIX\\}-${sel}::before\\{[^}]*width:24px;height:24px`
    );
    assert.match(src, re, `${sel} has no 24x24 target`);
  }
});

test("their neighbours are spaced so the 24px targets do not collide", () => {
  // Growing a hit area without growing the gap just makes two controls fight
  // over the same pixels. WCAG's spacing exception needs the CENTRES 24px
  // apart: 20px votes need a 4px gap, 6px dots need 18px.
  assert.match(src, /\.\$\{PREFIX\}-votes\{[^}]*gap:4px/);
  assert.match(src, /\.\$\{PREFIX\}-ui-dots\{[^}]*gap:18px/);
});

test("reduced motion is gated at the keyframes, not by a selector list", () => {
  const block = src.match(
    /@media \(prefers-reduced-motion:reduce\)\{([\s\S]*?)\n\}/
  )?.[1];
  assert.ok(block, "no reduced-motion block");
  // Every keyframe the sheet defines must be redefined here, or a consumer of
  // the one that was missed keeps moving for a reader who asked for stillness.
  const defined = [
    ...src.matchAll(/@keyframes \$\{PREFIX\}-([a-z0-9]+)\{/g),
  ].map((m) => m[1]);
  const unique = [...new Set(defined)];
  // `spin` is deliberately NOT stilled: it reports state, and a stopped spinner
  // says "stuck", which is a worse answer than a moving one.
  for (const name of unique.filter((n) => n !== "spin")) {
    assert.ok(
      block.includes(`@keyframes \${PREFIX}-${name}{`),
      `${name} keeps animating under reduced motion`
    );
  }
  assert.ok(
    !block.includes("-msg,"),
    "the block is back to naming selectors; it must redefine keyframes"
  );
});

test("entrances keep their fade under reduced motion — softer, never zero", () => {
  // House law: a gentler variant, not stillness. Killing the opacity too would
  // make content appear with no transition at all, losing the spatial cue that
  // something arrived.
  const block = src.match(
    /@media \(prefers-reduced-motion:reduce\)\{([\s\S]*?)\n\}/
  )![1];
  for (const name of ["rise", "richin", "tokin", "sheetup"]) {
    assert.match(
      block,
      new RegExp(`@keyframes \\$\\{PREFIX\\}-${name}\\{from\\{opacity:0\\}`),
      `${name} should fade, not jump`
    );
  }
});
