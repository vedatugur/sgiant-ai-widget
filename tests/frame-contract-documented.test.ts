/**
 * A FRAME FIELD THE WIDGET REQUIRES MUST BE IN BACKEND.md.
 *
 * `StreamFrame` marks every field optional, because one interface describes a
 * dozen frame shapes. Some handlers then require a field before they render
 * anything — and when the backend omits it the frame is dropped, so the author
 * sees a turn that is simply missing a piece, with nothing to search for.
 *
 * That happened on 2026-09-03. A `question` frame needs `questionId`; it is
 * `questionId?: string` on the type, was mentioned nowhere in BACKEND.md, and a
 * demo written from BACKEND.md rendered its intro sentence and silently nothing
 * else. The frame now warns, and the contract is documented — this asserts the
 * documentation cannot fall behind the code again.
 *
 * It reads the GUARDS, not a list someone maintains by hand: a new
 * `frame.type === "x" && frame.y` is exactly the change that would otherwise
 * add an undocumented requirement.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");

/** Fields a `frame.type === "..."` branch requires before it will render. */
function requiredFrameFields(): Map<string, Set<string>> {
  const src = readFileSync(join(ROOT, "src/index.ts"), "utf8");
  const out = new Map<string, Set<string>>();

  // `frame.type === "question" && frame.questionId && frame.prompt`
  const guards = src.matchAll(
    /frame\.type === "([a-z_]+)"\s*&&([\s\S]{0,220}?)\)\s*\{/g
  );
  for (const g of guards) {
    const [, type, tail] = g;
    // A NEGATED guard is the warning path, not a requirement — skip it, or
    // this test would demand documentation for the check it inspired.
    if (tail.includes("!(")) continue;
    const fields = new Set<string>();
    for (const f of tail.matchAll(/frame\.([a-zA-Z]+)/g))
      if (f[1] !== "type") fields.add(f[1]);
    if (fields.size) {
      const prev = out.get(type) ?? new Set<string>();
      for (const f of fields) prev.add(f);
      out.set(type, prev);
    }
  }
  return out;
}

test("every frame field a handler requires is documented in BACKEND.md", () => {
  const doc = readFileSync(join(ROOT, "BACKEND.md"), "utf8");
  const required = requiredFrameFields();

  assert.ok(
    required.size >= 2,
    `only parsed ${required.size} frame guard(s) — the matcher is broken, not the code`
  );

  const undocumented: string[] = [];
  for (const [type, fields] of required)
    for (const field of fields)
      if (!doc.includes(field)) undocumented.push(`${type}.${field}`);

  assert.deepEqual(
    undocumented,
    [],
    `these fields gate a frame from rendering and BACKEND.md never names them. ` +
      `A backend author following the docs writes a frame that is silently ` +
      `ignored — which is exactly how questionId was found, by a demo whose ` +
      `question never appeared.`
  );
});

test("an incomplete question frame warns instead of vanishing", () => {
  // The behaviour, not the wording: there must be a warn path keyed on the
  // question frame, and it must name the field that is missing.
  const src = readFileSync(join(ROOT, "src/index.ts"), "utf8");
  assert.match(
    src,
    /frame\.type === "question" && !\(frame\.questionId && frame\.prompt\)/,
    "the question frame no longer checks for its required fields before warning"
  );
  assert.match(
    src,
    /warnOnce\(\s*"question-frame-incomplete"/,
    "the incomplete-question warning is gone — a dropped frame is silent again"
  );
});
