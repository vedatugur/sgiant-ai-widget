/**
 * What the widget will and will not navigate to.
 *
 * Extracted from index.ts (#320) at zero leakage, and kept apart from the
 * directive shapes next door on purpose: this is the security surface, not the
 * vocabulary. Model output is untrusted — it can carry text scraped from
 * third-party sites — so every URL the assistant proposes passes through here.
 *
 * It becomes a public surface when the widget publishes (#306): an embedder
 * pointing the widget at their own backend inherits these rules, so they have
 * to be findable and readable rather than buried mid-file.
 */

import { isKnownNavTarget } from "./host-actions";

/**
 * Is this an AI-supplied in-app path we're willing to navigate to? Model output
 * is untrusted (it can carry text scraped from third-party sites), so a path is
 * only ever a SITE-ROOT-RELATIVE route: it must start with a single `/` and
 * must not start with `//` or `/\` (both read as protocol-relative, i.e. another
 * origin) — which also rules out `javascript:`/`data:` payloads.
 */
export function isSafeRelPath(path: unknown): path is string {
  return (
    typeof path === "string" &&
    path.startsWith("/") &&
    !path.startsWith("//") &&
    !path.startsWith("/\\")
  );
}

/**
 * THE navigation gate — the one the advanced view's frame stands behind.
 *
 * Module-level and exported on purpose. `dispatchAction` is a closure over a
 * live DOM, so with the decision inline there the single check that keeps a
 * model-authored path out of an un-sandboxed, same-origin, session-bearing
 * iframe was unreachable by any test: deleting it left the whole suite green.
 * Here it is exercised directly (tests/unit/nav-manifest-gate.test.ts) and the
 * call site is pinned by source assertion.
 *
 * Throws rather than returning a verdict: an undefined return from
 * `dispatchAction` resolves as SUCCESS, and the chip ticks green over a path we
 * had just declined.
 *
 * `getTargets` is a getter, not an array: `refreshTargets` REPLACES the cache,
 * and the second read has to see what the first one fetched.
 */
export async function gateNavigationTarget(
  path: unknown,
  getTargets: () => readonly { path?: string }[],
  refreshTargets: () => Promise<void>
): Promise<void> {
  // AI-supplied navigation targets are untrusted: only a root-relative in-app
  // route is ever followed — in the advanced-view frame OR by the host router.
  if (!isSafeRelPath(path))
    throw new Error("that navigation target is not an in-app page");
  // …and the shape test is not the gate. It admits every path in the app,
  // including another tenant's: `/accounts/<someone-else>/settings` is
  // root-relative, and the host's `orgPath`/`adminPath` return an
  // already-`/accounts/`-prefixed path untouched. The manifest this turn was
  // built from is the real allow-list; it has been present as `knownNavTargets`
  // since #111 and nothing but the prose-nav fallback ever read it.
  //
  // The cache holds the LAST TURN THIS SESSION SENT, which is not every chip
  // that can be clicked: `persistKey` restores a transcript across a reload and
  // its nav chips are live before a word has been sent. Ask the host for its
  // catalogue rather than refuse a page the manifest declares.
  if (!getTargets().length) await refreshTargets();
  if (!isKnownNavTarget(path, getTargets()))
    throw new Error("that page is not one I can open");
}

/**
 * Final gate in front of the advanced-view iframe's `src`. That frame is
 * deliberately un-sandboxed (it hosts our own app with the live session), so
 * only a same-origin http(s) URL may ever be loaded into it.
 */
export function isSafeFrameUrl(url: string): boolean {
  try {
    const u = new URL(url, location.origin);
    return (
      u.origin === location.origin &&
      (u.protocol === "http:" || u.protocol === "https:")
    );
  } catch {
    return false;
  }
}
