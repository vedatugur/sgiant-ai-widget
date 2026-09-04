import test from "node:test";
import assert from "node:assert/strict";
import { widgetStyles } from "./aiw-source.ts";

/**
 * The attachment bar sits directly on the composer's `border-top`, so nothing
 * below it absorbs a missing bottom padding: the chips touch the line.
 *
 * It shipped as `padding:8px 10px 0` — 8px above the chips and none below —
 * and was reported from a real look at it, not from a test. Measured in the
 * browser afterwards: chip 8px from the top of the bar, 0 from the bottom.
 * The chip's OWN padding was symmetric all along, which is what makes this
 * kind of thing hard to see in the source: every value near it looks right.
 */
test("the attachment bar's vertical padding is symmetric", () => {
  const rule = /-attbar\{([^}]*)\}/.exec(widgetStyles)?.[1];
  assert.ok(rule, "the attbar rule must exist");
  const padding = /padding:([^;}]+)/.exec(rule!)?.[1]?.trim();
  assert.ok(padding, "the attbar must set padding");
  const parts = padding!.split(/\s+/);
  // 1 value = uniform, 2 = vertical/horizontal, both symmetric by definition.
  // 3 or 4 values name top and bottom separately, which is where they drift.
  if (parts.length >= 3)
    assert.equal(
      parts[0],
      parts[2],
      `attbar top and bottom padding differ (${padding}) — the chips sit on the composer's border`
    );
});
