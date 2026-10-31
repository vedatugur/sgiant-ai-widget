import test from "node:test";
import assert from "node:assert/strict";
import { WIDGET_LABELS, widgetLabelOverrides } from "../dist/labels.js";
import * as entry from "../dist/index.js";

/**
 * A HOST PASSES ONLY ITS OWN WORDS (audit F128).
 *
 * `resolveWidgetLabels` handed the window every label, defaulted to English,
 * so a host's copy of a sentence won over the window's own and a key the
 * host's file lacked came out in English on a Turkish page. A host now
 * passes `locale` and `widgetLabelOverrides(t)`: the labels its translator
 * knows, and nothing else.
 */

/** A translator over a flat file, the way i18next answers `t(key, def)`. */
const translator =
  (file: Record<string, string>) =>
  (key: string, def: string): string =>
    key in file ? file[key] : def;

test("only the labels the host's file holds are passed", () => {
  const out = widgetLabelOverrides(
    translator({
      "chatWidget.send": "Gönder!",
      "chatWidget.notALabel": "nobody reads this",
    })
  );
  assert.deepEqual(out, { send: "Gönder!" });
});

test("a host with no chat words passes nothing, so the window uses its own", () => {
  assert.deepEqual(widgetLabelOverrides(translator({})), {});
});

test("a host's sentence equal to the window's English is still the host's", () => {
  // The default is not the English: a file that says what the window says
  // is still the file's word, kept so a later reword in the window does not
  // silently change the host's screen either way.
  const out = widgetLabelOverrides(
    translator({ "chatWidget.send": WIDGET_LABELS.send })
  );
  assert.deepEqual(out, { send: WIDGET_LABELS.send });
});

test("every label is asked for under chatWidget.<key>", () => {
  const asked: string[] = [];
  widgetLabelOverrides((key, def) => {
    asked.push(key);
    return def;
  });
  assert.deepEqual(
    asked.sort(),
    Object.keys(WIDGET_LABELS)
      .map((k) => `chatWidget.${k}`)
      .sort()
  );
});

test("the package entry exports it beside the deprecated helper", () => {
  assert.equal(typeof entry.widgetLabelOverrides, "function");
  assert.equal(typeof entry.resolveWidgetLabels, "function");
});
