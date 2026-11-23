import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { composerMaxLength } from "../dist/message-limit.js";
import { PUBLIC_CHAT_MESSAGE_MAX_CHARS } from "../dist/limits.js";
import { widgetSrc } from "./aiw-source.ts";

/**
 * THE PUBLIC WINDOW'S BOX STOPS WHERE THE SERVER STOPS (sgiant-platform#709).
 *
 * The public chat refuses a message over 4,000 characters inside the
 * conversation (`message_too_long`). Only the public lane is capped, named
 * explicitly: the first version capped any window without `accountId`, and
 * the staff chat passes `getAccountScope` and no `accountId` (QA on #709).
 * Each host's option shape is held here as it mounts the window.
 */
const API = "https://api.example.com";

test("the public lane is capped at the server's 4,000 characters", () => {
  assert.equal(PUBLIC_CHAT_MESSAGE_MAX_CHARS, 4000);
  // Our marketing site and the app's demo: the public endpoint.
  assert.equal(composerMaxLength({ endpoint: `${API}/public/ai/chat` }), 4000);
  assert.equal(composerMaxLength({ endpoint: "/public/ai/chat/" }), 4000);
  assert.equal(
    composerMaxLength({ endpoint: `${API}/public/ai/chat?x=1` }),
    4000,
  );
  // A customer's site, drawn by createSiteChat.
  assert.equal(
    composerMaxLength({ siteChat: true, endpoint: `${API}/public/ai/chat` }),
    4000,
  );
});

test("the staff chat and the signed-in chat are not capped", () => {
  // ui-admin: `/admin/ai/chat`, `getAccountScope`, no `accountId`.
  assert.equal(
    composerMaxLength({ endpoint: `${API}/admin/ai/chat` }),
    undefined,
  );
  // ui-org: the account's own chat.
  assert.equal(
    composerMaxLength({ endpoint: `${API}/accounts/acc-1/ai/chat` }),
    undefined,
  );
  // A path that only contains the words is not the public chat.
  assert.equal(
    composerMaxLength({ endpoint: `${API}/admin/public/ai/chat-log` }),
    undefined,
  );
  assert.equal(composerMaxLength({}), undefined);
});

test("the box is given that length, and the number is in the gated limits module", () => {
  assert.match(
    widgetSrc,
    /const maxChars = composerMaxLength\(opts\);\s*if \(maxChars\) input\.maxLength = maxChars;/,
  );
  // The platform's drift test reads dist/limits.js; no public export.
  const dist = readFileSync(
    join(import.meta.dirname, "..", "dist", "limits.js"),
    "utf8",
  );
  assert.match(dist, /PUBLIC_CHAT_MESSAGE_MAX_CHARS\s*=\s*4000/);
  const index = readFileSync(
    join(import.meta.dirname, "..", "src", "index.ts"),
    "utf8",
  );
  assert.doesNotMatch(index, /PUBLIC_CHAT_MESSAGE_MAX_CHARS/);
});
