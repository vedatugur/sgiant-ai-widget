import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { widgetStyles } from "./aiw-source.ts";

/**
 * THE COMPOSER ROW FITS THE WINDOW, WHATEVER THE HOST PUTS IN IT
 * (sgiant-platform#617).
 *
 * With the model pill in the row, Send ended 7.2px past the panel's edge and
 * was clipped: measured in the hub and in two customers' wp-admin on 1.19.0, at
 * the default 368px, with "Sonnet 5.5" chosen. "Opus 5.5" happened to fit,
 * which is why it shipped.
 *
 * The cause was one missing declaration. The text field was `flex:1`, and a
 * flex item's automatic minimum is its content size: for an <input> that is
 * its built-in width (20 characters, 180px here), so the one item in the row
 * that was SUPPOSED to give way was the one that could not. The row overflowed
 * instead, and the panel's `overflow:hidden` cut off whatever came last.
 *
 * Two layers, on purpose. The first reads the stylesheet and runs everywhere,
 * including the release job. The second measures the row in a real browser,
 * because "the declaration is there" and "nothing is clipped" are different
 * claims and only the second is the one anyone cares about. It is opt-in
 * (AIW_CHROME=<path to a Chrome>): this package has no browser among its
 * dependencies, and a publish gate that quietly starts depending on whatever
 * Chrome the runner image carries is a gate that breaks on someone else's
 * schedule.
 */

/** One rule's declarations, by exact selector, outside any media query. */
function rule(selector: string): string {
  const at = widgetStyles.indexOf(`\n.\${PREFIX}-${selector}{`);
  assert.ok(at >= 0, `no .${selector} rule in the stylesheet`);
  const open = widgetStyles.indexOf("{", at + 10);
  return widgetStyles.slice(open + 1, widgetStyles.indexOf("}", open));
}

/** The text field never gets narrower than this, border to border; the pill
 *  gives way first. */
const INPUT_FLOOR = 96;

test("the text field is allowed to shrink, down to a floor it keeps", () => {
  const input = rule("input");
  assert.match(input, /(^|;)flex:1(;|$)/, "the field no longer takes the slack");
  // The declaration whose absence was the bug. `min-width:auto` (the default)
  // resolves to the input's built-in 180px; any explicit length replaces it.
  assert.match(
    input,
    new RegExp(`(^|;)min-width:${INPUT_FLOOR}px(;|$)`),
    "the composer's text field has no explicit min-width, so it cannot shrink below its built-in width"
  );
  // The floor is a promise about the box the person sees, padding included.
  assert.match(input, /(^|;)box-sizing:border-box(;|$)/);
});

test("the pill gives way before the text field does", () => {
  // A long model name is the host's to send and not ours to forbid, so the row
  // has to have an answer for it: the pill shrinks and truncates its own
  // label. `flex:0 0 auto` (what it was) made it rigid, which left only the
  // text field to absorb a long name.
  const model = rule("model");
  assert.match(model, /(^|;)flex:0 1 auto(;|$)/, "the pill cannot shrink");
  assert.match(model, /(^|;)min-width:\d+px(;|$)/, "the pill has no floor");
  // Its button and label must be shrinkable too, or the wrapper shrinks and
  // the button pokes out of it.
  assert.match(rule("model-btn"), /(^|;)min-width:0(;|$)/);
  assert.match(rule("model-name"), /text-overflow:ellipsis/);
  // And the two fixed ends stay whole.
  assert.match(rule("attach"), /(^|;)flex:0 0 auto(;|$)/);
  assert.match(rule("send"), /(^|;)flex:0 0 auto(;|$)/);
});

test("the model menu hangs from the row, so it cannot start before the window", () => {
  // Found by QA on the first version of this fix: hung from the pill, a 266px
  // menu began 30 to 46px left of a 320px window once the pill had moved left.
  // The row spans the panel; the pill does not.
  assert.match(rule("form"), /(^|;)position:relative(;|$)/);
  assert.doesNotMatch(rule("model"), /position:relative/, "the menu is hung from the pill again");
  const menu = widgetStyles.match(/\n\.\$\{PREFIX\}-menu\.\$\{PREFIX\}-model-menu\{([^}]*)\}/)?.[1] ?? "";
  assert.match(menu, /(^|;)max-width:calc\(100% - 20px\)(;|$)/, "the menu is not capped at the row's width");
  assert.match(menu, /(^|;)right:10px(;|$)/);
});

// ── Measured ───────────────────────────────────────────────────────────────

const CHROME = process.env.AIW_CHROME;
const BUNDLE = join(import.meta.dirname, "..", "dist", "sgiant-ai-widget.global.js");

/** What the button says: the widget's own English, and the hub's Turkish,
 *  which is 15px wider and is what a real host sends. */
const SENDS = ["Send", "Gönder"];

/** The names the api offers today, and one longer than any of them. */
const REAL = ["Haiku 4.5", "Sonnet 5.5", "Opus 5.5", "Fable 5.1"];
const LONG = "Example Vendor Extra Large Preview 2026";

/** The widths the panel can be: its default, an ordinary phone, the two
 *  narrower ones where the menu used to leave the window, the narrowest it is
 *  ever allowed (a 320px phone, and the advanced chat column's own clamp), and
 *  expanded. Viewport in, panel width out. `whole`: a name the api really
 *  offers is shown uncut there; below 360px it may end in an ellipsis. */
const WINDOWS = [
  { name: "default", viewport: [1280, 800], expanded: false, panel: 368, whole: true },
  { name: "phone", viewport: [360, 740], expanded: false, panel: 360, whole: true },
  { name: "phone", viewport: [340, 700], expanded: false, panel: 340, whole: false },
  { name: "narrowest", viewport: [320, 640], expanded: false, panel: 320, whole: false },
  { name: "expanded", viewport: [1280, 800], expanded: true, panel: 760, whole: true },
] as const;

interface Box {
  left: number;
  right: number;
  width: number;
}
interface Measured {
  panel: Box;
  rowRight: number;
  input: Box;
  send: Box;
  pill: Box;
  attach: Box | null;
  labelCut: boolean;
  /** The open menu, and whether the chosen name is shown whole inside it. */
  menu: Box;
  menuNameCut: boolean;
}

/** Runs in the page. Mounts the widget and measures the composer row. */
const MEASURE = async (o: {
  label: string;
  attach: boolean;
  expanded: boolean;
  send?: string;
}): Promise<Measured> => {
  localStorage.clear();
  const w = (globalThis as any).SgiantAiWidget.createAiChatWidget({
    endpoint: "/nowhere",
    title: "Aria",
    models: [{ id: "m", label: o.label }],
    ...(o.attach ? { uploadEndpoint: "/nowhere" } : {}),
    ...(o.send ? { labels: { send: o.send } } : {}),
  });
  w.open();
  const q = (t: string) =>
    document.querySelector(`[data-ai-target="${t}"]`) as HTMLElement | null;
  if (o.expanded) q("widget-expand")!.click();
  // The panel animates in and its width transitions; measure the settled row.
  await new Promise((r) => setTimeout(r, 450));
  const box = (e: Element): Box => {
    const r = e.getBoundingClientRect();
    return { left: r.left, right: r.right, width: r.width };
  };
  const input = q("widget-composer")!;
  const form = input.closest("form")!;
  const pill = q("widget-model")!;
  const name = pill.firstElementChild as HTMLElement;
  const attach = q("widget-attach");
  const row = {
    input: box(input),
    send: box(form.querySelector('button[type="submit"]')!),
    pill: box(pill),
    labelCut: name.scrollWidth > name.clientWidth,
  };
  // Then open the menu, the way a person would, and measure that too.
  pill.click();
  await new Promise((r) => setTimeout(r, 250));
  const menu = form.querySelector('[role="menu"]')!;
  const chosen = menu.querySelector('[aria-checked="true"] span span') as HTMLElement;
  return {
    ...row,
    menu: box(menu),
    menuNameCut: chosen.scrollWidth > chosen.clientWidth,
    panel: box(form.parentElement!.closest('[class*="-panel"]')!),
    rowRight:
      form.getBoundingClientRect().right -
      parseFloat(getComputedStyle(form).paddingRight),
    attach: attach ? box(attach) : null,
  };
};

/** A Chrome, driven over its own debugging socket: no dependency to install. */
async function withPage(
  chrome: string,
  fn: (page: {
    measure(viewport: readonly [number, number], o: Parameters<typeof MEASURE>[0]): Promise<Measured>;
  }) => Promise<void>
): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "aiw-composer-"));
  const harness = join(dir, "harness.html");
  writeFileSync(
    harness,
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body><script src="${pathToFileURL(BUNDLE)}"></script>`
  );
  const proc = spawn(
    chrome,
    ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${join(dir, "profile")}`, "--no-first-run", "--hide-scrollbars", "about:blank"],
    { stdio: ["ignore", "ignore", "pipe"] }
  );
  try {
    const wsUrl = await new Promise<string>((resolve, reject) => {
      let err = "";
      proc.stderr.on("data", (d) => {
        err += d;
        const m = err.match(/DevTools listening on (ws:\/\/\S+)/);
        if (m) resolve(m[1]!);
      });
      proc.on("exit", () => reject(new Error(`Chrome exited early: ${err}`)));
      setTimeout(() => reject(new Error(`Chrome never listened: ${err}`)), 20_000);
    });
    const ws = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = () => reject(new Error("could not reach Chrome"));
    });
    let seq = 0;
    const waiting = new Map<number, (m: any) => void>();
    ws.onmessage = (e) => {
      const m = JSON.parse(String(e.data));
      if (m.id && waiting.has(m.id)) {
        waiting.get(m.id)!(m);
        waiting.delete(m.id);
      }
    };
    const send = (method: string, params: object = {}, sessionId?: string) =>
      new Promise<any>((resolve, reject) => {
        const id = ++seq;
        waiting.set(id, (m) =>
          m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result)
        );
        ws.send(JSON.stringify({ id, method, params, sessionId }));
      });
    const { targetId } = await send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
    const evaluate = async (expression: string): Promise<any> => {
      const r = await send(
        "Runtime.evaluate",
        { expression, awaitPromise: true, returnByValue: true },
        sessionId
      );
      if (r.exceptionDetails)
        throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
      return r.result.value;
    };
    await fn({
      async measure(viewport, o) {
        await send(
          "Emulation.setDeviceMetricsOverride",
          { width: viewport[0], height: viewport[1], deviceScaleFactor: 1, mobile: false },
          sessionId
        );
        // A fresh document per case, so no case inherits another's widget.
        await send("Page.navigate", { url: `${pathToFileURL(harness)}?${++seq}` }, sessionId);
        for (let i = 0; ; i++) {
          const ready = await evaluate(
            "document.readyState === 'complete' && typeof SgiantAiWidget"
          ).catch(() => false);
          if (ready === "object") break;
          assert.ok(i < 100, "the bundle never loaded in the page");
          await new Promise((r) => setTimeout(r, 50));
        }
        return evaluate(`(${MEASURE})(${JSON.stringify(o)})`);
      },
    });
    ws.close();
  } finally {
    proc.kill();
    await new Promise((r) => (proc.exitCode === null ? proc.once("exit", r) : r(null)));
    rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
  }
}

test(
  "measured: nothing in the composer row is past the window's edge",
  { skip: CHROME ? false : "set AIW_CHROME=<path to Chrome> to measure in a browser" },
  async () => {
    const failures: string[] = [];
    const lines: string[] = [];
    await withPage(CHROME!, async (page) => {
      for (const win of WINDOWS) {
        for (const attach of [false, true]) {
          for (const send of SENDS) {
            for (const label of [...REAL, LONG]) {
              const m = await page.measure(win.viewport, {
                label,
                attach,
                expanded: win.expanded,
                send,
              });
              const where = `${win.name} ${m.panel.width}px, ${attach ? "with" : "no"} attach, "${send}", "${label}"`;
              lines.push(
                `${where}: field ${m.input.width.toFixed(1)}, pill ${m.pill.width.toFixed(1)}${m.labelCut ? " (cut)" : ""}, send ends ${(m.panel.right - m.send.right).toFixed(1)} inside, menu ${(m.menu.left - m.panel.left).toFixed(1)} to ${(m.panel.right - m.menu.right).toFixed(1)} inside`
              );
              const check = (ok: boolean, what: string) => {
                if (!ok) failures.push(`${where}: ${what}`);
              };
              check(Math.abs(m.panel.width - win.panel) < 0.5, `the window is ${m.panel.width}px, not ${win.panel}px`);
              // The row's own content edge, which is stricter than the window's.
              check(m.send.right <= m.rowRight + 0.5, `Send ends ${(m.send.right - m.rowRight).toFixed(1)}px past the row (${(m.send.right - m.panel.right).toFixed(1)}px past the window)`);
              check(m.pill.right <= m.send.left + 0.5, "the pill runs under Send");
              check(m.input.width >= INPUT_FLOOR - 0.5, `the text field is ${m.input.width.toFixed(1)}px wide`);
              check(m.send.width >= 40, `Send is ${m.send.width.toFixed(1)}px wide`);
              if (m.attach) check(Math.abs(m.attach.width - 38) < 0.5, `the attach button is ${m.attach.width.toFixed(1)}px wide`);
              if (label !== LONG && win.whole) check(!m.labelCut, "the model's name is cut short");
              if (label === LONG) check(m.labelCut, "a long name pushed the row instead of being cut");
              // The menu is where a cut name is read in full, so it is held to
              // more than the pill: wholly inside the window, name uncut.
              check(m.menu.left >= m.panel.left - 0.5, `the menu starts ${(m.panel.left - m.menu.left).toFixed(1)}px before the window`);
              check(m.menu.right <= m.panel.right + 0.5, `the menu ends ${(m.menu.right - m.panel.right).toFixed(1)}px past the window`);
              check(!m.menuNameCut, "the name is cut in the menu too, so it is nowhere in full");
            }
          }
        }
      }
      // THE RULE AT THE VERY BOTTOM. At 320px with attach, the fixed ends and
      // the two floors leave Send 94px. A label wider than that is the one
      // thing this row does not absorb, and this is what it does then: Send
      // runs past the row's padding. Recorded rather than asserted away, so a
      // change to it is a decision and not a surprise.
      const wide = await page.measure([320, 640], {
        label: "Sonnet 5.5",
        attach: true,
        expanded: false,
        send: "Gönderiliyor",
      });
      lines.push(
        `narrowest 320px, with attach, a ${wide.send.width.toFixed(1)}px Send ("Gönderiliyor"): field ${wide.input.width.toFixed(1)}, pill ${wide.pill.width.toFixed(1)}, send ends ${(wide.panel.right - wide.send.right).toFixed(1)} inside the window`
      );
      if (wide.send.width <= 94) failures.push("the wide label is not wider than 94px: pick a wider one");
      if (wide.input.width < INPUT_FLOOR - 0.5) failures.push("a wide Send label took the field below its floor");
    });
    console.log(lines.join("\n"));
    assert.deepEqual(failures, []);
  }
);
