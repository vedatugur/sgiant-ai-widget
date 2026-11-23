import test from "node:test";
import assert from "node:assert/strict";
import { SKIP_WITHOUT_CHROME, withBrowser, type Page } from "./aiw-browser.ts";
import { cancelTurn, STOP_READS_ON_MS } from "../dist/stream.js";

/**
 * STOP REALLY STOPS THE TURN (sgiant-platform, the owner, 2026-11-23).
 *
 * 3.1.0's Stop ended only the reading: the server went on, charged the whole
 * answer and kept it. Now the server names its turn (a `turn` frame) and Stop
 * asks it to cut the turn, `POST <endpoint>/turns/:turnId/cancel`, with the
 * turn's own token. When it answers that it is stopping, the window reads on
 * to the turn's `done` (`stopped: true`), so what is on screen is what the
 * server kept. When it says no, or never named the turn, Stop ends the
 * reading as before.
 */

type Call = { url: string; init: RequestInit };

async function withFetch<T>(
  answer: (url: string) => Response | Promise<Response>,
  run: (calls: Call[]) => Promise<T>
): Promise<T> {
  const calls: Call[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return answer(String(url));
  }) as typeof fetch;
  try {
    return await run(calls);
  } finally {
    globalThis.fetch = real;
  }
}

test("the cancel is asked of the chat's own address, with the turn's token", async () => {
  await withFetch(
    () => Response.json({ state: "stopping" }),
    async (calls) => {
      const ok = await cancelTurn(
        { endpoint: "https://api.example.com/accounts/a-1/ai/chat/", getToken: async () => "tok" },
        "t-1"
      );
      assert.equal(ok, true);
      assert.equal(calls.length, 1);
      assert.equal(calls[0]!.url, "https://api.example.com/accounts/a-1/ai/chat/turns/t-1/cancel");
      assert.equal(calls[0]!.init.method, "POST");
      assert.deepEqual(calls[0]!.init.headers, { authorization: "Bearer tok" });
      assert.equal(calls[0]!.init.credentials, "same-origin");
    }
  );
});

test("anything but `stopping` is a no: the window then stops reading", async () => {
  for (const answer of [
    () => Response.json({ state: "cannot_stop" }, { status: 409 }),
    () => Response.json({ state: "not_running" }),
    () => new Response("not found", { status: 404 }),
    () => Promise.reject(new TypeError("Failed to fetch")),
  ])
    await withFetch(answer, async () => {
      assert.equal(await cancelTurn({ endpoint: "/chat" }, "t-1"), false);
    });
  // A token step that throws is a no too, never a throw out of Stop.
  await withFetch(
    () => Response.json({ state: "stopping" }),
    async (calls) => {
      assert.equal(
        await cancelTurn({ endpoint: "/chat", getToken: () => Promise.reject(new Error("x")) }, "t-1"),
        false
      );
      assert.equal(calls.length, 0);
    }
  );
  assert.ok(STOP_READS_ON_MS >= 5_000 && STOP_READS_ON_MS <= 30_000);
});

// ── In a browser ────────────────────────────────────────────────────────────

const P = "sgiant-aiw";
/** `cancel`: what the server answers a cancel. `named`: whether it sends the
 *  turn frame. `ended`: the turn ended before the cut arrived. */
const MOUNT = (o: { cancel: "stopping" | "cannot_stop"; named: boolean; ended?: boolean }) => `(() => {
  const T = (window.T = { aborted: false, cancels: [], cut: false });
  window.fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith("/cancel")) {
      T.cancels.push({ url, auth: (init.headers || {}).authorization || null });
      T.cut = ${o.cancel === "stopping"};
      return new Response(JSON.stringify({ state: "${o.cancel}" }), {
        status: ${o.cancel === "stopping" ? 200 : 409},
        headers: { "content-type": "application/json" },
      });
    }
    const body = JSON.parse(init.body);
    const enc = new TextEncoder();
    const signal = init.signal;
    const stream = new ReadableStream({
      async start(c) {
        signal.addEventListener("abort", () => { T.aborted = true; try { c.error(new DOMException("Aborted", "AbortError")); } catch {} });
        const send = (o) => { if (!signal.aborted) c.enqueue(enc.encode(JSON.stringify(o) + "\\n")); };
        ${o.named ? 'send({ type: "turn", turnId: "t-77" });' : ""}
        send({ threadId: body.threadId || "t-new" });
        for (const w of "One two three four five six seven eight nine ten".split(" ")) {
          if (signal.aborted) return;
          if (T.cut) {
            // The server cut the turn: the words already on their way, then
            // its end, saying so.
            await new Promise((r) => setTimeout(r, 80));
            send({ type: "text", d: "TAIL " });
            send({ type: "done", stopped: ${o.ended ? "false" : "true"} });
            c.close();
            return;
          }
          send({ type: "text", d: w + " " });
          await new Promise((r) => setTimeout(r, 120));
        }
        send({ type: "done" });
        if (!signal.aborted) c.close();
      },
    });
    return new Response(stream, { status: 200 });
  };
  T.w = SgiantAiWidget.createAiChatWidget({
    endpoint: "/accounts/a-1/ai/chat",
    getToken: async () => "tok",
    greeting: "Hello",
    storageNamespace: "tstop",
    layoutKey: "tstop",
    openEventName: "tstop:open",
    advancedView: true,
  });
  window.dispatchEvent(new CustomEvent("tstop:open", { detail: { advanced: true } }));
})()`;

const LOOK = `(() => {
  const P = "${P}";
  const panel = document.querySelector("." + P + "-panel");
  const said = [...panel.querySelectorAll("." + P + "-msg." + P + "-assistant")].pop();
  return {
    said: said ? said.textContent : "",
    stopped: !!panel.querySelector("." + P + "-stopped"),
    send: panel.querySelector("." + P + "-send").textContent,
    aborted: window.T.aborted,
    cancels: window.T.cancels,
  };
})()`;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const look = (page: Page) => page.evaluate<Record<string, any>>(LOOK);
const askAndStop = async (page: Page) => {
  await page.evaluate(
    `(() => { const i = document.querySelector(".${P}-input"); i.value = "How was October?"; i.closest("form").requestSubmit(); })()`
  );
  await wait(450);
  await page.evaluate(`document.querySelector(".${P}-send").click()`);
  await wait(600);
};

test("in a browser: Stop asks the server, and the window shows what the server kept", { skip: SKIP_WITHOUT_CHROME }, async (t) => {
  await withBrowser(async (page) => {
    await t.test("the server cuts the turn: the window reads on to its end and says it was stopped", async () => {
      await page.open([1440, 900]);
      await page.evaluate(MOUNT({ cancel: "stopping", named: true }));
      await wait(300);
      await askAndStop(page);
      const s = await look(page);
      assert.deepEqual(s.cancels, [{ url: "/accounts/a-1/ai/chat/turns/t-77/cancel", auth: "Bearer tok" }]);
      assert.equal(s.aborted, false, "the reading was not ended: the server ends the turn");
      assert.match(s.said, /^One two/);
      assert.match(s.said, /TAIL/, "the words the server kept are on screen");
      assert.doesNotMatch(s.said, /ten/);
      assert.equal(s.stopped, true);
      assert.equal(s.send, "Send");
    });

    await t.test("the server cannot cut it: the reading ends at once, as before", async () => {
      await page.open([1440, 900]);
      await page.evaluate(MOUNT({ cancel: "cannot_stop", named: true }));
      await wait(300);
      await askAndStop(page);
      const s = await look(page);
      assert.equal(s.cancels.length, 1);
      assert.equal(s.aborted, true);
      assert.match(s.said, /^One two/);
      assert.doesNotMatch(s.said, /TAIL|ten/);
      assert.equal(s.stopped, true);
    });

    await t.test("a server that names no turn is not asked: the reading ends", async () => {
      await page.open([1440, 900]);
      await page.evaluate(MOUNT({ cancel: "stopping", named: false }));
      await wait(300);
      await askAndStop(page);
      const s = await look(page);
      assert.deepEqual(s.cancels, []);
      assert.equal(s.aborted, true);
      assert.equal(s.stopped, true);
    });

    await t.test("the turn ended before the cut: an answer like any, with no stopped note", async () => {
      await page.open([1440, 900]);
      await page.evaluate(MOUNT({ cancel: "stopping", named: true, ended: true }));
      await wait(300);
      await askAndStop(page);
      const s = await look(page);
      assert.equal(s.aborted, false);
      assert.match(s.said, /TAIL/);
      assert.equal(s.stopped, false);
    });
  });
});
