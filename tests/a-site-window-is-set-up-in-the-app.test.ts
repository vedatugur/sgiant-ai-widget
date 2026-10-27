import test from "node:test";
import assert from "node:assert/strict";
import { readSiteSettings } from "../dist/site-chat.js";
import { SKIP_WITHOUT_CHROME, withBrowser } from "./aiw-browser.ts";

/**
 * THE SITE'S WINDOW AS ITS OWNER SETS IT UP (sgiant-platform#592; the owner,
 * 27 Oct 2026).
 *
 *  - two more settings: which bottom corner, and a logo; a logo is taken
 *    only from the server the settings came from, so no visitor's browser is
 *    sent anywhere else;
 *  - a logo that does not load shows the window's own mark;
 *  - a PREVIEW for the app: drawn in the host's box from the settings being
 *    edited, open, and unable to write or send; nothing leaves it.
 */

const API = "https://api.example/public/ai/site-settings";
const YES = { answersVisitors: true, name: "Reception" };

test("the corner: left only when it says left; anything else is the right", () => {
  assert.equal(readSiteSettings({ ...YES, position: "bottom-left" })?.position, "bottom-left");
  for (const position of ["bottom-right", "left", "BOTTOM-LEFT", 1, null, undefined])
    assert.equal(readSiteSettings({ ...YES, position })?.position, "bottom-right", String(position));
});

test("a logo only from the server the settings came from, and only https (http for a developer's own machine)", () => {
  const logo = (value: unknown, from: string | undefined = API) =>
    readSiteSettings({ ...YES, logo: value }, from)?.logo;
  assert.equal(logo("https://api.example/public/ai/site-logo?siteKey=pk"), "https://api.example/public/ai/site-logo?siteKey=pk");
  // A path is read against the settings' own server.
  assert.equal(logo("/public/ai/site-logo?siteKey=pk"), "https://api.example/public/ai/site-logo?siteKey=pk");
  for (const elsewhere of [
    "https://evil.example/pixel.gif",
    "https://api.example.evil/x.png",
    "http://api.example/x.png",
    "//evil.example/x.png",
    "javascript:alert(1)",
    "data:image/png;base64,AAAA",
    "",
    7,
    null,
  ])
    assert.equal(logo(elsewhere), null, String(elsewhere));
  // http only on a developer's own machine, even when the settings came
  // over http from the same server.
  assert.equal(logo("http://api.example/x.png", "http://api.example/public/ai/site-settings"), null);
  // Without the address the settings came from, no logo at all.
  assert.equal(readSiteSettings({ ...YES, logo: "https://api.example/x.png" })?.logo, null);
  assert.equal(logo("http://localhost:4000/x.png", "http://localhost:4000/public/ai/site-settings"), "http://localhost:4000/x.png");
});

test(
  "in a browser: the preview is drawn in the host's box, open, unable to write or send, and asks nobody",
  { skip: SKIP_WITHOUT_CHROME },
  async () => {
    await withBrowser(async (page) => {
      for (const lang of ["en", "tr"] as const) {
        await page.open([1280, 800]);
        const seen = await page.evaluate<{
          inBox: boolean;
          position: string;
          open: boolean;
          title: string;
          chips: string[];
          disabled: boolean;
          placeholder: string;
          sendOff: boolean;
          fetched: number;
          side: string;
          avatar: string;
        }>(`(${async (lang: string) => {
          const P = "sgiant-aiw";
          let fetched = 0;
          const real = window.fetch;
          window.fetch = (...a: Parameters<typeof fetch>) => {
            fetched++;
            return real(...a);
          };
          const box = document.createElement("div");
          box.style.cssText = "position:relative;width:420px;height:620px";
          document.body.append(box);
          const g = window as unknown as { SgiantAiWidget: any };
          const h = g.SgiantAiWidget.createSiteChatPreview({
            container: box,
            settings: {
              name: "Reception",
              greeting: "Hello",
              language: lang,
              color: "#0f766e",
              suggestions: ["Is breakfast included?"],
              position: "bottom-left",
              logo: "https://elsewhere.example/x.png",
            },
            from: "https://api.example/public/ai/site-settings",
          });
          await new Promise((r) => setTimeout(r, 300));
          const panel = box.querySelector(`.${P}-panel`) as HTMLElement;
          const input = panel.querySelector('[data-ai-target="widget-composer"]') as HTMLTextAreaElement;
          const chips = [...panel.querySelectorAll(`.${P}-suggestions button`)].map((b) => b.textContent ?? "");
          // Try every way of sending: a suggested question, Enter, the form.
          (panel.querySelector(`.${P}-suggestions button`) as HTMLButtonElement | null)?.click();
          input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
          input.closest("form")!.requestSubmit();
          await new Promise((r) => setTimeout(r, 300));
          const out = {
            inBox: box.contains(panel),
            position: getComputedStyle(panel).position,
            open: getComputedStyle(panel).display !== "none",
            title: panel.querySelector(`.${P}-title`)?.textContent ?? "",
            chips,
            disabled: input.disabled,
            placeholder: input.placeholder,
            sendOff: (panel.querySelector(`.${P}-send`) as HTMLButtonElement).disabled,
            fetched,
            side: getComputedStyle(panel).left,
            avatar: panel.querySelector(`.${P}-av-img`) ? "img" : "mark",
          };
          h.destroy();
          window.fetch = real;
          return out;
        }})(${JSON.stringify(lang)})`);
        assert.equal(seen.inBox, true);
        assert.equal(seen.position, "absolute");
        assert.equal(seen.open, true);
        assert.equal(seen.title, "Reception");
        assert.deepEqual(seen.chips, ["Is breakfast included?"]);
        assert.equal(seen.disabled, true);
        assert.equal(
          seen.placeholder,
          lang === "tr" ? "Önizlemede mesaj yazılmaz." : "You cannot write in the preview."
        );
        assert.equal(seen.sendOff, true);
        assert.equal(seen.fetched, 0, "the preview asked a server");
        // (The corner is held by its own test below.)
        // A logo from another server is not drawn: the window's own mark.
        assert.equal(seen.avatar, "mark");
      }
    });
  }
);

test(
  "in a browser: a logo on the settings' own server is drawn, and one that does not load becomes the window's own mark",
  { skip: SKIP_WITHOUT_CHROME },
  async () => {
    await withBrowser(async (page) => {
      await page.open([1280, 800]);
      const seen = await page.evaluate<{ before: string; src: string; after: string }>(`(${async () => {
        const P = "sgiant-aiw";
        const box = document.createElement("div");
        box.style.cssText = "position:relative;width:420px;height:620px";
        document.body.append(box);
        const g = window as unknown as { SgiantAiWidget: any };
        const h = g.SgiantAiWidget.createSiteChatPreview({
          container: box,
          settings: { name: "Reception", logo: "https://api.example/public/ai/site-logo?siteKey=pk" },
          from: "https://api.example/public/ai/site-settings",
        });
        const img = box.querySelector(`.${P}-panel .${P}-av-img`) as HTMLImageElement | null;
        const before = img ? "img" : "mark";
        const src = img?.getAttribute("src") ?? "";
        // api.example does not exist: the image fails to load.
        await new Promise((r) => setTimeout(r, 1500));
        const after = box.querySelector(`.${P}-panel .${P}-av-img`) ? "img" : "mark";
        h.destroy();
        return { before, src, after };
      }})()`);
      assert.equal(seen.before, "img");
      assert.equal(seen.src, "https://api.example/public/ai/site-logo?siteKey=pk");
      assert.equal(seen.after, "mark");
    });
  }
);

test(
  "in a browser: the preview sits in the corner chosen, beside the app's own assistant, and leaves the page as it found it",
  { skip: SKIP_WITHOUT_CHROME },
  async () => {
    await withBrowser(async (page) => {
      for (const width of [1280, 375] as const) {
        await page.open([width, 900]);
        const seen = await page.evaluate<{
          rows: { pos: string; left: number; right: number; inBox: boolean; height: number }[];
          appSide: number;
          sweeps: number;
          sweepInBody: boolean;
          leftOver: Record<string, number>;
          stored: string[];
        }>(`(${async () => {
          const P = "sgiant-aiw";
          const g = window as unknown as { SgiantAiWidget: any };
          const counts: Record<string, number> = {};
          for (const target of [window, document] as const) {
            const add = target.addEventListener.bind(target);
            const remove = target.removeEventListener.bind(target);
            (target as any).addEventListener = (t: string, f: any, o?: any) => {
              counts[t] = (counts[t] ?? 0) + 1;
              return add(t, f, o);
            };
            (target as any).removeEventListener = (t: string, f: any, o?: any) => {
              counts[t] = (counts[t] ?? 0) - 1;
              return remove(t, f, o);
            };
          }
          // The app's own assistant first, in the right corner.
          const app = g.SgiantAiWidget.createAiChatWidget({ endpoint: "about:blank", title: "AYCA" });
          const afterApp = { ...counts };
          const box = document.createElement("div");
          // As the app gives it: at most 420px, never wider than the page.
          box.style.cssText = "position:relative;width:100%;max-width:420px;height:620px";
          document.body.append(box);
          const rows = [];
          for (const position of ["bottom-left", "bottom-right", "bottom-left"]) {
            const h = g.SgiantAiWidget.createSiteChatPreview({
              container: box,
              settings: { name: "Reception", position },
            });
            // After the window's own opening movement.
            await new Promise((r) => setTimeout(r, 700));
            const panel = box.querySelector(`.${P}-panel`) as HTMLElement;
            const b = box.getBoundingClientRect();
            const r = panel.getBoundingClientRect();
            rows.push({
              pos: position,
              left: Math.round(r.left - b.left),
              right: Math.round(b.right - r.right),
              inBox: r.left >= b.left && r.right <= b.right && r.top >= b.top && r.bottom <= b.bottom,
              height: Math.round(r.height),
              top: Math.round(r.top - b.top),
              bottom: Math.round(b.bottom - r.bottom),
            } as any);
            h.destroy();
          }
          const bubble = document.querySelector(`body > .${P}-bubble`) as HTMLElement;
          const appSide = Math.round(window.innerWidth - bubble.getBoundingClientRect().right);
          const sweeps = document.querySelectorAll(`[id="${P}-av-sweep"]`).length;
          const sweepInBody = !box.contains(document.getElementById(`${P}-av-sweep`));
          const leftOver: Record<string, number> = {};
          for (const k of Object.keys(counts)) if ((counts[k] ?? 0) !== (afterApp[k] ?? 0)) leftOver[k] = (counts[k] ?? 0) - (afterApp[k] ?? 0);
          const stored = Object.keys(localStorage).filter((k) => !k.startsWith("ayca") && k !== "aiw:opened");
          app.destroy();
          return { rows, appSide, sweeps, sweepInBody, leftOver, stored };
        }})()`);
        for (const row of seen.rows) {
          assert.equal(row.inBox, true, `${width}: ${row.pos} is outside its box: ${JSON.stringify(row)}`);
          if (row.pos === "bottom-left") assert.equal(row.left, 20, `${width}: ${JSON.stringify(row)}`);
          else assert.equal(row.right, 20, `${width}: ${JSON.stringify(row)}`);
          assert.ok(row.height <= 580, `${width}: the preview took ${row.height}px`);
        }
        // The app's own launcher stays in its corner.
        assert.ok(seen.appSide < 60, `${width}: the app's launcher moved (${seen.appSide}px from the right)`);
        // One shared mark, in the page's body.
        assert.equal(seen.sweeps, 1);
        assert.equal(seen.sweepInBody, true);
        // Three previews drawn and destroyed leave no listener behind.
        assert.deepEqual(seen.leftOver, {}, `${width}: listeners left behind`);
      }
    });
  }
);

test(
  "in a browser: on a customer's site, the corner and the logo the server tells are drawn, and the window is asked of nothing else",
  { skip: SKIP_WITHOUT_CHROME },
  async () => {
    await withBrowser(async (page) => {
      await page.open([1280, 800]);
      const seen = await page.evaluate<{ left: number; src: string; asked: string[] }>(`(${async () => {
        const P = "sgiant-aiw";
        const asked: string[] = [];
        window.fetch = (async (url: string) => {
          asked.push(String(url));
          return new Response(
            JSON.stringify({
              answersVisitors: true,
              name: "Reception",
              position: "bottom-left",
              logo: "https://api.example/public/ai/site-logo?siteKey=pk&v=1",
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }) as typeof fetch;
        const g = window as unknown as { SgiantAiWidget: any };
        const h = await g.SgiantAiWidget.createSiteChat({
          endpoint: "https://api.example/public/ai/chat",
          siteKey: "pk",
          settingsUrl: "https://api.example/public/ai/site-settings",
        });
        const bubble = document.querySelector(`.${P}-bubble`) as HTMLElement;
        const img = bubble.querySelector(`.${P}-av-img`) as HTMLImageElement | null;
        const out = {
          left: Math.round(bubble.getBoundingClientRect().left),
          src: img?.getAttribute("src") ?? "",
          asked,
        };
        h?.destroy();
        return out;
      }})()`);
      assert.ok(seen.left < 60, `the launcher is ${seen.left}px from the left`);
      assert.equal(seen.src, "https://api.example/public/ai/site-logo?siteKey=pk&v=1");
      assert.deepEqual(seen.asked, ["https://api.example/public/ai/site-settings?siteKey=pk"]);
    });
  }
);
