/**
 * A cross-tab "the assistant changed something" bus.
 *
 * Deliberately knows NOTHING about what changed: it carries an account id and a
 * list of opaque domain strings, and the host decides what they mean. sgiant's
 * mapping from those strings to query keys lives in `@sgiant/ai-apply`, because
 * it is a description of sgiant's product rather than of this widget.
 */

// Neutral, like the bridge's channel: this ships to people whose product is
// not sgiant. It is a WIRE value between tabs of one deployment, so a change
// only costs an old tab and a new tab not seeing each other until reload.
const AI_LIVE_CHANNEL = "ai-widget-live";

export interface AiChangeEvent {
  accountId: string;
  domains?: string[];
}

/** Tell other tabs an AI change landed so they invalidate too. No-op where
 *  BroadcastChannel is unavailable (old browsers / SSR). */
export function broadcastAiChange(accountId: string, domains?: string[]): void {
  // SAME-TAB listeners (e.g. the brand info bar's live "updated by AI" status)
  // get a synchronous window event — BroadcastChannel is meant for OTHER tabs and
  // is the less reliable path within one document, so this is the primary signal
  // for anything on the current page; BroadcastChannel below still covers tabs.
  if (typeof window !== "undefined") {
    try {
      window.dispatchEvent(
        new CustomEvent(AI_LIVE_CHANNEL, { detail: { accountId, domains } })
      );
    } catch {
      /* CustomEvent unavailable */
    }
  }
  if (typeof BroadcastChannel === "undefined") return;
  try {
    const ch = new BroadcastChannel(AI_LIVE_CHANNEL);
    ch.postMessage({ accountId, domains } satisfies AiChangeEvent);
    ch.close();
  } catch {
    /* channel unavailable */
  }
}

/** Subscribe to cross-tab AI change events; returns an unsubscribe fn. */
export function subscribeAiChange(cb: (e: AiChangeEvent) => void): () => void {
  if (typeof BroadcastChannel === "undefined") return () => {};
  const ch = new BroadcastChannel(AI_LIVE_CHANNEL);
  const handler = (ev: MessageEvent): void => {
    const d = ev.data as Partial<AiChangeEvent> | null;
    if (d && typeof d.accountId === "string")
      cb({
        accountId: d.accountId,
        domains: Array.isArray(d.domains) ? d.domains : undefined,
      });
  };
  ch.addEventListener("message", handler);
  return () => {
    ch.removeEventListener("message", handler);
    ch.close();
  };
}

// The cross-user live-sync stream (`subscribeLiveSync`) was deleted in 2.0.0
// with the server's SSE endpoint it read (audit F7): nothing subscribed.
