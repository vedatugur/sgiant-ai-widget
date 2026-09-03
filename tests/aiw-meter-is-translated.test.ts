import test from "node:test";
import assert from "node:assert/strict";
import { widgetSrc } from "./aiw-source.ts";
import { WIDGET_LABELS } from "../dist/labels.js";

/**
 * The free-token meter renders ONLY when `signupUrl` is set — which is exactly
 * the anonymous surfaces, the marketing visitor chat and the public demo, both
 * of which serve Turkish. Its three strings were hardcoded English, so a
 * Turkish visitor read "60,000 free tokens left" under a Turkish conversation.
 *
 * The widget cannot call i18next, so "translated" here means: the string comes
 * from the label bag, and the label bag has a key for it.
 */
const src = widgetSrc;

test("the meter's strings are label keys, not literals", () => {
  for (const key of [
    "meterTokensLeft",
    "meterFreePreview",
    "meterUsedThisSession",
  ] as const) {
    assert.ok(
      key in WIDGET_LABELS,
      `${key} is missing from WIDGET_LABELS — the meter would fall back to a literal`
    );
    assert.match(
      src,
      new RegExp(`L\\("${key}"`),
      `${key} exists but the widget does not read it`
    );
  }
});

test("the meter body contains no bare English copy", () => {
  const i = src.indexOf("function renderMeter");
  assert.notEqual(i, -1, "renderMeter moved");
  let d = 0,
    j = i;
  while (src[j] !== "{") j++;
  for (; j < src.length; j++) {
    d += src[j] === "{" ? 1 : src[j] === "}" ? -1 : 0;
    if (d === 0) break;
  }
  const body = src.slice(i, j);
  // The phrases that were there, and any other multi-word English sentence.
  for (const phrase of [
    "free tokens left",
    "Free preview",
    "used this session",
  ])
    assert.ok(
      !body.includes(phrase),
      `renderMeter still contains the literal "${phrase}"`
    );
});
