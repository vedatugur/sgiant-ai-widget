/**
 * THE TOKEN STEP MAY ANSWER "NOT NOW" (sgiant-platform#620).
 *
 * Before every send the widget asks the host for a token. Sometimes the honest
 * answer is that there is none to give, and that is not a failure of anything:
 * this person has not connected their account yet, or is connected and has no
 * access to this one. A host could only say so by throwing, and a throw from
 * `getToken` was treated like a dropped connection: "hit a snag" over the
 * host's sentence, a "Try again" that could not help, and the launcher marked
 * offline until a later turn got through. And there was nowhere to put the one
 * thing that WOULD help: a button to connect.
 *
 * So the host says it, on purpose, the way `onApplyProposal` already refuses
 * (see `ApplyRefusal`): `getToken` rejects with something that has a
 * `userMessage`. Any object will do, an Error included: it is recognised by
 * that property alone, so a plain script with no import can do it. The window
 * then shows the sentence as it is, and the button if there is one. Nothing
 * else on the rejection is ever shown, and a rejection without a `userMessage`
 * is handled exactly as before.
 *
 * The words are the host's, in the page's language. The widget adds none.
 */
export interface TokenRefusal {
  /** A sentence for the person, in the page's language. Shown as it is. */
  userMessage: string;
  /** One thing the person can do about it, as a button under the sentence. */
  action?: {
    /** The button's text, in the page's language. */
    label: string;
    /**
     * Called INSIDE the click, with nothing awaited before it, so a window
     * opened on its first line is opened by a real click and is not blocked.
     *
     * Resolve `true` when the person can now be given a token: the widget asks
     * `getToken` again and sends the question it was holding, once. Resolve
     * anything else, or reject, when they cannot (they closed the window, the
     * browser blocked it): the sentence and the button stay, and nothing is
     * sent. Return an explicit boolean. Only `true` counts as done, so a
     * handler that falls off its end after a blocked popup is not read as
     * success.
     */
    onClick: () => unknown;
  };
}

/**
 * What a rejected `getToken` chose to tell the person, or `null` when it chose
 * nothing (an older host, a network error, a bug): then it is a failure, and
 * is shown as one.
 */
export function readTokenRefusal(thrown: unknown): TokenRefusal | null {
  if (!thrown || typeof thrown !== "object") return null;
  const said = (thrown as { userMessage?: unknown }).userMessage;
  if (typeof said !== "string" || !said.trim()) return null;
  const action = (thrown as { action?: unknown }).action as
    | { label?: unknown; onClick?: unknown }
    | null
    | undefined;
  const label =
    action && typeof action === "object" && typeof action.label === "string"
      ? action.label.trim()
      : "";
  // A button needs both a name and something to do. Half of one is no button,
  // and the sentence is still worth showing.
  return label && typeof action!.onClick === "function"
    ? {
        userMessage: said.trim(),
        action: { label, onClick: action!.onClick as () => unknown },
      }
    : { userMessage: said.trim() };
}
