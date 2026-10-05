/**
 * WHY AN APPLY FAILED, WHEN THE HOST KNOWS (sgiant-platform#581).
 *
 * A person presses Apply on a card. The host's `onApplyProposal` does the
 * write on its own session, and sometimes the write is refused: the site is
 * not connected, this person may not publish there, the storage is full. The
 * card used to answer every one of those the same way: the button changed to
 * "Try again", and nothing else. Trying again was refused again, for as long
 * as anyone cared to press it, and the one thing they could act on (WHY) was
 * caught and thrown away.
 *
 * The widget still cannot know why. It does not speak the host's API, and it
 * must not print whatever a thrown error happens to carry: an `Error.message`
 * is written for a log, in one language, and may hold a path or a status line.
 *
 * So the host says it, on purpose. `onApplyProposal` rejects with something
 * that has a `userMessage`: a sentence the HOST chose for this person, in the
 * page's language. Any object will do, an Error included. Nothing else on the
 * rejection is ever shown.
 *
 * `retry: false` means pressing the button again cannot work until something
 * else changes. The card then keeps its own name on the button instead of
 * "Try again", which would be a promise the host has just said is false.
 */
export interface ApplyRefusal {
  /** A sentence for the person, in the page's language. Shown as it is. */
  userMessage: string;
  /** `false`: asking again cannot work as things stand. Default `true`. */
  retry?: boolean;
}

/**
 * What a rejected `onApplyProposal` chose to tell the person, or `null` when
 * it chose nothing (an older host, a bug, a network error nobody wrapped).
 */
export function readApplyRefusal(
  thrown: unknown
): { userMessage: string; retry: boolean } | null {
  if (!thrown || typeof thrown !== "object") return null;
  const said = (thrown as { userMessage?: unknown }).userMessage;
  if (typeof said !== "string" || !said.trim()) return null;
  return {
    userMessage: said.trim(),
    retry: (thrown as { retry?: unknown }).retry !== false,
  };
}
