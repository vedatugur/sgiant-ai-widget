import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { widgetSrc, widgetStyles } from "./aiw-source.ts";

/**
 * The automation switches — auto-navigate and auto-apply.
 *
 * EVERY ASSERTION HERE CORRESPONDS TO A BUG THAT SHIPPED PAST A CLEAN BUILD.
 * The feature typechecked and the existing 96 tests passed while the widget
 * did not mount at all, the explainer rendered as a blank rectangle, and the
 * menu sat on top of the panel it had just opened. None of it threw where a
 * test was looking; all of it was obvious the moment a page was opened.
 */

const STYLES = widgetStyles;

test("the toggle does not read advanced-view state before it is declared", () => {
  // THE CRASH: `advanced` is a `let`. The auto-navigate toggle reads it while
  // the header menu is being BUILT, and the declaration used to sit ~2000 lines
  // further down — inside its temporal dead zone at that moment. The access
  // threw "Cannot access 'advanced' before initialization" and took the whole
  // widget down on mount: no bubble, no panel, nothing.
  const src = readFileSync("src/index.ts", "utf8");
  const declared = src.indexOf("let advanced = false;");
  const readAt = src.indexOf("const pinned = advanced;");
  assert.ok(declared > 0, "`advanced` must be declared");
  assert.ok(readAt > 0, "the toggle must read it");
  assert.ok(
    declared < readAt,
    "`advanced` is read while the menu is built — declaring it later puts it in its temporal dead zone and the widget does not mount at all"
  );
});

test("the automation panel invents no custom properties", () => {
  // THE INVISIBLE PANEL: `--aiw-panel-bg`, `--aiw-shadow-lg` and `--aiw-hover-bg`
  // were invented. An undefined var inside `color-mix()` invalidates the WHOLE
  // declaration, so the scrim computed to rgba(0,0,0,0) and the panel read as a
  // blank rectangle over the chat.
  //
  // NOT "every token must be defined here" — that was this test's first rule and
  // it was wrong: the widget deliberately CONSUMES tokens it never defines
  // (`--aiw-fg` is host-overridable, and that is the theming contract). The real
  // property is narrower: a token must either belong to the established
  // vocabulary — used somewhere else in the stylesheet — or carry a fallback.
  // An invented name has neither, which is exactly how it renders as nothing.
  const at = STYLES.indexOf("-automation{");
  assert.ok(at > 0, "the automation styles must exist");
  const block = STYLES.slice(at, at + 1600);
  const elsewhere = STYLES.slice(0, at) + STYLES.slice(at + 1600);
  const bare = [...block.matchAll(/var\((--aiw-[a-z0-9-]+)\s*\)/g)].map((m) => m[1]);
  const unknown = [...new Set(bare)].filter((t) => !elsewhere.includes(t));
  assert.deepEqual(
    unknown,
    [],
    `invented custom properties, used nowhere else and with no fallback: ${unknown.join(", ")}`
  );
});

test("opening the explainer closes the menu with the menu's own mechanism", () => {
  // THE MENU THAT WOULD NOT CLOSE: the first version removed `-more-open` from
  // the wrapper. The menu is opened by toggling `-menu-open` on the MENU, so the
  // dropdown stayed up on top of the panel it had just opened. Nothing threw.
  const src = readFileSync("src/index.ts", "utf8");
  const from = src.indexOf('helpItem.btn.addEventListener("click"');
  const to = src.indexOf("moreMenu.appendChild(helpItem.btn)", from);
  const handler = from > 0 && to > from ? src.slice(from, to) : "";
  assert.ok(handler.length > 0, "the explainer handler must exist");
  assert.match(handler, /setMenu\(false\)/, "must close the menu the way the menu closes");
  // Strip comments before asserting the ABSENCE of something: the fix's own
  // comment explains why `-more-open` was wrong, and a bare substring check read
  // that explanation as the bug it describes. A test that cannot tell code from
  // prose fails on well-commented code, which teaches people to comment less.
  const code = handler.replace(/\/\/[^\n]*/g, "");
  assert.doesNotMatch(
    code,
    /classList\.remove\([^)]*more-open/,
    "that class is not what opens the menu"
  );
});

test("auto-apply requires the host's blessing — it never guesses", () => {
  // The widget cannot tell a WordPress draft from a publish: they arrive as the
  // same shape. So the host classifies and the widget asks. A host that passes
  // no predicate gets no toggle and nothing is ever auto-applied.
  assert.match(widgetSrc, /autoApplyOption\?:\s*\(\s*name: string/);
  assert.match(widgetSrc, /opts\.autoApplyOption\?\.\(name, args\)/);
});

test("auto-apply refuses a card that asked the user something", () => {
  // `fields` are inputs the ASSISTANT requested. Applying past them answers a
  // question that was put to the person, using whatever the model guessed.
  const src = readFileSync("src/index.ts", "utf8");
  assert.match(src, /autoApply && !fields\.length && opts\.autoApplyOption/);
});

test("auto-apply is never pinned by advanced mode, unlike auto-navigate", () => {
  // Advanced view makes the assistant faster at MOVING AROUND. That is not a
  // reason to let it write without being asked, and conflating the two is how
  // "pilot mode" quietly becomes "publishes without you".
  const src = readFileSync("src/index.ts", "utf8");
  const applyBlock = src.slice(
    src.indexOf("if (opts.autoApplyOption) {"),
    src.indexOf("// \"How automation works\" — the explainer.")
  );
  assert.ok(applyBlock.length > 0);
  assert.doesNotMatch(
    applyBlock,
    /advanced/,
    "advanced mode must not force auto-apply on"
  );
});

test("the explainer says what will NEVER happen, not only what will", () => {
  // The reason the panel exists. "Auto-apply — on/off" tells a person nothing
  // about what still asks them first, which is the only part they need in order
  // to trust the switch.
  const labels = readFileSync("src/labels.ts", "utf8");
  const never = /automationHelpNever:\s*\n?\s*"([^"]+)"/.exec(labels)?.[1] ?? "";
  for (const word of ["publish", "delet", "credits", "clicks"]) {
    assert.match(never.toLowerCase(), new RegExp(word), `the "never" line should name ${word}`);
  }
});

test("both settings are described as browser-local, because they are", () => {
  const labels = readFileSync("src/labels.ts", "utf8");
  assert.match(labels, /automationHelpLocal:[\s\S]{0,120}browser/i);
  assert.match(widgetSrc, /AUTOAPPLY_KEY = `\$\{ns\}:autoapply`/);
});

test("no backticks inside the stylesheet's comments", () => {
  // THE STYLESHEET IS A TEMPLATE LITERAL, so a backtick anywhere in it — including
  // inside a /* comment */ — ends the string and breaks the build with a parse
  // error pointing at a line that looks fine. I did this THREE TIMES in one
  // session, twice in comments that were themselves warning about it, which is
  // the clearest possible argument for a check instead of care.
  // Scoped to the CSS STRING, not the whole file: the module's own JSDoc sits
  // outside the literal and may use backticks freely. Checking everything was
  // this test's first rule and it flagged three innocent doc comments — a guard
  // that cries wolf gets deleted, which would leave the real hazard unwatched.
  const src = readFileSync("src/styles.ts", "utf8");
  const from = src.indexOf("const css = `");
  assert.ok(from > 0, "the stylesheet template literal must be findable");
  const cssBody = src.slice(from + "const css = `".length);
  const comments = cssBody.match(/\/\*[\s\S]*?\*\//g) ?? [];
  const offenders = comments.filter((c) => c.includes("`"));
  assert.deepEqual(
    offenders.map((c) => c.slice(0, 60)),
    [],
    "a backtick in a comment terminates the CSS template literal"
  );
});
