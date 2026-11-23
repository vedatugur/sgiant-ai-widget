import { PUBLIC_CHAT_MESSAGE_MAX_CHARS } from "./limits.js";

/**
 * THE PUBLIC WINDOW'S BOX STOPS WHERE THE SERVER STOPS (sgiant-platform#709).
 *
 * The public chat refuses a message over `PUBLIC_CHAT_MESSAGE_MAX_CHARS`
 * inside the conversation (`message_too_long`); the box had no limit, so a
 * visitor could paste a page and only then be told to shorten it.
 *
 * Only the PUBLIC lane, named explicitly: a window `createSiteChat` drew
 * (`siteChat`), or one that posts to the public chat endpoint
 * (`/public/ai/chat`, which our own sites and the demo use). Not "a window
 * without an account": the staff chat passes `getAccountScope` and no
 * `accountId` (QA on #709), and neither it nor a signed-in chat has this
 * limit on the server.
 */
export function composerMaxLength(opts: {
  endpoint?: string;
  siteChat?: boolean;
}): number | undefined {
  return opts.siteChat === true || isPublicChatEndpoint(opts.endpoint)
    ? PUBLIC_CHAT_MESSAGE_MAX_CHARS
    : undefined;
}

/** The public chat's address, whatever the origin: `/public/ai/chat`. */
function isPublicChatEndpoint(endpoint: string | undefined): boolean {
  if (typeof endpoint !== "string") return false;
  const path = endpoint.split(/[?#]/)[0]!.replace(/\/+$/, "");
  return /(^|\/)public\/ai\/chat$/.test(path);
}
