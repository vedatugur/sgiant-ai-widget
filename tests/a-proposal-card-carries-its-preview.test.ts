import test from "node:test";
import assert from "node:assert/strict";
// From the BUILD: src/ uses extensionless imports node cannot resolve.
import { buildThreadReplay } from "../dist/replay.js";
import { readProposalSummary } from "../dist/proposal-summary.js";
import { SKIP_WITHOUT_CHROME, withBrowser } from "./aiw-browser.ts";

/**
 * A PROPOSAL CARD CARRIES WHAT THE SERVER WORKED OUT FOR IT (3.3.0).
 *
 * A server can send a `preview` beside a proposed write: where the draft is,
 * and the call Apply should make. 3.2.0 kept seven fields of the frame and
 * dropped this one, phrased the card from `args` alone as plain text, and
 * applied without the proposal's own id. So a host could neither show the
 * draft a publish would make public nor apply the proposal the server kept.
 *
 * These pin the three halves: the preview travels (live and replayed), the
 * host gets it with the id, and a card the host phrases can hold one link,
 * drawn as text and never from an address that could run script.
 */

const PREVIEW = {
  kind: "publish",
  title: "October sales",
  draftPath: "/drafts/r1?draft=1",
  apply: { method: "POST", path: "/drafts/r1/publish", body: { proposalId: "p1" } },
};

/* ------------------------------------------------------------- the replay */

const T = (hms: string) => `2026-11-28T${hms}.000Z`;
const thread = (payload: Record<string, unknown>, status = "proposed") => ({
  messages: [
    { id: "u1", parentId: null, role: "user", content: "Publish it", createdAt: T("10:00:00") },
    { id: "a1", parentId: "u1", role: "assistant", content: "Here it is.", createdAt: T("10:00:30") },
  ],
  artifacts: [
    {
      id: "p1",
      kind: "proposal",
      status,
      createdAt: T("10:00:10"),
      payload: { name: "publish_draft", args: { id: "r1" }, ...payload },
    },
  ],
  activePath: ["u1", "a1"],
});
const proposalOf = (items: ReturnType<typeof buildThreadReplay>) =>
  items.find((it) => "kind" in it && it.kind === "proposal") as
    | { preview?: unknown; id: string }
    | undefined;

test("a saved proposal's preview replays exactly as it was saved", () => {
  const p = proposalOf(buildThreadReplay(thread({ preview: PREVIEW })));
  assert.ok(p, "the proposal is replayed");
  assert.deepEqual(p.preview, PREVIEW);
  // Opaque: any JSON value travels, the widget judges none of them.
  for (const preview of ["text", 3, false, null, [1, 2]])
    assert.deepEqual(proposalOf(buildThreadReplay(thread({ preview })))!.preview, preview);
});

test("a proposal saved without one replays as 3.2.0 replayed it", () => {
  const p = proposalOf(buildThreadReplay(thread({})));
  assert.ok(p);
  assert.equal("preview" in p, false);
});

/* ------------------------------------------------------ the host's answer */

test("a sentence is read as the sentence; an empty one says nothing", () => {
  assert.deepEqual(readProposalSummary("Publish October sales"), {
    text: "Publish October sales",
  });
  // Exactly what the card drew before, spaces and all.
  assert.deepEqual(readProposalSummary("  a\nb "), { text: "  a\nb " });
  for (const v of ["", null, undefined, 0, false, [], ["x"]])
    assert.equal(readProposalSummary(v), null, JSON.stringify(v));
});

test("a card keeps its title, text and a link to a site path or an http(s) page", () => {
  assert.deepEqual(
    readProposalSummary({
      title: "Publish October sales",
      text: "6 sections, version 2",
      link: { label: "See the draft", href: "/drafts/r1?draft=1" },
    }),
    {
      title: "Publish October sales",
      text: "6 sections, version 2",
      link: { href: "/drafts/r1?draft=1", label: "See the draft" },
    }
  );
  assert.deepEqual(
    readProposalSummary({ text: "x", link: { href: "https://example.com/d/1" } }),
    { text: "x", link: { href: "https://example.com/d/1" } }
  );
});

test("a link whose address could run script or leave by another door is dropped", () => {
  for (const href of [
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "//evil.example/x",
    "/\\evil.example/x",
    "drafts/r1",
    "ftp://example.com/x",
    "",
    42,
    null,
  ]) {
    const got = readProposalSummary({ text: "x", link: { href, label: "See" } });
    assert.deepEqual(got, { text: "x" }, String(href));
  }
  // A card that is nothing but a refused link is no card.
  assert.equal(readProposalSummary({ link: { href: "javascript:alert(1)" } }), null);
  // Parts that are not text are not drawn.
  assert.deepEqual(readProposalSummary({ title: 7, text: { a: 1 }, link: "x" }), null);
});

/* ---------------------------------------------------------- in a browser */

const P = "sgiant-aiw";

/**
 * Runs in the page: a window whose server proposes one write, with `frame`
 * merged into the `tool_proposal`, and a host whose `proposalSummary`
 * answers `summary` (or is absent when `summary` is undefined). What the
 * host was given is kept in `T.summaryCalls` and `T.applyCalls`.
 */
const MOUNT = (frame: Record<string, unknown>, summary: unknown, again: boolean): void => {
  const g = globalThis as any;
  if (again) g.T.w.destroy();
  else {
    g.T = { saved: [] as unknown[], summaryCalls: [], applyCalls: [], w: null };
    g.fetch = async (input: any) => {
      const url = typeof input === "string" ? input : input.url;
      if (!String(url).includes("/demo-chat")) return new Response("{}", { status: 404 });
      const enc = new TextEncoder();
      const body = new ReadableStream({
        start(c) {
          const send = (o: unknown) => c.enqueue(enc.encode(JSON.stringify(o) + "\n"));
          send({ threadId: "th-1" });
          send({
            type: "tool_proposal",
            callId: "c1",
            name: "publish_draft",
            args: { id: "r1", status: "draft" },
            ...frame,
          });
          send({ type: "text", d: "Ready when you are." });
          send({ type: "done" });
          c.close();
        },
      });
      return new Response(body, {
        status: 200,
        headers: { "content-type": "application/x-ndjson" },
      });
    };
  }
  g.T.w = g.SgiantAiWidget.createAiChatWidget({
    endpoint: "/demo-chat",
    title: "Assistant",
    persistKey: "preview-test",
    getToken: () => Promise.resolve("tok"),
    listThreads: async () => [{ id: "th-1", title: "Drafts" }],
    loadThread: async () => g.T.saved,
    onApplyProposal: async (name: string, args: unknown, ctx: unknown) => {
      g.T.applyCalls.push({ name, args, ctx: ctx === undefined ? "undefined" : ctx });
      return "Published.";
    },
    ...(summary === undefined
      ? {}
      : {
          proposalSummary: (name: string, args: unknown, about: unknown) => {
            g.T.summaryCalls.push({ name, args, about });
            return summary;
          },
        }),
  });
  g.T.w.open();
};

const ASK = (q: string): void => {
  const input = document.querySelector(".sgiant-aiw-input") as HTMLInputElement;
  input.value = q;
  input.closest("form")!.requestSubmit();
};

/** Runs in the page, after `ms`: the one card, as a person sees it. */
const CARD = async (ms: number) => {
  await new Promise((r) => setTimeout(r, ms));
  const P = "sgiant-aiw";
  const card = document.querySelector(`.${P}-panel .${P}-proposal-pending`);
  if (!card) return null;
  const a = card.querySelector("a");
  return {
    title: card.querySelector(`.${P}-proposal-title`)?.textContent ?? null,
    summary: card.querySelector(`.${P}-proposal-summary`)?.textContent ?? null,
    links: card.querySelectorAll("a").length,
    link: a
      ? {
          text: a.textContent,
          href: a.getAttribute("href"),
          target: a.target,
          rel: a.rel,
          children: a.children.length,
        }
      : null,
    html: card.innerHTML,
  };
};

const PRESS_APPLY = async (): Promise<unknown> => {
  const P = "sgiant-aiw";
  const btn = document.querySelector(
    `.${P}-proposal-pending .${P}-nav-btn`
  ) as HTMLButtonElement;
  btn.click();
  await new Promise((r) => setTimeout(r, 200));
  return (globalThis as any).T.applyCalls;
};

test(
  "in a browser: the card the host phrases from the preview, live and reloaded",
  { skip: SKIP_WITHOUT_CHROME },
  async (t) => {
    await withBrowser(async (page) => {
      const live = async (frame: Record<string, unknown>, summary: unknown) => {
        await page.open([1280, 800]);
        await page.evaluate(
          `(${MOUNT})(${JSON.stringify(frame)}, ${summary === undefined ? "undefined" : JSON.stringify(summary)}, false)`
        );
        await page.evaluate(`(${ASK})("Publish it")`);
        return page.evaluate<Awaited<ReturnType<typeof CARD>>>(`(${CARD})(400)`);
      };

      await t.test("the preview and the id reach proposalSummary and onApplyProposal", async () => {
        const card = await live(
          { proposalId: "p1", accountId: "acc-1", preview: PREVIEW },
          "Publish it now"
        );
        assert.ok(card, "the card is drawn");
        const calls = await page.evaluate<any[]>("T.summaryCalls");
        assert.equal(calls.length, 1);
        assert.equal(calls[0].name, "publish_draft");
        assert.deepEqual(calls[0].args, { id: "r1", status: "draft" });
        assert.deepEqual(calls[0].about, {
          preview: PREVIEW,
          proposalId: "p1",
          accountId: "acc-1",
        });
        const applied = await page.evaluate<any[]>(`(${PRESS_APPLY})()`);
        assert.equal(applied.length, 1);
        assert.deepEqual(applied[0].ctx, {
          accountId: "acc-1",
          proposalId: "p1",
          preview: PREVIEW,
        });
      });

      await t.test("a frame with none of them: the host gets what 3.2.0 gave it", async () => {
        await live({}, "Publish it now");
        const calls = await page.evaluate<any[]>("T.summaryCalls");
        assert.deepEqual(calls[0].about, {});
        const applied = await page.evaluate<any[]>(`(${PRESS_APPLY})()`);
        assert.equal(applied[0].ctx, "undefined");
      });

      await t.test("a string summary draws exactly as before", async () => {
        const card = await live({ preview: PREVIEW }, "Publish it now\nto everyone");
        assert.ok(card);
        assert.equal(card.title, "Apply this change?");
        assert.equal(card.summary, "Publish it now\nto everyone");
        assert.equal(card.links, 0);
        // No host summary at all: the generic one, from the args.
        const plain = await live({ preview: PREVIEW }, undefined);
        assert.equal(plain!.summary, "status: draft");
      });

      await t.test("a card summary draws its title, text and one link, as text", async () => {
        const card = await live(
          { proposalId: "p1", preview: PREVIEW },
          {
            title: "Publish <b>October</b> sales",
            text: "6 sections <img src=x onerror=alert(1)>",
            link: { label: "See <i>the</i> draft", href: "/drafts/r1?draft=1" },
          }
        );
        assert.ok(card);
        assert.equal(card.title, "Publish <b>October</b> sales");
        assert.equal(card.summary, "6 sections <img src=x onerror=alert(1)>");
        assert.deepEqual(card.link, {
          text: "See <i>the</i> draft",
          href: "/drafts/r1?draft=1",
          target: "_blank",
          rel: "noopener noreferrer",
          children: 0,
        });
        assert.equal(card.links, 1);
        // Nothing the host wrote became markup.
        assert.doesNotMatch(card.html, /<b>|<img|<i>/);
      });

      await t.test("a link to a script address is not drawn as a link", async () => {
        const card = await live(
          { preview: PREVIEW },
          { text: "Publish", link: { label: "See", href: "javascript:alert(1)" } }
        );
        assert.ok(card);
        assert.equal(card.summary, "Publish");
        assert.equal(card.links, 0);
        assert.doesNotMatch(card.html, /javascript:/);
      });

      await t.test("reloaded: the saved preview reaches the host as the live one did", async () => {
        await live({ proposalId: "p1", preview: PREVIEW }, "Publish it now");
        const saved = buildThreadReplay(thread({ preview: PREVIEW }));
        await page.evaluate(`T.saved = ${JSON.stringify(saved)}; T.summaryCalls = []`);
        await page.evaluate(`(${MOUNT})({}, "Publish it now", true)`);
        const card = await page.evaluate<Awaited<ReturnType<typeof CARD>>>(`(${CARD})(500)`);
        assert.ok(card, "the replayed card is drawn");
        const calls = await page.evaluate<any[]>("T.summaryCalls");
        assert.ok(calls.length >= 1, "the host was asked to phrase it");
        assert.deepEqual(calls.at(-1).about, { preview: PREVIEW, proposalId: "p1" });
        const applied = await page.evaluate<any[]>(`(${PRESS_APPLY})()`);
        assert.deepEqual(applied.at(-1).ctx, { proposalId: "p1", preview: PREVIEW });
      });
    });
  }
);
