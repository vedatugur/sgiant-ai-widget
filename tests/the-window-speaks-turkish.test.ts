import test from "node:test";
import assert from "node:assert/strict";
import { WIDGET_LABELS } from "../dist/labels.js";
import { WIDGET_LABELS_TR, builtInLabels } from "../dist/labels-tr.js";
import { SKIP_WITHOUT_CHROME, withBrowser } from "./aiw-browser.ts";

/**
 * THE WINDOW SPEAKS TURKISH BY ITSELF (sgiant-platform#617).
 *
 * A host that passed no `labels` got English on a Turkish page: every button,
 * the placeholder, the connection-lost sentence. Each host that wanted Turkish
 * carried its own copy of the same sentences, and a label the window gained
 * later reached such a host in English until somebody noticed.
 *
 * The window now carries its Turkish and chooses it from the page's language.
 */
const KEYS = Object.keys(WIDGET_LABELS) as (keyof typeof WIDGET_LABELS)[];
const holes = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

test("every label has its Turkish, with the same blanks to fill", () => {
  assert.deepEqual(Object.keys(WIDGET_LABELS_TR).sort(), [...KEYS].sort());
  for (const key of KEYS) {
    const tr = WIDGET_LABELS_TR[key];
    assert.equal(typeof tr, "string", key);
    assert.notEqual(tr.trim(), "", key);
    // A blank the Turkish lacks is a value never shown; one it adds is drawn
    // as "{count}".
    assert.deepEqual(holes(tr), holes(WIDGET_LABELS[key]), key);
    // i18next's double braces would be drawn as they are.
    assert.doesNotMatch(tr, /\{\{/, key);
  }
});

/** The sentences about what the assistant does on its own. */
const NAMED = [
  "autoNavOnHint",
  "autoNavOffHint",
  "autoApplyOnHint",
  "autoApplyOffHint",
  "automationHelpTitle",
  "automationHelpNav",
  "automationHelpNavPinned",
  "automationHelpApply",
] as const;

test("no label names one product's assistant: each says the window's own name", () => {
  // They said "AYCA", on a window a host may have named anything.
  for (const table of [WIDGET_LABELS, WIDGET_LABELS_TR])
    for (const key of KEYS) assert.doesNotMatch(table[key], /AYCA/, key);
  for (const key of NAMED) {
    assert.match(WIDGET_LABELS[key], /\{name\}/, key);
    assert.match(WIDGET_LABELS_TR[key], /\{name\}/, key);
  }
});

test("the free-preview line says the same thing in both languages", () => {
  // English said "{count} free tokens left" where Turkish hosts said what is
  // left in the free preview.
  assert.equal(WIDGET_LABELS.meterTokensLeft, "{count} left in the free preview");
  assert.equal(
    WIDGET_LABELS_TR.meterTokensLeft,
    "Ücretsiz önizlemede {count} kaldı"
  );
});

test("the language: what the host says, else what the page says, else English", () => {
  for (const tag of ["tr", "tr-TR", "TR", "tr_TR", " tr "])
    assert.equal(builtInLabels(tag), WIDGET_LABELS_TR, tag);
  for (const tag of ["en", "en-GB", "de", "trk", "t", "", undefined, null])
    assert.equal(builtInLabels(tag), WIDGET_LABELS, String(tag));
  // The page speaks only when the host said nothing.
  assert.equal(builtInLabels(undefined, "tr-TR"), WIDGET_LABELS_TR);
  assert.equal(builtInLabels("", "tr"), WIDGET_LABELS_TR);
  assert.equal(builtInLabels("en", "tr"), WIDGET_LABELS);
  assert.equal(builtInLabels("tr", "en"), WIDGET_LABELS_TR);
  assert.equal(builtInLabels(undefined, undefined), WIDGET_LABELS);
  // Whatever a plain-JS host hands over, nothing throws.
  for (const odd of [3, {}, [], true] as unknown[])
    assert.equal(builtInLabels(odd as string), WIDGET_LABELS);
});

/* ---------------------------------------------------------- in a browser */

/** Runs in the page: a window on a page of this language, and what it says. */
const SAYS = (
  pageLang: string,
  options: Record<string, unknown>
): { send: string; ask: string; close: string } => {
  document.documentElement.lang = pageLang;
  const w = (globalThis as any).SgiantAiWidget.createAiChatWidget({
    endpoint: "/demo-chat",
    ...options,
  });
  w.open();
  const P = "sgiant-aiw";
  const panel = document.querySelector(`.${P}-panel`)!;
  const input = panel.querySelector(
    '[data-ai-target="widget-composer"]'
  ) as HTMLInputElement;
  const said = {
    send: panel.querySelector(`.${P}-send`)!.textContent ?? "",
    ask: input.placeholder,
    close:
      [...panel.querySelectorAll("button")]
        .map((b) => b.getAttribute("aria-label") ?? "")
        .find((a) => a === "Close chat" || a === "Sohbeti kapat") ?? "",
  };
  w.destroy();
  return said;
};

test(
  "in a browser: the window's words follow the page",
  { skip: SKIP_WITHOUT_CHROME },
  async (t) => {
    await withBrowser(async (page) => {
      const says = async (pageLang: string, options: Record<string, unknown>) => {
        await page.open([1280, 800]);
        return page.evaluate<ReturnType<typeof SAYS>>(
          `(${SAYS})(${JSON.stringify(pageLang)}, ${JSON.stringify(options)})`
        );
      };
      const tr = (key: keyof typeof WIDGET_LABELS, name: string) =>
        WIDGET_LABELS_TR[key].split("{name}").join(name);
      const en = (key: keyof typeof WIDGET_LABELS, name: string) =>
        WIDGET_LABELS[key].split("{name}").join(name);

      await t.test("a Turkish page, a host that says nothing: Turkish", async () => {
        const s = await says("tr-TR", { title: "Resepsiyon" });
        assert.deepEqual(s, {
          send: WIDGET_LABELS_TR.send,
          ask: tr("askAnything", "Resepsiyon"),
          close: WIDGET_LABELS_TR.closeChat,
        });
        assert.notEqual(s.send, WIDGET_LABELS.send);
      });

      await t.test("an English page: English, as before", async () => {
        const s = await says("en", {});
        assert.deepEqual(s, {
          send: WIDGET_LABELS.send,
          ask: en("askAnything", "AYCA"),
          close: WIDGET_LABELS.closeChat,
        });
      });

      await t.test("the host's `locale` is believed over the page", async () => {
        assert.equal((await says("tr", { locale: "en" })).send, WIDGET_LABELS.send);
        assert.equal((await says("en", { locale: "tr" })).send, WIDGET_LABELS_TR.send);
      });

      await t.test("a host's own label still wins, and the rest is Turkish", async () => {
        const s = await says("tr", { labels: { send: "Yolla" } });
        assert.equal(s.send, "Yolla");
        assert.equal(s.close, WIDGET_LABELS_TR.closeChat);
      });
    });
  }
);
