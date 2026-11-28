import test from "node:test";
import assert from "node:assert/strict";
import { SKIP_WITHOUT_CHROME, withBrowser } from "./aiw-browser.ts";

/**
 * AN "OPEN" BUTTON OPENS ITS PAGE, OR SAYS IT COULD NOT (3.3.1).
 *
 * A step that produced a report replays with "Open the report", and a
 * finished job with "Open the result". Both go through the navigation gate,
 * which matches the path against the host's page list. That list is written
 * relative to where the host mounts it (`/reports/:reportId`), and a host's
 * `reportHref` returns the full address its links need
 * (`/accounts/a1/reports/r1`), so the gate refused the report button on
 * every press, and the button came back with nothing said: a dead click.
 *
 * These pin the two halves: `reportPath` hands the gate the path as the page
 * list writes it (and `reportHref` keeps feeding links), and a refused press
 * says so under the button, in the window's words.
 */

/** Runs in the page: a window restoring thread th-1, whose transcript holds
 *  one report step, and a host that records every action it is asked for. */
const MOUNT = (hooks: {
  reportPath?: string | null;
  jobResultPath?: string;
}): void => {
  type Host = {
    T: { actions: Array<{ name: string; data: Record<string, string> }> };
    SgiantAiWidget: {
      createAiChatWidget: (o: Record<string, unknown>) => { open(): void };
    };
  };
  const g = globalThis as unknown as Host;
  g.T = { actions: [] };
  // A thread this browser was in: the window reads it again on load.
  localStorage.setItem(
    "aiw:v1:open-test",
    JSON.stringify({ threadId: "th-1", messages: [], savedAt: Date.now() })
  );
  const at = (s: string) => `2026-11-28T10:00:${s}.000Z`;
  const report = {
    id: "r1",
    type: "report",
    status: "done",
    resultPath: hooks.jobResultPath,
  };
  const w = g.SgiantAiWidget.createAiChatWidget({
    endpoint: "/demo-chat",
    title: "Assistant",
    persistKey: "open-test",
    getToken: () => Promise.resolve("tok"),
    // The host's page list, as a host declares it: relative to the account.
    getContext: async () => ({
      navTargets: [{ path: "/reports" }, { path: "/reports/:reportId" }],
    }),
    loadThread: async () => ({
      messages: [
        { id: "u1", parentId: null, role: "user", content: "Write the report", createdAt: at("00") },
        { id: "a1", parentId: "u1", role: "assistant", content: "It is ready.", createdAt: at("30") },
      ],
      artifacts: [
        {
          kind: "activity",
          createdAt: at("10"),
          payload: { label: "Writing the report", status: "ok", reportId: "r1" },
        },
      ],
      activePath: ["u1", "a1"],
    }),
    reportHref: (id: string) => `/accounts/a1/reports/${id}`,
    ...(hooks.reportPath === undefined
      ? {}
      : { reportPath: (id: string) => (hooks.reportPath === null ? "" : `${hooks.reportPath}${id}`) }),
    ...(hooks.jobResultPath === undefined
      ? {}
      : {
          getReport: async () => report,
          listThreadJobs: async () => [report],
        }),
    onWidgetAction: async (name: string, data: Record<string, string>) => {
      g.T.actions.push({ name, data });
      return "Opened";
    },
  });
  w.open();
};

/** Runs in the page: press the button (`.act-open` or the job card's), wait,
 *  and read what a person sees. */
const PRESS = async (which: "step" | "job") => {
  const P = "sgiant-aiw";
  const find = () =>
    (which === "step"
      ? document.querySelector(`.${P}-activity .${P}-act-open`)
      : document.querySelector(`.${P}-job .${P}-nav-btn`)) as HTMLButtonElement | null;
  for (let i = 0; i < 40 && !find(); i++) await new Promise((r) => setTimeout(r, 50));
  const btn = find();
  if (!btn) return null;
  btn.click();
  await new Promise((r) => setTimeout(r, 200));
  const lines = [...document.querySelectorAll(`.${P}-open-err`)];
  const g = globalThis as unknown as {
    T: { actions: Array<{ name: string; data: Record<string, string> }> };
  };
  return {
    actions: g.T.actions,
    refusal: lines.map((l) => l.textContent),
    role: lines[0]?.getAttribute("role") ?? null,
    disabled: btn.disabled,
  };
};

const STEP_BUTTONS = async () => {
  await new Promise((r) => setTimeout(r, 600));
  return document.querySelectorAll(".sgiant-aiw-activity .sgiant-aiw-act-open").length;
};

test(
  "in a browser: the report and result buttons open their page, or say they could not",
  { skip: SKIP_WITHOUT_CHROME },
  async (t) => {
    await withBrowser(async (page) => {
      const mount = async (hooks: Record<string, unknown>) => {
        await page.open([1280, 800]);
        await page.evaluate(`(${MOUNT})(${JSON.stringify(hooks)})`);
      };
      type Pressed = Awaited<ReturnType<typeof PRESS>>;

      await t.test("reportPath: the step's button opens the page the list names", async () => {
        await mount({ reportPath: "/reports/" });
        const r = await page.evaluate<Pressed>(`(${PRESS})("step")`);
        assert.ok(r, "the replayed step has its button");
        assert.deepEqual(r.actions, [{ name: "navigate", data: { path: "/reports/r1" } }]);
        assert.deepEqual(r.refusal, []);
      });

      await t.test("reportHref alone: refused by the gate, and said under the step", async () => {
        await mount({});
        const r = await page.evaluate<Pressed>(`(${PRESS})("step")`);
        assert.ok(r, "the replayed step has its button");
        // The gate is not loosened: a full address is still not a listed page.
        assert.deepEqual(r.actions, []);
        assert.deepEqual(r.refusal, ["That page could not be opened."]);
        assert.equal(r.role, "status");
        assert.equal(r.disabled, false, "the button is usable again");
        // A second refused press says it once, not twice.
        const again = await page.evaluate<Pressed>(`(${PRESS})("step")`);
        assert.deepEqual(again!.refusal, ["That page could not be opened."]);
      });

      await t.test("a reportPath that answers nothing draws no button", async () => {
        await mount({ reportPath: null });
        assert.equal(await page.evaluate<number>(`(${STEP_BUTTONS})()`), 0);
      });

      await t.test("a finished job's result: opened when listed, refused out loud when not", async () => {
        await mount({ reportPath: "/reports/", jobResultPath: "/reports/r1" });
        const ok = await page.evaluate<Pressed>(`(${PRESS})("job")`);
        assert.ok(ok, "the job card has its button");
        assert.deepEqual(ok.actions, [{ name: "navigate", data: { path: "/reports/r1" } }]);
        assert.deepEqual(ok.refusal, []);

        await mount({ reportPath: "/reports/", jobResultPath: "/accounts/a1/reports/r1" });
        const no = await page.evaluate<Pressed>(`(${PRESS})("job")`);
        assert.ok(no, "the job card has its button");
        assert.deepEqual(no.actions, []);
        assert.deepEqual(no.refusal, ["That page could not be opened."]);
        assert.equal(no.disabled, false);
      });
    });
  }
);
