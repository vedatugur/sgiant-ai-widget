import test from "node:test";
import assert from "node:assert/strict";
import { widgetSrc } from "./aiw-source.ts";

/**
 * A directive must never survive to the reader as text.
 *
 * `navigate`, `action` and `form` used to strip only when a host had wired the
 * matching handler, so a host with none printed the raw `[[navigate:{...}]]`
 * into the message. Seen live on the public demo — the one surface whose entire
 * job is to impress a prospect.
 *
 * The model emits these because the system prompt offers them, which no host
 * can switch off, so "no handler" is a normal state rather than a misuse. These
 * assert the SHAPE that makes that safe: strip unconditionally, render
 * conditionally.
 */
const src = widgetSrc;

/** The body of `renderDirectives`-style handling, where the stripping happens. */
function directiveBlock(): string {
  // Anchor on the RENDER path specifically. `stripDirectivesForReplay` parses
  // the same directives earlier in the file (and always strips, being a
  // transcript stripper) — anchoring on the directive name alone read that one
  // and asserted nothing about the path this is actually about.
  const start = src.indexOf("const nav = parseJsonDirective<NavigateSpec>");
  assert.notEqual(start, -1, "the navigate RENDER branch moved");
  const end = src.indexOf("linkifyProseNav(t)", start);
  assert.ok(end > start, "could not find the end of the directive block");
  // COMMENTS OUT. These assertions are about the order of two statements, and
  // the comment explaining the rule naturally names the very guard it is about
  // — matching that instead of the code made all three fail on correct source.
  return src
    .slice(start, end)
    .split("\n")
    .filter((l) => !l.trim().startsWith("//"))
    .join("\n");
}

test("navigate strips before it checks for a handler", () => {
  const block = directiveBlock();
  const strip = block.indexOf("t = nav.stripped");
  const guard = block.indexOf("opts.onWidgetAction");
  assert.ok(strip !== -1, "navigate no longer strips at all");
  assert.ok(
    strip < guard,
    "navigate strips only after checking onWidgetAction — a host with no " +
      "actions will print the raw directive to the reader"
  );
});

test("action strips before it checks for a handler", () => {
  const block = directiveBlock();
  const i = block.indexOf("const act = parseJsonDirective<ActionSpec>");
  assert.notEqual(i, -1, "the action directive branch moved");
  const tail = block.slice(i);
  const strip = tail.indexOf("t = act.stripped");
  const guard = tail.indexOf("opts.onWidgetAction");
  assert.ok(strip !== -1, "action no longer strips at all");
  assert.ok(
    strip < guard,
    "action strips only after checking onWidgetAction — raw markup reaches the reader"
  );
});

test("form strips before it checks for a handler", () => {
  const block = directiveBlock();
  const i = block.indexOf("parseFormDirective(t)");
  assert.notEqual(i, -1, "the form directive branch moved");
  const tail = block.slice(i);
  const strip = tail.indexOf("t = form.stripped");
  const guard = tail.indexOf("opts.onWidgetAction || opts.onLead");
  assert.ok(strip !== -1, "form no longer strips at all");
  assert.ok(
    strip < guard,
    "form strips only after checking its handlers — raw markup reaches the reader"
  );
});
