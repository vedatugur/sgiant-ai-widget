import test from "node:test";
import assert from "node:assert/strict";
import { WIDGET_LABELS } from "../dist/labels.js";
import {
  WIDGET_LABELS_TR,
  WIDGET_OPTION_WORDS,
  WIDGET_OPTION_WORDS_TR,
  builtInLabels,
  builtInOptionWords,
} from "../dist/labels-tr.js";
import { readFileSync } from "node:fs";
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

test("the six words that are options follow the page too", () => {
  // The votes, Edit, Regenerate and the edit box's buttons each had an
  // English default written where it is drawn.
  assert.deepEqual(WIDGET_OPTION_WORDS_TR, {
    voteUp: "Faydalı",
    voteDown: "Faydasız",
    edit: "Düzenle",
    regenerate: "Yeniden oluştur",
    cancel: "İptal",
    save: "Kaydet ve gönder",
  });
  assert.equal(builtInOptionWords("tr"), WIDGET_OPTION_WORDS_TR);
  assert.equal(builtInOptionWords(undefined, "tr-TR"), WIDGET_OPTION_WORDS_TR);
  assert.equal(builtInOptionWords("en", "tr"), WIDGET_OPTION_WORDS);
  assert.equal(builtInOptionWords(undefined), WIDGET_OPTION_WORDS);
  // And no English word is left written where one of them is drawn.
  const code = readFileSync("src/index.ts", "utf8");
  for (const option of [
    "voteUpLabel",
    "voteDownLabel",
    "editLabel",
    "regenerateLabel",
    "cancelLabel",
    "saveLabel",
  ])
    assert.doesNotMatch(code, new RegExp(`opts\\.${option} \\?\\? "`), option);
});

/* ---------------------------------------------------------- in a browser */

/** Runs in the page: a window on a page of this language, and what it says. */
const SAYS = (
  pageLang: string,
  options: Record<string, unknown>
): { send: string; ask: string; close: string; sub: string | null } => {
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
    // The line under the name: its words, or null when nothing is drawn.
    sub: (() => {
      const sub = panel.querySelector(`.${P}-sub`) as HTMLElement | null;
      return sub && sub.getBoundingClientRect().height > 0
        ? sub.textContent
        : null;
    })(),
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
          sub: null,
        });
        assert.notEqual(s.send, WIDGET_LABELS.send);
      });

      await t.test("an English page: English, as before", async () => {
        const s = await says("en", {});
        assert.deepEqual(s, {
          send: WIDGET_LABELS.send,
          ask: en("askAnything", "AYCA"),
          close: WIDGET_LABELS.closeChat,
          sub: null,
        });
      });

      await t.test("the host's `locale` is believed over the page", async () => {
        assert.equal((await says("tr", { locale: "en" })).send, WIDGET_LABELS.send);
        assert.equal((await says("en", { locale: "tr" })).send, WIDGET_LABELS_TR.send);
      });

      await t.test("the line under the name is the host's, or is not there", async () => {
        // It defaulted to "Growth assistant": one product's description of
        // itself, in English, on every host that gave none.
        assert.equal((await says("en", {})).sub, null);
        assert.equal((await says("tr", { subtitle: "  " })).sub, null);
        assert.equal(
          (await says("tr", { subtitle: "Site ağı asistanı" })).sub,
          "Site ağı asistanı"
        );
      });

      await t.test("a host's own label still wins, and the rest is Turkish", async () => {
        const s = await says("tr", { labels: { send: "Yolla" } });
        assert.equal(s.send, "Yolla");
        assert.equal(s.close, WIDGET_LABELS_TR.closeChat);
      });
    });
  }
);
