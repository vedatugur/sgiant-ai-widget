import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SKIP_WITHOUT_CHROME, withBrowser, type Page } from "./aiw-browser.ts";

/**
 * A SENTENCE THE SERVER WROTE FOR THE READER STANDS ALONE.
 *
 * Every failed turn was drawn as one card: the window's own headline ("AYCA
 * hit a snag and couldn't answer. Please try again."), the server's message
 * under it as a detail, and "Try again". That is right when the message is a
 * vendor's text or the first line of a stack. It is wrong when the server
 * took care to write a sentence for the person reading:
 *
 *   AYCA hit a snag and couldn't answer. Please try again.
 *   The assistant cannot answer right now. The problem is on our side, not
 *   with your account. Please try again in a few minutes.
 *   [Try again]
 *
 * The same thing twice, in two voices, and a button that does now what the
 * sentence asks to be done in a few minutes.
 *
 * The window cannot tell the two kinds of message apart by reading them, so
 * the server says which it is: an error frame WITH A `code` carries a sentence
 * for the reader. It is drawn by itself. `retry:false` on it removes "Try
 * again". A frame with no code is drawn exactly as before, so a technical
 * message never becomes the card's headline. The code's value is the server's
 * own name for the refusal: it is not shown and nothing branches on it.
 */
const INDEX = readFileSync(
  join(import.meta.dirname, "..", "src", "index.ts"),
  "utf8"
);
/** Source with comments removed, for assertions about the code itself. */
const CODE = INDEX.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");

test("the frame's code is what says the message is for the reader", () => {
  assert.match(
    CODE,
    /const coded =\s*typeof frame\.code === "string" && frame\.code\.trim\(\) !== "";/
  );
  assert.match(
    CODE,
    /failureIs = coded\s*\?\s*\{ alone: true, retry: frame\.retry !== false \}\s*:\s*\{\};/
  );
  // The value is never compared with anything: no list of known codes here.
  assert.doesNotMatch(
    CODE,
    /(?<!typeof )frame\.code\s*===\s*["'`][a-z_]+["'`]|switch \(frame\.code\)/
  );
});

test("a failure that is not a server's coded frame is the ordinary card", () => {
  // The two other ways a turn fails reset it: an HTTP status, and no answer.
  assert.match(
    CODE,
    /failure = `Server error \(\$\{res\.status\}\)\.`;\s*failureIs = \{\};/
  );
  assert.match(
    CODE,
    /failureIs = \{\};\s*failure = \(err as Error\)\.message \|\| "Network error\.";/
  );
  assert.equal(CODE.match(/showError\(failure, failureIs\)/g)?.length, 2);
  assert.doesNotMatch(CODE, /showError\(failure\)/);
});

test("the card draws a sentence that stands alone without its own headline", () => {
  assert.match(
    CODE,
    /const alone = show\.alone === true \|\| show\.retry === false;/
  );
  assert.match(CODE, /txt\.textContent = alone \? raw : L\("errorSnag", \{ name \}\);/);
  assert.match(CODE, /detail\.textContent = alone \? "" : raw;/);
  // "Try again" is decided by `retry` alone, as it always was.
  assert.match(CODE, /if \(show\.retry !== false\) \{/);
});

/* ---------------------------------------------------------- in a browser */

const SAID =
  "Asistan şu anda yanıt veremiyor. Sorun bizim tarafımızda, hesabınızla ilgili değil.\nNeden: sağlayıcıda kredi kalmadı.";
const TECHNICAL = "upstream connect error or disconnect/reset before headers";

/** Runs in the page: a window whose server answers with the frames given. */
const MOUNT = (): void => {
  const T = ((globalThis as any).T = {
    frames: [] as unknown[],
    status: 200,
    asked: 0,
  });
  (globalThis as any).fetch = async (input: any) => {
    const url = typeof input === "string" ? input : input.url;
    if (!String(url).includes("/demo-chat"))
      return new Response("{}", { status: 404 });
    T.asked++;
    if (T.status !== 200)
      return new Response('{"error":"Too many messages"}', { status: T.status });
    return new Response(
      T.frames.map((l) => JSON.stringify(l) + "\n").join(""),
      { status: 200, headers: { "content-type": "application/x-ndjson" } }
    );
  };
  const w = (globalThis as any).SgiantAiWidget.createAiChatWidget({
    endpoint: "/demo-chat",
    title: "AYCA",
    getToken: () => Promise.resolve("tok"),
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

/** Runs in the page: the error card as a person finds it. */
const LOOK = async (): Promise<{
  cards: number;
  text: string;
  detail: string;
  detailShown: boolean;
  lines: number;
  inside: boolean;
  retry: { x: number; y: number } | null;
  answers: string[];
  offline: boolean;
  asked: number;
  panel: string;
}> => {
  await new Promise((r) => setTimeout(r, 300));
  const P = "sgiant-aiw";
  const panel = document.querySelector(`.${P}-panel`)!;
  const cards = [...panel.querySelectorAll(`.${P}-error`)];
  const card = cards[cards.length - 1];
  const txt = card?.querySelector(`.${P}-error-text`) as HTMLElement | null;
  const detail = card?.querySelector(`.${P}-error-detail`) as HTMLElement | null;
  const btn = card?.querySelector(`.${P}-error-retry`) as HTMLElement | null;
  const box = panel.getBoundingClientRect();
  let lines = 0;
  let inside = true;
  if (txt) {
    const range = document.createRange();
    range.selectNodeContents(txt);
    const rects = [...range.getClientRects()].filter((r) => r.width > 0);
    lines = new Set(rects.map((r) => Math.round(r.top))).size;
    inside = rects.every(
      (r) => r.left >= box.left - 0.5 && r.right <= box.right + 0.5
    );
  }
  const r = btn?.getBoundingClientRect();
  return {
    cards: cards.length,
    text: txt?.textContent ?? "",
    detail: detail?.textContent ?? "",
    detailShown: !!detail && detail.getBoundingClientRect().height > 0,
    lines,
    inside,
    retry: r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null,
    answers: [...panel.querySelectorAll(`.${P}-msg.${P}-assistant`)].map(
      (m) => m.textContent ?? ""
    ),
    offline: !!document.querySelector(`.${P}-bubble-offline`),
    asked: (globalThis as any).T.asked,
    panel: panel.textContent ?? "",
  };
};

async function turn(
  page: Page,
  viewport: readonly [number, number],
  frames: unknown[],
  status = 200
): Promise<Awaited<ReturnType<typeof LOOK>>> {
  await page.open(viewport);
  await page.evaluate(`(${MOUNT})()`);
  await page.evaluate(
    `T.frames = ${JSON.stringify(frames)}; T.status = ${status};`
  );
  await page.evaluate(`(${ASK})("Bu ay kaç rezervasyon aldık?")`);
  return page.evaluate<Awaited<ReturnType<typeof LOOK>>>(`(${LOOK})()`);
}
const look = (page: Page) =>
  page.evaluate<Awaited<ReturnType<typeof LOOK>>>(`(${LOOK})()`);

const SNAG = /hit a snag/;
const done = { type: "done" };

test(
  "in a browser: the server's sentence, and only it",
  { skip: SKIP_WITHOUT_CHROME },
  async (t) => {
    await withBrowser(async (page) => {
      for (const viewport of [
        [1280, 800],
        [320, 640],
      ] as const) {
        const at = `${viewport[0]}px`;

        await t.test(`${at}: a coded frame is drawn alone, and may be tried again`, async () => {
          const s = await turn(page, viewport, [
            { type: "error", code: "assistant_unavailable", message: SAID },
            done,
          ]);
          assert.equal(s.cards, 1);
          assert.equal(s.text, SAID, "the card's text is not the server's sentence");
          assert.doesNotMatch(s.panel, SNAG, "the window's own headline is there too");
          assert.equal(s.detail, "");
          assert.equal(s.detailShown, false, "an empty line is drawn under it");
          // Its second line is a second line, and nothing leaves the window.
          assert.ok(s.lines >= 2, `${s.lines} line(s)`);
          assert.equal(s.inside, true);
          // The code is the server's business: it is not on the screen.
          assert.doesNotMatch(s.panel, /assistant_unavailable/);
          // A 200 with a frame is an answer: the launcher is not marked offline.
          assert.equal(s.offline, false);
          // "Try again" is there, and asks again.
          assert.ok(s.retry, "no Try again on a frame that allows it");
          await page.click(s.retry!.x, s.retry!.y);
          assert.equal((await look(page)).asked, 2);
        });

        await t.test(`${at}: retry:false takes the button away`, async () => {
          const s = await turn(page, viewport, [
            {
              type: "error",
              code: "member_rate_limit",
              retry: false,
              message: "Çok hızlı yazıyorsunuz. Lütfen bir dakika bekleyin.",
            },
            done,
          ]);
          assert.equal(s.text, "Çok hızlı yazıyorsunuz. Lütfen bir dakika bekleyin.");
          assert.doesNotMatch(s.panel, SNAG);
          assert.equal(s.retry, null, "Try again is offered though the server said not to");
          assert.equal(s.offline, false);
        });

        await t.test(`${at}: a frame with no code is the card it always was`, async () => {
          const s = await turn(page, viewport, [
            { type: "error", message: TECHNICAL },
            done,
          ]);
          assert.match(s.text, SNAG);
          assert.equal(s.detail, TECHNICAL);
          assert.equal(s.detailShown, true);
          assert.ok(s.retry);
        });

        await t.test(`${at}: what is not a code does not count as one`, async () => {
          for (const code of ["", "   ", 7, true, null, ["x"]]) {
            const s = await turn(page, viewport, [
              { type: "error", code, message: TECHNICAL },
              done,
            ]);
            assert.match(s.text, SNAG, `code ${JSON.stringify(code)} was trusted`);
            assert.equal(s.detail, TECHNICAL);
          }
        });

        await t.test(`${at}: after half an answer, the half stays and the sentence follows`, async () => {
          const s = await turn(page, viewport, [
            { type: "text", d: "Bu ay 42 rezervasyon" },
            {
              type: "error",
              code: "assistant_stopped",
              retry: false,
              message: "Yanıt yarıda kesildi. Lütfen sorunuzu yeniden sorun.",
            },
            done,
          ]);
          assert.deepEqual(s.answers, ["Bu ay 42 rezervasyon"]);
          assert.equal(s.text, "Yanıt yarıda kesildi. Lütfen sorunuzu yeniden sorun.");
          assert.equal(s.retry, null);
        });

        await t.test(`${at}: an HTTP refusal is drawn as before`, async () => {
          const s = await turn(page, viewport, [], 429);
          assert.match(s.text, SNAG);
          assert.equal(s.detail, "Server error (429).");
          assert.ok(s.retry);
        });
      }
    });
  }
);
