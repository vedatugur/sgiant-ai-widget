import test from "node:test";
import assert from "node:assert/strict";
import { SKIP_WITHOUT_CHROME, withBrowser, type Page } from "./aiw-browser.ts";

/**
 * A VISITOR'S CONVERSATION FOLLOWS THEM THROUGH THE SITE, IN THE TAB ONLY.
 *
 * A site chat used to start again on every page: a guest who asked about
 * breakfast on one page had a stranger on the next. Now the conversation is
 * kept, and where it is kept is the whole point: in the TAB's storage, which
 * is gone when the tab closes. Nothing a visitor wrote goes into the storage
 * a browser keeps, on what may be a shared computer.
 *
 * Held here:
 *  - EVERY name the window writes in a visitor's browser over a full visit,
 *    as two exact lists. A new one fails this test, by name;
 *  - the conversation is there on the next page, and goes on as the same one;
 *  - "Clear this conversation" removes it;
 *  - it goes when the server says no, when the site's key changed, when what
 *    is kept is not what this window writes, and when it is too old;
 *  - it stays when nobody answered (one bad connection erases nothing);
 *  - there is a limit to how much is kept;
 *  - a browser that refuses storage keeps nothing and the chat still works.
 */

/** What a server answers, and a page to visit it from. Runs in the page. */
const SETUP = (): void => {
  const g = globalThis as any;
  const S = (g.S = {
    settings: { answersVisitors: true, name: "Reception", greeting: "Welcome." } as unknown,
    settingsFail: "" as "" | "network" | "500" | "404",
    sent: [] as Array<{ threadId: unknown; content: string; siteKey: unknown }>,
    thread: "thr_1",
  });
  g.fetch = (input: any, init?: any) => {
    const url = String(typeof input === "string" ? input : input.url);
    if (url.includes("/site-settings")) {
      if (S.settingsFail === "network") return Promise.reject(new TypeError("Failed to fetch"));
      if (S.settingsFail) return Promise.resolve(new Response("{}", { status: Number(S.settingsFail) }));
      return Promise.resolve(new Response(JSON.stringify(S.settings), { status: 200 }));
    }
    const body = JSON.parse(init?.body ?? "{}");
    S.sent.push({ threadId: body.threadId ?? null, content: body.content, siteKey: body.siteKey });
    return Promise.resolve(
      new Response(
        [
          { type: "thread", threadId: S.thread },
          { type: "text", d: `Answer to: ${body.content}` },
          { type: "done" },
        ]
          .map((f) => JSON.stringify(f) + "\n")
          .join(""),
        { status: 200, headers: { "content-type": "application/x-ndjson" } }
      )
    );
  };
  const P = "sgiant-aiw";
  g.visit = async (siteKey = "pk_1") => {
    const w = await g.SgiantAiWidget.createSiteChat({
      endpoint: "https://api.example/public/ai/chat",
      settingsUrl: "https://api.example/public/ai/site-settings",
      siteKey,
    });
    g.W = w;
    if (w) {
      w.open();
      await new Promise((r) => setTimeout(r, 250));
    }
    return !!w;
  };
  g.leave = () => {
    g.W?.destroy();
    g.W = null;
  };
  g.field = () =>
    document.querySelector('[data-ai-target="widget-composer"]') as HTMLTextAreaElement;
  g.ask = async (q: string) => {
    g.field().value = q;
    g.field().closest("form")!.requestSubmit();
    await new Promise((r) => setTimeout(r, 450));
  };
  g.type = (text: string) => {
    g.field().value = text;
    g.field().dispatchEvent(new Event("input", { bubbles: true }));
  };
  g.shown = () => ({
    questions: [...document.querySelectorAll(`.${P}-panel .${P}-msg.${P}-user`)].map(
      (m) => m.textContent ?? ""
    ),
    answers: [...document.querySelectorAll(`.${P}-panel .${P}-msg.${P}-assistant`)].map(
      (m) => m.textContent ?? ""
    ),
    drawn: document.querySelectorAll(`[class*="${P}"]`).length,
    box: g.field()?.value ?? null,
  });
  g.kept = () => ({
    forGood: Object.keys(localStorage).sort(),
    inTheTab: Object.keys(sessionStorage).sort(),
    all: JSON.stringify([
      Object.entries(localStorage),
      Object.entries(sessionStorage),
    ]),
    forGoodText: JSON.stringify(Object.entries(localStorage)),
  });
};

const fresh = async (page: Page, viewport: readonly [number, number] = [1280, 800]) => {
  await page.open(viewport);
  await page.evaluate(`(${SETUP})()`);
};

test(
  "in a browser: a visitor's conversation, kept in the tab",
  { skip: SKIP_WITHOUT_CHROME },
  async (t) => {
    await withBrowser(async (page) => {
      await t.test("EVERYTHING the window writes in a visitor's browser over a full visit, by name", async () => {
        await fresh(page);
        const seen = await page.evaluate<{
          forGood: string[];
          inTheTab: string[];
          forGoodText: string;
          cookie: string;
        }>(`(async () => {
          await visit();
          await ask("Is breakfast included?");
          type("an unsent thought about the spa");
          // The sound switch, pressed: the one other thing a visitor can set.
          const P = "sgiant-aiw";
          const chime = [...document.querySelectorAll("." + P + "-panel button")].find((b) =>
            /chime|sound|ses/i.test((b.getAttribute("aria-label") || b.title || b.textContent || ""))
          );
          chime && chime.click();
          // The window, dragged by its header.
          const h = document.querySelector("." + P + "-header");
          const r = h.getBoundingClientRect();
          const at = (type, x, y) =>
            new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, pointerId: 1, button: 0, isPrimary: true });
          // On the header's own text, not on one of its buttons. A made-up
          // pointer cannot be captured, which the window survives.
          const grip = h.querySelector("." + P + "-title") || h;
          try { grip.dispatchEvent(at("pointerdown", r.left + 60, r.top + 12)); } catch {}
          h.dispatchEvent(at("pointermove", r.left - 80, r.top - 120));
          h.dispatchEvent(at("pointerup", r.left - 80, r.top - 120));
          await new Promise((r) => setTimeout(r, 200));
          const k = kept();
          leave();
          return { forGood: k.forGood, inTheTab: k.inTheTab, forGoodText: k.forGoodText, cookie: document.cookie };
        })()`);
        // FOR AS LONG AS THE BROWSER KEEPS IT: that the window was opened
        // before, and the sound setting once a visitor changes it. Nothing
        // else, ever.
        const FOR_GOOD = ["aiw:opened", "aiw:sound"];
        // ONLY WHILE THE TAB IS OPEN: the conversation with its id, the text
        // typed and not sent, whether the window was left open, and where it
        // was placed.
        const IN_THE_TAB = [
          "aiw:draft:site:pk_1",
          "aiw:open:site:pk_1",
          "aiw:pos:site:pk_1",
          "aiw:v1:site:pk_1",
        ];
        for (const name of seen.forGood)
          assert.ok(FOR_GOOD.includes(name), `kept for good, and not on the list: ${name}`);
        for (const name of seen.inTheTab)
          assert.ok(IN_THE_TAB.includes(name), `kept in the tab, and not on the list: ${name}`);
        // The visit above really did each thing: so the lists are what a
        // full visit leaves, not what a short one happens to.
        assert.deepEqual(seen.forGood, FOR_GOOD, "the sound switch was not pressed");
        assert.deepEqual(seen.inTheTab, IN_THE_TAB, "the window was not dragged");
        for (const must of ["aiw:v1:site:pk_1", "aiw:draft:site:pk_1", "aiw:open:site:pk_1"])
          assert.ok(seen.inTheTab.includes(must), `not kept in the tab: ${must}`);
        // Not one word of the visitor's in the storage a browser keeps.
        for (const word of ["breakfast", "spa", "thr_1", "Answer to"])
          assert.ok(!seen.forGoodText.includes(word), `"${word}" is kept for good`);
        assert.equal(seen.cookie, "");
      });

      await t.test("on the next page the conversation is there, and goes on as the same one", async () => {
        for (const viewport of [[1280, 800], [320, 640]] as const) {
          await fresh(page, viewport);
          const seen = await page.evaluate<{
            next: { questions: string[]; answers: string[]; box: string | null };
            sent: Array<{ threadId: unknown; content: string }>;
          }>(`(async () => {
            await visit();
            await ask("Is breakfast included?");
            type("and the spa");
            leave();
            // The next page of the site.
            await visit();
            const next = shown();
            await ask("And parking?");
            leave();
            return { next, sent: S.sent };
          })()`);
          assert.deepEqual(seen.next.questions, ["Is breakfast included?"]);
          assert.ok(seen.next.answers.some((a) => a.includes("Answer to: Is breakfast included?")));
          // What was typed and not sent is in the box again.
          assert.equal(seen.next.box, "and the spa");
          // The same conversation to the server: its id goes with the next question.
          assert.deepEqual(
            seen.sent.map((s) => s.threadId),
            [null, "thr_1"]
          );
        }
      });

      await t.test('"Clear this conversation" removes it, in both languages', async () => {
        for (const [lang, name] of [
          ["en", "Clear this conversation"],
          ["tr", "Bu sohbeti temizle"],
          // A page in a language the window has no words for: the English.
          ["de", "Clear this conversation"],
        ] as const) {
          await fresh(page, [320, 640]);
          const seen = await page.evaluate<{
            found: boolean;
            title: string;
            after: { questions: string[]; answers: string[]; box: string | null };
            tab: string[];
            all: string;
            next: { questions: string[] };
            nextThread: unknown;
          }>(`(async (name, lang) => {
            document.documentElement.lang = lang;
            await visit();
            await ask("Is breakfast included?");
            type("and the spa");
            const btn = [...document.querySelectorAll(".sgiant-aiw-panel button")].find(
              (b) => b.getAttribute("aria-label") === name
            );
            const title = btn ? btn.title : "";
            btn && btn.click();
            await new Promise((r) => setTimeout(r, 200));
            const after = shown();
            const k = kept();
            leave();
            await visit();
            const next = shown();
            await ask("Hello again");
            leave();
            return { found: !!btn, title, after, tab: k.inTheTab, all: k.all, next, nextThread: S.sent[S.sent.length - 1].threadId };
          })(${JSON.stringify(name)}, ${JSON.stringify(lang)})`);
          assert.equal(seen.found, true, `${lang}: no button named "${name}"`);
          assert.equal(seen.title, name);
          // The window is as it was at the start: the greeting, an empty box.
          assert.deepEqual(seen.after.questions, []);
          assert.ok(seen.after.answers.some((a) => a.includes("Welcome.")));
          assert.equal(seen.after.box, "");
          // Nothing of the conversation, its id or the unsent text is left.
          for (const word of ["breakfast", "spa", "thr_1", "Answer to"])
            assert.ok(!seen.all.includes(word), `${lang}: "${word}" is still in the browser`);
          assert.ok(!seen.tab.includes("aiw:v1:site:pk_1"));
          assert.ok(!seen.tab.includes("aiw:draft:site:pk_1"));
          // And the next page starts a new one, not the old one again.
          assert.deepEqual(seen.next.questions, []);
          assert.equal(seen.nextThread, null);
        }
      });

      await t.test("the server says no: nothing is drawn and what was kept is gone", async () => {
        for (const how of ["false", "404"] as const) {
          await fresh(page);
          const seen = await page.evaluate<{ drew: boolean; drawn: number; tab: string[]; back: string[] }>(
            `(async (how) => {
              await visit();
              await ask("Is breakfast included?");
              leave();
              if (how === "false") S.settings = { answersVisitors: false };
              else S.settingsFail = "404";
              const drew = await visit();
              const out = { drew, drawn: shown().drawn, tab: kept().inTheTab };
              // Turned on again later: a new conversation, not the old one.
              S.settings = { answersVisitors: true };
              S.settingsFail = "";
              await visit();
              const back = shown().questions;
              leave();
              return { ...out, back };
            })(${JSON.stringify(how)})`
          );
          assert.equal(seen.drew, false, how);
          assert.equal(seen.drawn, 0, how);
          assert.deepEqual(seen.tab, [], `${how}: still kept`);
          assert.deepEqual(seen.back, [], how);
        }
      });

      await t.test("nobody answered: nothing is drawn, and what was kept is there on the next page", async () => {
        for (const how of ["network", "500"] as const) {
          await fresh(page);
          const seen = await page.evaluate<{ drew: boolean; drawn: number; same: boolean; back: string[] }>(
            `(async (how) => {
              await visit();
              await ask("Is breakfast included?");
              leave();
              const before = kept().all;
              S.settingsFail = how;
              const drew = await visit();
              const out = { drew, drawn: shown().drawn, same: kept().all === before };
              S.settingsFail = "";
              await visit();
              const back = shown().questions;
              leave();
              return { ...out, back };
            })(${JSON.stringify(how)})`
          );
          assert.equal(seen.drew, false, how);
          assert.equal(seen.drawn, 0, how);
          assert.equal(seen.same, true, `${how}: one bad connection changed what was kept`);
          assert.deepEqual(seen.back, ["Is breakfast included?"], how);
        }
      });

      await t.test("the site's key changed: the old conversation is neither shown nor left behind", async () => {
        await fresh(page);
        const seen = await page.evaluate<{ questions: string[]; tab: string[]; all: string; sentKey: unknown; sentThread: unknown }>(
          `(async () => {
            await visit("pk_1");
            await ask("Is breakfast included?");
            leave();
            await visit("pk_2");
            const questions = shown().questions;
            await ask("Hello");
            const k = kept();
            leave();
            const last = S.sent[S.sent.length - 1];
            return { questions, tab: k.inTheTab, all: k.all, sentKey: last.siteKey, sentThread: last.threadId };
          })()`
        );
        assert.deepEqual(seen.questions, []);
        assert.ok(seen.tab.every((n) => !n.endsWith(":site:pk_1")), seen.tab.join(", "));
        assert.ok(!seen.all.includes("breakfast"));
        assert.equal(seen.sentKey, "pk_2");
        // The old conversation's id is not sent under the new key.
        assert.equal(seen.sentThread, null);
      });

      await t.test("what is kept but is not what this window writes is removed, never drawn", async () => {
        const now = Date.now();
        const cases: Array<[string, string]> = [
          ["not JSON", "<html>"],
          ["a list", JSON.stringify([{ role: "user", content: "x" }])],
          ["no time on it", JSON.stringify({ messages: [{ role: "user", content: "SHOULD NOT SHOW" }] })],
          [
            "a message that is not a text",
            JSON.stringify({ savedAt: now, messages: [{ role: "user", content: { html: "SHOULD NOT SHOW" } }] }),
          ],
          [
            "a role this window does not write",
            JSON.stringify({ savedAt: now, messages: [{ role: "system", content: "SHOULD NOT SHOW" }] }),
          ],
          [
            "an id that is not a text",
            JSON.stringify({ savedAt: now, threadId: 7, messages: [{ role: "user", content: "SHOULD NOT SHOW" }] }),
          ],
          [
            "older than twelve hours",
            JSON.stringify({
              savedAt: now - 13 * 60 * 60 * 1000,
              threadId: "thr_old",
              messages: [{ role: "user", content: "SHOULD NOT SHOW" }],
            }),
          ],
        ];
        for (const [why, stored] of cases) {
          await fresh(page);
          const seen = await page.evaluate<{ panel: string; left: string | null; thread: unknown }>(
            `(async (stored) => {
              sessionStorage.setItem("aiw:v1:site:pk_1", stored);
              await visit();
              const panel = document.querySelector(".sgiant-aiw-panel").textContent;
              const left = sessionStorage.getItem("aiw:v1:site:pk_1");
              await ask("Hello");
              leave();
              return { panel, left, thread: S.sent[0].threadId };
            })(${JSON.stringify(stored)})`
          );
          assert.ok(!seen.panel.includes("SHOULD NOT SHOW"), `${why}: it was drawn`);
          assert.equal(seen.left, null, `${why}: it was left in the tab`);
          assert.equal(seen.thread, null, `${why}: its id was sent`);
        }
      });

      await t.test("there is a limit to how much is kept: the oldest go first", async () => {
        await fresh(page);
        const seen = await page.evaluate<{ size: number; kept: number; last: string; first: string }>(
          `(async () => {
            await visit();
            const long = "x".repeat(60000);
            for (const n of [1, 2, 3, 4, 5]) await ask("Q" + n + " " + long);
            const raw = sessionStorage.getItem("aiw:v1:site:pk_1");
            const messages = JSON.parse(raw).messages;
            leave();
            return {
              size: JSON.stringify(messages).length,
              kept: messages.length,
              last: messages[messages.length - 1].content.slice(0, 16),
              first: messages[0].content.slice(0, 16),
            };
          })()`
        );
        assert.ok(seen.size <= 200000, `${seen.size} characters kept`);
        assert.ok(seen.kept >= 2 && seen.kept < 10, `${seen.kept} messages kept`);
        // The newest is there; the first question is not.
        assert.match(seen.last, /^Answer to: Q5/);
        assert.doesNotMatch(seen.first, /Q1 /);
      });

      await t.test("a browser that refuses storage: nothing is kept, nothing is said, and the chat works", async () => {
        await fresh(page);
        const seen = await page.evaluate<{ drew: boolean; answers: string[]; next: string[]; errors: number; panel: string }>(
          `(async () => {
            let errors = 0;
            addEventListener("error", () => errors++);
            addEventListener("unhandledrejection", () => errors++);
            const refuse = () => { throw new DOMException("refused", "SecurityError"); };
            for (const store of [Storage.prototype]) {
              store.getItem = refuse; store.setItem = refuse; store.removeItem = refuse;
            }
            Object.defineProperty(window, "sessionStorage", { get: refuse });
            const drew = await visit();
            await ask("Is breakfast included?");
            const answers = shown().answers;
            const panel = document.querySelector(".sgiant-aiw-panel").textContent;
            leave();
            await visit();
            const next = shown().questions;
            leave();
            return { drew, answers, next, errors, panel };
          })()`
        );
        assert.equal(seen.drew, true);
        assert.ok(seen.answers.some((a) => a.includes("Answer to: Is breakfast included?")));
        // One page at a time, as before there was anything to keep.
        assert.deepEqual(seen.next, []);
        assert.equal(seen.errors, 0);
        assert.doesNotMatch(seen.panel, /storage|refused|SecurityError/i);
      });

      await t.test("the other way in is as it was: a host's key still goes to the browser's long-lived storage", async () => {
        await fresh(page);
        const seen = await page.evaluate<{ forGood: string[]; inTheTab: string[]; name: string | null }>(
          `(async () => {
            const w = SgiantAiWidget.createAiChatWidget({ endpoint: "https://api.example/chat", persistKey: "acc-1" });
            w.open();
            await new Promise((r) => setTimeout(r, 200));
            await ask("Hello");
            const k = kept();
            const btn = document.querySelector('[data-ai-target="widget-new-chat"]') ||
              [...document.querySelectorAll(".sgiant-aiw-panel button")].find((b) => b.getAttribute("aria-label") === "New chat");
            w.destroy();
            return { forGood: k.forGood, inTheTab: k.inTheTab, name: btn ? btn.getAttribute("aria-label") : null };
          })()`
        );
        assert.ok(seen.forGood.includes("aiw:v1:acc-1"));
        assert.deepEqual(seen.inTheTab, []);
        assert.equal(seen.name, "New chat");
      });
    });
  }
);
