import test from "node:test";
import assert from "node:assert/strict";
import { WIDGET_LABELS } from "../dist/labels.js";
import { WIDGET_LABELS_TR } from "../dist/labels-tr.js";
import { SKIP_WITHOUT_CHROME, withBrowser } from "./aiw-browser.ts";

/**
 * A MODEL LIST THAT DID NOT LOAD: THE PILL STAYS AND SAYS WHY
 * (sgiant-platform#617).
 *
 * The pill is drawn only when the host hands over a list. A host whose list
 * failed to arrive either held the whole chat back for it, or mounted without
 * a pill: the person who chose a model yesterday found the control gone and
 * nothing saying why, and their turn ran on another model without a word.
 *
 * With `modelsUnavailable` the pill is there, chooses nothing, and says the
 * reason to a mouse, a keyboard, a screen reader and a thumb.
 */
const EN = "The model list could not be loaded. The default model is used.";
const TR = "Model listesi yüklenemedi. Varsayılan model kullanılıyor.";

test("the sentence, letter for letter, in both languages", () => {
  assert.equal(WIDGET_LABELS.modelPickerUnavailable, EN);
  assert.equal(WIDGET_LABELS_TR.modelPickerUnavailable, TR);
});

/** Runs in the page: a window, and what its composer holds. */
const LOOK = async (
  pageLang: string,
  options: Record<string, unknown>,
  press: "no" | "pill" | "pill-then-elsewhere" | "pill-then-escape" | "send"
) => {
  document.documentElement.lang = pageLang;
  const g = globalThis as any;
  const sent: unknown[] = [];
  g.fetch = async (_input: unknown, init?: { body?: string }) => {
    if (init?.body) sent.push(JSON.parse(init.body));
    return new Response(
      JSON.stringify({ type: "assistant_delta", text: "ok" }) +
        "\n" +
        JSON.stringify({ type: "done" }) +
        "\n",
      { status: 200, headers: { "content-type": "application/x-ndjson" } }
    );
  };
  const w = g.SgiantAiWidget.createAiChatWidget({
    endpoint: "/demo-chat",
    ...options,
  });
  w.open();
  await new Promise((r) => setTimeout(r, 350));
  const P = "sgiant-aiw";
  const panel = document.querySelector(`.${P}-panel`)!;
  const form = panel.querySelector("form")!;
  const input = form.querySelector(
    '[data-ai-target="widget-composer"]'
  ) as HTMLInputElement;
  const pill = form.querySelector(`.${P}-model-btn`) as HTMLButtonElement | null;
  if (pill && press.startsWith("pill")) {
    pill.focus();
    pill.click();
    // The sentence fades in; wait for frames, not for a guess at the clock.
    for (let i = 0; i < 40; i++)
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    if (press === "pill-then-elsewhere") input.click();
    if (press === "pill-then-escape")
      pill.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
      );
    if (press !== "pill") await new Promise((r) => setTimeout(r, 250));
  }
  if (press === "send") {
    input.value = "Merhaba";
    form.requestSubmit();
    await new Promise((r) => setTimeout(r, 300));
  }
  const note = pill
    ? document.getElementById(pill.getAttribute("aria-describedby") ?? "-")
    : null;
  const box = panel.getBoundingClientRect();
  const within = (el: Element | null) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return (
      r.width > 0 &&
      r.left >= box.left - 0.5 &&
      r.right <= box.right + 0.5 &&
      r.top >= box.top - 0.5 &&
      r.bottom <= box.bottom + 0.5
    );
  };
  const fr = form.getBoundingClientRect();
  const kids = [...form.children].filter(
    (c) => (c as HTMLElement).offsetWidth > 0
  );
  const out = {
    pill: pill
      ? {
          text: pill.textContent,
          ariaDisabled: pill.getAttribute("aria-disabled"),
          disabled: pill.disabled,
          hasPopup: pill.getAttribute("aria-haspopup"),
          title: pill.title,
          target: pill.getAttribute("data-ai-target"),
          focused: document.activeElement === pill,
          expanded: pill.getAttribute("aria-expanded"),
        }
      : null,
    note: note
      ? {
          text: note.textContent,
          role: note.getAttribute("role"),
          shown: note.classList.contains(`${P}-menu-open`),
          opacity: getComputedStyle(note).opacity,
          within: within(note),
          sideways: note.scrollWidth - note.clientWidth,
        }
      : null,
    // Everything in the composer row is inside it, and the box is usable.
    rowFits: kids.every((c) => {
      const r = c.getBoundingClientRect();
      return r.left >= fr.left - 0.5 && r.right <= fr.right + 0.5;
    }),
    inputWidth: Math.round(input.getBoundingClientRect().width),
    sent,
  };
  w.destroy();
  return out;
};

test(
  "in a browser: the pill of a list that did not load",
  { skip: SKIP_WITHOUT_CHROME },
  async (t) => {
    await withBrowser(async (page) => {
      const look = async (
        viewport: readonly [number, number],
        pageLang: string,
        options: Record<string, unknown>,
        press: Parameters<typeof LOOK>[2] = "no"
      ) => {
        await page.open(viewport);
        return page.evaluate<Awaited<ReturnType<typeof LOOK>>>(
          `(${LOOK})(${JSON.stringify(pageLang)}, ${JSON.stringify(options)}, ${JSON.stringify(press)})`
        );
      };

      for (const viewport of [
        [1280, 800],
        [320, 640],
      ] as const)
        for (const [lang, sentence] of [
          ["en", EN],
          ["tr", TR],
        ] as const) {
          const at = `${viewport[0]}px, ${lang}`;

          await t.test(`${at}: it is there, chooses nothing and carries the reason`, async () => {
            const s = await look(viewport, lang, { modelsUnavailable: true });
            assert.ok(s.pill, "no pill");
            assert.equal(s.pill.text, "Model");
            // Not `disabled`: that takes no focus, no hover and no tap, so
            // nobody could read why.
            assert.equal(s.pill.ariaDisabled, "true");
            assert.equal(s.pill.disabled, false);
            assert.equal(s.pill.hasPopup, null, "it promises a menu");
            assert.equal(s.pill.title, sentence);
            assert.equal(s.pill.target, null, "the assistant is offered it as a control");
            assert.deepEqual(
              { text: s.note?.text, role: s.note?.role, shown: s.note?.shown },
              { text: sentence, role: "note", shown: false }
            );
            assert.equal(s.rowFits, true, "the composer row overflows");
            assert.ok(s.inputWidth >= 120, `the box is ${s.inputWidth}px wide`);
          });

          await t.test(`${at}: pressed, it shows the sentence, inside the window`, async () => {
            const s = await look(viewport, lang, { modelsUnavailable: true }, "pill");
            assert.equal(s.pill!.focused, true, "it cannot be focused");
            assert.equal(s.pill!.expanded, "true");
            assert.equal(s.note!.shown, true);
            assert.equal(s.note!.opacity, "1");
            assert.equal(s.note!.within, true, "the sentence leaves the window");
            assert.equal(s.note!.sideways, 0, "the sentence scrolls sideways");
          });
        }

      await t.test("a press elsewhere, or Escape, puts the sentence away", async () => {
        for (const press of ["pill-then-elsewhere", "pill-then-escape"] as const) {
          const s = await look([1280, 800], "en", { modelsUnavailable: true }, press);
          assert.equal(s.note!.shown, false, press);
          assert.equal(s.pill!.expanded, "false", press);
        }
      });

      await t.test("no model is sent: the turn runs on the server's default", async () => {
        const s = await look([1280, 800], "en", { modelsUnavailable: true }, "send");
        assert.equal(s.sent.length, 1);
        assert.equal("model" in (s.sent[0] as object), false);
      });

      await t.test("a list that arrived is a list, whatever else the host says", async () => {
        const s = await look([1280, 800], "en", {
          modelsUnavailable: true,
          models: [
            { id: "m-1", label: "One" },
            { id: "m-2", label: "Two" },
          ],
        });
        assert.equal(s.pill!.text, "One");
        assert.equal(s.pill!.ariaDisabled, null);
        assert.equal(s.pill!.hasPopup, "menu");
        assert.equal(s.pill!.target, "widget-model");
      });

      await t.test("a host that says nothing gets no pill, as before", async () => {
        for (const options of [{}, { modelsUnavailable: false }, { models: [] }])
          assert.equal((await look([1280, 800], "en", options)).pill, null);
      });
    });
  }
);
