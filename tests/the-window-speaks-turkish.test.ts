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

test("the words that are not labels follow the page too", () => {
  // The votes, Edit, Regenerate, the edit box's buttons, the advanced view's
  // controls, the arrows between versions, a picture's name, an unnamed
  // action: each had an English word written where it is drawn.
  assert.deepEqual(WIDGET_OPTION_WORDS_TR, {
    voteUp: "Faydalı",
    voteDown: "Faydasız",
    edit: "Düzenle",
    regenerate: "Yeniden oluştur",
    cancel: "İptal",
    save: "Kaydet ve gönder",
    resize: "Boyutlandırmak için sürükleyin · sıfırlamak için çift tıklayın",
    advanced: "Gelişmiş görünüm",
    exitAdvanced: "Gelişmiş görünümden çık",
    hidePane: "Sayfayı gizle",
    showPane: "Sayfayı göster",
    prevVersion: "Önceki sürüm",
    nextVersion: "Sonraki sürüm",
    imageAlt: "Web görseli önizlemesi",
    openPage: "Sayfayı aç",
    thePage: "Sayfa",
    run: "Çalıştır",
  });
  assert.deepEqual(
    Object.keys(WIDGET_OPTION_WORDS).sort(),
    Object.keys(WIDGET_OPTION_WORDS_TR).sort()
  );
  for (const word of Object.values(WIDGET_OPTION_WORDS_TR))
    assert.notEqual(word.trim(), "");
  assert.equal(builtInOptionWords("tr"), WIDGET_OPTION_WORDS_TR);
  assert.equal(builtInOptionWords(undefined, "tr-TR"), WIDGET_OPTION_WORDS_TR);
  assert.equal(builtInOptionWords("en", "tr"), WIDGET_OPTION_WORDS);
  assert.equal(builtInOptionWords(undefined), WIDGET_OPTION_WORDS);
});

test("no English word is left written where something is drawn", () => {
  // Found by a look at a Turkish page whose host passes no words: the votes'
  // spoken names, the version arrows, the resize handle, a picture's name.
  // What is drawn there now comes from a table that has both languages.
  for (const file of [
    "src/widget.ts",
    "src/message-chrome.ts",
    "src/decision-cards.ts",
  ]) {
    const code = readFileSync(file, "utf8")
      // Comments may say anything.
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    // `x || "Word"`, `x ?? "Word"`, and an attribute or text set to a literal.
    const written = [
      ...code.matchAll(/(?:\|\||\?\?)\s*"([A-Z][A-Za-z …&·-]*[a-z…])"/g),
      ...code.matchAll(
        /(?:setAttribute\("(?:aria-label|title|alt|placeholder)",\s*|\.(?:title|alt|placeholder|textContent)\s*=\s*)"([A-Z][a-z][^"]*)"/g
      ),
    ].map((m) => m[1]);
    assert.deepEqual(written, [], file);
  }
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

      await t.test("figures follow the same choice as the words", async () => {
        // A Turkish page with a silent host read Turkish words around "1,200".
        const figure = (pageLang: string, options: object) =>
          page.open([1280, 800]).then(() =>
            page.evaluate<string>(
              `(async () => {
                document.documentElement.lang = ${JSON.stringify(pageLang)};
                const w = SgiantAiWidget.createAiChatWidget({
                  endpoint: "/demo-chat", persistKey: "figures",
                  listThreads: async () => [{ id: "t", title: "T" }],
                  loadThread: async () => [
                    { role: "user", content: "S", id: "q" },
                    { role: "assistant", content: "C", id: "a", parentId: "q", inputTokens: 1200, outputTokens: 3 },
                  ],
                  ...${JSON.stringify(options)},
                });
                w.open();
                await new Promise((r) => setTimeout(r, 200));
                const P = "sgiant-aiw";
                [...document.querySelectorAll("." + P + "-panel button")].find((b) => /History|Geçmiş/.test((b.getAttribute("aria-label") || "") + b.title))?.click();
                await new Promise((r) => setTimeout(r, 300));
                [...document.querySelectorAll("." + P + "-panel *")].find((n) => n.children.length === 0 && n.textContent === "T")?.click();
                await new Promise((r) => setTimeout(r, 600));
                const text = document.querySelector("." + P + "-panel").textContent;
                w.destroy();
                return (text.match(/1[.,]200/) || ["none"])[0];
              })()`
            )
          );
        assert.equal(await figure("tr", {}), "1.200");
        assert.equal(await figure("en", {}), "1,200");
        assert.equal(await figure("tr", { locale: "en" }), "1,200");
        assert.equal(await figure("en", { locale: "tr" }), "1.200");
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
