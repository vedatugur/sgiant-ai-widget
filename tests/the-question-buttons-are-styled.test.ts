import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { widgetStyles } from "./aiw-source.ts";

/**
 * THE QUESTION CARD'S BUTTONS WEAR THEIR OWN STYLE.
 *
 * When the decision cards were lifted out of the window (ae95c73), a search and
 * replace of `send` with `ctx.send` reached inside a string: the confirm
 * buttons were drawn with the class `aiw-question-ctx.send`, which no rule
 * styles, so they lost their colour and their disabled look. Every class the
 * card draws its buttons with must be one the stylesheet styles.
 */
test("every class the question card gives a button is styled", () => {
  const cards = readFileSync(
    join(import.meta.dirname, "..", "src", "decision-cards.ts"),
    "utf8"
  );
  const classes = [
    ...cards.matchAll(/el\(\s*"button",\s*`\$\{PREFIX\}-(question-[^`\s]+)`/g),
  ].map((m) => m[1]);
  assert.ok(classes.length >= 2, "could not find the question card's buttons");
  for (const c of classes)
    assert.match(
      widgetStyles,
      new RegExp(`\\$\\{PREFIX\\}-${c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[{:]`),
      `the class ${c} has no rule`
    );
});
