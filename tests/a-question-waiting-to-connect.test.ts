import test from "node:test";
import assert from "node:assert/strict";
import { SKIP_WITHOUT_CHROME, withBrowser } from "./aiw-browser.ts";

/**
 * ONE QUESTION WAITS FOR THE PERSON TO CONNECT, AND IT IS THE ONE ON SCREEN
 * (sgiant-platform#639).
 *
 * While a host's token step says "not now" (the person has not connected
 * yet), a question is drawn as theirs and held under a notice with a button.
 * Seen on a customer's wp-admin: someone pressed Send three times before
 * connecting. Three bubbles, one notice. The button held only the last
 * question, so connecting sent ONE message, and two bubbles stayed on screen
 * looking like sent messages that had never been sent. A reload showed one.
 *
 * Nothing was lost and nothing was sent twice; what was wrong is that the
 * screen said something that was not so. A question that is replaced before
 * it could be sent is now taken back.
 */
const RUN = async (questions: string[], connect: boolean): Promise<{
  before: { log: string[]; buttons: number };
  after: { log: string[]; buttons: number };
  sent: string[];
  stored: string[];
}> => {
  const g = globalThis as any;
  localStorage.clear();
  const T = { connected: false, sent: [] as string[] };
  g.fetch = async (_url: unknown, init?: { body?: string }) => {
    T.sent.push(JSON.parse(init?.body ?? "{}").content);
    return new Response(
      JSON.stringify({ type: "assistant_delta", text: "Merhaba!" }) +
        "\n" +
        JSON.stringify({ type: "done" }) +
        "\n",
      { status: 200, headers: { "content-type": "application/x-ndjson" } }
    );
  };
  const w = g.SgiantAiWidget.createAiChatWidget({
    endpoint: "/demo-chat",
    title: "AYCA",
    persistKey: "waiting",
    getToken: () =>
      T.connected
        ? Promise.resolve("tok")
        : Promise.reject({
            userMessage: "AYCA'yı kullanmak için sgiant hesabınızı bağlayın.",
            action: {
              label: "Bağlan",
              onClick: () => {
                T.connected = true;
                return true;
              },
            },
          }),
  });
  w.open();
  const P = "sgiant-aiw";
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const look = () => ({
    log: [...document.querySelectorAll(`.${P}-panel .${P}-log > *`)].map(
      (n) =>
        (n.classList.contains(`${P}-user`)
          ? "Q: "
          : n.classList.contains(`${P}-assistant`)
            ? "A: "
            : n.classList.contains(`${P}-notice`)
              ? "notice: "
              : "other: ") + (n.textContent ?? "")
    ),
    buttons: [...document.querySelectorAll(`.${P}-panel .${P}-notice button`)]
      .length,
  });
  for (const q of questions) {
    const input = document.querySelector(
      '[data-ai-target="widget-composer"]'
    ) as HTMLInputElement;
    input.value = q;
    input.closest("form")!.requestSubmit();
    await sleep(300);
  }
  const before = look();
  if (connect) {
    (
      document.querySelector(
        `.${P}-panel .${P}-notice button`
      ) as HTMLButtonElement
    ).click();
    await sleep(900);
  }
  const after = look();
  const saved = JSON.parse(
    localStorage.getItem(
      Object.keys(localStorage).find((k) => k.includes(":v1:"))!
    ) ?? "{}"
  ) as { messages?: Array<{ role: string; content: string }> };
  w.destroy();
  return {
    before,
    after,
    sent: T.sent,
    stored: (saved.messages ?? [])
      .filter((m) => m.role === "user")
      .map((m) => m.content),
  };
};

const NOTICE = "notice: AYCA'yı kullanmak için sgiant hesabınızı bağlayın.Bağlan";

test(
  "in a browser: questions asked before the person has connected",
  { skip: SKIP_WITHOUT_CHROME },
  async (t) => {
    await withBrowser(async (page) => {
      const run = async (questions: string[], connect: boolean) => {
        await page.open([1280, 800]);
        return page.evaluate<Awaited<ReturnType<typeof RUN>>>(
          `(${RUN})(${JSON.stringify(questions)}, ${connect})`
        );
      };

      await t.test("THE FAULT: the same question three times is one bubble, and one message once connected", async () => {
        const s = await run(["merhaba", "merhaba", "merhaba"], true);
        // Before connecting: one question waits, under one button.
        assert.deepEqual(s.before.log, ["Q: merhaba", NOTICE]);
        assert.equal(s.before.buttons, 1);
        // After: what is on screen is what was sent.
        assert.deepEqual(s.sent, ["merhaba"]);
        assert.deepEqual(s.after.log, ["Q: merhaba", "A: Merhaba!"]);
        // And what the browser keeps for a reload holds it once.
        assert.deepEqual(s.stored, ["merhaba"]);
      });

      await t.test("a different question replaces the one that was waiting: the last is sent", async () => {
        const s = await run(["bugün kaç rezervasyon var?", "dün kaç vardı?"], true);
        assert.deepEqual(s.before.log, ["Q: dün kaç vardı?", NOTICE]);
        assert.deepEqual(s.sent, ["dün kaç vardı?"]);
        assert.deepEqual(s.after.log, ["Q: dün kaç vardı?", "A: Merhaba!"]);
        assert.deepEqual(s.stored, ["dün kaç vardı?"]);
      });

      await t.test("one question, as before: it waits, is sent once, and is drawn once", async () => {
        const s = await run(["merhaba"], true);
        assert.deepEqual(s.before.log, ["Q: merhaba", NOTICE]);
        assert.deepEqual(s.sent, ["merhaba"]);
        assert.deepEqual(s.after.log, ["Q: merhaba", "A: Merhaba!"]);
      });

      await t.test("not connecting sends nothing, and the one question stays with its button", async () => {
        const s = await run(["merhaba", "merhaba"], false);
        assert.deepEqual(s.sent, []);
        assert.deepEqual(s.after.log, ["Q: merhaba", NOTICE]);
        assert.equal(s.after.buttons, 1);
      });
    });
  }
);
