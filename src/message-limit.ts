/**
 * THE LONGEST MESSAGE THE PUBLIC CHAT TAKES, in characters (sgiant-platform
 * #709).
 *
 * The server refuses a longer one inside the conversation (`message_too_long`,
 * sgiant-platform#693 QA: its `PUBLIC_CHAT_MESSAGE_MAX_CHARS`, 4,000). The box
 * had no limit of its own, so a visitor could paste a page they would then be
 * told to shorten. The box now stops at the same number. A copy, kept equal by
 * the platform's drift test, which reads this export from the published
 * package.
 *
 * Only the PUBLIC window (no account: a customer's site, or ours): a signed-in
 * chat has no such limit on the server, and the box gets none.
 */
export const PUBLIC_CHAT_MESSAGE_MAX_CHARS = 4000;

/** The box's `maxLength`, or undefined for a window with no limit. */
export function composerMaxLength(opts: {
  accountId?: string;
}): number | undefined {
  return opts.accountId ? undefined : PUBLIC_CHAT_MESSAGE_MAX_CHARS;
}
