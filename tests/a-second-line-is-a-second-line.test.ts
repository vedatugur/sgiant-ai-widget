import test from "node:test";
import assert from "node:assert/strict";
import { widgetStyles } from "./aiw-source.ts";
import { SKIP_WITHOUT_CHROME, withBrowser, type Page } from "./aiw-browser.ts";

/**
 * A SECOND LINE IS A SECOND LINE, IN THE NOTICE AND IN THE ERROR CARD.
 *
 * A host's sentence can have two lines: what happened, then why.
 *
 *   "The assistant cannot answer right now.\nCause: the provider is out of credit."
 *
 * A message in the conversation has always kept its line breaks
 * (`white-space:pre-wrap`). The notice and the error card did not: their text
 * had no `white-space` at all, so the browser folded the break into a space
 * and the cause ran on as the end of the first sentence. Seen in the window
 * on 1.19.1 and on 1.20.0.
 *
 * `pre-line`, not `pre-wrap`: a line break is kept, and runs of spaces are
 * still folded, so a host's indented template string does not draw its
 * indentation.
 */

/** One rule's declarations, by exact selector, outside any media query. */
function rule(selector: string): string {
  const at = widgetStyles.indexOf(`\n.\${PREFIX}-${selector}{`);
  assert.ok(at >= 0, `no .${selector} rule in the stylesheet`);
  const open = widgetStyles.indexOf("{", at + 10);
  return widgetStyles.slice(open + 1, widgetStyles.indexOf("}", open));
}

test("the notice and the error card keep a line break", () => {
  for (const selector of ["notice-text", "error-text", "error-detail"])
    assert.match(
      rule(selector),
      /(^|;)white-space:pre-line(;|$)/,
      `.${selector} folds a line break into a space`
    );
});

test("a message in the conversation keeps its own, as it always did", () => {
  assert.match(rule("msg"), /(^|;)white-space:pre-wrap(;|$)/);
});

// Short enough that the two sentences fit on ONE line together, at every
// width: folded into a space they are one line, and only a kept line break
// makes them two. (Longer sentences wrap to two lines either way, and a test
// that counted their lines passed without the rule.)
const WHAT = "Yanıt veremiyor.";
const WHY = "Neden: kredi kalmadı.";
const TWO_LINES = `${WHAT}\n${WHY}`;
// And a pair as long as a real one, for what must stay inside the window.
const LONG = `Asistan şu anda yanıt veremiyor, lütfen biraz sonra yeniden deneyin.\nNeden: sağlayıcıda kredi kalmadı. Konuşmanız kaydedildi.`;

/** Runs in the page: a window whose token step refuses, one way or the other. */
const MOUNT = (said: string): void => {
  const T = ((globalThis as any).T = { mode: "notice" });
  (globalThis as any).fetch = async () => new Response("{}", { status: 404 });
  const w = (globalThis as any).SgiantAiWidget.createAiChatWidget({
    endpoint: "/demo-chat",
    title: "AYCA",
    getToken: () =>
      T.mode === "notice"
        ? // The host's own sentence: drawn in the notice.
          Promise.reject({ userMessage: said })
        : // Anything else: drawn as the detail of the error card.
          Promise.reject(new Error(said)),
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

/** Runs in the page: the lines one element's text is drawn on. */
const LINES = async (
  selector: string
): Promise<{
  found: boolean;
  text: string;
  lines: number;
  indent: number;
  inside: boolean;
}> => {
  await new Promise((r) => setTimeout(r, 250));
  const panel = document.querySelector(".sgiant-aiw-panel")!;
  const el = panel.querySelector(selector);
  if (!el)
    return { found: false, text: "", lines: 0, indent: 0, inside: false };
  const range = document.createRange();
  range.selectNodeContents(el);
  const rects = [...range.getClientRects()].filter((r) => r.width > 0);
  const box = panel.getBoundingClientRect();
  return {
    found: true,
    text: el.textContent ?? "",
    lines: new Set(rects.map((r) => Math.round(r.top))).size,
    // How far the last line starts from where the first one does.
    indent: rects.length
      ? Math.round(rects[rects.length - 1]!.left - rects[0]!.left)
      : 0,
    inside: rects.every(
      (r) => r.left >= box.left - 0.5 && r.right <= box.right + 0.5
    ),
  };
};

async function asked(
  page: Page,
  viewport: readonly [number, number],
  mode: "notice" | "error",
  said: string
): Promise<void> {
  await page.open(viewport);
  await page.evaluate(`(${MOUNT})(${JSON.stringify(said)})`);
  await page.evaluate(`T.mode = ${JSON.stringify(mode)}`);
  await page.evaluate(`(${ASK})("Bu ay kaç rezervasyon aldık?")`);
}
const lines = (page: Page, selector: string) =>
  page.evaluate<Awaited<ReturnType<typeof LINES>>>(
    `(${LINES})(${JSON.stringify(selector)})`
  );

test(
  "in a browser: the cause is on a line of its own",
  { skip: SKIP_WITHOUT_CHROME },
  async (t) => {
    await withBrowser(async (page) => {
      // A desk, and the narrowest phone: there the window is the screen.
      for (const viewport of [
        [1280, 800],
        [320, 640],
      ] as const) {
        const at = `${viewport[0]}px`;
        for (const [name, mode, selector] of [
          ["the notice", "notice", ".sgiant-aiw-notice-text"],
          ["the error card", "error", ".sgiant-aiw-error-detail"],
        ] as const) {
          await t.test(`${at}: ${name}`, async () => {
            // The premise: together on one line, the two would fit.
            await asked(page, viewport, mode, `${WHAT} ${WHY}`);
            const folded = await lines(page, selector);
            assert.equal(folded.found, true, `${name} was not drawn`);
            assert.equal(folded.lines, 1, "the pair no longer fits one line");
            // With a line break between them they are two.
            await asked(page, viewport, mode, TWO_LINES);
            const two = await lines(page, selector);
            assert.equal(two.text, TWO_LINES);
            assert.equal(two.lines, 2, "the line break was folded into a space");
            // A real one, long enough to wrap: nothing leaves the window.
            await asked(page, viewport, mode, LONG);
            const long = await lines(page, selector);
            assert.ok(long.lines >= 3, `${long.lines} lines`);
            assert.equal(long.inside, true, "the text leaves the window");
          });
        }

        await t.test(`${at}: a host's indentation is not drawn`, async () => {
          await asked(page, viewport, "notice", `${WHAT}\n        ${WHY}`);
          const indented = await lines(page, ".sgiant-aiw-notice-text");
          assert.equal(indented.lines, 2);
          assert.equal(indented.indent, 0, "the second line starts indented");
        });
      }
    });
  }
);
