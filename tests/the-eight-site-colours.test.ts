import test from "node:test";
import assert from "node:assert/strict";
import { SKIP_WITHOUT_CHROME, withBrowser } from "./aiw-browser.ts";

/**
 * THE COLOURS A SITE'S OWNER MAY CHOOSE ARE READABLE IN THE WINDOW.
 *
 * A site's settings carry one accent colour, and the window works out the
 * colour of the text it puts on it. That is only as good as the colours it
 * is given, so the eight a site's owner is offered are measured here in a
 * real window, on a light and on a dark device, where the accent is really
 * used: the visitor's own bubble (the accent mixed into a dark navy, not the
 * accent itself), the send button, and the accent as the ink of a suggested
 * question. Each must reach 4.5 to 1, the usual floor for text.
 *
 * It also holds WHICH text colour comes out: cream on seven of them and
 * navy on the gold. A change to the window's contrast rule that flips one
 * shows here, by name.
 */
const COLOURS = {
  Violet: "#6d28d9",
  Blue: "#1d4ed8",
  Navy: "#1e3a5f",
  Teal: "#0f766e",
  Green: "#15803d",
  Terracotta: "#c2410c",
  Burgundy: "#9f1239",
  Gold: "#d4a017",
} as const;

/** Runs in the page: contrast of text on what is really behind it. */
const MEASURE = async (
  accent: string
): Promise<Record<string, { ratio: number; text: string; behind: string }>> => {
  const g = globalThis as any;
  const P = "sgiant-aiw";
  localStorage.clear();
  g.fetch = async () =>
    new Response(
      JSON.stringify({ type: "text", d: "Merhaba" }) + "\n" + JSON.stringify({ type: "done" }) + "\n",
      { status: 200 }
    );
  const w = g.SgiantAiWidget.createAiChatWidget({
    endpoint: "/x",
    title: "Resepsiyon",
    greeting: "Hoş geldiniz",
    accent,
    getSuggestions: () => ["Çalışma saatleriniz nedir?"],
  });
  w.open();
  await new Promise((r) => setTimeout(r, 300));
  const rgb = (c: string) => {
    const m = c.match(/[\d.]+/g)!.map(Number);
    return { r: m[0]!, g: m[1]!, b: m[2]!, a: m[3] ?? 1 };
  };
  const lum = (c: { r: number; g: number; b: number }) => {
    const f = (v: number) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  // The first thing behind the text that is not see-through.
  const behindOf = (el: Element): string => {
    for (let e: Element | null = el; e; e = e.parentElement) {
      const cs = getComputedStyle(e);
      const painted = cs.backgroundImage.match(/rgba?\([^)]+\)/);
      if (painted) return painted[0];
      if (rgb(cs.backgroundColor).a > 0.5) return cs.backgroundColor;
    }
    return getComputedStyle(document.body).backgroundColor;
  };
  const out: Record<string, { ratio: number; text: string; behind: string }> = {};
  const read = (name: string, selector: string) => {
    const el = document.querySelector(selector);
    if (!el) return;
    const text = getComputedStyle(el).color;
    const behind = behindOf(el);
    const [hi, lo] = [lum(rgb(text)), lum(rgb(behind))].sort((a, b) => b - a);
    out[name] = {
      ratio: Math.round(((hi! + 0.05) / (lo! + 0.05)) * 100) / 100,
      text,
      behind,
    };
  };
  // Before a question: the suggested question, where the accent is ink.
  read("a suggested question", `.${P}-suggestions button`);
  const input = document.querySelector(
    '[data-ai-target="widget-composer"]'
  ) as HTMLTextAreaElement;
  input.value = "Çalışma saatleriniz nedir?";
  read("the send button", `.${P}-send`);
  input.closest("form")!.requestSubmit();
  await new Promise((r) => setTimeout(r, 400));
  read("the visitor's own bubble", `.${P}-msg.${P}-user`);
  w.destroy();
  return out;
};

const CREAM = "rgb(252, 247, 227)";
const NAVY = "rgb(21, 29, 47)";

test(
  "in a browser: the eight colours, on a light and on a dark device",
  { skip: SKIP_WITHOUT_CHROME },
  async (t) => {
    await withBrowser(async (page) => {
      for (const scheme of ["light", "dark"] as const) {
        await page.scheme(scheme);
        for (const [name, accent] of Object.entries(COLOURS))
          await t.test(`${name} ${accent}, ${scheme}`, async () => {
            await page.open([390, 800]);
            const seen = await page.evaluate<Awaited<ReturnType<typeof MEASURE>>>(
              `(${MEASURE})(${JSON.stringify(accent)})`
            );
            assert.deepEqual(Object.keys(seen).sort(), [
              "a suggested question",
              "the send button",
              "the visitor's own bubble",
            ]);
            for (const [where, m] of Object.entries(seen))
              assert.ok(
                m.ratio >= 4.5,
                `${where}: ${m.ratio} to 1 (${m.text} on ${m.behind})`
              );
            // Cream on seven, navy on the gold, on both accent-filled parts.
            const on = name === "Gold" ? NAVY : CREAM;
            assert.equal(seen["the send button"]!.text, on);
            assert.equal(seen["the visitor's own bubble"]!.text, on);
          });
      }
    });
  }
);
