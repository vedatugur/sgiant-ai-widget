import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SKIP_WITHOUT_CHROME, withBrowser, type Page } from "./aiw-browser.ts";
import { WIDGET_LABELS } from "../dist/labels.js";

/**
 * A TURN WHOSE CONNECTION DROPPED PROMISES NOTHING, AND LOCKS NOTHING.
 *
 * When the stream broke mid-reply the window said "Connection lost — still
 * working on the reply; it will appear here when ready", locked Send in that
 * conversation, and asked for the conversation every ten seconds for fifteen
 * minutes. That is right when the server finishes the turn anyway. It is
 * false after a release: the question and the answer are both saved only at
 * the END of a turn, so a turn cut by a release leaves nothing. The person
 * was told to wait for an answer that was not coming, in a conversation they
 * could not write in.
 *
 * Now: a sentence that promises nothing, and Send is free. The window still
 * looks, and a reply that lands late is drawn. A new message in that
 * conversation ends the looking, so a reply found afterwards is never drawn
 * over the turn the person is in.
 */
const INDEX = readFileSync(
  join(import.meta.dirname, "..", "src", "widget.ts"),
  "utf8"
);
/** Source with comments removed, for assertions about the code itself. */
const CODE = INDEX.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
const SENTENCE =
  "The connection was lost. If the answer does not appear here, send your message again.";

test("the sentence promises nothing", () => {
  assert.equal(WIDGET_LABELS.streamLostRecovering, SENTENCE);
  assert.doesNotMatch(
    WIDGET_LABELS.streamLostRecovering,
    /still working|will appear|when ready|being prepared/i
  );
});

test("looking for a lost answer never marks the conversation as answering", () => {
  const looking = CODE.slice(
    CODE.indexOf("async function recoverLostTurn("),
    CODE.indexOf("function turnLanded(")
  );
  assert.ok(looking.length > 400, "could not find recoverLostTurn");
  // `pendingThreads` is what disables Send and spins the history row.
  assert.doesNotMatch(looking, /pendingThreads|syncBusy/);
  // A new message ends the looking, and the looking checks before it draws.
  assert.match(CODE, /if \(turnThread\) lostSearch\.delete\(turnThread\);/);
  assert.match(
    looking,
    /if \(!stillMine\(\)\) return;\s*if \(!turnLanded\(items, sentContent\)\) continue;/
  );
  // The marker a page load reads is cleared only by the search that owns it.
  assert.match(
    looking,
    /if \(stillMine\(\)\) \{\s*lostSearch\.delete\(turnThread\);\s*if \(inflight\?\.threadId === turnThread\) \{\s*inflight = null;/
  );
});

/* ---------------------------------------------------------- in a browser */

const Q = "Bu ay kaç rezervasyon aldık?";
const LATE = "Bu ay 42 rezervasyon aldınız.";

/**
 * Runs in the page: a window with a history, whose server names the
 * conversation and then drops the connection. The ten-second wait between
 * looks is shortened to 200ms; nothing else about time is touched.
 */
const MOUNT = (): void => {
  const T = ((globalThis as any).T = {
    /** What the chat address does next: "drop", or frames to answer with. */
    next: "drop" as "drop" | unknown[],
    /** What the saved conversation holds when it is asked for. */
    saved: [] as unknown[],
    asked: 0,
    looked: 0,
  });
  const realTimeout = globalThis.setTimeout;
  (globalThis as any).setTimeout = (fn: any, ms?: number, ...rest: any[]) =>
    realTimeout(fn, ms === 10_000 ? 200 : ms, ...rest);
  (globalThis as any).fetch = async (input: any) => {
    const url = typeof input === "string" ? input : input.url;
    if (!String(url).includes("/demo-chat"))
      return new Response("{}", { status: 404 });
    T.asked++;
    const enc = new TextEncoder();
    const line = (o: unknown) => enc.encode(JSON.stringify(o) + "\n");
    const plan = T.next;
    const body = new ReadableStream({
      start(c) {
        c.enqueue(line({ threadId: "th-1" }));
        if (plan === "drop") {
          realTimeout(() => c.error(new TypeError("network error")), 50);
          return;
        }
        for (const f of plan as unknown[]) c.enqueue(line(f));
        c.close();
      },
    });
    return new Response(body, {
      status: 200,
      headers: { "content-type": "application/x-ndjson" },
    });
  };
  const w = (globalThis as any).SgiantAiWidget.createAiChatWidget({
    endpoint: "/demo-chat",
    title: "AYCA",
    getToken: () => Promise.resolve("tok"),
    listThreads: async () => [{ id: "th-1", title: "Rezervasyonlar" }],
    loadThread: async () => {
      T.looked++;
      return T.saved;
    },
  });
  w.open();
};

/** Runs in the page: type a question and submit it, as the composer does. */
const ASK = (q: string): void => {
  const input = document.querySelector(
    '[data-ai-target="widget-composer"]'
  ) as HTMLInputElement;
  input.value = q;
  input.closest("form")!.requestSubmit();
};

/** Runs in the page, after `ms`: what a person finds. */
const LOOK = async (
  ms: number
): Promise<{
  cards: string[];
  retry: boolean;
  inside: boolean;
  sendDisabled: boolean;
  questions: string[];
  answers: string[];
  asked: number;
  looked: number;
}> => {
  await new Promise((r) => setTimeout(r, ms));
  const P = "sgiant-aiw";
  const panel = document.querySelector(`.${P}-panel`)!;
  const box = panel.getBoundingClientRect();
  const cards = [...panel.querySelectorAll(`.${P}-error`)];
  let inside = true;
  for (const card of cards) {
    const txt = card.querySelector(`.${P}-error-text`);
    if (!txt) continue;
    const range = document.createRange();
    range.selectNodeContents(txt);
    inside &&= [...range.getClientRects()]
      .filter((r) => r.width > 0)
      .every((r) => r.left >= box.left - 0.5 && r.right <= box.right + 0.5);
  }
  const texts = (sel: string) =>
    [...panel.querySelectorAll(sel)].map((m) => m.textContent ?? "");
  return {
    cards: cards.map(
      (c) => c.querySelector(`.${P}-error-text`)?.textContent ?? ""
    ),
    retry: !!panel.querySelector(`.${P}-error-retry`),
    inside,
    sendDisabled: (panel.querySelector(`.${P}-send`) as HTMLButtonElement)
      .disabled,
    questions: texts(`.${P}-msg.${P}-user`),
    answers: texts(`.${P}-msg.${P}-assistant`),
    asked: (globalThis as any).T.asked,
    looked: (globalThis as any).T.looked,
  };
};
const look = (page: Page, ms = 400) =>
  page.evaluate<Awaited<ReturnType<typeof LOOK>>>(`(${LOOK})(${ms})`);

async function dropped(
  page: Page,
  viewport: readonly [number, number]
): Promise<Awaited<ReturnType<typeof LOOK>>> {
  await page.open(viewport);
  await page.evaluate(`(${MOUNT})()`);
  await page.evaluate(`(${ASK})(${JSON.stringify(Q)})`);
  return look(page);
}

test(
  "in a browser: a dropped connection",
  { skip: SKIP_WITHOUT_CHROME },
  async (t) => {
    await withBrowser(async (page) => {
      for (const viewport of [
        [1280, 800],
        [320, 640],
      ] as const) {
        const at = `${viewport[0]}px`;

        await t.test(`${at}: the sentence, no button, and Send is free`, async () => {
          const s = await dropped(page, viewport);
          assert.deepEqual(s.cards, [SENTENCE]);
          assert.equal(s.inside, true, "the sentence leaves the window");
          assert.equal(s.retry, false);
          assert.deepEqual(s.questions, [Q], "the person's message is gone");
          assert.equal(s.sendDisabled, false, "Send is locked while it looks");
          // It is still looking, and stays unlocked while it does.
          const later = await look(page, 700);
          assert.ok(later.looked >= 2, `asked for the conversation ${later.looked} time(s)`);
          assert.equal(later.sendDisabled, false);
        });

        await t.test(`${at}: an answer that lands late is drawn`, async () => {
          await dropped(page, viewport);
          await page.evaluate(
            `T.saved = ${JSON.stringify([
              { role: "user", content: Q },
              { role: "assistant", content: LATE },
            ])}`
          );
          const s = await look(page, 900);
          assert.deepEqual(s.answers, [LATE]);
          assert.deepEqual(s.questions, [Q]);
          assert.deepEqual(s.cards, [], "the card stays after the answer came");
          // And it stops looking once it has it.
          const n = s.looked;
          assert.equal((await look(page, 700)).looked, n);
        });

        await t.test(`${at}: the message can be sent again at once, and is answered`, async () => {
          await dropped(page, viewport);
          await page.evaluate(
            `T.next = ${JSON.stringify([
              { type: "assistant_delta", text: "Yeniden: 42." },
              { type: "done" },
            ])}`
          );
          await page.evaluate(`(${ASK})(${JSON.stringify(Q)})`);
          const s = await look(page);
          assert.equal(s.asked, 2, "the second message was not sent");
          assert.deepEqual(s.questions, [Q, Q]);
          assert.equal(s.answers.at(-1), "Yeniden: 42.");
          // The first turn's answer lands on the server afterwards. The
          // conversation is the person's now: it is not redrawn under them.
          const before = s.looked;
          await page.evaluate(
            `T.saved = ${JSON.stringify([
              { role: "user", content: Q },
              { role: "assistant", content: LATE },
            ])}`
          );
          const after = await look(page, 900);
          assert.equal(after.looked, before, "it went on looking after a new message");
          assert.deepEqual(after.questions, [Q, Q]);
          assert.equal(after.answers.at(-1), "Yeniden: 42.");
        });
      }
    });
  }
);
