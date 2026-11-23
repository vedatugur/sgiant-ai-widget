import test from "node:test";
import assert from "node:assert/strict";
import * as entry from "../dist/index.js";
import { composerMaxLength } from "../dist/message-limit.js";
import { widgetSrc } from "./aiw-source.ts";

/**
 * THE PUBLIC WINDOW'S BOX STOPS WHERE THE SERVER STOPS (sgiant-platform#709).
 *
 * The public chat refuses a message over 4,000 characters inside the
 * conversation (`message_too_long`, sgiant-platform#693 QA). The box had no
 * limit, so a visitor could paste a page and only then be told to shorten
 * it. The number is exported so the platform's drift test can hold it to
 * its `PUBLIC_CHAT_MESSAGE_MAX_CHARS`.
 */
test("the public window's box takes at most the server's 4,000 characters", () => {
  assert.equal(entry.PUBLIC_CHAT_MESSAGE_MAX_CHARS, 4000);
  assert.equal(composerMaxLength({}), 4000);
  // A signed-in window has no such limit on the server.
  assert.equal(composerMaxLength({ accountId: "acc-1" }), undefined);
});

test("the box is given that length", () => {
  assert.match(
    widgetSrc,
    /const maxChars = composerMaxLength\(opts\);\s*if \(maxChars\) input\.maxLength = maxChars;/,
  );
});
