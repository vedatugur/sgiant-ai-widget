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

      await t.test("what a visit leaves in the browser: not the conversation, and a later no touches none of it", async () => {
        await page.open([1280, 800]);
        const seen = await page.evaluate<{
          keys: string[];
          holdsTheQuestion: boolean;
          afterNo: { handle: boolean; drawn: number; changed: boolean };
          again: string[];
        }>(`(${async (yes: unknown) => {
          const g = globalThis as any;
          const P = "sgiant-aiw";
          let answer: unknown = yes;
          g.fetch = (input: any) => {
            const url = typeof input === "string" ? input : input.url;
            return Promise.resolve(
              String(url).includes("/site-settings")
                ? new Response(JSON.stringify(answer), { status: 200 })
                : new Response(
                    JSON.stringify({ type: "text", d: "09:00-18:00" }) +
                      "\n" +
                      JSON.stringify({ type: "done" }) +
                      "\n",
                    { status: 200 }
                  )
            );
          };
          const make = () =>
            g.SgiantAiWidget.createSiteChat({
              endpoint: "https://api.example/public/ai/chat",
              settingsUrl: "https://api.example/public/ai/site-settings",
              siteKey: "pk_site_1",
            });
          const kept = () =>
            JSON.stringify(
              [localStorage, sessionStorage].map((store) =>
                Object.keys(store)
                  .sort()
                  .map((k) => [k, store.getItem(k)])
              )
            );
          // A visit while the assistant is on: one question, one answer.
          const first = await make();
          first.open();
          await new Promise((r) => setTimeout(r, 200));
          const input = document.querySelector(
            '[data-ai-target="widget-composer"]'
          ) as HTMLTextAreaElement;
          input.value = "Opening hours of the spa?";
          input.closest("form")!.requestSubmit();
          await new Promise((r) => setTimeout(r, 400));
          first.destroy();
          const before = kept();
          // The next page view: turned off.
          answer = { ...(yes as object), answersVisitors: false };
          const second = await make();
          const afterNo = {
            handle: !!second,
            drawn: document.querySelectorAll(`[class*="${P}"]`).length,
            changed: kept() !== before,
          };
          // And the one after: on again.
          answer = yes;
          const third = await make();
          third.open();
          await new Promise((r) => setTimeout(r, 300));
          const again = [
            ...document.querySelectorAll(`.${P}-panel .${P}-msg.${P}-user`),
          ].map((m) => m.textContent ?? "");
          third.destroy();
          return {
            keys: [...Object.keys(localStorage), ...Object.keys(sessionStorage)].sort(),
            holdsTheQuestion: before.includes("spa") || before.includes("09:00"),
            afterNo,
            again,
          };
        }})(${JSON.stringify(YES)})`);
        // A visitor's words are not kept on their device: the site entry
        // asks for no conversation memory. What IS kept says only how the
        // window was left (opened before, where, sound).
        assert.equal(seen.holdsTheQuestion, false, `kept: ${seen.keys.join(", ")}`);
        assert.deepEqual(seen.again, []);
        assert.deepEqual(seen.afterNo, { handle: false, drawn: 0, changed: false });
        for (const key of seen.keys)
          assert.match(key, /^(aiw|sgiant-aiw)[:-]/, `a key that is not the window's: ${key}`);
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

      await t.test("yes with nothing set: the window's own defaults", async () => {
        const s = await run(page, { answersVisitors: true });
        assert.equal(s.handle, true);
        assert.deepEqual(s.chips, []);
        assert.notEqual(s.title, "");
        assert.equal(s.accent, "#6d28d9");
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
