import test from "node:test";
import assert from "node:assert/strict";
import { SKIP_WITHOUT_CHROME, withBrowser, type Page } from "./aiw-browser.ts";

/**
 * THE BOX A PERSON WRITES IN IS AS WIDE AS THE WINDOW, AND GROWS.
 *
 * It was a one-line field that shared its row with the model picker and
 * Send, each of which took its width first. Measured then, with a question
 * of 138 characters typed in: 38 of them in view in the default window with
 * no picker, 22 with the picker, and on a 320 px phone in Turkish with a
 * long model name, eight. Nobody could read back what they were writing.
 *
 * Now the box has a row of its own and grows with its text, one line to
 * five, then scrolls inside; the picker, the attach button and Send are on
 * the row under it. Held here, in a real window, at the default width and
 * on two phones, in both languages, with no picker, a picker, and a long
 * model name:
 *
 *  - the box is as wide as the window allows, whatever is in the row below;
 *  - the whole question is in view while it is written;
 *  - it grows to five lines and no further;
 *  - nothing is cut and nothing scrolls sideways;
 *  - Enter sends, Shift+Enter does not, and Enter in the middle of
 *    composing a letter does not;
 *  - a picture pasted into the box is still an attachment.
 */
const QUESTION =
  "Bu ay kaç rezervasyon aldık ve geçen yılın aynı ayına göre doluluk oranımız nasıl değişti, ayrıca en çok hangi kanaldan rezervasyon geldi?";
const MODELS = [
  { id: "a", label: "Opus 5.5" },
  { id: "b", label: "Sonnet 5.5" },
];
const LONG = [
  { id: "a", label: "Claude Sonnet 5.5 (hızlı ve ekonomik)" },
  { id: "b", label: "Opus 5.5" },
];

/** Runs in the page: a window, and what its box looks like with `text` in it. */
const LOOK = async (
  how: { models?: unknown; lang: string; attach?: boolean },
  text: string
): Promise<{
  panel: number;
  inner: number;
  box: { width: number; height: number; lines: number };
  empty: { height: number; lines: number };
  wholeInView: boolean;
  scrollsInside: boolean;
  sideways: number;
  row: Array<{ what: string; left: number; right: number; inside: boolean }>;
  sendAtTheEnd: boolean;
  boxAboveRow: boolean;
  logHeight: number;
  sendInView: boolean;
}> => {
  const g = globalThis as any;
  const P = "sgiant-aiw";
  document.documentElement.lang = how.lang;
  g.fetch = async () => new Response("{}", { status: 200 });
  const w = g.SgiantAiWidget.createAiChatWidget({
    endpoint: "/x",
    ...(how.models ? { models: how.models } : {}),
    ...(how.attach ? { uploadEndpoint: "/upload" } : {}),
  });
  g.W = w;
  w.open();
  await new Promise((r) => setTimeout(r, 300));
  const panel = document.querySelector(`.${P}-panel`) as HTMLElement;
  const form = panel.querySelector(`.${P}-form`) as HTMLElement;
  const box = panel.querySelector(
    '[data-ai-target="widget-composer"]'
  ) as HTMLTextAreaElement;
  const cs = getComputedStyle(box);
  const line = parseFloat(cs.lineHeight);
  const chrome =
    parseFloat(cs.paddingTop) +
    parseFloat(cs.paddingBottom) +
    parseFloat(cs.borderTopWidth) +
    parseFloat(cs.borderBottomWidth);
  const lines = () => Math.round((box.getBoundingClientRect().height - chrome) / line);
  const empty = { height: Math.round(box.getBoundingClientRect().height), lines: lines() };
  box.focus();
  box.value = text;
  box.dispatchEvent(new Event("input", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 100));
  const fcs = getComputedStyle(form);
  const formBox = form.getBoundingClientRect();
  const inner =
    formBox.width - parseFloat(fcs.paddingLeft) - parseFloat(fcs.paddingRight);
  const b = box.getBoundingClientRect();
  const rowEl = panel.querySelector(`.${P}-form-row`) as HTMLElement;
  const p = panel.getBoundingClientRect();
  const row = [...rowEl.children].map((k) => {
    const r = k.getBoundingClientRect();
    return {
      what: String((k as HTMLElement).className).replace(/sgiant-aiw-/g, "").split(" ")[0]!,
      left: Math.round(r.left - p.left),
      right: Math.round(p.right - r.right),
      inside: r.left >= p.left - 0.5 && r.right <= p.right + 0.5 && r.width > 0,
    };
  });
  const send = panel.querySelector(`.${P}-send`)!.getBoundingClientRect();
  const out = {
    panel: Math.round(p.width),
    inner: Math.round(inner),
    box: { width: Math.round(b.width), height: Math.round(b.height), lines: lines() },
    empty,
    wholeInView: box.scrollHeight <= box.clientHeight + 1,
    scrollsInside: cs.overflowY === "auto" || getComputedStyle(box).overflowY === "auto",
    sideways: Math.max(
      form.scrollWidth - form.clientWidth,
      panel.scrollWidth - panel.clientWidth,
      box.scrollWidth - box.clientWidth
    ),
    row,
    sendAtTheEnd: Math.abs(send.right - (formBox.right - parseFloat(fcs.paddingRight))) < 1.5,
    boxAboveRow: b.bottom <= rowEl.getBoundingClientRect().top + 0.5,
    logHeight: Math.round(
      (panel.querySelector(`.${P}-log`) as HTMLElement).getBoundingClientRect().height
    ),
    // Inside the WINDOW, which on a phone is the whole screen. Measured
    // against the window's own box and not the screen's: the sheet slides up
    // when it opens, and a page nobody is looking at does not run that
    // animation to its end, so the screen is the wrong ruler here.
    sendInView:
      send.bottom <= p.bottom + 0.5 &&
      send.top >= p.top &&
      Math.round(p.height) <= window.innerHeight,
  };
  w.destroy();
  return out;
};

const look = async (
  page: Page,
  viewport: readonly [number, number],
  how: { models?: unknown; lang: string; attach?: boolean },
  text = QUESTION
) => {
  await page.open(viewport);
  return page.evaluate<Awaited<ReturnType<typeof LOOK>>>(
    `(${LOOK})(${JSON.stringify(how)}, ${JSON.stringify(text)})`
  );
};

test(
  "in a browser: the box a person writes in",
  { skip: SKIP_WITHOUT_CHROME },
  async (t) => {
    await withBrowser(async (page) => {
      for (const viewport of [
        [1280, 800],
        [390, 800],
        [320, 640],
      ] as const)
        for (const [row, models] of [
          ["no picker", undefined],
          ["a picker", MODELS],
          ["a long model name", LONG],
        ] as const)
          for (const lang of ["en", "tr"])
            await t.test(`${viewport[0]}px, ${row}, ${lang}: the box is the window's width and shows the whole question`, async () => {
              const s = await look(page, viewport, { models, lang, attach: true });
              // The box is as wide as the form allows, to the pixel, whatever
              // sits in the row under it. (It was 96 to 296 px.)
              assert.equal(s.box.width, s.inner, `the box is ${s.box.width} of ${s.inner}px`);
              // The whole question is in view: nothing to scroll back to.
              assert.equal(s.wholeInView, true, "part of the question is out of view");
              assert.ok(s.box.lines >= 2 && s.box.lines <= 5, `${s.box.lines} lines`);
              // An empty box is one line.
              assert.equal(s.empty.lines, 1);
              // Nothing sideways, and everything in the row is inside the window.
              assert.equal(s.sideways, 0);
              for (const item of s.row)
                assert.equal(item.inside, true, `${item.what} is cut or outside`);
              // The box, then the row; Send at the end of the row.
              assert.equal(s.boxAboveRow, true);
              assert.equal(s.sendAtTheEnd, true);
              // The row holds what it should, in order.
              assert.deepEqual(
                s.row.map((r) => r.what),
                models ? ["attach", "model", "send"] : ["attach", "send"]
              );
              // The conversation above still has room, and Send is on screen.
              assert.ok(s.logHeight > 150, `the log is ${s.logHeight}px high`);
              assert.equal(s.sendInView, true);
            });

      await t.test("it grows to five lines and no further: after that it scrolls inside", async () => {
        for (const viewport of [[1280, 800], [320, 640]] as const) {
          const long = Array.from({ length: 12 }, (_, i) => `satır ${i + 1}`).join("\n");
          const s = await look(page, viewport, { lang: "tr" }, long);
          assert.equal(s.box.lines, 5, `${s.box.lines} lines at ${viewport[0]}`);
          assert.equal(s.wholeInView, false);
          assert.equal(s.scrollsInside, true);
          assert.equal(s.sideways, 0);
          assert.equal(s.sendInView, true);
          assert.ok(s.logHeight > 120, `the log is ${s.logHeight}px high`);
          // And one line is one line.
          const one = await look(page, viewport, { lang: "tr" }, "Merhaba");
          assert.equal(one.box.lines, 1);
          assert.equal(one.box.height, one.empty.height);
        }
      });

      await t.test("a phone's keyboard up, and twelve lines typed: the box gives lines back, and it, its row and Send are all inside what is left of the screen", async () => {
        await page.open([320, 640]);
        const seen = await page.evaluate<{
          panel: number;
          boxLines: number;
          formInside: boolean;
          sendInside: boolean;
          headerShown: boolean;
          log: number;
          sideways: number;
        }>(`(${async () => {
          const g = globalThis as any;
          const P = "sgiant-aiw";
          g.fetch = async () => new Response("{}", { status: 200 });
          const w = g.SgiantAiWidget.createAiChatWidget({
            endpoint: "/x",
            uploadEndpoint: "/u",
            models: [{ id: "a", label: "Claude Sonnet 5.5 (hızlı ve ekonomik)" }],
          });
          w.open();
          await new Promise((r) => setTimeout(r, 300));
          const box = document.querySelector(
            '[data-ai-target="widget-composer"]'
          ) as HTMLTextAreaElement;
          box.focus();
          box.value = Array.from({ length: 12 }, (_, i) => "satır " + (i + 1)).join("\n");
          box.dispatchEvent(new Event("input", { bubbles: true }));
          // The keyboard comes up: the part of the screen that can be seen
          // shrinks to 300px, which the window follows.
          const vv = window.visualViewport!;
          Object.defineProperty(vv, "height", { get: () => 300, configurable: true });
          vv.dispatchEvent(new Event("resize"));
          await new Promise((r) => setTimeout(r, 200));
          const panel = document.querySelector(`.${P}-panel`) as HTMLElement;
          const p = panel.getBoundingClientRect();
          const inside = (sel: string) => {
            const r = panel.querySelector(sel)!.getBoundingClientRect();
            return r.top >= p.top - 0.5 && r.bottom <= p.bottom + 0.5 && r.height > 0;
          };
          const cs = getComputedStyle(box);
          const chrome =
            parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) +
            parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
          const out = {
            panel: Math.round(p.height),
            boxLines: Math.round((box.getBoundingClientRect().height - chrome) / parseFloat(cs.lineHeight)),
            formInside: inside(`.${P}-form`),
            sendInside: inside(`.${P}-send`),
            headerShown: inside(`.${P}-header`),
            log: Math.round(panel.querySelector(`.${P}-log`)!.getBoundingClientRect().height),
            sideways: panel.scrollWidth - panel.clientWidth,
          };
          w.destroy();
          return out;
        }})()`);
        assert.equal(seen.panel, 300);
        // Fewer than five, in whole lines, and never none: a third of a
        // short window, not a fixed five.
        assert.ok(seen.boxLines >= 2 && seen.boxLines < 5, `${seen.boxLines} lines`);
        assert.equal(seen.formInside, true, "the box or its row is behind the keyboard");
        assert.equal(seen.sendInside, true, "Send is behind the keyboard");
        assert.equal(seen.headerShown, true, "the header was pushed out");
        // And the conversation above is still there to read.
        assert.ok(seen.log >= 48, `the conversation is ${seen.log}px high`);
        assert.equal(seen.sideways, 0);
      });

      await t.test("an empty box is one line whatever its hint says, and does not jump when a letter is typed and taken back", async () => {
        for (const viewport of [[1280, 800], [320, 640]] as const) {
          await page.open(viewport);
          const heights = await page.evaluate<number[]>(`(${async () => {
            const g = globalThis as any;
            g.fetch = async () => new Response("{}", { status: 200 });
            // A long name makes a long hint: "Ask <name> anything…".
            const w = g.SgiantAiWidget.createAiChatWidget({
              endpoint: "/x",
              title: "Kaşmarinabutikotelveresidencesresepsiyonu",
            });
            w.open();
            await new Promise((r) => setTimeout(r, 300));
            const box = document.querySelector(
              '[data-ai-target="widget-composer"]'
            ) as HTMLTextAreaElement;
            const h = () => Math.round(box.getBoundingClientRect().height);
            const set = (v: string) => {
              box.value = v;
              box.dispatchEvent(new Event("input", { bubbles: true }));
            };
            const empty = h();
            set("a");
            // One line is what a box with one letter in it is.
            const oneLine = h();
            const one = oneLine;
            set("");
            const again = h();
            // And the hint is still there once the box is empty again.
            const hint = box.placeholder.length;
            w.destroy();
            return [oneLine, empty, one, again, hint];
          }})()`);
          const [oneLine, empty, one, again, hint] = heights as [number, number, number, number, number];
          assert.ok(hint > 40, "the hint is short, so this proves nothing");
          assert.equal(empty, oneLine, `an empty box is ${empty}px, one line is ${oneLine}px`);
          assert.equal(one, oneLine);
          assert.equal(again, oneLine);
        }
      });

      await t.test("past five lines, the line being written is wholly in view after every letter", async () => {
        await page.open([1280, 800]);
        const short = await page.evaluate<number[]>(`(${async () => {
          const g = globalThis as any;
          g.fetch = async () => new Response("{}", { status: 200 });
          const w = g.SgiantAiWidget.createAiChatWidget({ endpoint: "/x" });
          w.open();
          await new Promise((r) => setTimeout(r, 300));
          const box = document.querySelector(
            '[data-ai-target="widget-composer"]'
          ) as HTMLTextAreaElement;
          box.focus();
          const seen: number[] = [];
          let text = Array.from({ length: 7 }, (_, i) => "satır " + (i + 1)).join("\n");
          for (const letter of ["", " a", "b", "\n", "c", "\n", "d"]) {
            text += letter;
            box.value = text;
            box.setSelectionRange(text.length, text.length);
            // What a browser does on a typed letter: bring the caret into
            // view against the box as it is, THEN tell the page.
            box.scrollTop = Math.max(0, box.scrollTop);
            box.dispatchEvent(new Event("input", { bubbles: true }));
            // How far the box is from being scrolled to its end.
            seen.push(Math.round(box.scrollHeight - box.clientHeight - box.scrollTop));
          }
          w.destroy();
          return seen;
        }})()`);
        for (const left of short) assert.equal(left, 0, `scrolled ${left}px short of its end`);
      });

      await t.test("the window made short with five lines typed: the box gives lines back at once, without waiting for a letter", async () => {
        await page.open([1280, 800]);
        const seen = await page.evaluate<{ before: number; after: number; sendInside: boolean; back: number }>(
          `(${async () => {
            const g = globalThis as any;
            const P = "sgiant-aiw";
            g.fetch = async () => new Response("{}", { status: 200 });
            const w = g.SgiantAiWidget.createAiChatWidget({ endpoint: "/x" });
            w.open();
            await new Promise((r) => setTimeout(r, 300));
            const panel = document.querySelector(`.${P}-panel`) as HTMLElement;
            const box = document.querySelector(
              '[data-ai-target="widget-composer"]'
            ) as HTMLTextAreaElement;
            box.value = Array.from({ length: 9 }, (_, i) => "satır " + (i + 1)).join("\n");
            box.dispatchEvent(new Event("input", { bubbles: true }));
            const cs = getComputedStyle(box);
            const chrome =
              parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) +
              parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
            const lines = () =>
              Math.round((box.getBoundingClientRect().height - chrome) / parseFloat(cs.lineHeight));
            const before = lines();
            // The browser's window is made short: the panel can be no
            // taller than it. No letter is typed.
            panel.style.maxHeight = "300px";
            window.dispatchEvent(new Event("resize"));
            await new Promise((r) => setTimeout(r, 100));
            const p = panel.getBoundingClientRect();
            const send = panel.querySelector(`.${P}-send`)!.getBoundingClientRect();
            const after = lines();
            const sendInside = send.bottom <= p.bottom + 0.5 && send.top >= p.top;
            // And tall again: the lines come back.
            panel.style.maxHeight = "";
            window.dispatchEvent(new Event("resize"));
            await new Promise((r) => setTimeout(r, 100));
            const back = lines();
            w.destroy();
            return { before, after, sendInside, back };
          }})()`
        );
        assert.equal(seen.before, 5);
        assert.ok(seen.after >= 1 && seen.after < 5, `${seen.after} lines in a 300px window`);
        assert.equal(seen.sendInside, true, "Send is outside the window");
        assert.equal(seen.back, 5);
      });

      await t.test("a word with no space in it wraps inside the box, it does not push it wider", async () => {
        const s = await look(page, [320, 640], { models: LONG, lang: "tr" }, "x".repeat(200));
        assert.equal(s.box.width, s.inner);
        assert.equal(s.sideways, 0);
        assert.ok(s.box.lines >= 2);
      });

      await t.test("Enter sends; Shift+Enter is a new line; Enter while composing a letter sends nothing", async () => {
        await page.open([1280, 800]);
        const seen = await page.evaluate<{
          afterShift: { sent: number; value: string; prevented: boolean };
          composing: { sent: number; prevented: boolean };
          composing229: { sent: number; prevented: boolean };
          afterEnter: { sent: string[]; value: string; lines: number; prevented: boolean };
          withModifier: number;
        }>(`(${async () => {
          const g = globalThis as any;
          const sent: string[] = [];
          g.fetch = async (_u: unknown, init?: { body?: string }) => {
            sent.push(JSON.parse(init?.body ?? "{}").content);
            return new Response(
              JSON.stringify({ type: "text", d: "ok" }) + "\n" + JSON.stringify({ type: "done" }) + "\n",
              { status: 200 }
            );
          };
          const w = g.SgiantAiWidget.createAiChatWidget({ endpoint: "/x" });
          w.open();
          await new Promise((r) => setTimeout(r, 250));
          const box = document.querySelector(
            '[data-ai-target="widget-composer"]'
          ) as HTMLTextAreaElement;
          const key = (init: KeyboardEventInit & { keyCode?: number }) => {
            const e = new KeyboardEvent("keydown", {
              key: "Enter",
              bubbles: true,
              cancelable: true,
              ...init,
            });
            if (init.keyCode !== undefined)
              Object.defineProperty(e, "keyCode", { get: () => init.keyCode });
            box.dispatchEvent(e);
            return e.defaultPrevented;
          };
          box.focus();
          box.value = "birinci satır";
          // Shift+Enter: left to the browser, which adds the line.
          const shiftPrevented = key({ shiftKey: true });
          const afterShift = { sent: sent.length, value: box.value, prevented: shiftPrevented };
          // In the middle of composing (an input method accepting a letter).
          const c1 = key({ isComposing: true });
          const composing = { sent: sent.length, prevented: c1 };
          const c2 = key({ keyCode: 229 });
          const composing229 = { sent: sent.length, prevented: c2 };
          // With Ctrl or Cmd it is not ours either.
          key({ ctrlKey: true });
          key({ metaKey: true });
          const withModifier = sent.length;
          // Two lines, then a plain Enter.
          box.value = "birinci satır\nikinci satır";
          box.dispatchEvent(new Event("input", { bubbles: true }));
          const prevented = key({});
          await new Promise((r) => setTimeout(r, 400));
          const cs = getComputedStyle(box);
          const chrome =
            parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) +
            parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
          const afterEnter = {
            sent,
            value: box.value,
            lines: Math.round((box.getBoundingClientRect().height - chrome) / parseFloat(cs.lineHeight)),
            prevented,
          };
          w.destroy();
          return { afterShift, composing, composing229, afterEnter, withModifier };
        }})()`);
        assert.deepEqual(seen.afterShift, { sent: 0, value: "birinci satır", prevented: false });
        assert.deepEqual(seen.composing, { sent: 0, prevented: false });
        assert.deepEqual(seen.composing229, { sent: 0, prevented: false });
        assert.equal(seen.withModifier, 0);
        // Sent once, with its two lines; the box is empty and one line again.
        assert.deepEqual(seen.afterEnter.sent, ["birinci satır\nikinci satır"]);
        assert.equal(seen.afterEnter.prevented, true);
        assert.equal(seen.afterEnter.value, "");
        assert.equal(seen.afterEnter.lines, 1);
      });

      await t.test("a picture pasted into the box is an attachment, and pasted text is text", async () => {
        await page.open([1280, 800]);
        const seen = await page.evaluate<{ uploads: number; prevented: boolean; textPrevented: boolean }>(
          `(${async () => {
            const g = globalThis as any;
            let uploads = 0;
            g.fetch = async (input: any) => {
              const url = String(typeof input === "string" ? input : input.url);
              if (url.includes("/upload")) {
                uploads++;
                return new Response(
                  JSON.stringify({ mediaId: "m1", filename: "ekran.png", mimeType: "image/png" }),
                  { status: 200 }
                );
              }
              return new Response("{}", { status: 200 });
            };
            const w = g.SgiantAiWidget.createAiChatWidget({ endpoint: "/x", uploadEndpoint: "/upload" });
            w.open();
            await new Promise((r) => setTimeout(r, 250));
            const box = document.querySelector(
              '[data-ai-target="widget-composer"]'
            ) as HTMLTextAreaElement;
            const paste = (fill: (d: DataTransfer) => void) => {
              const data = new DataTransfer();
              fill(data);
              const e = new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true });
              box.dispatchEvent(e);
              return e.defaultPrevented;
            };
            const prevented = paste((d) =>
              d.items.add(new File([new Uint8Array([137, 80, 78, 71])], "ekran.png", { type: "image/png" }))
            );
            await new Promise((r) => setTimeout(r, 300));
            const textPrevented = paste((d) => d.setData("text/plain", "merhaba"));
            w.destroy();
            return { uploads, prevented, textPrevented };
          }})()`
        );
        assert.equal(seen.prevented, true, "the picture went into the box as text");
        assert.equal(seen.uploads, 1);
        assert.equal(seen.textPrevented, false, "pasted text was swallowed");
      });

      await t.test("what was typed before comes back in a box that fits it, when the window is opened", async () => {
        await page.open([320, 640]);
        const lines = await page.evaluate<number[]>(`(${async (text: string) => {
          const g = globalThis as any;
          g.fetch = async () => new Response("{}", { status: 200 });
          const measure = () => {
            const box = document.querySelector(
              '[data-ai-target="widget-composer"]'
            ) as HTMLTextAreaElement;
            const cs = getComputedStyle(box);
            const chrome =
              parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) +
              parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
            return Math.round((box.getBoundingClientRect().height - chrome) / parseFloat(cs.lineHeight));
          };
          const first = g.SgiantAiWidget.createAiChatWidget({ endpoint: "/x", persistKey: "k" });
          first.open();
          await new Promise((r) => setTimeout(r, 200));
          const box = document.querySelector(
            '[data-ai-target="widget-composer"]'
          ) as HTMLTextAreaElement;
          box.value = text;
          box.dispatchEvent(new Event("input", { bubbles: true }));
          const typed = measure();
          first.destroy();
          // The window again, closed at first: the draft is there unseen.
          const second = g.SgiantAiWidget.createAiChatWidget({ endpoint: "/x", persistKey: "k" });
          second.open();
          await new Promise((r) => setTimeout(r, 250));
          const back = measure();
          second.destroy();
          return [typed, back];
        }})(${JSON.stringify(QUESTION)})`);
        assert.ok(lines[0]! >= 3, `${lines[0]} lines while typing`);
        assert.equal(lines[1], lines[0], "the kept text came back in a box of another size");
      });
    });
  }
);
