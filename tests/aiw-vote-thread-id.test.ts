import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..", "src");
const chrome = readFileSync(join(root, "message-chrome.ts"), "utf8");
const index = readFileSync(join(root, "index.ts"), "utf8");

/**
 * A vote must be cast against the thread the message is IN, read at click time.
 *
 * `buildVoteButtons` moved out of the widget closure in #320. Inside it, the
 * thread id was ambient: `threadId` is a `let` the widget reassigns when the
 * server names a thread, and the click handler read whatever it held at the
 * moment of the click. Out here that only stays true if the dependency is a
 * GETTER. The obvious-looking signature — `threadId: string` — captures the
 * value when the BUTTON IS BUILT, which for the first turn of a new thread is
 * before the id exists.
 *
 * The failure is silent in every direction. `getThreadId() ?? ""` still yields a
 * string, the vote request is still well-formed, the server still answers 2xx,
 * and the UI still paints the thumb as selected. The only symptom is that the
 * quality signal #299 exists to collect lands on the wrong thread or on none —
 * discoverable by nobody, because there is no error and no user-visible change.
 *
 * That is why this is pinned as source rather than behaviour: the widget tests
 * in this repo have no DOM, and the regression is not a wrong output but a
 * wrong BINDING TIME, which a passing call would not reveal anyway.
 */
test("the vote reads the thread id at click time, not at build time", () => {
  // Non-vacuity: if the vote builder is ever renamed or moved again, this test
  // must fail loudly rather than assert nothing about a file it cannot find.
  assert.match(
    chrome,
    /function buildVoteButtons\(/,
    "message-chrome.ts no longer defines buildVoteButtons — re-point this test at wherever the vote builder went, do not delete it"
  );

  // The dependency is a getter...
  assert.match(
    chrome,
    /getThreadId:\s*\(\)\s*=>/,
    "message-chrome.ts must take `getThreadId` as a function"
  );

  // ...and the vote body CALLS it, rather than closing over a captured value.
  assert.match(
    chrome,
    /threadId:\s*getThreadId\(\)/,
    "the vote payload must call getThreadId() so the id is read when the click happens"
  );

  // The factory must not ALSO destructure a plain `threadId` off its deps:
  // offering both is how the getter quietly stops being the one that is used.
  //
  // Scoped to the destructuring line on purpose. The first version of this
  // assertion searched the whole file for `threadId: string` and failed on the
  // `vote` payload's own field — which is a legitimate use, and exactly the
  // false alarm that teaches the next person to delete the test.
  const destructure = /const\s*\{([^}]*)\}\s*=\s*deps;/.exec(chrome);
  assert.ok(destructure, "expected the factory to destructure its deps object");
  assert.doesNotMatch(
    destructure[1],
    /\bthreadId\b/,
    "the factory must not take a plain `threadId` alongside the getter — that captures at build time"
  );

  // And the widget must actually pass a getter, not a value.
  assert.match(
    index,
    // The trailing \b is load-bearing: without it this matched `() => threadId0`
    // and the mutation test that proves this assertion works passed anyway.
    /getThreadId:\s*\(\)\s*=>\s*threadId\b/,
    "index.ts must pass `getThreadId: () => threadId`; passing `threadId` directly reintroduces the capture"
  );
});
