/**
 * TWO DECISIONS THE APP PANE MAKES, extracted so they can be checked.
 *
 * Both live inside `createAiChatWidget`'s closure in the real widget, where
 * they are unreachable from a test — and both are the kind of rule that fails
 * politely: get them wrong and the pane either never follows a long operation
 * (the feature silently does nothing) or follows it too eagerly (it yanks a
 * reader off the page they chose, repeatedly, on every poll). Neither shows up
 * as an error.
 */

/** Same-path test used for both decisions. A query string is a filter within a
 *  page, not a different destination; a trailing slash is not a destination
 *  either. */
export function samePanePath(
  a: string | null | undefined,
  b: string | null | undefined
): boolean {
  if (!a || !b) return false;
  const norm = (p: string): string => {
    const path = p.split("?")[0] ?? "";
    return path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
  };
  return norm(a) === norm(b);
}

export interface AutoNavigateInput {
  /** Advanced view is open. There is no pane to move otherwise, and moving the
   *  whole PAGE because a background job started is a different feature. */
  advanced: boolean;
  /** The host wired `getAdvancedUrl` — without it there is no embed URL. */
  canNavigate: boolean;
  /** The user has driven the frame themselves since this session began. */
  userDriven: boolean;
  /** This operation has already been followed once. */
  alreadyFollowed: boolean;
  /** The path to follow to, as the model/host supplied it. */
  path: string | null | undefined;
  /** Where the pane is now — skip the reload if it is already there. */
  currentPath?: string | null;
}

/**
 * Should the pane follow a long operation to its live page?
 *
 * Every `false` here is a way this becomes obnoxious rather than helpful, and
 * the third one is the one that bites hardest: a report card polls every couple
 * of seconds, so a decision that does not remember it already followed would
 * reload the page continuously — turning "watch it build" into a surface that
 * cannot be read at all.
 */
export function shouldAutoNavigate(i: AutoNavigateInput): boolean {
  if (!i.advanced || !i.canNavigate) return false;
  if (i.userDriven || i.alreadyFollowed) return false;
  if (!i.path || !i.path.startsWith("/") || i.path.startsWith("//")) {
    return false;
  }
  // Already there: following again would be a pointless full document load.
  if (samePanePath(i.currentPath, i.path)) return false;
  return true;
}

/**
 * Should the chat column collapse its narration to one line?
 *
 * True exactly when the pane is showing the same run — the owner's decision for
 * advanced mode. The report page owns the detail (it has the stage rail and it
 * is the authority on stage), and two renderings of one job on one screen is
 * the divergence advanced view makes visible. When the pane is elsewhere the
 * chat is the ONLY account of what is happening, so it narrates in full.
 */
export function shouldCollapseNarration(i: {
  advanced: boolean;
  livePath: string | null | undefined;
  currentPath: string | null | undefined;
}): boolean {
  if (!i.advanced) return false;
  return samePanePath(i.currentPath, i.livePath);
}
