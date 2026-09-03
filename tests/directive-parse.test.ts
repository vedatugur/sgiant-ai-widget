import test from "node:test";
import assert from "node:assert/strict";
import { parseJsonDirective } from "../dist/directive.js";

test("a surplus closing brace leaves no residue in the reply", () => {
  // Seen on dev 2026-08-12: the model wrote one `}` too many. The matcher
  // stopped at the real closing brace (correct), then looked for `]`, found
  // `}`, and consumed nothing — so the card rendered perfectly AND the user
  // saw `}]]` printed above it.
  const r = parseJsonDirective<{ title: string }>(
    'Here you go: [[ui:{"title":"Scene plan"}}]]\n\nWhich scene first?',
    "ui"
  );
  assert.ok(r);
  assert.equal(r.spec.title, "Scene plan");
  // Interior whitespace is left as-is (it renders the same); what must never
  // survive is the punctuation, which renders as gibberish.
  assert.match(r.stripped, /^Here you go:\s*\n\nWhich scene first\?$/);
  assert.ok(!r.stripped.includes("}"), `residue left: ${r.stripped}`);
  assert.ok(!r.stripped.includes("]"), `residue left: ${r.stripped}`);
});

test("the usual bracket slips still parse", () => {
  for (const [raw, why] of [
    ['[[ui:{"a":1}]]', "well formed"],
    ['[[ui:{"a":1}]', "one bracket"],
    ['[[ui:{"a":1}', "no brackets"],
    ['[[ui:{"a":1}}}]]', "several surplus braces"],
  ] as const) {
    const r = parseJsonDirective<{ a: number }>(`x ${raw} y`, "ui");
    assert.ok(r, why);
    assert.equal(r.spec.a, 1, why);
    assert.match(r.stripped, /^x\s+y$/, why);
    assert.ok(!/[}\]]/.test(r.stripped), `${why}: residue ${r.stripped}`);
  }
});

test("punctuation inside a quoted value cannot end the object early", () => {
  // Real captions carry exactly this: escaped quotes and stray brackets.
  const text =
    '[[ui:{"caption":"the \\"stay here\\" feeling }]] and more","layout":"strip"}]]';
  const r = parseJsonDirective<{ caption: string; layout: string }>(text, "ui");
  assert.ok(r);
  assert.equal(r.spec.layout, "strip");
  assert.equal(r.spec.caption, 'the "stay here" feeling }]] and more');
  assert.equal(r.stripped, "");
});

test("prose after the directive is never eaten", () => {
  // The brace-swallowing must stop at the first character that is not residue,
  // or a reply ending in a real brace would lose text.
  const r = parseJsonDirective<{ a: number }>(
    '[[ui:{"a":1}]] use }} carefully',
    "ui"
  );
  assert.ok(r);
  assert.equal(r.stripped, "use }} carefully");
});

test("a malformed object is left alone rather than half-stripped", () => {
  // Better to show the raw directive than to delete text and render nothing.
  assert.equal(parseJsonDirective('[[ui:{"a":}]]', "ui"), null);
  assert.equal(parseJsonDirective("[[ui:", "ui"), null);
  assert.equal(parseJsonDirective("no directive here", "ui"), null);
});
