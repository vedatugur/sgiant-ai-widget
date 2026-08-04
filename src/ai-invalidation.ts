/**
 * Central registry of the React Query keys each AI-touchable DOMAIN affects, so a
 * Copilot apply-proposal invalidates exactly the right queries and every page
 * reading them repopulates live. This replaces the hardcoded key arrays that were
 * duplicated in each app's `onApplyProposal` — one source of truth, so a new
 * page/domain is wired once and no surface is silently missed.
 *
 * Over-invalidation is deliberately fine (correctness > a few extra refetches);
 * unknown actions fall back to invalidating everything, so a newly-added apply is
 * never UNDER-invalidated.
 */

/** Query keys each domain's data lives under (all account-scoped: `[key, accountId]`). */
export const AI_DOMAIN_KEYS: Record<string, string[]> = {
  creations: ["studio-creations", "studio-status"],
  brand: ["ai-brand-profile", "brand-versions", "studio-status"],
  assets: ["asset-media", "asset-folders", "asset-usage", "assets"],
  account: ["accounts-me", "account-products-activated", "account-settings"],
};

/** Which domains each apply-proposal name touches (for scoped invalidation). */
export const AI_ACTION_DOMAINS: Record<string, string[]> = {
  update_creation: ["creations"],
  render_creation: ["creations"],
  add_scraped_media: ["assets"],
  ingest_website: ["assets"],
  generate_image: ["assets"],
  generate_video: ["assets"],
  organize_assets: ["assets"],
  manage_folders: ["assets"],
  set_account_settings: ["account"],
  edit_asset: ["assets"],
  create_asset: ["assets"],
  share_asset: ["assets"],
  save_artifact_to_assets: ["assets"],
  update_brand_profile: ["brand", "creations"],
  edit_brand: ["brand", "creations"],
};

/** Minimal shape of a React Query client — avoids a hard dep on @tanstack here. */
export interface QueryInvalidator {
  invalidateQueries: (opts: { queryKey: unknown[] }) => unknown;
}

/**
 * Invalidate every query key the given `domains` touch (default: ALL domains),
 * scoped to the account. After this, any page bound to those queries refetches
 * and its inputs/displays repopulate with the AI's change.
 */
export function invalidateAiTouched(
  qc: QueryInvalidator,
  accountId: string,
  domains?: string[]
): void {
  const chosen = domains ?? Object.keys(AI_DOMAIN_KEYS);
  const keys = new Set<string>();
  for (const d of chosen) for (const k of AI_DOMAIN_KEYS[d] ?? []) keys.add(k);
  for (const key of keys)
    void qc.invalidateQueries({ queryKey: [key, accountId] });
}

/**
 * Invalidate exactly what one apply-proposal `name` touches. Unknown names fall
 * back to invalidating everything, so a new action is never under-invalidated.
 */
export function invalidateForAction(
  qc: QueryInvalidator,
  accountId: string,
  name: string
): void {
  invalidateAiTouched(qc, accountId, AI_ACTION_DOMAINS[name]);
}

// --- Cross-tab real-time -------------------------------------------------------
// An AI change in ONE tab should make EVERY tab of this browser live, on any
// page. BroadcastChannel is same-origin + browser-native (no server), so the
// acting tab invalidates locally AND broadcasts; other tabs invalidate on
// receipt. (Cross-USER / cross-device realtime needs a server push — see
// docs/realtime-sync.md.)
const AI_LIVE_CHANNEL = "sgiant-ai-live";

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

/**
 * Apply an AI change everywhere: invalidate THIS tab's queries and broadcast to
 * the others. Call from `onApplyProposal` after the write lands. This is the one
 * entry point a host needs for the full live-refresh behaviour.
 */
export function applyAiChange(
  qc: QueryInvalidator,
  accountId: string,
  name: string
): void {
  const domains = AI_ACTION_DOMAINS[name];
  invalidateAiTouched(qc, accountId, domains);
  broadcastAiChange(accountId, domains);
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
