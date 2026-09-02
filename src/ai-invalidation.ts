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

// --- Cross-user real-time (SSE) ------------------------------------------------
// Tier 3: a change made by ANOTHER user/device. The server pushes
// `{accountId, domains}` over SSE (Postgres LISTEN/NOTIFY → see
// docs/realtime-sync.md); the client refetches. Uses fetch (not EventSource) so
// it can send the Clerk bearer token, and auto-reconnects with capped backoff.

export interface LiveSyncOptions {
  /** The SSE endpoint, e.g. `${API_BASE}/accounts/:id/live`. */
  url: string;
  /** Fresh auth token per (re)connect. */
  getToken: () => Promise<string | null>;
  /** Called for each change event the server pushes. */
  onChange: (accountId: string, domains?: string[]) => void;
}

/** Subscribe to the server's live-sync stream. Returns an unsubscribe fn. No-op
 *  where fetch/streams are unavailable (SSR). */
export function subscribeLiveSync(opts: LiveSyncOptions): () => void {
  if (typeof fetch === "undefined") return () => {};
  let closed = false;
  let ctrl: AbortController | null = null;
  let backoff = 1000;

  const connect = async (): Promise<void> => {
    if (closed) return;
    ctrl = new AbortController();
    try {
      const token = await opts.getToken();
      const res = await fetch(opts.url, {
        headers: token ? { authorization: `Bearer ${token}` } : {},
        credentials: "include",
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) throw new Error(`live ${res.status}`);
      backoff = 1000; // connected — reset backoff
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done || closed) break;
        buf += dec.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n\n")) >= 0) {
          const frame = buf.slice(0, nl);
          buf = buf.slice(nl + 2);
          const line = frame.split("\n").find((l) => l.startsWith("data:"));
          if (!line) continue; // heartbeat / comment
          try {
            const d = JSON.parse(
              line.slice(5).trim()
            ) as Partial<AiChangeEvent>;
            if (d && typeof d.accountId === "string")
              opts.onChange(
                d.accountId,
                Array.isArray(d.domains) ? d.domains : undefined
              );
          } catch {
            /* non-json frame */
          }
        }
      }
    } catch {
      /* network error / abort */
    }
    if (closed) return;
    const wait = backoff;
    backoff = Math.min(backoff * 2, 30_000);
    setTimeout(connect, wait);
  };
  void connect();
  return () => {
    closed = true;
    ctrl?.abort();
  };
}
