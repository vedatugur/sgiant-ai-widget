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
 *
 * EVERY "NEXT PAGE" HERE IS A REAL ONE: a navigation in the same tab, the
 * bundle loaded again. The window allows one site chat per page view, so a
 * second visit made inside one page would be answered with the first and
 * prove nothing.
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

type Server = {
  settings?: unknown;
  settingsFail?: "" | "network" | "500" | "404";
};
type Seen<T> = {
  drew: boolean;
  out: T;
  sent: Array<{ threadId: unknown; content: string; siteKey: unknown }>;
};

/**
 * One page view of a visit. `first` starts a new visit (a fresh tab's worth
 * of storage); otherwise it is the next page of the same one. `body` is the
 * source of what the visitor does there, with the page's helpers in reach.
 */
async function view<T = unknown>(
  page: Page,
  how: {
    first?: boolean;
    viewport?: readonly [number, number];
    server?: Server;
    siteKey?: string;
    lang?: string;
    before?: string;
  },
  body = "return null;"
): Promise<Seen<T>> {
  if (how.first) await page.open(how.viewport ?? [1280, 800]);
  else await page.next();
  return page.evaluate<Seen<T>>(`(async () => {
    (${SETUP})();
    Object.assign(S, ${JSON.stringify(how.server ?? {})});
    ${how.lang ? `document.documentElement.lang = ${JSON.stringify(how.lang)};` : ""}
    ${how.before ?? ""}
    const drew = await visit(${JSON.stringify(how.siteKey ?? "pk_1")});
    const out = await (async () => { ${body} })();
    leave();
    return { drew, out, sent: S.sent };
  })()`);
}

test(
  "in a browser: a visitor's conversation, kept in the tab",
  { skip: SKIP_WITHOUT_CHROME },
  async (t) => {
    await withBrowser(async (page) => {
      await t.test("EVERYTHING the window writes in a visitor's browser over a full visit, by name", async () => {
        const { out: seen } = await view<{
          forGood: string[];
          inTheTab: string[];
          forGoodText: string;
          cookie: string;
        }>(
          page,
          { first: true },
          `
          await ask("Is breakfast included?");
          type("an unsent thought about the spa");
          // The sound switch, pressed: the one other thing a visitor can set.
          const P = "sgiant-aiw";
          const chime = [...document.querySelectorAll("." + P + "-panel button")].find((b) =>
            /chime|sound|ses/i.test((b.getAttribute("aria-label") || b.title || b.textContent || ""))
          );
          chime && chime.click();
          // The window, dragged by its header: on the header's own text, not
          // on one of its buttons. A made-up pointer cannot be captured,
          // which the window survives.
          const h = document.querySelector("." + P + "-header");
          const r = h.getBoundingClientRect();
          const at = (type, x, y) =>
            new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, pointerId: 1, button: 0, isPrimary: true });
          const grip = h.querySelector("." + P + "-title") || h;
          try { grip.dispatchEvent(at("pointerdown", r.left + 60, r.top + 12)); } catch {}
          h.dispatchEvent(at("pointermove", r.left - 80, r.top - 120));
          h.dispatchEvent(at("pointerup", r.left - 80, r.top - 120));
          await new Promise((r) => setTimeout(r, 200));
          const k = kept();
          return { forGood: k.forGood, inTheTab: k.inTheTab, forGoodText: k.forGoodText, cookie: document.cookie };
          `
        );
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
        // Exactly these: a name missing means the visit did not really do
        // the thing, a name added means the window keeps something new.
        assert.deepEqual(seen.forGood, FOR_GOOD);
        assert.deepEqual(seen.inTheTab, IN_THE_TAB);
        // Not one word of the visitor's in the storage a browser keeps.
        for (const word of ["breakfast", "spa", "thr_1", "Answer to"])
          assert.ok(!seen.forGoodText.includes(word), `"${word}" is kept for good`);
        assert.equal(seen.cookie, "");
      });

      await t.test("on the next page the conversation is there, and goes on as the same one", async () => {
        for (const viewport of [[1280, 800], [320, 640]] as const) {
          const one = await view(
            page,
            { first: true, viewport },
            `await ask("Is breakfast included?"); type("and the spa");`
          );
          assert.deepEqual(one.sent.map((s) => s.threadId), [null]);
          const two = await view<{ before: ReturnType<any>; }>(
            page,
            {},
            `const before = shown(); await ask("And parking?"); return { before };`
          );
          const before = (two.out as any).before;
          assert.equal(two.drew, true);
          assert.deepEqual(before.questions, ["Is breakfast included?"]);
          assert.ok(before.answers.some((a: string) => a.includes("Answer to: Is breakfast included?")));
          // What was typed and not sent is in the box again.
          assert.equal(before.box, "and the spa");
          // The same conversation to the server: its id goes with the question.
          assert.deepEqual(two.sent.map((s) => s.threadId), ["thr_1"]);
        }
      });

      await t.test('"Clear this conversation" removes it, in both languages', async () => {
        for (const [lang, name] of [
          ["en", "Clear this conversation"],
          ["tr", "Bu sohbeti temizle"],
          // A page in a language the window has no words for: the English.
          ["de", "Clear this conversation"],
        ] as const) {
          const { out: seen } = await view<any>(
            page,
            { first: true, viewport: [320, 640], lang },
            `
            await ask("Is breakfast included?");
            type("and the spa");
            const btn = [...document.querySelectorAll(".sgiant-aiw-panel button")].find(
              (b) => b.getAttribute("aria-label") === ${JSON.stringify(name)}
            );
            const title = btn ? btn.title : "";
            btn && btn.click();
            await new Promise((r) => setTimeout(r, 200));
            const k = kept();
            return { found: !!btn, title, after: shown(), tab: k.inTheTab, all: k.all };
            `
          );
          assert.equal(seen.found, true, `${lang}: no button named "${name}"`);
          assert.equal(seen.title, name);
          // The window is as it was at the start: the greeting, an empty box.
          assert.deepEqual(seen.after.questions, []);
          assert.ok(seen.after.answers.some((a: string) => a.includes("Welcome.")));
          assert.equal(seen.after.box, "");
          // Nothing of the conversation, its id or the unsent text is left.
          for (const word of ["breakfast", "spa", "thr_1", "Answer to"])
            assert.ok(!seen.all.includes(word), `${lang}: "${word}" is still in the browser`);
          assert.ok(!seen.tab.includes("aiw:v1:site:pk_1"));
          assert.ok(!seen.tab.includes("aiw:draft:site:pk_1"));
          // And the next page starts a new one, not the old one again.
          const next = await view<any>(
            page,
            { lang },
            `const first = shown(); await ask("Hello again"); return first;`
          );
          assert.deepEqual(next.out.questions, []);
          assert.deepEqual(next.sent.map((s) => s.threadId), [null]);
        }
      });

      await t.test("the server says no: nothing is drawn and what was kept is gone", async () => {
        for (const server of [
          { settings: { answersVisitors: false } },
          { settingsFail: "404" },
        ] as Server[]) {
          const why = JSON.stringify(server);
          await view(page, { first: true }, `await ask("Is breakfast included?");`);
          const no = await view<any>(
            page,
            { server },
            `return { drawn: shown().drawn, tab: kept().inTheTab };`
          );
          assert.equal(no.drew, false, why);
          assert.equal(no.out.drawn, 0, why);
          assert.deepEqual(no.out.tab, [], `${why}: still kept`);
          // Turned on again later: a new conversation, not the old one.
          const back = await view<any>(page, {}, `return shown().questions;`);
          assert.equal(back.drew, true, why);
          assert.deepEqual(back.out, [], why);
        }
      });

      await t.test("nobody answered: nothing is drawn, and what was kept is there on the next page", async () => {
        for (const settingsFail of ["network", "500"] as const) {
          const first = await view<string>(
            page,
            { first: true },
            `await ask("Is breakfast included?"); return kept().all;`
          );
          const lost = await view<any>(
            page,
            { server: { settingsFail } },
            `return { drawn: shown().drawn, all: kept().all };`
          );
          assert.equal(lost.drew, false, settingsFail);
          assert.equal(lost.out.drawn, 0, settingsFail);
          assert.equal(
            lost.out.all,
            first.out,
            `${settingsFail}: one bad connection changed what was kept`
          );
          const back = await view<any>(page, {}, `return shown().questions;`);
          assert.deepEqual(back.out, ["Is breakfast included?"], settingsFail);
        }
      });

      await t.test("the site's key changed: the old conversation is neither shown nor left behind", async () => {
        await view(page, { first: true, siteKey: "pk_1" }, `await ask("Is breakfast included?");`);
        const seen = await view<any>(
          page,
          { siteKey: "pk_2" },
          `const questions = shown().questions; await ask("Hello"); const k = kept(); return { questions, tab: k.inTheTab, all: k.all };`
        );
        assert.deepEqual(seen.out.questions, []);
        assert.ok(
          seen.out.tab.every((n: string) => !n.endsWith(":site:pk_1")),
          seen.out.tab.join(", ")
        );
        assert.ok(!seen.out.all.includes("breakfast"));
        assert.equal(seen.sent[0]!.siteKey, "pk_2");
        // The old conversation's id is not sent under the new key.
        assert.equal(seen.sent[0]!.threadId, null);
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
          const seen = await view<any>(
            page,
            {
              first: true,
              before: `sessionStorage.setItem("aiw:v1:site:pk_1", ${JSON.stringify(stored)});`,
            },
            `
            const panel = document.querySelector(".sgiant-aiw-panel").textContent;
            const left = sessionStorage.getItem("aiw:v1:site:pk_1");
            await ask("Hello");
            return { panel, left };
            `
          );
          assert.ok(!seen.out.panel.includes("SHOULD NOT SHOW"), `${why}: it was drawn`);
          assert.equal(seen.out.left, null, `${why}: it was left in the tab`);
          assert.equal(seen.sent[0]!.threadId, null, `${why}: its id was sent`);
        }
      });

      await t.test("there is a limit to how much is kept: the oldest go first", async () => {
        const { out: seen } = await view<any>(
          page,
          { first: true },
          `
          const long = "x".repeat(60000);
          for (const n of [1, 2, 3, 4, 5]) await ask("Q" + n + " " + long);
          const messages = JSON.parse(sessionStorage.getItem("aiw:v1:site:pk_1")).messages;
          return {
            size: JSON.stringify(messages).length,
            kept: messages.length,
            last: messages[messages.length - 1].content.slice(0, 16),
            first: messages[0].content.slice(0, 16),
          };
          `
        );
        assert.ok(seen.size <= 200000, `${seen.size} characters kept`);
        assert.ok(seen.kept >= 2 && seen.kept < 10, `${seen.kept} messages kept`);
        // The newest is there; the first question is not.
        assert.match(seen.last, /^Answer to: Q5/);
        assert.doesNotMatch(seen.first, /Q1 /);
      });

      await t.test("a browser that refuses storage: nothing is kept, nothing is said, and the chat works", async () => {
        const REFUSE = `
          window.__errors = 0;
          addEventListener("error", () => window.__errors++);
          addEventListener("unhandledrejection", () => window.__errors++);
          const refuse = () => { throw new DOMException("refused", "SecurityError"); };
          Storage.prototype.getItem = refuse;
          Storage.prototype.setItem = refuse;
          Storage.prototype.removeItem = refuse;
          Object.defineProperty(window, "sessionStorage", { get: refuse });
        `;
        const one = await view<any>(
          page,
          { first: true, before: REFUSE },
          `
          await ask("Is breakfast included?");
          return {
            answers: shown().answers,
            panel: document.querySelector(".sgiant-aiw-panel").textContent,
            errors: window.__errors,
          };
          `
        );
        assert.equal(one.drew, true);
        assert.ok(one.out.answers.some((a: string) => a.includes("Answer to: Is breakfast included?")));
        assert.equal(one.out.errors, 0);
        assert.doesNotMatch(one.out.panel, /storage|refused|SecurityError/i);
        // One page at a time, as before there was anything to keep.
        const two = await view<any>(
          page,
          { before: REFUSE },
          `return { questions: shown().questions, errors: window.__errors };`
        );
        assert.equal(two.drew, true);
        assert.deepEqual(two.out, { questions: [], errors: 0 });
      });

      await t.test("the other way in is as it was: a host's key still goes to the browser's long-lived storage", async () => {
        await page.open([1280, 800]);
        const seen = await page.evaluate<{ forGood: string[]; inTheTab: string[]; name: string | null }>(
          `(async () => {
            (${SETUP})();
            const w = SgiantAiWidget.createAiChatWidget({ endpoint: "https://api.example/chat", persistKey: "acc-1" });
            w.open();
            await new Promise((r) => setTimeout(r, 200));
            await ask("Hello");
            const k = kept();
            const btn = [...document.querySelectorAll(".sgiant-aiw-panel button")].find(
              (b) => b.getAttribute("aria-label") === "New chat"
            );
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
