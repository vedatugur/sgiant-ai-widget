import test from "node:test";
import assert from "node:assert/strict";
import { widgetSrc } from "./aiw-source.ts";
import { WIDGET_LABELS } from "../dist/labels.js";

/**
 * The quality prompt (#299).
 *
 * These guard DECISIONS, not appearance. Each one was argued on the issue and
 * each is a single expression in the widget that a later edit could quietly
 * relax — at which point the prompt still works, still looks right, and starts
 * producing the exact signal the decision was taken to avoid.
 */
const src = widgetSrc;

test("the slow trigger is 20s — past a tool-using answer, short of the ceiling", () => {
  const m = src.match(/QUALITY_SLOW_MS\s*=\s*([0-9_]+)/);
  assert.ok(m, "QUALITY_SLOW_MS is gone — the slow trigger has no threshold");
  assert.equal(
    Number(m[1].replace(/_/g, "")),
    20_000,
    "the decision on #299 is 20 seconds"
  );
});

test("a thread's FIRST turn is never asked", () => {
  // "Asking someone to rate a conversation they have not had yet is noise."
  assert.match(
    src,
    /turns > 1/,
    "the first-turn guard is gone — every new conversation would be prompted"
  );
});

test("at most once per thread per session", () => {
  assert.match(src, /qualityAsked\.has\(/, "the once-per-thread read is gone");
  assert.match(src, /qualityAsked\.add\(/, "nothing marks a thread as asked");
});

test("the two triggers ask DIFFERENT questions", () => {
  // A slow-but-excellent answer prompted with "was this helpful?" teaches us
  // "slow = bad", which we already knew. The whole point of two prompts.
  assert.notEqual(
    WIDGET_LABELS.qualitySlowTitle,
    WIDGET_LABELS.qualityFailedTitle,
    "one prompt for both triggers — the slow case would poison the signal"
  );
  assert.match(
    WIDGET_LABELS.qualitySlowTitle,
    /worth it/i,
    "the slow prompt should ask about the WAIT"
  );
  assert.match(
    WIDGET_LABELS.qualityFailedTitle,
    /trying to do/i,
    "the failed prompt should ask about the GOAL"
  );
});

test("a prompt with nothing said and nothing picked records nothing", () => {
  // Otherwise dismissing by clicking Send would write a -1 the user never cast.
  assert.match(
    src,
    /picked === null && !text/,
    "the empty-submission guard is gone — dismissal would become a downvote"
  );
});

test("the prompt needs a messageId, so a failed turn that persisted nothing gets none", () => {
  // A vote is a row against a message. The error card's Report is the path
  // there, and stacking a second ask on a failure is the noise to avoid.
  assert.match(
    src,
    /liveMessageId &&\s*\n?\s*opts\.vote/,
    "the prompt no longer requires a message id to attach to"
  );
});
