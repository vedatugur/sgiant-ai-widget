import test from "node:test";
import assert from "node:assert/strict";
import { readSiteSettings, siteSettingsAddress } from "../dist/site-chat.js";
import { SKIP_WITHOUT_CHROME, withBrowser, type Page } from "./aiw-browser.ts";

/**
 * A CHAT ON A SITE ASKS FIRST WHETHER IT MAY BE THERE.
 *
 * `createSiteChat` reads the site's public settings before it draws
 * anything. A visitor's page may carry the script long after the site's
 * owner turned the assistant off (a cached page), or before they wrote
 * anything for it to answer from. Then the page shows nothing: no launcher,
 * no frame, no stylesheet, and nothing that appears and goes away again.
 *
 * Closed on every failure: only a 200 whose body says `answersVisitors:
 * true`, with a real `true`, draws the window.
 */

const YES = {
  answersVisitors: true,
  name: "Reception",
  greeting: "Welcome. How can I help?",
  language: null,
  color: "#0F766E",
  suggestions: ["What are your opening hours?", "Where are you?"],
};

test("only a real true says yes", () => {
  assert.ok(readSiteSettings(YES));
  for (const answersVisitors of [false, "true", 1, null, undefined, {}, []])
    assert.equal(readSiteSettings({ ...YES, answersVisitors }), null);
  // An older server does not send the field at all: that is a no.
  const { answersVisitors: _gone, ...older } = YES;
  assert.equal(readSiteSettings(older), null);
  for (const body of [null, undefined, "yes", 7, [], [YES], true])
    assert.equal(readSiteSettings(body), null);
});

test("how the window looks is judged field by field, and a bad one is the default", () => {
  assert.deepEqual(readSiteSettings(YES), {
    name: "Reception",
    greeting: "Welcome. How can I help?",
    language: null,
    color: "#0f766e",
    suggestions: ["What are your opening hours?", "Where are you?"],
    // sgiant-platform#592: the right corner and the window's own mark when
    // the site set neither.
    position: "bottom-right",
    logo: null,
  });
  // A wrong colour is not a reason to take the assistant away.
  for (const color of ["teal", "#fff", "#12345g", 7, null, "", "0f766e"])
    assert.equal(readSiteSettings({ ...YES, color })?.color, null);
  for (const language of ["de", "TR", "tr-TR", 1, "", undefined])
    assert.equal(readSiteSettings({ ...YES, language })?.language, null);
  assert.equal(readSiteSettings({ ...YES, language: "tr" })?.language, "tr");
  for (const empty of ["", "   ", 4, null, ["x"]]) {
    assert.equal(readSiteSettings({ ...YES, name: empty })?.name, null);
    assert.equal(readSiteSettings({ ...YES, greeting: empty })?.greeting, null);
  }
  assert.equal(readSiteSettings({ ...YES, name: "n".repeat(200) })?.name?.length, 80);
  assert.equal(
    readSiteSettings({ ...YES, greeting: "g".repeat(900) })?.greeting?.length,
    500
  );
  assert.deepEqual(
    readSiteSettings({
      ...YES,
      suggestions: [" a ", "", 3, "b", "c", "d", "e", "s".repeat(120)],
    })?.suggestions,
    ["a", "b", "c", "d"]
  );
  for (const suggestions of ["a", null, { 0: "a" }, undefined])
    assert.deepEqual(readSiteSettings({ ...YES, suggestions })?.suggestions, []);
});

test("the key goes on the settings address, whatever the address already carries", () => {
  assert.equal(
    siteSettingsAddress("https://api.example/public/ai/site-settings", "pk 1&2"),
    "https://api.example/public/ai/site-settings?siteKey=pk%201%262"
  );
  assert.equal(
    siteSettingsAddress("https://api.example/settings?v=1", "pk"),
    "https://api.example/settings?v=1&siteKey=pk"
  );
});

/* ---------------------------------------------------------- in a browser */

/**
 * Runs in the page. `answer` is what the settings read gets: a body, a
 * status, "network" for a failed request, "never" for one that does not
 * answer, "junk" for a 200 that is not JSON.
 */
const RUN = async (
  answer: unknown,
  opts: { locale?: string; lang?: string; timeoutMs?: number } = {}
): Promise<{
  handle: boolean;
  tookMs: number;
  asked: Array<{ url: string; credentials: string | undefined }>;
  /** Everything of the window's in the page, by its class prefix. */
  drawn: number;
  styles: number;
  bodyChildren: number;
  everDrawn: boolean;
  title: string;
  greeting: string;
  chips: string[];
  placeholder: string;
  accent: string;
  sentKey: unknown;
  stored: number;
}> => {
  const g = globalThis as any;
  const P = "sgiant-aiw";
  localStorage.clear();
  if (opts.lang) document.documentElement.lang = opts.lang;
  const asked: Array<{ url: string; credentials: string | undefined }> = [];
  let sentKey: unknown = null;
  g.fetch = (input: any, init?: any) => {
    const url = typeof input === "string" ? input : input.url;
    if (String(url).includes("/site-settings")) {
      asked.push({ url: String(url), credentials: init?.credentials });
      if (answer === "network") return Promise.reject(new TypeError("Failed to fetch"));
      if (answer === "never")
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError"))
          );
        });
      if (answer === "junk")
        return Promise.resolve(new Response("<html>502</html>", { status: 200 }));
      if (typeof answer === "number")
        return Promise.resolve(new Response('{"error":"x"}', { status: answer }));
      return Promise.resolve(
        new Response(JSON.stringify(answer), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      );
    }
    sentKey = JSON.parse(init?.body ?? "{}").siteKey;
    return Promise.resolve(
      new Response(
        JSON.stringify({ type: "text", d: "ok" }) + "\n" + JSON.stringify({ type: "done" }) + "\n",
        { status: 200, headers: { "content-type": "application/x-ndjson" } }
      )
    );
  };
  // Anything of the window's that is ever put in the page, even for a moment.
  let everDrawn = false;
  const mine = (n: Node): boolean =>
    n instanceof Element &&
    (String(n.className).includes(P) ||
      (n.tagName === "STYLE" && (n.textContent ?? "").includes(P)) ||
      !!n.querySelector?.(`[class*="${P}"]`));
  const seen = new MutationObserver((records) => {
    for (const r of records) for (const n of r.addedNodes) if (mine(n)) everDrawn = true;
  });
  seen.observe(document.documentElement, { childList: true, subtree: true });
  const before = document.body.children.length;
  const started = performance.now();
  const handle = await g.SgiantAiWidget.createSiteChat({
    endpoint: "https://api.example/public/ai/chat",
    siteKey: "pk_site_1",
    settingsUrl: "https://api.example/public/ai/site-settings",
    ...(opts.locale ? { locale: opts.locale } : {}),
    ...(opts.timeoutMs ? { timeoutMs: opts.timeoutMs } : {}),
  });
  const tookMs = performance.now() - started;
  await new Promise((r) => setTimeout(r, 150));
  let title = "";
  let greeting = "";
  let chips: string[] = [];
  let placeholder = "";
  let accent = "";
  if (handle) {
    handle.open();
    await new Promise((r) => setTimeout(r, 250));
    const panel = document.querySelector(`.${P}-panel`)!;
    title = panel.querySelector(`.${P}-title`)?.textContent ?? "";
    greeting =
      panel.querySelector(`.${P}-log .${P}-assistant`)?.textContent ?? "";
    chips = [...panel.querySelectorAll(`.${P}-suggestions button`)].map(
      (b) => b.textContent ?? ""
    );
    const input = panel.querySelector(
      '[data-ai-target="widget-composer"]'
    ) as HTMLTextAreaElement;
    placeholder = input.placeholder;
    accent = getComputedStyle(panel).getPropertyValue("--aiw-accent").trim();
    input.value = "hello";
    input.closest("form")!.requestSubmit();
    await new Promise((r) => setTimeout(r, 300));
  }
  seen.disconnect();
  const out = {
    handle: !!handle,
    tookMs,
    asked,
    drawn: document.querySelectorAll(`[class*="${P}"]`).length,
    styles: [...document.querySelectorAll("style")].filter((s) =>
      (s.textContent ?? "").includes(P)
    ).length,
    bodyChildren: document.body.children.length - before,
    everDrawn,
    title,
    greeting,
    chips,
    placeholder,
    accent,
    sentKey,
    stored: localStorage.length,
  };
  handle?.destroy();
  return out;
};

const run = async (
  page: Page,
  answer: unknown,
  opts: { locale?: string; lang?: string; timeoutMs?: number } = {},
  viewport: readonly [number, number] = [1280, 800]
) => {
  await page.open(viewport);
  return page.evaluate<Awaited<ReturnType<typeof RUN>>>(
    `(${RUN})(${JSON.stringify(answer)}, ${JSON.stringify(opts)})`
  );
};

test(
  "in a browser: the site's assistant, only when the server says yes",
  { skip: SKIP_WITHOUT_CHROME },
  async (t) => {
    await withBrowser(async (page) => {
      const nothing = (s: Awaited<ReturnType<typeof RUN>>, why: string) => {
        assert.equal(s.handle, false, `${why}: a window was made`);
        assert.equal(s.drawn, 0, `${why}: something of the window is in the page`);
        assert.equal(s.styles, 0, `${why}: its stylesheet is in the page`);
        assert.equal(s.bodyChildren, 0, `${why}: the page gained an element`);
        assert.equal(s.everDrawn, false, `${why}: something appeared and went`);
        assert.equal(s.stored, 0, `${why}: something was kept in the browser`);
        assert.equal(s.asked.length, 1, `${why}: asked ${s.asked.length} times`);
      };

      await t.test("THE CASE THAT MATTERS: a cached page that still carries the script, after the assistant was turned off, shows no chat", async () => {
        for (const viewport of [[1280, 800], [320, 640]] as const)
          nothing(
            await run(page, { ...YES, answersVisitors: false }, {}, viewport),
            `turned off, ${viewport[0]}px`
          );
      });

      await t.test("every other way of not hearing yes is nothing too", async () => {
        const { answersVisitors: _gone, ...older } = YES;
        const cases: Array<[string, unknown]> = [
          ["a server from before the field", older],
          ['"true" as a text', { ...YES, answersVisitors: "true" }],
          ["no such site", 404],
          ["too many requests", 429],
          ["the server's own trouble", 500],
          ["a gateway's page with a 200", "junk"],
          ["a list where an object belongs", [YES]],
          ["the request failed", "network"],
        ];
        for (const [why, answer] of cases) nothing(await run(page, answer), why);
      });

      await t.test("a read that does not answer is given up on, and nothing is drawn", async () => {
        const s = await run(page, "never", { timeoutMs: 400 });
        nothing(s, "no answer");
        assert.ok(s.tookMs >= 380 && s.tookMs < 1500, `gave up after ${s.tookMs} ms`);
        assert.equal(await page.evaluate("SgiantAiWidget.SITE_SETTINGS_TIMEOUT_MS"), 4000);
      });

      await t.test("yes: the window, with what the site's owner set", async () => {
        for (const viewport of [[1280, 800], [320, 640]] as const) {
          const s = await run(page, YES, {}, viewport);
          assert.equal(s.handle, true);
          assert.equal(s.styles, 1);
          assert.equal(s.title, "Reception");
          assert.match(s.greeting, /Welcome\. How can I help\?/);
          assert.deepEqual(s.chips, ["What are your opening hours?", "Where are you?"]);
          assert.equal(s.accent, "#0f766e");
          // The key is on the read, and on the visitor's question.
          assert.equal(
            s.asked[0]!.url,
            "https://api.example/public/ai/site-settings?siteKey=pk_site_1"
          );
          assert.equal(s.asked[0]!.credentials, "omit");
          assert.equal(s.sentKey, "pk_site_1");
        }
      });

      await t.test("the site went away while this browser still believed yes: one sentence, no way to try again, and nothing of the refusal's body", async () => {
        const GONE = {
          en: "The assistant is not available on this site right now.",
          tr: "Asistan şu anda bu sitede kullanılamıyor.",
        };
        for (const [lang, status] of [
          ["en", 403],
          ["tr", 403],
          ["en", 404],
          // A page in a language the window has no words for: the English.
          ["de", 403],
        ] as const) {
          await page.open([320, 640]);
          const seen = await page.evaluate<{
            cards: number;
            text: string;
            retry: boolean;
            questions: string[];
            panel: string;
            asked: number;
            inside: boolean;
          }>(`(${async (yes: unknown, lang: string, status: number) => {
            const g = globalThis as any;
            const P = "sgiant-aiw";
            document.documentElement.lang = lang;
            let asked = 0;
            g.fetch = (input: any) => {
              const url = typeof input === "string" ? input : input.url;
              if (String(url).includes("/site-settings"))
                return Promise.resolve(new Response(JSON.stringify(yes), { status: 200 }));
              asked++;
              // Everything a body could carry to be mistaken for a sentence.
              return Promise.resolve(
                new Response(
                  JSON.stringify({
                    error: "unknown or inactive siteKey",
                    code: "site_unavailable",
                    message: "STRANGERS WORDS",
                    retry: true,
                  }),
                  { status, headers: { "content-type": "application/json" } }
                )
              );
            };
            const w = await g.SgiantAiWidget.createSiteChat({
              endpoint: "https://api.example/public/ai/chat",
              settingsUrl: "https://api.example/public/ai/site-settings",
              siteKey: "pk_site_1",
            });
            w.open();
            await new Promise((r) => setTimeout(r, 200));
            const ask = async (q: string) => {
              const input = document.querySelector(
                '[data-ai-target="widget-composer"]'
              ) as HTMLTextAreaElement;
              input.value = q;
              input.closest("form")!.requestSubmit();
              await new Promise((r) => setTimeout(r, 400));
            };
            await ask("Is breakfast included?");
            const panel = document.querySelector(`.${P}-panel`)!;
            const cards = [...panel.querySelectorAll(`.${P}-error`)];
            const card = cards[cards.length - 1];
            const box = panel.getBoundingClientRect();
            const r = card?.getBoundingClientRect();
            const out = {
              cards: cards.length,
              text: card?.querySelector(`.${P}-error-text`)?.textContent ?? "",
              retry: !!card?.querySelector(`.${P}-error-retry`),
              questions: [...panel.querySelectorAll(`.${P}-msg.${P}-user`)].map(
                (m) => m.textContent ?? ""
              ),
              panel: panel.textContent ?? "",
              asked,
              inside: !!r && r.left >= box.left - 0.5 && r.right <= box.right + 0.5,
            };
            w.destroy();
            return out;
          }})(${JSON.stringify(YES)}, ${JSON.stringify(lang)}, ${status})`);
          const why = `${lang}, ${status}`;
          assert.equal(seen.cards, 1, why);
          assert.equal(seen.text, lang === "tr" ? GONE.tr : GONE.en, why);
          assert.equal(seen.retry, false, `${why}: Try again is offered`);
          // The visitor's own question stays where they wrote it.
          assert.deepEqual(seen.questions, ["Is breakfast included?"], why);
          assert.equal(seen.inside, true, why);
          // Nothing the refusal carried, and none of the window's own
          // failure card.
          for (const leak of [
            "STRANGERS",
            "unknown or inactive",
            "siteKey",
            "site_unavailable",
            "Server error",
            "403",
            "404",
            "hit a snag",
          ])
            assert.ok(!seen.panel.includes(leak), `${why}: "${leak}" is on the screen`);
          assert.equal(seen.asked, 1, why);
        }
      });

      await t.test("a server that says the same thing inside the conversation: the same words, drawn the same way", async () => {
        // A newer server answers 200 and says it in the stream, in the
        // visitor's language. The frame is exact.
        for (const message of [
          "The assistant is not available on this site right now.",
          "Asistan şu anda bu sitede kullanılamıyor.",
        ]) {
          await page.open([320, 640]);
          const seen = await page.evaluate<{
            cards: number;
            text: string;
            retry: boolean;
            questions: string[];
            panel: string;
          }>(`(${async (yes: unknown, message: string) => {
            const g = globalThis as any;
            const P = "sgiant-aiw";
            g.fetch = (input: any) => {
              const url = typeof input === "string" ? input : input.url;
              return Promise.resolve(
                String(url).includes("/site-settings")
                  ? new Response(JSON.stringify(yes), { status: 200 })
                  : new Response(
                      JSON.stringify({
                        type: "error",
                        code: "site_unavailable",
                        retry: false,
                        message,
                      }) +
                        "\n" +
                        JSON.stringify({ type: "done" }) +
                        "\n",
                      { status: 200, headers: { "content-type": "application/x-ndjson" } }
                    )
              );
            };
            const w = await g.SgiantAiWidget.createSiteChat({
              endpoint: "https://api.example/public/ai/chat",
              settingsUrl: "https://api.example/public/ai/site-settings",
              siteKey: "pk_site_1",
            });
            w.open();
            await new Promise((r) => setTimeout(r, 200));
            const input = document.querySelector(
              '[data-ai-target="widget-composer"]'
            ) as HTMLTextAreaElement;
            input.value = "Is breakfast included?";
            input.closest("form")!.requestSubmit();
            await new Promise((r) => setTimeout(r, 400));
            const panel = document.querySelector(`.${P}-panel`)!;
            const cards = [...panel.querySelectorAll(`.${P}-error`)];
            const card = cards[cards.length - 1];
            const out = {
              cards: cards.length,
              text: card?.querySelector(`.${P}-error-text`)?.textContent ?? "",
              retry: !!card?.querySelector(`.${P}-error-retry`),
              questions: [...panel.querySelectorAll(`.${P}-msg.${P}-user`)].map(
                (m) => m.textContent ?? ""
              ),
              panel: panel.textContent ?? "",
            };
            w.destroy();
            return out;
          }})(${JSON.stringify(YES)}, ${JSON.stringify(message)})`);
          assert.equal(seen.cards, 1);
          assert.equal(seen.text, message);
          assert.equal(seen.retry, false);
          assert.deepEqual(seen.questions, ["Is breakfast included?"]);
          assert.equal(seen.panel.split(message).length - 1, 1, "said more than once");
          for (const leak of ["site_unavailable", "hit a snag", "(no response)"])
            assert.ok(!seen.panel.includes(leak), `"${leak}" is on the screen`);
        }
      });

      await t.test("a refusal that asking again can cure keeps the window's ordinary card, and still nothing of its body", async () => {
        for (const status of [429, 500, 503]) {
          await page.open([1280, 800]);
          const panel = await page.evaluate<string>(`(${async (yes: unknown, status: number) => {
            const g = globalThis as any;
            g.fetch = (input: any) => {
              const url = typeof input === "string" ? input : input.url;
              return Promise.resolve(
                String(url).includes("/site-settings")
                  ? new Response(JSON.stringify(yes), { status: 200 })
                  : new Response(
                      JSON.stringify({ error: "STRANGERS WORDS", code: "x", message: "STRANGERS WORDS" }),
                      { status }
                    )
              );
            };
            const w = await g.SgiantAiWidget.createSiteChat({
              endpoint: "https://api.example/public/ai/chat",
              settingsUrl: "https://api.example/public/ai/site-settings",
              siteKey: "pk_site_1",
            });
            w.open();
            await new Promise((r) => setTimeout(r, 200));
            const input = document.querySelector(
              '[data-ai-target="widget-composer"]'
            ) as HTMLTextAreaElement;
            input.value = "Is breakfast included?";
            input.closest("form")!.requestSubmit();
            await new Promise((r) => setTimeout(r, 400));
            const text = document.querySelector(".sgiant-aiw-panel")!.textContent ?? "";
            w.destroy();
            return text;
          }})(${JSON.stringify(YES)}, ${status})`);
          assert.match(panel, new RegExp(`Server error \\(${status}\\)`));
          assert.ok(!panel.includes("STRANGERS"), `${status}: the body is on the screen`);
          assert.ok(!panel.includes("not available on this site"));
        }
      });

      await t.test("the old way in is as it was: a 403 there is the ordinary card", async () => {
        await page.open([1280, 800]);
        const panel = await page.evaluate<string>(`(${async () => {
          const g = globalThis as any;
          g.fetch = () =>
            Promise.resolve(new Response('{"error":"unknown or inactive siteKey"}', { status: 403 }));
          const w = g.SgiantAiWidget.createAiChatWidget({
            endpoint: "https://api.example/public/ai/chat",
            extraBody: { siteKey: "pk_site_1" },
          });
          w.open();
          await new Promise((r) => setTimeout(r, 200));
          const input = document.querySelector(
            '[data-ai-target="widget-composer"]'
          ) as HTMLTextAreaElement;
          input.value = "Is breakfast included?";
          input.closest("form")!.requestSubmit();
          await new Promise((r) => setTimeout(r, 400));
          const text = document.querySelector(".sgiant-aiw-panel")!.textContent ?? "";
          w.destroy();
          return text;
        }})()`);
        assert.match(panel, /Server error \(403\)/);
        assert.ok(!panel.includes("not available on this site"));
        assert.ok(!panel.includes("unknown or inactive"));
      });

      await t.test("a page may ask for a shorter wait, never a longer one", async () => {
        // Asked to wait a minute: given up at four seconds all the same.
        const s = await run(page, "never", { timeoutMs: 60_000 });
        nothing(s, "no answer, a minute asked for");
        assert.ok(s.tookMs >= 3900 && s.tookMs < 5500, `gave up after ${s.tookMs} ms`);
      });

      await t.test("the call made twice on one page: one read, one window, the same one", async () => {
        for (const viewport of [[1280, 800], [320, 640]] as const) {
          await page.open(viewport);
          const seen = await page.evaluate<{
            same: boolean;
            reads: number;
            launchers: number;
            panels: number;
            styles: number;
            other: boolean;
            afterDestroy: { launchers: number; reads: number; fresh: boolean };
          }>(`(${async (yes: unknown) => {
            const g = globalThis as any;
            const P = "sgiant-aiw";
            let reads = 0;
            g.fetch = (input: any) => {
              const url = String(typeof input === "string" ? input : input.url);
              if (url.includes("/site-settings")) reads++;
              return Promise.resolve(new Response(JSON.stringify(yes), { status: 200 }));
            };
            const call = (siteKey: string) =>
              g.SgiantAiWidget.createSiteChat({
                endpoint: "https://api.example/public/ai/chat",
                settingsUrl: "https://api.example/public/ai/site-settings",
                siteKey,
              });
            // A plugin's call and a pasted one, at the same moment; and a
            // third later, once the first has long answered.
            const [a, b] = await Promise.all([call("pk_1"), call("pk_1")]);
            const c = await call("pk_1");
            const count = () => ({
              launchers: document.querySelectorAll(`.${P}-bubble`).length,
              panels: document.querySelectorAll(`.${P}-panel`).length,
              styles: [...document.querySelectorAll("style")].filter((s) =>
                (s.textContent ?? "").includes(P)
              ).length,
            });
            const one = count();
            const readsOne = reads;
            // Another site's key on the same page is another window.
            const d = await call("pk_2");
            const other = d !== a && count().launchers === 2;
            d.destroy();
            // After the first is destroyed, a call draws a new one.
            a.destroy();
            const again = await call("pk_1");
            const afterDestroy = {
              launchers: count().launchers,
              reads,
              fresh: again !== a,
            };
            again.destroy();
            return { same: a === b && b === c, reads: readsOne, ...one, other, afterDestroy };
          }})(${JSON.stringify(YES)})`);
          assert.equal(seen.same, true, "the calls were given different windows");
          assert.equal(seen.reads, 1, `the settings were read ${seen.reads} times`);
          assert.equal(seen.launchers, 1);
          assert.equal(seen.panels, 1);
          assert.equal(seen.styles, 1);
          assert.equal(seen.other, true);
          assert.deepEqual(seen.afterDestroy, { launchers: 1, reads: 3, fresh: true });
        }
      });

      await t.test("a key with spaces around it is the same site: one window, and the key is sent and kept without them", async () => {
        await page.open([1280, 800]);
        const seen = await page.evaluate<{
          same: boolean;
          launchers: number;
          reads: string[];
          sentKey: unknown;
          tab: string[];
          capitals: boolean;
        }>(`(${async (yes: unknown) => {
          const g = globalThis as any;
          const P = "sgiant-aiw";
          const reads: string[] = [];
          let sentKey: unknown = null;
          g.fetch = (input: any, init?: any) => {
            const url = String(typeof input === "string" ? input : input.url);
            if (url.includes("/site-settings")) {
              reads.push(url.split("?")[1] ?? "");
              return Promise.resolve(new Response(JSON.stringify(yes), { status: 200 }));
            }
            sentKey = JSON.parse(init?.body ?? "{}").siteKey;
            return Promise.resolve(
              new Response(
                JSON.stringify({ type: "text", d: "ok" }) + "\n" + JSON.stringify({ type: "done" }) + "\n",
                { status: 200 }
              )
            );
          };
          const call = (siteKey: string) =>
            g.SgiantAiWidget.createSiteChat({
              endpoint: "https://api.example/public/ai/chat",
              settingsUrl: "https://api.example/public/ai/site-settings",
              siteKey,
            });
          const [a, b, c] = await Promise.all([call(" pk_1 "), call("pk_1"), call("pk_1\n")]);
          const launchers = document.querySelectorAll(`.${P}-bubble`).length;
          const readsOne = [...reads];
          a.open();
          await new Promise((r) => setTimeout(r, 200));
          const input = document.querySelector(
            '[data-ai-target="widget-composer"]'
          ) as HTMLTextAreaElement;
          input.value = "hello";
          input.closest("form")!.requestSubmit();
          await new Promise((r) => setTimeout(r, 400));
          const tab = Object.keys(sessionStorage).sort();
          // Capitals are another key to a server, and another window here.
          const other = await call("PK_1");
          const capitals = other !== a;
          other.destroy();
          a.destroy();
          return { same: a === b && b === c, launchers, reads: readsOne, sentKey, tab, capitals };
        }})(${JSON.stringify(YES)})`);
        assert.equal(seen.same, true);
        assert.equal(seen.launchers, 1);
        assert.deepEqual(seen.reads, ["siteKey=pk_1"]);
        assert.equal(seen.sentKey, "pk_1");
        assert.ok(seen.tab.length > 0);
        for (const name of seen.tab)
          assert.ok(name.endsWith(":site:pk_1"), `kept under another name: "${name}"`);
        assert.equal(seen.capitals, true);
      });

      await t.test("a key that is only spaces is no key: nothing is asked and nothing is drawn", async () => {
        await page.open([1280, 800]);
        const seen = await page.evaluate<{ reads: number; got: boolean; drawn: number }>(`(${async () => {
          const g = globalThis as any;
          let reads = 0;
          g.fetch = () => {
            reads++;
            return Promise.resolve(new Response('{"answersVisitors":true}', { status: 200 }));
          };
          const w = await g.SgiantAiWidget.createSiteChat({
            endpoint: "https://api.example/public/ai/chat",
            settingsUrl: "https://api.example/public/ai/site-settings",
            siteKey: "   ",
          });
          return {
            reads,
            got: !!w,
            drawn: document.querySelectorAll('[class*="sgiant-aiw"]').length,
          };
        }})()`);
        assert.deepEqual(seen, { reads: 0, got: false, drawn: 0 });
      });

      await t.test("a no is one answer for the page too: asked once however often it is called", async () => {
        await page.open([1280, 800]);
        const seen = await page.evaluate<{ reads: number; all: boolean; drawn: number }>(`(${async () => {
          const g = globalThis as any;
          let reads = 0;
          g.fetch = () => {
            reads++;
            return Promise.resolve(new Response('{"answersVisitors":false}', { status: 200 }));
          };
          const call = () =>
            g.SgiantAiWidget.createSiteChat({
              endpoint: "https://api.example/public/ai/chat",
              settingsUrl: "https://api.example/public/ai/site-settings",
              siteKey: "pk_no",
            });
          const got = [await call(), await call(), await call()];
          return {
            reads,
            all: got.every((w) => w === null),
            drawn: document.querySelectorAll('[class*="sgiant-aiw"]').length,
          };
        }})()`);
        assert.deepEqual(seen, { reads: 1, all: true, drawn: 0 });
      });

      await t.test("a name that does not fit is one line that ends in …, inside the header", async () => {
        for (const name of [
          "Kaşmarinabutikotelveresidenceskışveyazkampanyalarıresepsiyonu",
          "Kaş Marina Butik Otel ve Residences Kış ve Yaz Kampanyaları Resepsiyonu",
        ]) {
          await page.open([320, 640]);
          const seen = await page.evaluate<{
            lines: number;
            cut: boolean;
            ellipsis: string;
            inside: boolean;
            text: string;
            tooltip: string | null;
          }>(`(${async (yes: unknown, name: string) => {
            const g = globalThis as any;
            const P = "sgiant-aiw";
            g.fetch = () =>
              Promise.resolve(
                new Response(JSON.stringify({ ...(yes as object), name }), { status: 200 })
              );
            const w = await g.SgiantAiWidget.createSiteChat({
              endpoint: "https://api.example/public/ai/chat",
              settingsUrl: "https://api.example/public/ai/site-settings",
              siteKey: "pk_long",
            });
            w.open();
            await new Promise((r) => setTimeout(r, 250));
            const title = document.querySelector(`.${P}-title`) as HTMLElement;
            const header = document.querySelector(`.${P}-header`)!.getBoundingClientRect();
            const box = title.getBoundingClientRect();
            const cs = getComputedStyle(title);
            title.dispatchEvent(new MouseEvent("mouseenter"));
            const out = {
              tooltip: title.getAttribute("title"),
              lines: Math.round(box.height / parseFloat(cs.lineHeight) || 1),
              cut: title.scrollWidth > title.clientWidth,
              ellipsis: cs.textOverflow,
              inside: box.left >= header.left - 0.5 && box.right <= header.right + 0.5,
              text: title.textContent ?? "",
            };
            w.destroy();
            return out;
          }})(${JSON.stringify(YES)}, ${JSON.stringify(name)})`);
          // The whole name is still the title's text, for a screen reader.
          assert.equal(seen.text, name);
          // And for a mouse: the whole name is the tooltip while it is cut.
          assert.equal(seen.tooltip, name);
          assert.equal(seen.cut, true, "the name fits, so this proves nothing");
          assert.equal(seen.ellipsis, "ellipsis");
          assert.equal(seen.lines, 1);
          assert.equal(seen.inside, true);
        }
      });

      await t.test("yes with nothing set: the window's own defaults", async () => {
        const s = await run(page, { answersVisitors: true });
        assert.equal(s.handle, true);
        assert.deepEqual(s.chips, []);
        assert.equal(s.title, "Assistant");
        assert.equal(s.accent, "#6d28d9");
      });

      await t.test("a site that gave its assistant no name: a plain word for it in all six places, and this package's own name in none", async () => {
        // The six places the window says the assistant's name, as a guest
        // meets them: the title, the launcher, the window's name and the
        // box's name for a screen reader, the box's hint, and a failure.
        const SIX = {
          en: [
            "Assistant",
            "Open Assistant",
            "Assistant chat",
            "Message Assistant",
            "Ask Assistant anything…",
            "Assistant hit a snag and couldn't answer. Please try again.",
          ],
          tr: [
            "Asistan",
            "Asistan aç",
            "Asistan sohbeti",
            "Asistan için mesaj yazın",
            "Asistan her sorunuzu yanıtlar…",
            "Asistan bir sorunla karşılaştı ve yanıt veremedi. Lütfen tekrar deneyin.",
          ],
        };
        for (const [lang, words] of [
          ["en", SIX.en],
          ["tr", SIX.tr],
          // A page in a language the window has no words for: the English.
          ["de", SIX.en],
        ] as const) {
          await page.open([320, 640]);
          const said = await page.evaluate<string[]>(`(${async (lang: string) => {
            const g = globalThis as any;
            document.documentElement.lang = lang;
            g.fetch = (input: any) =>
              Promise.resolve(
                String(typeof input === "string" ? input : input.url).includes("/site-settings")
                  ? new Response('{"answersVisitors":true}', { status: 200 })
                  : new Response(
                      JSON.stringify({ type: "error", message: "boom" }) +
                        "\n" +
                        JSON.stringify({ type: "done" }) +
                        "\n",
                      { status: 200 }
                    )
              );
            const w = await g.SgiantAiWidget.createSiteChat({
              endpoint: "https://api.example/public/ai/chat",
              settingsUrl: "https://api.example/public/ai/site-settings",
              siteKey: "pk_unnamed",
            });
            // Everything a guest can read or be read, at every moment.
            const said = new Set<string>();
            const listen = () => {
              for (const el of document.querySelectorAll("*")) {
                if (["STYLE", "SCRIPT"].includes(el.tagName)) continue;
                for (const a of ["aria-label", "title", "placeholder", "alt"]) {
                  const v = el.getAttribute(a);
                  if (v) said.add(v.trim());
                }
                if (el.children.length === 0 && el.textContent?.trim())
                  said.add(el.textContent.trim());
              }
            };
            await new Promise((r) => setTimeout(r, 200));
            listen();
            w.open();
            await new Promise((r) => setTimeout(r, 300));
            listen();
            const input = document.querySelector(
              '[data-ai-target="widget-composer"]'
            ) as HTMLTextAreaElement;
            input.value = "hello";
            input.closest("form")!.requestSubmit();
            await new Promise((r) => setTimeout(r, 400));
            listen();
            w.destroy();
            return [...said];
          }})(${JSON.stringify(lang)})`);
          for (const sentence of words)
            assert.ok(said.includes(sentence), `${lang}: nowhere says "${sentence}"`);
          // And a seventh place cannot appear with this package's name in it.
          const named = said.filter((s) => /ayca/i.test(s));
          assert.deepEqual(named, [], `${lang}: a guest reads the package's own name`);
        }
      });

      await t.test("a name that fits has no tooltip: it is all there to read", async () => {
        await page.open([1280, 800]);
        const tooltip = await page.evaluate<string | null>(`(${async () => {
          const g = globalThis as any;
          g.fetch = () =>
            Promise.resolve(
              new Response('{"answersVisitors":true,"name":"Reception"}', { status: 200 })
            );
          const w = await g.SgiantAiWidget.createSiteChat({
            endpoint: "https://api.example/public/ai/chat",
            settingsUrl: "https://api.example/public/ai/site-settings",
            siteKey: "pk_short",
          });
          w.open();
          await new Promise((r) => setTimeout(r, 200));
          const title = document.querySelector(".sgiant-aiw-title") as HTMLElement;
          title.dispatchEvent(new MouseEvent("mouseenter"));
          const got = title.getAttribute("title");
          w.destroy();
          return got;
        }})()`);
        assert.equal(tooltip, null);
      });

      await t.test("a site that gave a name gets that name in the same places, and the other way in keeps its own", async () => {
        await page.open([1280, 800]);
        const seen = await page.evaluate<{ site: string[]; app: string[] }>(`(${async () => {
          const g = globalThis as any;
          const P = "sgiant-aiw";
          g.fetch = () =>
            Promise.resolve(
              new Response('{"answersVisitors":true,"name":"Reception"}', { status: 200 })
            );
          const read = () => [
            document.querySelector(`.${P}-title`)?.textContent ?? "",
            document.querySelector(`.${P}-bubble`)?.getAttribute("aria-label") ?? "",
            (
              document.querySelector('[data-ai-target="widget-composer"]') as HTMLTextAreaElement
            ).placeholder,
          ];
          const w = await g.SgiantAiWidget.createSiteChat({
            endpoint: "https://api.example/public/ai/chat",
            settingsUrl: "https://api.example/public/ai/site-settings",
            siteKey: "pk_named",
          });
          const site = read();
          w.destroy();
          const a = g.SgiantAiWidget.createAiChatWidget({ endpoint: "https://api.example/chat" });
          const app = read();
          a.destroy();
          return { site, app };
        }})()`);
        assert.deepEqual(seen.site, ["Reception", "Open Reception", "Ask Reception anything…"]);
        // A host that calls the window the old way and names nothing is not
        // a customer's site, and is as it was.
        assert.deepEqual(seen.app, ["AYCA", "Open AYCA", "Ask AYCA anything…"]);
      });

      await t.test("the window's own words: the site's language, else the call's, else the page's, else English", async () => {
        const TR = /sorunuzu/;
        const placeholder = async (
          language: unknown,
          opts: { locale?: string; lang?: string }
        ) => (await run(page, { ...YES, language }, opts)).placeholder;
        const english = await placeholder(null, {});
        const turkish = await placeholder("tr", {});
        assert.notEqual(turkish, english);
        assert.match(turkish, TR);
        // The site's setting wins over the call and the page.
        assert.equal(await placeholder("tr", { locale: "en", lang: "en" }), turkish);
        assert.equal(await placeholder("en", { locale: "tr", lang: "tr" }), english);
        // No setting: the call, then the page.
        assert.equal(await placeholder(null, { locale: "tr", lang: "en" }), turkish);
        assert.equal(await placeholder(null, { lang: "tr-TR" }), turkish);
        // A page in a language the window has no words for: English.
        for (const lang of ["de", "ru", "fr", "zh-CN"])
          assert.equal(await placeholder(null, { locale: lang, lang }), english);
      });
    });
  }
);
