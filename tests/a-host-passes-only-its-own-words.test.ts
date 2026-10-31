import test from "node:test";
import assert from "node:assert/strict";
import { WIDGET_LABELS, widgetLabelOverrides } from "../dist/labels.js";
import * as entry from "../dist/index.js";
import i18next from "i18next";

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

/**
 * A real i18next with `fallbackLng: "en"`, on a Turkish page: the Turkish file
 * words `send`, the English file words `send` and `newChat`.
 */
async function turkishPageWithEnglishFallback() {
  const i18n = i18next.createInstance();
  await i18n.init({
    lng: "tr",
    fallbackLng: "en",
    resources: {
      en: { translation: { chatWidget: { send: "Send", newChat: "New chat" } } },
      tr: { translation: { chatWidget: { send: "Gönder!" } } },
    },
  });
  const t = (key: string, def: string): string => i18n.t(key, def);
  return { i18n, t };
}

test("a key the page's language lacks is not handed over in the fallback's English", async () => {
  const { i18n, t } = await turkishPageWithEnglishFallback();
  // What the old call cannot see: t() answers the English for a key the
  // Turkish file lacks, as if the host had worded it.
  assert.equal(t("chatWidget.newChat", "absent"), "New chat");
  const out = widgetLabelOverrides({ t, i18n });
  assert.equal("newChat" in out, false);
  assert.deepEqual(out, { send: "Gönder!" });
});

test("{ t, exists } reads the same way for a translator that is not i18next", async () => {
  const { i18n, t } = await turkishPageWithEnglishFallback();
  const out = widgetLabelOverrides({
    t,
    exists: (key) =>
      i18n.exists(key, { lng: i18n.language, fallbackLng: [] }),
  });
  assert.deepEqual(out, { send: "Gönder!" });
});

test("t alone keeps working, with the limit its comment names", async () => {
  // A t-only call still passes what the translator answers, the fallback's
  // English included: the limit `widgetLabelOverrides` documents.
  const { t } = await turkishPageWithEnglishFallback();
  assert.deepEqual(widgetLabelOverrides(t), {
    send: "Gönder!",
    newChat: "New chat",
  });
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
