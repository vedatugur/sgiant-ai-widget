import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SKIP_WITHOUT_CHROME, withBrowser, type Page } from "./aiw-browser.ts";
import { widgetSrc } from "./aiw-source.ts";
import { WIDGET_LABELS } from "../dist/labels.js";
import { WIDGET_LABELS_TR } from "../dist/labels-tr.js";
import { advancedCss } from "../dist/advanced-styles.js";
import { offersAdvancedView } from "../dist/advanced-view.js";
import {
  newAnswerIds,
  shellGroups,
  shellMode,
} from "../dist/advanced-shell.js";

/**
 * THE ADVANCED VIEW IS THE PANEL'S AND THE HUB'S (sgiant-platform#702).
 *
 * The owner-approved picture (examples/advanced-view-prototype/) built into
 * the window: the conversation list on the left (folds, opens over the chat
 * on a laptop, a drawer on a phone; search, star, a dot on a conversation
 * with a new answer), no bar over the chat, the page on the right at a fixed
 * width that the assistant can open itself, a status line and a Stop button,
 * a new-chat screen, and every colour, radius, font and duration a --aiw-*
 * token. A visitor's small window on a customer's site is exactly as it was.
 */
const read = (f: string) => readFileSync(join(import.meta.dirname, "..", f), "utf8");

test("the new sentences, word for word, in English and Turkish", () => {
  const words: Record<string, [string, string]> = {
    advBack: ["Back to the app", "Uygulamaya dön"],
    sideLabel: ["Conversations", "Sohbetler"],
    sideOpen: ["Open the conversation list", "Sohbet listesini aç"],
    sideCollapse: ["Collapse the conversation list", "Sohbet listesini daralt"],
    sideClose: ["Close the conversation list", "Sohbet listesini kapat"],
    searchConversations: ["Search conversations", "Sohbetlerde ara"],
    searchNoMatch: ["No conversation matches this search.", "Bu aramayla eşleşen sohbet yok."],
    starredBucket: ["Starred", "Yıldızlı"],
    newAnswer: ["New answer", "Yeni cevap"],
    paneBackToChat: ["Back to the conversation", "Sohbete dön"],
    paneChat: ["Chat", "Sohbet"],
    statusThinking: ["Thinking…", "Düşünüyor…"],
    stop: ["Stop", "Durdur"],
    stopAnswer: ["Stop the answer", "Cevabı durdur"],
    stopped: ["You stopped this answer.", "Bu cevabı durdurdunuz."],
  };
  for (const [key, [en, tr]] of Object.entries(words)) {
    assert.equal((WIDGET_LABELS as Record<string, string>)[key], en, key);
    assert.equal((WIDGET_LABELS_TR as Record<string, string>)[key], tr, key);
  }
});

test("who gets the advanced view: a page beside the chat, or a host that asks; never a visitor", () => {
  assert.equal(offersAdvancedView({ endpoint: "/x" }), false);
  assert.equal(offersAdvancedView({ endpoint: "/x", getAdvancedUrl: () => "/a" }), true);
  assert.equal(offersAdvancedView({ endpoint: "/x", advancedView: true }), true);
  // Send becomes Stop only in those windows.
  assert.match(widgetSrc, /const inApp = offersAdvancedView\(opts\);/);
  assert.match(widgetSrc, /const canStop =\s*inApp && !opts\.preview && turnStops\.has/);
});

test("three layouts from the window's size, at the prototype's breakpoints", () => {
  assert.equal(shellMode(1440, 900), "desk");
  assert.equal(shellMode(1200, 800), "desk");
  assert.equal(shellMode(1199, 800), "laptop");
  assert.equal(shellMode(820, 760), "laptop");
  assert.equal(shellMode(819, 1024), "phone");
  assert.equal(shellMode(390, 844), "phone");
  assert.equal(shellMode(844, 390), "phone", "a phone on its side is a phone");
});

test("the new-answer dot: only news, never the conversation on screen, never a first sight", () => {
  const threads = [
    { id: "a", updatedAt: "2026-11-23T10:00:00Z" },
    { id: "b", updatedAt: "2026-11-23T11:00:00Z" },
    { id: "c", updatedAt: "2026-11-23T12:00:00Z" },
    { id: "d", updatedAt: "2026-11-23T12:00:00Z" },
  ];
  const seen = { a: "2026-11-23T09:00:00Z", b: "2026-11-23T11:00:00Z", d: "2026-11-23T08:00:00Z" };
  // a changed since it was seen; b did not; c was never seen; d is on screen.
  assert.deepEqual([...newAnswerIds(threads, seen, new Set(), "d")], ["a"]);
  // An answer that finished here while another conversation was open.
  assert.deepEqual([...newAnswerIds(threads, seen, new Set(["c"]), "d")].sort(), ["a", "c"]);
});

test("the list: starred first, then by time; the search reads titles in the page's language", () => {
  const now = new Date().toISOString();
  const threads = [
    { id: "1", title: "Haziran fiyatları", updatedAt: now },
    { id: "2", title: "İptal oranı", updatedAt: now, starred: true },
    { id: "3", title: null, updatedAt: now },
  ];
  const g = shellGroups(threads, (t) => Boolean(t.starred), "", "tr", "Adsız");
  assert.deepEqual(g.map((x) => [x.bucket, x.items.map((t) => t.id)]), [
    ["starred", ["2"]],
    ["bucketToday", ["1", "3"]],
  ]);
  // Turkish dotted capital I folds to i in Turkish, so "iptal" finds "İptal".
  assert.deepEqual(
    shellGroups(threads, () => false, "iptal", "tr", "Adsız").flatMap((x) => x.items.map((t) => t.id)),
    ["2"]
  );
  assert.deepEqual(shellGroups(threads, () => false, "adsız", "tr", "Adsız")[0].items.map((t) => t.id), ["3"]);
  assert.deepEqual(shellGroups(threads, () => false, "zzz", "tr", "Adsız"), []);
});

test("every colour, radius, font and duration of the view is a token", () => {
  const css = advancedCss();
  assert.deepEqual(css.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [], [], "a literal colour");
  assert.deepEqual(css.match(/rgba?\(/g) ?? [], [], "a literal colour");
  // Durations: only through var(); "0s" is the visibility switch, not motion.
  const literal = (css.match(/[\s(:,]\.?\d+(?:\.\d+)?m?s\b/g) ?? []).filter((d) => !/\b0s$/.test(d.trim()));
  assert.deepEqual(literal, [], "a literal duration");
  for (const m of css.matchAll(/border-radius:([^;}]+)/g))
    assert.ok(/var\(--aiw-radius|50%/.test(m[1]!), `radius ${m[1]}`);
  for (const m of css.matchAll(/font-family:([^;}]+)/g))
    assert.ok(/var\(--aiw-font|inherit/.test(m[1]!), `font ${m[1]}`);
  // The tokens exist, with a value, on the window's roots.
  const sheet = read("src/styles.ts");
  for (const t of ["--aiw-font-family", "--aiw-font-answer", "--aiw-dur-in", "--aiw-dur-out", "--aiw-ease", "--aiw-side-w", "--aiw-rail-w", "--aiw-pane-w", "--aiw-hit", "--aiw-bubble", "--aiw-mark", "--aiw-scrim"])
    assert.match(sheet, new RegExp(`${t}:[^;]+;`), t);
  // Dark has its own reading of the two that are not already scheme tokens.
  assert.match(sheet, /\$\{panel\}\{--aiw-bubble:#2e2e2c;--aiw-scrim:rgba\(0,0,0,\.55\)\}/);
});

test("reduced motion reaches the view: its keyframes are redefined, its slides switched off", () => {
  const block = widgetSrc.match(/@media \(prefers-reduced-motion:reduce\)\{([\s\S]*?)\n\}/)![1]!;
  for (const k of ["panein", "sidein", "sheetin", "ring", "shim"])
    assert.ok(block.includes(`@keyframes \${PREFIX}-${k}{`), k);
  assert.match(block, /\.\$\{PREFIX\}-side,\.\$\{PREFIX\}-scrim\{transition:none!important\}/);
  // Nothing in the view transitions a width.
  assert.doesNotMatch(advancedCss(), /transition:[^;}]*\bwidth\b/);
});

test("a stop ends the reading, keeps what was shown, and does not reload the conversation over it", () => {
  const stream = read("src/stream.ts");
  assert.match(stream, /signal: ends\.signal,/);
  // A stop is not a lost connection: the request's end is caught where it
  // happens, so nothing marks the api unreachable or draws an error.
  assert.match(stream, /const stopEnds = \(e: unknown\): null => \{\s*if \(stopped\) return null;\s*throw e;/);
  assert.match(stream, /\}\)\.catch\(stopEnds\);/);
  assert.match(stream, /await reader\.read\(\)\.catch\(stopEnds\)/);
  // A stop the server did not make keeps what was on screen and no more,
  // and reloads nothing over it (the-server-cuts-a-stopped-turn.test.ts
  // holds the stop the server makes).
  assert.match(stream, /if \(stopped && !cutOnServer\)\s*assistantRaw = assistantRaw\.slice\(0, shownLen\);/);
  assert.match(stream, /\(!stopped \|\| cutOnServer\) &&\s*!hasLiveProposal/);
});

test("the assistant opens the page itself, but never over a phone's conversation", () => {
  const adv = read("src/advanced-view.ts");
  const reveal = adv.slice(adv.indexOf("const revealPane = "));
  assert.match(reveal.slice(0, 200), /if \(!getAdvanced\(\) \|\| ctx\.isPhone\(\)\) return;/);
  assert.match(adv, /navigateFrame\(opts\.getAdvancedUrl\(relPath\)\);[\s\S]{0,200}revealPane\(\);/);
});

test("the approved picture and the two examples are in the repository", () => {
  const proto = read("examples/advanced-view-prototype/index.html");
  assert.match(proto, /<title>Gelişmiş görünüm v2<\/title>/);
  const ex = read("examples/advanced.html");
  assert.match(ex, /renderAdvancedFooter: accountMenu/);
  assert.match(ex, /Acme Hotel/);
  assert.match(ex, /getAdvancedUrl:/);
  assert.match(read("examples/acme-app.html"), /Season report/);
});

// ── In a browser ────────────────────────────────────────────────────────────

const P = "sgiant-aiw";
const MOUNT = (advanced: boolean) => `(() => {
  const T = (window.T = { sent: 0, stopped: false });
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const body = JSON.parse(init.body);
    T.sent++;
    const enc = new TextEncoder();
    const signal = init.signal;
    const stream = new ReadableStream({
      async start(c) {
        signal.addEventListener("abort", () => { T.stopped = true; try { c.error(new DOMException("Aborted", "AbortError")); } catch {} });
        const send = (o) => { if (!signal.aborted) c.enqueue(enc.encode(JSON.stringify(o) + "\\n")); };
        send({ threadId: body.threadId || "t-new" });
        send({ type: "activity", callId: "a", label: "Reading the report", status: "running" });
        await new Promise((r) => setTimeout(r, 250));
        for (const w of "One two three four five six seven eight nine ten".split(" ")) {
          if (signal.aborted) return;
          send({ type: "text", d: w + " " });
          await new Promise((r) => setTimeout(r, 120));
        }
        send({ type: "done" });
        if (!signal.aborted) c.close();
      },
    });
    return new Response(stream, { status: 200 });
  };
  const now = new Date().toISOString();
  T.w = SgiantAiWidget.createAiChatWidget({
    endpoint: "/chat",
    greeting: "Hello",
    storageNamespace: "t702",
    layoutKey: "t702",
    openEventName: "t702:open",
    getSuggestions: () => ["First question"],
    ${advanced ? "advancedView: true," : ""}
    ${advanced ? `listThreads: async () => [
      { id: "t-1", title: "Season report", updatedAt: now },
      { id: "t-2", title: "June prices", updatedAt: now },
    ],
    loadThread: async () => [{ role: "user", content: "Q" }, { role: "assistant", content: "A" }],` : ""}
  });
  window.dispatchEvent(new CustomEvent("t702:open", { detail: { advanced: ${advanced} } }));
})()`;

const LOOK = `(() => {
  const P = "${P}";
  const panel = document.querySelector("." + P + "-panel");
  const send = panel.querySelector("." + P + "-send");
  const line = panel.querySelector("." + P + "-turnline");
  return {
    advanced: panel.classList.contains(P + "-advanced"),
    mode: panel.dataset.aiwMode || null,
    blank: panel.classList.contains(P + "-blank"),
    listOpen: panel.classList.contains(P + "-side-open"),
    side: !!panel.querySelector("." + P + "-side"),
    rows: [...panel.querySelectorAll("." + P + "-side-title")].map((n) => n.textContent),
    send: send.textContent,
    sendLabel: send.getAttribute("aria-label"),
    sendDisabled: send.disabled,
    line: line && !line.hidden ? line.textContent : null,
    stopped: !!panel.querySelector("." + P + "-stopped"),
    noResponse: panel.textContent.includes("(no response)"),
    header: getComputedStyle(panel.querySelector("." + P + "-header")).display,
    stars: (() => { try { return localStorage.getItem("t702:stars:t702"); } catch { return "blocked"; } })(),
  };
})()`;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const look = (page: Page) => page.evaluate<Record<string, any>>(LOOK);
const ask = (page: Page, q: string) =>
  page.evaluate(`(() => { const i = document.querySelector(".${P}-input"); i.value = ${JSON.stringify(q)}; i.closest("form").requestSubmit(); })()`);

test("in a browser: the advanced view and the visitor's window", { skip: SKIP_WITHOUT_CHROME }, async (t) => {
  await withBrowser(async (page) => {
    await t.test("desk: list beside the chat, no bar, the new-chat screen", async () => {
      await page.open([1440, 900]);
      await page.evaluate(MOUNT(true));
      await wait(400);
      const s = await look(page);
      assert.equal(s.advanced, true);
      assert.equal(s.mode, "desk");
      assert.equal(s.listOpen, true);
      assert.equal(s.header, "none", "the bar over the chat is drawn");
      assert.equal(s.blank, true);
      assert.deepEqual(s.rows, ["Season report", "June prices"]);
    });

    await t.test("search narrows the list; a star moves a row to the top and is kept in this browser", async () => {
      await page.evaluate(`(() => { const q = document.querySelector(".${P}-side-q"); q.value = "june"; q.dispatchEvent(new Event("input")); })()`);
      assert.deepEqual((await look(page)).rows, ["June prices"]);
      await page.evaluate(`(() => { const q = document.querySelector(".${P}-side-q"); q.value = ""; q.dispatchEvent(new Event("input")); })()`);
      await page.evaluate(`document.querySelectorAll(".${P}-side-star")[1].click()`);
      const s = await look(page);
      assert.deepEqual(s.rows, ["June prices", "Season report"]);
      assert.equal(s.stars, JSON.stringify(["t-2"]));
    });

    await t.test("Send is Stop while the answer comes; a stop keeps the words and says so", async () => {
      await ask(page, "How was October?");
      await wait(120);
      let s = await look(page);
      assert.equal(s.send, "Stop");
      assert.equal(s.sendLabel, "Stop the answer");
      assert.equal(s.sendDisabled, false);
      assert.equal(s.line, "Reading the report");
      await wait(600);
      await page.evaluate(`document.querySelector(".${P}-send").click()`);
      await wait(300);
      s = await look(page);
      assert.equal(await page.evaluate("T.stopped"), true, "the request was not ended");
      assert.equal(s.stopped, true);
      assert.equal(s.noResponse, false);
      assert.equal(s.send, "Send");
      assert.equal(s.line, null);
      const said = await page.evaluate<string>(`[...document.querySelectorAll(".${P}-msg.${P}-assistant")].pop().textContent`);
      assert.match(said, /^One two/);
      assert.doesNotMatch(said, /ten/);
    });

    await t.test("laptop: the list folds to a rail and opens over the chat; Escape closes it", async () => {
      await page.open([1100, 760]);
      await page.evaluate(MOUNT(true));
      await wait(300);
      let s = await look(page);
      assert.equal(s.mode, "laptop");
      assert.equal(s.listOpen, false);
      await page.evaluate(`document.querySelectorAll(".${P}-side-rail button")[2].click()`);
      s = await look(page);
      assert.equal(s.listOpen, true);
      await page.evaluate(`document.querySelector(".${P}-panel").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
      assert.equal((await look(page)).listOpen, false);
    });

    await t.test("phone: the list is a drawer behind a backdrop", async () => {
      await page.open([390, 844]);
      await page.evaluate(MOUNT(true));
      await wait(300);
      assert.equal((await look(page)).mode, "phone");
      await page.evaluate(`document.querySelector(".${P}-ctop-side").click()`);
      await wait(50);
      const scrim = await page.evaluate<boolean>(`document.querySelector(".${P}-scrim").classList.contains("${P}-scrim-on")`);
      assert.equal(scrim, true);
      await page.evaluate(`document.querySelector(".${P}-scrim").click()`);
      assert.equal((await look(page)).listOpen, false);
    });

    await t.test("a visitor's window: no list, no row, and Send never becomes Stop", async () => {
      await page.open([1280, 800]);
      await page.evaluate(MOUNT(false));
      await wait(200);
      let s = await look(page);
      assert.equal(s.advanced, false);
      assert.equal(s.side, false);
      assert.notEqual(s.header, "none");
      await ask(page, "Hi");
      await wait(150);
      s = await look(page);
      assert.equal(s.send, "Send");
      assert.equal(s.sendDisabled, true);
      assert.equal(s.sendLabel, null);
    });
  });
});
