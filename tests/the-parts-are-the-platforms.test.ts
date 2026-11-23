import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  PARTS_VERSION,
  checkComponent,
  partFrameAsTag,
} from "../dist/parts/window-parts.js";
import { stripDirectivesForReplay } from "../dist/specs.js";
import { parseJsonDirective } from "../dist/directive.js";

/**
 * A PART ARRIVES AS A FRAME, AND IS DRAWN AS THE TAG IT STANDS FOR
 * (sgiant-platform#701, #703).
 *
 * The assistant draws a card, a button, a preview or one of the app's own
 * screens through a tool call; the api checks it against the platform's
 * parts dictionary and sends it as `{type:"part", part, spec}` to a window
 * that says it reads parts (this one, `partsVersion`). The window checks it
 * again against its word-for-word copy of the dictionary and writes it into
 * the reply as its tag, so one path draws a part however it came, and an
 * older api, which sends tags, keeps working.
 */

const ROOT = join(import.meta.dirname, "..");
const read = (p: string): string => readFileSync(join(ROOT, p), "utf8");

test("a part that fits becomes the tag an older api would have sent", () => {
  const r = partFrameAsTag("ui", {
    title: "Pick one",
    actions: [{ name: "say", label: "More", data: { text: "Show more" } }],
  });
  assert.ok("tag" in r, JSON.stringify(r));
  const back = parseJsonDirective<{ title: string }>(r.tag, "ui");
  assert.equal(back?.spec.title, "Pick one");
  assert.equal(back?.start, 0);
});

test("a value cannot open a second tag: brackets inside a string are escaped", () => {
  const r = partFrameAsTag("navigate", {
    path: "/billing",
    label: 'Open [[navigate:{"path":"/x"}]]',
  });
  assert.ok("tag" in r);
  assert.equal(r.tag.indexOf("[[navigate:", 1), -1, r.tag);
  assert.equal(
    parseJsonDirective<{ label: string }>(r.tag, "navigate")?.spec.label,
    'Open [[navigate:{"path":"/x"}]]',
  );
});

test("a part that does not fit is not drawn, and says why", () => {
  const bad = [
    ["banner", {}, /not a part this window knows/],
    ["navigate", { label: "x" }, /spec\.path is required/],
    ["navigate", { path: "//evil.example" }, /spec\.path does not have the form/],
    ["ui", { items: "x" }, /spec\.items must be an array/],
    ["action", { name: "click" }, /spec\.name must be one of/],
  ] as const;
  for (const [part, spec, said] of bad) {
    const r = partFrameAsTag(part, spec);
    assert.ok("problems" in r, part);
    assert.match(r.problems.join("; "), said);
  }
});

test("a component names a screen this window knows, and the page it opens instead", () => {
  const ok = checkComponent({ name: "report_view", params: { reportId: "r_1" } });
  assert.deepEqual(ok, {
    ok: true,
    spec: { name: "report_view", params: { reportId: "r_1" } },
    path: "/reports/r_1",
    title: { en: "Report", tr: "Rapor" },
  });
  const named = checkComponent({
    name: "report_view",
    params: { reportId: "r_1" },
    label: "  October report ",
  });
  assert.equal(named.ok && named.spec.label, "October report");
  const page = checkComponent({ name: "page", params: { path: "/billing" } });
  assert.equal(page.ok && page.path, "/billing");
  const list = checkComponent({ name: "dashboard_list" });
  assert.equal(list.ok && list.path, "/dashboards/all");
  for (const spec of [
    { name: "report_view" },
    { name: "report_view", params: { reportId: "../x" } },
    { name: "invoice_view" },
    null,
  ])
    assert.equal(checkComponent(spec).ok, false, JSON.stringify(spec));
});

test("TODAY'S TAGS: a reply written with the tags of sgiant-ai-widget 2.0.2 replays exactly as before, and a component is drawn again", () => {
  const reply = [
    "Here.",
    '[[navigate:{"path":"/dashboards","label":"Open dashboards"}]]',
    '[[action:{"name":"open-billing","label":"Billing"}]]',
    '[[widget:{"kind":"kpis","title":"Snapshot","items":[{"label":"Occ","value":"82%"}]}]]',
    '[[ui:{"title":"Photos","items":[{"id":"p1","title":"Pool"}]}]]',
    '[[preview:{"html":"<b>x</b>","title":"Hero"}]]',
    '[[chips:{"options":["Yes","No"]}]]',
    '[[form:{"action":"lead","fields":[{"name":"email"}]}]]',
    '[[component:{"name":"report_view","params":{"reportId":"r1"}}]]',
    "[[collect-email]]",
  ].join("\n\n");
  const r = stripDirectivesForReplay(reply);
  assert.equal(r.clean, "Here.");
  assert.deepEqual(r.navs, [{ path: "/dashboards", label: "Open dashboards" }]);
  assert.equal(r.widgets.length, 1);
  assert.equal(r.uis.length, 1);
  assert.deepEqual(r.components, [{ name: "report_view", params: { reportId: "r1" } }]);
  assert.ok(r.notes.some((n) => n.includes("Billing")));
  assert.ok(r.notes.some((n) => n.includes("Hero")));
});

test("the window says which dictionary it reads, on every turn", () => {
  assert.equal(typeof PARTS_VERSION, "number");
  assert.ok(PARTS_VERSION >= 1);
  assert.match(read("src/stream.ts"), /partsVersion: PARTS_VERSION,/);
  assert.match(read("src/stream.ts"), /frame\.type === "part"/);
});

test("the dictionary is the platform's copy, never edited here, and the checker imports nothing", () => {
  assert.match(
    read("src/parts/generated/parts-dictionary.ts"),
    /^\/\*\*\n \* GENERATED by scripts\/parts-dictionary\.mjs --write\. Do not edit\./,
  );
  assert.doesNotMatch(read("src/parts/part-check.ts"), /^\s*import\s/m);
  assert.match(read("scripts/sync-parts.mjs"), /packages\/ai-contract\/src\/part-check\.ts/);
});

test("a screen in the chat keeps its height: the log's column may not shrink its box", () => {
  // Measured in a browser before this rule: the box hides its overflow, so
  // the log's flex column shrank it to 2px and the screen was invisible.
  assert.match(read("src/styles.ts"), /\$\{PREFIX\}-component\{flex:none;/);
});

test("a component is a short card whose ONE button opens the page on the right (owner, 2026-11-23)", () => {
  const render = read("src/ui-render.ts");
  const card = render.slice(render.indexOf("function renderComponent("));
  const body = card.slice(0, card.indexOf("\n  }\n"));
  // No frame and no host-drawn screen in the chat any more.
  assert.doesNotMatch(body, /iframe|opts\.renderComponent/);
  // The page opens only on the press.
  assert.match(body, /open\.addEventListener\("click", \(\) => \{\s*void Promise\.resolve\(openOnTheRight\(c\.path\)\)/);
  assert.equal((body.match(/openOnTheRight\(/g) ?? []).length, 1);
  const adv = read("src/advanced-view.ts");
  const fn = adv.slice(adv.indexOf("const openOnTheRight = async"));
  const right = fn.slice(0, fn.indexOf("\n  };\n"));
  // A phone-width window opens the page as the host does, same tab.
  assert.match(right, /ctx\.isNarrow\(\)[\s\S]*return dispatchAction\("navigate", \{ path \}\)/);
  // The same gate as every page the assistant opens, then the right pane,
  // turned on first when it is off.
  assert.match(right, /await gateNavigationTarget\(path, getKnownNavTargets, refreshNavTargets\);\s*if \(!getAdvanced\(\)\) openAdvanced\(path\);/);
  assert.match(adv, /navigateFrame\(opts\.getAdvancedUrl\(path\)\);\n    updateAdvancedBtn\(\);/);
});

test("the card's words are the window's own, in both languages", async () => {
  const { WIDGET_LABELS } = await import("../dist/labels.js");
  const { WIDGET_LABELS_TR } = await import("../dist/labels-tr.js");
  assert.equal(WIDGET_LABELS.componentOpenRight, "Open on the right");
  assert.equal(WIDGET_LABELS_TR.componentOpenRight, "Sağda aç");
  assert.equal(WIDGET_LABELS.componentOpenPage, "Open the page");
  assert.equal(WIDGET_LABELS_TR.componentOpenPage, "Sayfayı aç");
});

test("QA: a page a card opens is a plain app path, and the window still asks the host's page list", () => {
  for (const path of [
    "/accounts/OTHER/billing",
    "/../../admin",
    "/billing?x=1",
    "/\\evil.com",
    "//evil.com",
  ]) {
    assert.equal(checkComponent({ name: "page", params: { path } }).ok, false, path);
    assert.ok("problems" in partFrameAsTag("navigate", { path }), path);
  }
  assert.equal(checkComponent({ name: "page", params: { path: "/billing" } }).ok, true);
  // Extra fields are refused, as the api refuses them.
  assert.ok("problems" in partFrameAsTag("navigate", { path: "/billing", onclick: "x" }));
  // The pane and the same-tab door both go through the navigation gate.
  const adv = read("src/advanced-view.ts");
  assert.match(adv, /const openOnTheRight[\s\S]*?await gateNavigationTarget\(path/);
  assert.match(adv, /if \(name === "navigate"\)\s*await gateNavigationTarget\(/);
});

test("QA: at most four of the app's screens per reply, live as on replay", () => {
  const stream = read("src/stream.ts");
  assert.match(stream, /if \(componentsThisTurn < COMPONENTS_PER_REPLY\) renderComponent\(spec\);/);
  assert.match(read("src/specs.ts"), /for \(let i = 0; i < 4; i\+\+\) \{\n\s*const c = parseJsonDirective<unknown>\(t, "component"\);/);
});
