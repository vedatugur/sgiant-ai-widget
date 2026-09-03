import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * EVERY PERSISTED KEY MUST HAVE A READER.
 *
 * The widget stores five or six things in localStorage so a refresh doesn't
 * cost you your place: the transcript + thread id, the composer draft, the
 * open/closed state, the floating position, and whether ADVANCED (split) view
 * was on.
 *
 * `ayca:adv:<persistKey>` was written on every single toggle — `rememberAdvanced()`
 * is called from both `openAdvanced()` and `closeAdvanced()` — and read back
 * nowhere. `advanced` was initialised `false` and nothing ever consulted the
 * stored flag, so the split view could not survive a reload for its whole life.
 * The transcript and thread DID come back (those keys are read), so the symptom
 * read as "the chat doesn't continue after refresh": same conversation, but the
 * working surface the user was in had silently reverted to the small widget.
 *
 * A write with no reader type-checks, lints and passes knip — the key is a live
 * variable and `setItem` is a real call. Only the pairing is missing, which is
 * the same shape CLAUDE.md records from the Studio removal: a dangling PROMISE
 * is not a dangling reference. So the pairing is what this asserts.
 */

const SRC = "src/index.ts";

/**
 * WHERE THIS LOOKS CHANGED WITH #320, AND THE TEST CAUGHT IT ITSELF.
 *
 * The matcher used to scan for `localStorage.setItem(KEY` / `getItem(KEY` in
 * index.ts. The storage extraction removed every raw call from that file, so
 * the matcher found zero writes — and the `written.size >= 5` guard fired with
 * "the matcher is broken, not the widget" instead of passing green on an empty
 * set. That guard is why this test survived its own premise moving, and it is
 * worth copying into any test that greps source.
 *
 * The surface it scans now is BETTER than the one it lost. `localStorage.setItem`
 * and `getItem` are the same call shape for a flag, a string and a JSON blob;
 * the helpers in ./storage name the direction and the type, so a mismatched
 * pair is visible in the match itself.
 */
const WRITERS = ["writeItem", "writeFlag", "writeJson"] as const;
const READERS = ["readItem", "readFlag", "readJson"] as const;

/**
 * First argument of each call to any of `fns` — the key expression.
 *
 * The `(?:<[^>]*>)?` is load-bearing: `readJson` is generic and both of its
 * callers pass an explicit type argument, so a matcher that demanded `readJson(`
 * reported `storeKey` and `jobsKey` as write-only. They are read on the next
 * line. A false orphan here is worse than none — it accuses working code and
 * teaches the reader to distrust the assertion.
 */
function keysFor(src: string, fns: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const fn of fns) {
    const re = new RegExp(
      `\\b${fn}(?:<[^>]*>)?\\(\\s*([A-Za-z_$][\\w$]*)`,
      "g"
    );
    for (const m of src.matchAll(re)) out.add(m[1]);
  }
  return out;
}

test("every persisted key the widget writes is also read back", () => {
  const src = readFileSync(SRC, "utf8");
  const written = keysFor(src, WRITERS);
  const read = keysFor(src, READERS);

  assert.ok(
    written.size >= 5,
    `only found ${written.size} written keys — the matcher is broken, not the widget`
  );

  const orphans = [...written].filter((k) => !read.has(k)).sort();
  assert.deepEqual(
    orphans,
    [],
    `persisted but never restored: ${orphans.join(", ")} — ` +
      `each is written to storage and no code path reads it back, ` +
      `so the state it represents cannot survive a reload`
  );
});

test("the widget reaches storage only through ./storage (#320)", () => {
  const src = readFileSync(SRC, "utf8");

  // Comments mention localStorage freely and should keep being able to. Only
  // real calls are the concern, which is why this matches the call shape rather
  // than the word.
  const raw = [...src.matchAll(/(?:window\.)?localStorage\.\w+\(/g)].map(
    (m) => m[0]
  );

  assert.deepEqual(
    raw,
    [],
    `index.ts calls localStorage directly: ${raw.join(", ")}. ` +
      `Every access goes through ./storage, which owns the two rules each of ` +
      `these sites used to re-implement — an empty key means persistence is ` +
      `off, and blocked storage is non-fatal. A call here re-opens the drift ` +
      `that put a deliberate "return true" inside one of ten identical catch ` +
      `blocks, indistinguishable from a typo.`
  );
});

test("every storage key is built from the configurable namespace (#306)", () => {
  const src = readFileSync(SRC, "utf8");

  // A PUBLISHED widget writes into a stranger's browser, so no key may carry a
  // product name. The namespace defaults to "aiw" — neutral, and already the
  // prefix of the `--aiw-*` custom properties the stylesheet uses — and sgiant's
  // own surfaces pass "ayca" to keep the transcripts and drafts their users
  // already have.
  //
  // Before #306 the keys were spelled three different ways in one file:
  // `ayca:v1:…`, `sg_ayca_sound`, and `sgiant-aiw.opened`. That is how a product
  // name ends up somewhere nobody looks.
  const declarations = [
    ...src.matchAll(/^\s*const (\w*(?:Key|KEY))\s*=\s*(.+)$/gm),
  ].filter(([, name]) => !/^(persistKey|layoutKey|jobsKeyPrefix)$/.test(name));

  assert.ok(
    declarations.length >= 8,
    `only found ${declarations.length} key declarations — the matcher is broken, not the widget`
  );

  const branded = declarations
    .filter(([, , value]) => /ayca|sgiant/i.test(value))
    .map(([, name, value]) => `${name} = ${value.trim()}`);

  assert.deepEqual(
    branded,
    [],
    `these storage keys hard-code a product name instead of using the namespace: ` +
      `each writes an sgiant word into the localStorage of whoever embeds this widget. ` +
      `Build them from \`ns\` (opts.storageNamespace, default "aiw").`
  );
});

test("the default storage namespace is neutral (#306)", () => {
  const src = readFileSync(SRC, "utf8");
  const line = src.match(/const ns = opts\.storageNamespace \|\| "([^"]+)"/);

  assert.ok(
    line,
    "the storageNamespace default moved — this test cannot see it any more"
  );
  assert.doesNotMatch(
    line[1],
    /ayca|sgiant/i,
    `the default namespace is "${line?.[1]}", which names the product. It is what a ` +
      `third-party embedder gets when they pass nothing, so it has to be neutral.`
  );
});
