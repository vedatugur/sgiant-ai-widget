import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createHostActions,
  isNavigationAction,
} from "../dist/host-actions.js";

/**
 * THE WIDGET KNOWS NO PRODUCT'S ACTIONS (2.0.0, audit F130).
 *
 * Until 2.0.0 `createHostActions` registered sgiant's four named actions on
 * every host, with sgiant's routes: "open-billing" went to `/billing` on the
 * marketing site and the hub too, pages neither has, and a host had to know to
 * pass `standardActions: false` to be spared. A stranger's widget has no
 * business knowing /billing.
 *
 * Now the widget runs `navigate` and the on-page controls, and nothing else
 * unless the host hands it a handler. sgiant's actions live in
 * `@sgiant/ai-contract` (names and paths) and `@sgiant/ai-apply` (handlers).
 */
const dispatcher = (handlers?: Record<string, () => string>) => {
  const navigated: string[] = [];
  const act = createHostActions({
    navigate: (p: string) => navigated.push(p),
    ...(handlers ? { handlers } : {}),
  });
  return { act, navigated };
};

test("a named action the host did not hand over is refused, never guessed", async () => {
  const { act, navigated } = dispatcher();
  for (const name of [
    "open-dashboards",
    "open-dashboard-builder",
    "open-billing",
    "open-assets",
    "show-assets",
  ]) {
    await assert.rejects(() => act(name, {}), /unsupported action/, name);
  }
  assert.deepEqual(navigated, [], "a refused action navigated anyway");
});

test("the host's own handler runs, by name", async () => {
  const { act } = dispatcher({ "open-billing": () => "Opened billing" });
  assert.equal(await act("open-billing", {}), "Opened billing");
});

test("only navigate is navigation unless the host names more", () => {
  assert.ok(isNavigationAction("navigate"));
  assert.ok(!isNavigationAction("open-dashboards"));
  assert.ok(!isNavigationAction("show-assets"));
  assert.ok(isNavigationAction("show-assets", ["show-assets"]));
  // Things that spend or mutate are never navigation by default.
  assert.ok(!isNavigationAction("fill"));
  assert.ok(!isNavigationAction("click"));
});

test("the UI-control half needs no handler — it is the widget's own", async () => {
  const { act } = dispatcher();
  // No `document` here, so the DOM layer is what refuses. Reaching ITS message
  // proves the control path is wired without any host handler.
  await assert.rejects(
    () => act("highlight", { target: "some-page-control" }),
    /no such control on this page/,
  );
});

test("no sgiant route is written anywhere in the widget's source", () => {
  const dir = join(import.meta.dirname, "..", "src");
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".ts"))) {
    const code = readFileSync(join(dir, f), "utf8")
      // Comments may name the history; code may not carry the routes.
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    assert.doesNotMatch(
      code,
      /["'`]\/(billing|dashboards|assets)\b/,
      `${f} carries a sgiant route`,
    );
  }
});
