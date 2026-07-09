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
  account: ["accounts-me", "account-products-activated"],
};

/** Which domains each apply-proposal name touches (for scoped invalidation). */
export const AI_ACTION_DOMAINS: Record<string, string[]> = {
  update_creation: ["creations"],
  render_creation: ["creations"],
  add_stock_to_assets: ["assets"],
  add_scraped_media: ["assets"],
  ingest_website: ["assets"],
  generate_image: ["assets"],
  generate_video: ["assets"],
  organize_assets: ["assets"],
  edit_asset: ["assets"],
  create_asset: ["assets"],
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
