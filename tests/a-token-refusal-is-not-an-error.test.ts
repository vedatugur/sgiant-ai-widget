import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { widgetSrc } from "./aiw-source.ts";
import { SKIP_WITHOUT_CHROME, withBrowser, type Page } from "./aiw-browser.ts";
import { readTokenRefusal } from "../dist/token-refusal.js";
import * as entry from "../dist/index.js";

/**
 * THE TOKEN STEP MAY ANSWER "NOT NOW" (sgiant-platform#620).
 *
 * In a customer's wp-admin the assistant answered a question with "AYCA hit a
 * snag and couldn't answer. Please try again." over "Server error (401)", a
 * "Try again" button, and an offline mark on the launcher. Nothing had hit a
 * snag. The person had not connected their sgiant account, and the one thing
 * that would have helped, a button to connect, had nowhere to go.
 *
 * The host can now say so: `getToken` rejects with a `userMessage` and,
 * optionally, a button. These pin what that must and must not do, and that a
 * host which says nothing of the kind sees exactly what it saw before.
 */
const INDEX = readFileSync(
  join(import.meta.dirname, "..", "src", "index.ts"),
  "utf8"
);
/** Source with comments removed, for assertions about the code itself. */
const CODE = INDEX.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");

const A = "AYCA'yı kullanmak için sgiant hesabınızı bağlayın.";
const A_LABEL = "sgiant'a bağlan";
const B =
  "sgiant hesabınız bağlı, ancak bu sitenin ait olduğu hesaba erişiminiz yok. O hesabın bir yöneticisinden sizi eklemesini isteyin.";

test("a rejection with a sentence is read, from a plain object or an Error alike", () => {
  const onClick = (): boolean => true;
  // What a plain script with no import can throw: an object literal.
  assert.deepEqual(
    readTokenRefusal({ userMessage: A, action: { label: A_LABEL, onClick } }),
    { userMessage: A, action: { label: A_LABEL, onClick } }
  );
  // Or an Error with the properties set on it. No class, no instanceof.
  const thrown = Object.assign(new Error("409 no_access"), { userMessage: `  ${B}  ` });
  assert.deepEqual(readTokenRefusal(thrown), { userMessage: B });
  // An object that was never near this package's prototype chain.
  const bare = Object.assign(Object.create(null), { userMessage: B });
  assert.deepEqual(readTokenRefusal(bare), { userMessage: B });
  assert.doesNotMatch(
    readFileSync(join(import.meta.dirname, "..", "src", "token-refusal.ts"), "utf8").replace(
      /\/\*[\s\S]*?\*\/|\/\/.*$/gm,
      ""
    ),
    /instanceof|\bclass\b/
  );
});

test("nothing else on a rejection is taken for a sentence, so it stays a failure", () => {
  // The plugin's "sgiant did not answer" case: a retry is right there.
  assert.equal(readTokenRefusal(new Error("Server error (503).")), null);
  assert.equal(readTokenRefusal({ message: "Not connected." }), null);
  assert.equal(readTokenRefusal({ error: "not_connected" }), null);
  for (const userMessage of ["", "   ", 404, null, undefined, {}, ["x"]])
    assert.equal(readTokenRefusal({ userMessage }), null);
  for (const thrown of [null, undefined, "boom", 500, true])
    assert.equal(readTokenRefusal(thrown), null);
});

test("half a button is no button, and the sentence still shows", () => {
  const onClick = (): boolean => true;
  for (const action of [
    { label: A_LABEL },
    { onClick },
    { label: "   ", onClick },
    { label: 7, onClick },
    { label: A_LABEL, onClick: "open" },
    null,
    "connect",
  ])
    assert.deepEqual(readTokenRefusal({ userMessage: A, action }), { userMessage: A });
});

test("only a SEND draws the notice: an upload, and everything else, stays silent", () => {
  // The widget asks for a token in two places, a send and an upload.
  assert.equal((CODE.match(/opts\.getToken\(\)/g) ?? []).length, 2);
  // The rejection is read for a sentence in one of them, and the notice is
  // drawn from one place. A refused upload falls into the catch it always
  // fell into, which shows nothing and uploads nothing; loading past chats and
  // the live channel never come near either function.
  assert.equal((CODE.match(/readTokenRefusal\(/g) ?? []).length, 1);
  assert.equal((CODE.match(/showTokenNotice\(/g) ?? []).length, 2); // defined, called once
  const upload = CODE.slice(
    CODE.indexOf("async function uploadFiles("),
    CODE.indexOf("if (opts.uploadEndpoint || opts.getUploadEndpoint)")
  );
  assert.ok(upload.length > 500, "could not find uploadFiles");
  assert.doesNotMatch(upload, /TokenNotice|readTokenRefusal/);
});

test("the handler is called first in the click, with nothing ahead of it", () => {
  // A browser allows window.open only inside the click itself. One `await`,
  // or one microtask, ahead of the host's handler and its popup is blocked.
  const click = CODE.slice(
    CODE.indexOf('btn.addEventListener("click", () => {', CODE.indexOf("function showTokenNotice(")),
    CODE.indexOf("wrap.append(btn);")
  );
  assert.ok(click.length > 300, "could not find the notice button's click handler");
  const call = click.indexOf("action.onClick()");
  assert.notEqual(call, -1);
  assert.doesNotMatch(click.slice(0, call), /await|\.then\(|setTimeout|queueMicrotask|Promise/);
  // And only `true` is success: nothing looser.
  assert.match(click, /\(v\) => v === true/);
});

test("a refusal says nothing about whether the api can be reached", () => {
  // The offline mark comes from noteApiResult("unreachable"), and the snag
  // card from `failure`. A refusal sets neither.
  const at = CODE.indexOf("refused = readTokenRefusal(thrown);");
  const handler = CODE.slice(CODE.indexOf("} catch (err) {", at), CODE.indexOf("} finally {", at));
  assert.match(handler, /^\} catch \(err\) \{\s*if \(!refused\) \{[\s\S]*noteApiResult\("unreachable"\);[\s\S]*failure = [^;]*;\s*\}\s*$/);
});

test("the widget adds no words of its own, and the button is not the assistant's to press", () => {
  const notice = CODE.slice(
    CODE.indexOf("function showTokenNotice("),
    CODE.indexOf("function showError(")
  );
  assert.ok(notice.length > 500, "could not find showTokenNotice");
  // The sentence and the label are the host's, in the page's language.
  assert.doesNotMatch(notice, /\bL\(/);
  // Text, never markup.
  assert.doesNotMatch(notice, /innerHTML/);
  // Not offered as a control: it opens a window and needs a person's click.
  assert.doesNotMatch(notice, /data-ai-target|WIDGET_TARGETS/);
  assert.equal(typeof entry.readTokenRefusal, "function");
  assert.match(widgetSrc, /export interface TokenRefusal/);
});

test("the readme says how to refuse, and what an older widget does with it", () => {
  const readme = readFileSync(join(import.meta.dirname, "..", "README.md"), "utf8");
  assert.match(readme, /## When there is no token to give/);
  assert.match(readme, /userMessage/);
  assert.match(readme, /Only `true` counts/);
  assert.match(readme, /older than\s+1\.20\.0/);
});

// ── In a browser ───────────────────────────────────────────────────────────

/** Runs in the page: a widget whose token step answers as `T.mode` says. */
const MOUNT = (a: string, aLabel: string, b: string): void => {
  const T = ((globalThis as any).T = {
    mode: "A",
    fetches: [] as Array<{ auth: string | null; content: unknown }>,
    clicks: [] as boolean[],
    settle: null as null | ((v: unknown) => void),
  });
  (globalThis as any).fetch = async (input: any, init: any) => {
    const url = typeof input === "string" ? input : input.url;
    if (!String(url).includes("/demo-chat")) return new Response("{}", { status: 404 });
    T.fetches.push({
      auth: new Headers(init.headers).get("authorization"),
      content: JSON.parse(init.body).content,
    });
    const lines = [{ threadId: "t1" }, { type: "text", d: "Merhaba." }, { type: "done" }];
    return new Response(lines.map((l) => JSON.stringify(l) + "\n").join(""), {
      status: 200,
      headers: { "content-type": "application/x-ndjson" },
    });
  };
  const w = (globalThis as any).SgiantAiWidget.createAiChatWidget({
    endpoint: "/demo-chat",
    title: "AYCA",
    uploadEndpoint: "/demo-upload",
    getToken: () => {
      if (T.mode === "ok") return Promise.resolve("tok");
      if (T.mode === "old") return Promise.reject(new Error("Server error (401)."));
      if (T.mode === "B")
        return Promise.reject(Object.assign(new Error("409 no_access"), { userMessage: b }));
      // A plain object, as a script with no import would throw it.
      return Promise.reject({
        userMessage: a,
        action: {
          label: aLabel,
          onClick: () => {
            // What a popup needs: is this still the click?
            T.clicks.push((navigator as any).userActivation.isActive);
            return new Promise((r) => (T.settle = r));
          },
        },
      });
    },
  });
  w.open();
};

/** Runs in the page: what a person, and a screen reader, would find. */
const LOOK = async (): Promise<{
  notices: Array<{ text: string; button: string | null; disabled: boolean; busy: boolean }>;
  noticeInLiveRegion: boolean;
  noticeRole: string | null;
  errorCards: number;
  panelText: string;
  retry: boolean;
  offline: boolean;
  asked: number;
  sendDisabled: boolean;
  fetches: Array<{ auth: string | null; content: unknown }>;
  clicks: boolean[];
  button: { x: number; y: number } | null;
  focus: string;
}> => {
  await new Promise((r) => setTimeout(r, 200));
  const P = "sgiant-aiw";
  const panel = document.querySelector(`.${P}-panel`)!;
  const notices = [...panel.querySelectorAll(`.${P}-notice`)];
  const btn = panel.querySelector(`.${P}-notice-btn`) as HTMLButtonElement | null;
  const r = btn?.getBoundingClientRect();
  const active = document.activeElement as HTMLElement | null;
  return {
    notices: notices.map((n) => {
      const b = n.querySelector("button");
      return {
        text: n.querySelector(`.${P}-notice-text`)!.textContent!,
        button: b ? b.textContent : null,
        disabled: b ? b.disabled : false,
        busy: b ? b.getAttribute("aria-busy") === "true" : false,
      };
    }),
    noticeInLiveRegion: notices.length ? !!notices[0]!.closest('[aria-live="polite"]') : false,
    noticeRole: notices.length ? notices[0]!.getAttribute("role") : null,
    errorCards: panel.querySelectorAll(`.${P}-error`).length,
    panelText: panel.textContent!,
    retry: !!panel.querySelector(`.${P}-error-retry`),
    offline: !!document.querySelector(`.${P}-bubble-offline`),
    asked: panel.querySelectorAll(`.${P}-msg.${P}-user`).length,
    sendDisabled: (panel.querySelector('button[type="submit"]') as HTMLButtonElement).disabled,
    fetches: (globalThis as any).T.fetches,
    clicks: (globalThis as any).T.clicks,
    button: r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null,
    focus: active?.getAttribute("data-ai-target") ?? active?.tagName ?? "",
  };
};

/** Runs in the page: type a question and submit it, as the composer does. */
const ASK = (q: string): void => {
  const input = document.querySelector('[data-ai-target="widget-composer"]') as HTMLInputElement;
  input.value = q;
  input.closest("form")!.requestSubmit();
};

const Q = "Bu ay kaç rezervasyon aldık?";

async function mounted(page: Page, mode: string): Promise<void> {
  await page.open([1280, 800]);
  await page.evaluate(`(${MOUNT})(${JSON.stringify(A)}, ${JSON.stringify(A_LABEL)}, ${JSON.stringify(B)})`);
  await page.evaluate(`T.mode = ${JSON.stringify(mode)}`);
}
const look = (page: Page) => page.evaluate<Awaited<ReturnType<typeof LOOK>>>(`(${LOOK})()`);
const ask = (page: Page, q: string) => page.evaluate(`(${ASK})(${JSON.stringify(q)})`);
const settle = (page: Page, v: string, mode?: string) =>
  page.evaluate(`${mode ? `T.mode = ${JSON.stringify(mode)};` : ""} T.settle(${v})`);

test("in a browser: the whole of it, from the refusal to the question being sent", { skip: SKIP_WITHOUT_CHROME }, async (t) => {
  await withBrowser(async (page) => {
    await t.test("not connected: the sentence and the button, and none of the error card", async () => {
      await mounted(page, "A");
      await ask(page, Q);
      const s = await look(page);
      assert.deepEqual(s.notices, [{ text: A, button: A_LABEL, disabled: false, busy: false }]);
      assert.equal(s.errorCards, 0);
      assert.doesNotMatch(s.panelText, /snag|Try again|Report/);
      assert.equal(s.offline, false, "the launcher was marked offline");
      // Nothing was sent, and the question is on screen once, as theirs.
      assert.deepEqual(s.fetches, []);
      assert.equal(s.asked, 1);
      assert.ok(s.panelText.includes(Q));
      assert.equal(s.sendDisabled, false, "the composer was left locked");
      // Read out by the conversation's own live region, once, not as an alert.
      assert.equal(s.noticeInLiveRegion, true);
      assert.equal(s.noticeRole, null);
    });

    await t.test("the click reaches the handler as a click; while it runs nothing is sent", async () => {
      await mounted(page, "A");
      await ask(page, Q);
      const before = await look(page);
      await page.click(before.button!.x, before.button!.y);
      const during = await look(page);
      assert.deepEqual(during.clicks, [true], "the handler did not run inside the click");
      assert.deepEqual(during.notices, [{ text: A, button: A_LABEL, disabled: true, busy: true }]);
      assert.equal(during.sendDisabled, true);
      // A second question typed meanwhile is not sent and not drawn.
      await ask(page, "ikinci soru");
      // A second press does not call the handler again.
      await page.click(before.button!.x, before.button!.y);
      const still = await look(page);
      assert.deepEqual(still.fetches, []);
      assert.equal(still.asked, 1);
      assert.deepEqual(still.clicks, [true]);
    });

    await t.test("true: the held question is sent, once, without being typed or drawn again", async () => {
      await mounted(page, "A");
      await ask(page, Q);
      const before = await look(page);
      await page.click(before.button!.x, before.button!.y);
      await settle(page, "true", "ok");
      const after = await look(page);
      assert.deepEqual(after.fetches, [{ auth: "Bearer tok", content: Q }]);
      assert.equal(after.asked, 1, "the question was drawn a second time");
      assert.deepEqual(after.notices, []);
      assert.ok(after.panelText.includes("Merhaba."));
      assert.equal(after.focus, "widget-composer", "focus was lost with the button");
      assert.equal(after.sendDisabled, false);
    });

    for (const [name, value] of [
      ["false", "false"],
      ["nothing at all (a blocked popup)", "undefined"],
      ["a rejection", "Promise.reject(new Error('blocked'))"],
    ] as const)
      await t.test(`${name}: the notice stays, the button works again, nothing is sent`, async () => {
        await mounted(page, "A");
        await ask(page, Q);
        const before = await look(page);
        await page.click(before.button!.x, before.button!.y);
        // Even though a token COULD now be had, the handler did not say so.
        await settle(page, value, "ok");
        const after = await look(page);
        assert.deepEqual(after.notices, [{ text: A, button: A_LABEL, disabled: false, busy: false }]);
        assert.deepEqual(after.fetches, []);
        assert.equal(after.asked, 1);
        assert.equal(after.sendDisabled, false);
        // And it really does work again.
        await page.click(before.button!.x, before.button!.y);
        assert.deepEqual((await look(page)).clicks, [true, true]);
      });

    await t.test("connected, then no access: the second sentence replaces the first", async () => {
      await mounted(page, "A");
      await ask(page, Q);
      const before = await look(page);
      await page.click(before.button!.x, before.button!.y);
      await settle(page, "true", "B");
      const after = await look(page);
      // One notice, B's, with no button: there is nothing to click.
      assert.deepEqual(after.notices, [{ text: B, button: null, disabled: false, busy: false }]);
      assert.deepEqual(after.fetches, []);
      assert.equal(after.asked, 1);
      assert.equal(after.errorCards, 0);
      assert.equal(after.offline, false);
      assert.equal(after.sendDisabled, false);
    });

    await t.test("a later send that gets a token takes the notice away", async () => {
      await mounted(page, "B");
      await ask(page, Q);
      assert.equal((await look(page)).notices.length, 1);
      await page.evaluate(`T.mode = "ok"`);
      await ask(page, "tekrar");
      const after = await look(page);
      assert.deepEqual(after.notices, []);
      assert.deepEqual(after.fetches, [{ auth: "Bearer tok", content: "tekrar" }]);
    });

    await t.test("a rejection WITHOUT a sentence is exactly the card it always was", async () => {
      await mounted(page, "old");
      await ask(page, Q);
      const s = await look(page);
      assert.deepEqual(s.notices, []);
      assert.equal(s.errorCards, 1);
      assert.match(s.panelText, /AYCA hit a snag and couldn't answer\. Please try again\./);
      assert.match(s.panelText, /Server error \(401\)\./);
      assert.equal(s.retry, true);
      // The offline mark too, which is also what proves the refusal cases
      // above are looking for it in the right place.
      assert.equal(s.offline, true);
      assert.deepEqual(s.fetches, []);
    });

    await t.test("a refusal during an upload shows nothing and uploads nothing", async () => {
      await mounted(page, "A");
      await page.evaluate(`(() => {
        const input = document.querySelector('.sgiant-aiw-panel input[type="file"]');
        const dt = new DataTransfer();
        dt.items.add(new File(["x"], "not.txt", { type: "text/plain" }));
        input.files = dt.files;
        input.dispatchEvent(new Event("change"));
      })()`);
      const s = await look(page);
      assert.deepEqual(s.notices, []);
      assert.equal(s.errorCards, 0);
      assert.deepEqual(s.fetches, []);
      assert.equal(s.offline, false);
    });
  });
});
