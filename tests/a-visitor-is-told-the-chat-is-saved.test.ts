import test from "node:test";
import assert from "node:assert/strict";
import { WIDGET_LABELS } from "../dist/labels.js";
import { WIDGET_LABELS_TR } from "../dist/labels-tr.js";
import { SKIP_WITHOUT_CHROME, withBrowser } from "./aiw-browser.ts";

/**
 * A VISITOR IS TOLD THE CONVERSATION IS KEPT (sgiant-platform#648; the
 * owner's row 18, 28 Oct 2026: under the box they write in, always there).
 *
 * On a customer's site only. Our own sites are not a business's, and say
 * nothing of the kind.
 */
test("the sentence is the owner's, letter for letter, in both languages", () => {
  assert.equal(
    WIDGET_LABELS.savedNotice,
    "This conversation is saved and can be read by the business."
  );
  assert.equal(
    WIDGET_LABELS_TR.savedNotice,
    "Bu konuşma kaydedilir ve işletme tarafından okunabilir."
  );
});

test(
  "in a browser: under the box on a customer's site, in the site's language; nowhere on ours",
  { skip: SKIP_WITHOUT_CHROME },
  async () => {
    await withBrowser(async (page) => {
      await page.open([1280, 800]);
      const seen = await page.evaluate<{
        tr: { text: string; last: boolean; visible: boolean };
        en: string;
        ours: number;
      }>(`(${async () => {
        const P = "sgiant-aiw";
        const g = window as unknown as { SgiantAiWidget: any };
        const site = async (language: string) => {
          window.fetch = (async () =>
            new Response(
              JSON.stringify({ answersVisitors: true, name: "Ada", language }),
              { status: 200, headers: { "content-type": "application/json" } }
            )) as typeof fetch;
          const h = await g.SgiantAiWidget.createSiteChat({
            endpoint: "https://api.example/public/ai/chat",
            siteKey: `pk-${language}`,
            settingsUrl: "https://api.example/public/ai/site-settings",
          });
          (document.querySelector(`.${P}-bubble`) as HTMLElement).click();
          await new Promise((r) => setTimeout(r, 300));
          const form = document.querySelector(`.${P}-form`) as HTMLElement;
          const note = form.querySelector(`.${P}-saved-note`) as HTMLElement | null;
          const r = note?.getBoundingClientRect();
          const out = {
            text: note?.textContent ?? "",
            last: form.lastElementChild === note,
            visible: !!r && r.height > 0 && r.width > 0,
          };
          h?.destroy();
          return out;
        };
        const tr = await site("tr");
        const en = (await site("en")).text;
        const app = g.SgiantAiWidget.createAiChatWidget({ endpoint: "about:blank", title: "AYCA" });
        (document.querySelector(`.${P}-bubble`) as HTMLElement).click();
        await new Promise((r) => setTimeout(r, 300));
        const ours = document.querySelectorAll(`.${P}-saved-note`).length;
        app.destroy();
        return { tr, en, ours };
      }})()`);
      assert.equal(seen.tr.text, "Bu konuşma kaydedilir ve işletme tarafından okunabilir.");
      assert.equal(seen.tr.last, true, "it is not under the box");
      assert.equal(seen.tr.visible, true, "it is not drawn");
      assert.equal(seen.en, "This conversation is saved and can be read by the business.");
      assert.equal(seen.ours, 0, "our own window says it");
    });
  }
);
