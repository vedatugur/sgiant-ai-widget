import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * A REAL BROWSER, FOR THE TESTS THAT NEED ONE.
 *
 * Some claims about the widget are only true or false in a browser: that
 * nothing is clipped, that a handler really runs inside the click. This drives
 * a Chrome over its own debugging socket, so there is nothing to install.
 *
 * OPT-IN: `AIW_CHROME=<path to a Chrome>`. This package has no browser among
 * its dependencies, and a publish gate that quietly starts depending on
 * whatever Chrome the runner image carries is a gate that breaks on someone
 * else's schedule. Without the variable these tests are skipped, and say so.
 */
export const CHROME = process.env.AIW_CHROME;
export const SKIP_WITHOUT_CHROME = CHROME
  ? false
  : "set AIW_CHROME=<path to Chrome> to run this in a browser";

const BUNDLE = join(import.meta.dirname, "..", "dist", "sgiant-ai-widget.global.js");

export interface Page {
  /** A fresh document at this viewport with the built bundle loaded, so no
   *  case inherits another's widget or storage. */
  open(viewport: readonly [number, number]): Promise<void>;
  /** Evaluate an expression in the page; a promise is awaited. */
  evaluate<T = unknown>(expression: string): Promise<T>;
  /** A real mouse click at a point, the kind that carries user activation. */
  click(x: number, y: number): Promise<void>;
}

export async function withBrowser(fn: (page: Page) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "aiw-browser-"));
  const harness = join(dir, "harness.html");
  writeFileSync(
    harness,
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body><script src="${pathToFileURL(BUNDLE)}"></script>`
  );
  const proc = spawn(
    CHROME!,
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
      evaluate,
      async open(viewport) {
        await send(
          "Emulation.setDeviceMetricsOverride",
          { width: viewport[0], height: viewport[1], deviceScaleFactor: 1, mobile: false },
          sessionId
        );
        await send("Page.navigate", { url: `${pathToFileURL(harness)}?${++seq}` }, sessionId);
        for (let i = 0; ; i++) {
          const ready = await evaluate(
            "document.readyState === 'complete' && typeof SgiantAiWidget"
          ).catch(() => false);
          if (ready === "object") break;
          assert.ok(i < 100, "the bundle never loaded in the page");
          await new Promise((r) => setTimeout(r, 50));
        }
        await evaluate("localStorage.clear()");
      },
      async click(x, y) {
        for (const type of ["mousePressed", "mouseReleased"])
          await send(
            "Input.dispatchMouseEvent",
            { type, x, y, button: "left", clickCount: 1 },
            sessionId
          );
      },
    });
    ws.close();
  } finally {
    proc.kill();
    await new Promise((r) => (proc.exitCode === null ? proc.once("exit", r) : r(null)));
    rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
  }
}
