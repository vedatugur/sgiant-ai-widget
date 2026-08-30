/**
 * Replaying a saved thread, and the ‹n/m› branch navigation over it.
 *
 * Extracted from index.ts (#320). Measured at ZERO leakage: nothing in these
 * 250 lines reaches a top-level declaration in the file it came from, which is
 * why it moves as a unit and why the move is reviewable.
 *
 * The shape is worth naming, because it is the seam #306 needs: a PURE
 * TRANSFORM — a server payload in, a list of render items out — with no DOM,
 * no transport and no host context. `buildThreadReplay` is already documented
 * as taking a report ID rather than a path for exactly that reason ("a pure
 * function with no host context, and the widget runs in three shells with
 * different route shapes"). A published widget needs more regions like this
 * one and fewer inside the 6000-line closure.
 */

/** One item replayed from a past thread: a chat message, or an inline data
 *  widget (so reopening restores the conversation's charts/tables, not just
 *  text). The render hooks / fallback handle the actual drawing. */
export type LoadedThreadItem =
  | {
      role: "user" | "assistant";
      content: string;
      /** Stable message id (branching). Absent on hosts that predate branching. */
      id?: string;
      /** The model that produced this message, so a vote cast on REPLAYED
       *  history is attributable per model like a live one (#299). */
      model?: string;
      /** Parent turn in the conversation tree (null on a root message). */
      parentId?: string | null;
      /** Persisted per-turn token spend (assistant messages) — replays the
       *  ↑/↓ tokens caption that the live stream draws, so it survives the
       *  end-of-turn thread reload and thread reopen. Shown even on the free
       *  staff lane: not billed there, still worth seeing. */
      inputTokens?: number;
      outputTokens?: number;
      /** ‹n/m› sibling switcher data — present when this turn has siblings. */
      branch?: {
        index: number;
        count: number;
        prevLeaf?: string;
        nextLeaf?: string;
      };
    }
  | { kind: "widget"; spec: unknown; rows: unknown; comparisonRows?: unknown }
  | {
      kind: "activity";
      label: string;
      status: string;
      agent?: string;
      model?: string;
      /** The REPORT this step produced, if any.
       *
       *  An ID and not a path: `buildThreadReplay` is a pure function with no
       *  host context, and the widget runs in three shells with different route
       *  shapes. The renderer turns it into a path via `opts.reportHref`. */
      reportId?: string;
    };
/** The message variant of a replay item (carries the branch metadata). */
export type ReplayMessageItem = Extract<
  LoadedThreadItem,
  { role: "user" | "assistant" }
>;

/** ‹n/m› sibling navigation for one message (mirrors the panel's BranchNav). */
export interface BranchNav {
  index: number;
  count: number;
  prevLeaf?: string;
  nextLeaf?: string;
}

/** A stored message reduced to what branch navigation needs. */
export interface BranchMsg {
  id?: string;
  parentId?: string | null;
  createdAt?: string;
}

export const ROOT_KEY = "__root__";

/** Deepest leaf under a message, following the most recent child at each step
 *  (memoised, cycle-guarded) — the target the ‹n/m› switcher jumps to. Mirrors
 *  the full-page panel's `leafUnder`. */
export function leafUnder(
  id: string,
  childrenByParent: Map<string, BranchMsg[]>,
  memo: Map<string, string>,
  guard = 0
): string {
  const cached = memo.get(id);
  if (cached) return cached;
  const kids = childrenByParent.get(id);
  if (!kids || kids.length === 0 || guard > 1000) {
    memo.set(id, id);
    return id;
  }
  const last = kids[kids.length - 1];
  const leaf = last?.id
    ? leafUnder(last.id, childrenByParent, memo, guard + 1)
    : id;
  memo.set(id, leaf);
  return leaf;
}

/**
 * Compute the ‹n/m› sibling switcher for every message on the active path.
 * Siblings share a parent; editing a user turn or regenerating an assistant
 * reply adds one. The prev/next targets are the deepest leaf under the adjacent
 * sibling, so switching lands on a full branch. Mirrors the panel's
 * `computeBranchNav` exactly.
 */
export function computeBranchNav(
  messages: BranchMsg[],
  activePathIds: string[]
): Map<string, BranchNav> {
  const childrenByParent = new Map<string, BranchMsg[]>();
  for (const m of messages) {
    const key = m.parentId ?? ROOT_KEY;
    const arr = childrenByParent.get(key);
    if (arr) arr.push(m);
    else childrenByParent.set(key, [m]);
  }
  for (const arr of childrenByParent.values()) {
    arr.sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""));
  }
  const memo = new Map<string, string>();
  const byId = new Map<string, BranchMsg>();
  for (const m of messages) if (m.id) byId.set(m.id, m);
  const nav = new Map<string, BranchNav>();
  for (const id of activePathIds) {
    const m = byId.get(id);
    if (!m) continue;
    const siblings = childrenByParent.get(m.parentId ?? ROOT_KEY) ?? [];
    if (siblings.length < 2) continue;
    const i = siblings.findIndex((s) => s.id === id);
    if (i < 0) continue;
    const prev = siblings[i - 1];
    const next = siblings[i + 1];
    nav.set(id, {
      index: i + 1,
      count: siblings.length,
      ...(prev?.id
        ? { prevLeaf: leafUnder(prev.id, childrenByParent, memo) }
        : {}),
      ...(next?.id
        ? { nextLeaf: leafUnder(next.id, childrenByParent, memo) }
        : {}),
    });
  }
  return nav;
}

/**
 * Map a thread's messages + artifacts (the `/ai/threads/:id/messages` response)
 * into an ordered replay list — text messages interleaved with their data
 * widgets by `createdAt`, exactly like the full-page assistant. Pure; hosts pass
 * it the fetched payload so the widget reopens a conversation WITH its charts.
 *
 * Branching: when the server sends a non-empty `activePath`, the visible
 * transcript is that branch ONLY — messages (and message-scoped artifacts) are
 * filtered to it, and each surviving message carries its ‹n/m› sibling switcher
 * (computed over ALL messages). Absent/empty path → behave exactly as before
 * (back-compat with pre-branching hosts).
 */
export function buildThreadReplay(payload: {
  messages?: Array<{
    id?: string;
    parentId?: string | null;
    role: string;
    content: string;
    createdAt?: string;
    /** Persisted per-turn token spend (assistant rows; both read endpoints
     *  return them) — carried into the replay's tokens caption. */
    inputTokens?: number | null;
    outputTokens?: number | null;
  }>;
  artifacts?: Array<{
    kind: string;
    messageId?: string | null;
    payload?: unknown;
    /** proposed | applied | discarded — what tells a replayed proposal card
     *  whether Apply is still a live decision. */
    status?: string;
    createdAt?: string;
  }>;
  activePath?: string[];
}): LoadedThreadItem[] {
  const activePathIds =
    payload.activePath && payload.activePath.length > 0
      ? payload.activePath
      : null;
  const activeSet = activePathIds ? new Set(activePathIds) : null;
  const branchNav = activePathIds
    ? computeBranchNav(payload.messages ?? [], activePathIds)
    : null;
  const items: Array<{ t: string; item: LoadedThreadItem }> = [];
  for (const m of payload.messages ?? []) {
    // Off-branch messages don't appear in the active transcript.
    if (activeSet && m.id && !activeSet.has(m.id)) continue;
    if ((m.role === "user" || m.role === "assistant") && m.content.trim()) {
      const item: ReplayMessageItem = {
        role: m.role,
        content: m.content,
        ...(m.id ? { id: m.id } : {}),
        ...(m.parentId !== undefined ? { parentId: m.parentId } : {}),
        ...(m.inputTokens ? { inputTokens: m.inputTokens } : {}),
        ...(m.outputTokens ? { outputTokens: m.outputTokens } : {}),
        ...(m.id && branchNav?.has(m.id)
          ? { branch: branchNav.get(m.id) }
          : {}),
      };
      items.push({ t: m.createdAt ?? "", item });
    }
  }
  for (const a of payload.artifacts ?? []) {
    // Branch-scoped artifacts (tied to a message) only belong to the active
    // branch; artifacts with no messageId are thread-wide and always stay.
    if (activeSet && a.messageId && !activeSet.has(a.messageId)) continue;
    if (a.kind === "widget") {
      const p = (a.payload ?? {}) as {
        spec?: unknown;
        rows?: unknown;
        comparisonRows?: unknown;
      };
      if (!p.spec) continue;
      items.push({
        t: a.createdAt ?? "",
        item: {
          kind: "widget",
          spec: p.spec,
          rows: p.rows ?? [],
          comparisonRows: p.comparisonRows ?? null,
        },
      });
    } else if (a.kind === "activity") {
      // A persisted process step — replays the timeline (+ acting agent) on reopen.
      const p = (a.payload ?? {}) as {
        label?: string;
        status?: string;
        agent?: string;
        model?: string;
        reportId?: string;
      };
      if (!p.label) continue;
      // The report id was persisted on the artifact and DROPPED here, so a
      // finished report replayed as a chip you could read and not open.
      const reportId =
        p.status !== "error" && typeof p.reportId === "string" && p.reportId
          ? p.reportId
          : undefined;
      items.push({
        t: a.createdAt ?? "",
        item: {
          kind: "activity",
          label: p.label,
          status: p.status ?? "ok",
          agent: p.agent,
          model: p.model,
          ...(reportId ? { reportId } : {}),
        },
      });
    }
  }
  items.sort((x, y) => x.t.localeCompare(y.t));
  return items.map((s) => s.item);
}
