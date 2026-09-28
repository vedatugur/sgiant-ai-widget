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
    }
  | ReplayProposalItem;

/**
 * A write the assistant PROPOSED, replayed from the thread (sgiant-platform#503).
 *
 * An Apply card used to exist only in the live stream, so a reload, a remount
 * or a dropped connection lost it for good, while the reply went on talking
 * about "the approval cards". The server now keeps each proposal with its
 * outcome, and a replay draws it again: `proposed` as a live Apply card,
 * `applied` as what the apply produced. A dismissed card is not replayed,
 * because dismissing removed it from the live chat too.
 */
export interface ReplayProposalItem {
  kind: "proposal";
  /** The persisted proposal's id: what the card resolves by. */
  id: string;
  name: string;
  args: Record<string, unknown>;
  agent?: string;
  /** The confirm fields as the assistant declared them (raw; the renderer
   *  normalizes them exactly as it does a live frame's). */
  fields?: unknown;
  /** The account the write is FOR, when the worker said. */
  accountId?: string;
  /** The saved artifact a dashboard/template apply needs. */
  artifactId?: string;
  status: "proposed" | "applied";
  /** The host's account of an applied write: its sentence and a link. */
  result?: { message?: string; href?: string; hrefLabel?: string };
}
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
 * Where a replayed row sits among those sharing its anchor time: a turn's
 * question, the steps it took, its reply, then its decisions. See
 * `buildThreadReplay`'s `items`.
 */
const RANK = { question: 0, step: 1, reply: 2, decision: 3 } as const;

/**
 * Map a thread's messages + artifacts (the `/ai/threads/:id/messages` response)
 * into an ordered replay list — text messages interleaved with their data
 * widgets by `createdAt`, exactly like the full-page assistant, and the steps
 * and proposals a turn saved WHILE it ran placed by that turn's reply (see
 * `byTurn` below). Pure; hosts pass it the fetched payload so the widget
 * reopens a conversation WITH its charts.
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
    /** The row id. A proposal card resolves by it. */
    id?: string;
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
  /**
   * Sorted by `t`, then `rank`, then `t2`. The rank orders the rows that share
   * an anchor time: a turn's question, its steps, its reply, its decisions.
   * Both the question and the reply are saved when the turn ends, so they can
   * carry the same timestamp, and a step anchored to the reply must still land
   * between the two.
   */
  const items: Array<{
    t: string;
    rank: number;
    t2: string;
    item: LoadedThreadItem;
  }> = [];
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
      items.push({
        t: m.createdAt ?? "",
        rank: m.role === "user" ? RANK.question : RANK.reply,
        t2: "",
        item,
      });
    }
  }
  // Every assistant reply in the thread (every branch), oldest first: where a
  // step or a proposal finds the reply of its own turn. See byTurn.
  const replies = (payload.messages ?? [])
    .filter((m) => m.role === "assistant" && m.createdAt)
    .sort((x, y) => (x.createdAt ?? "").localeCompare(y.createdAt ?? ""));
  /**
   * PLACED BY THE REPLY OF ITS OWN TURN, as the live widget draws it: the
   * question, the steps, the reply, then the decision.
   *
   * Its own `createdAt` cannot place it. A step or a proposal is saved the
   * moment it streams, and the turn's question and reply are both saved when
   * the turn ENDS, minutes later on a long turn. By time alone it would sit
   * above the question that asked for it (sgiant-platform#503 for proposals,
   * #504 for steps). So it takes the first reply saved after it, which is its
   * own turn's (turns in one thread do not overlap), and sorts just before
   * that reply (a step) or just behind it (a decision). If that reply is on
   * another branch, so is the artifact. With no reply yet (the turn is still
   * running) it goes by its own time, which is after every earlier reply.
   */
  const byTurn = (
    a: { createdAt?: string },
    rank: number,
    item: LoadedThreadItem
  ) => {
    const own = a.createdAt ?? "";
    const reply = replies.find((m) => (m.createdAt ?? "") >= own);
    if (reply && activeSet && reply.id && !activeSet.has(reply.id)) return;
    items.push({ t: reply?.createdAt ?? own, rank, t2: own, item });
  };
  for (const a of payload.artifacts ?? []) {
    // Branch-scoped artifacts (tied to a message) only belong to the active
    // branch; artifacts with no messageId are thread-wide and always stay.
    if (activeSet && a.messageId && !activeSet.has(a.messageId)) continue;
    if (a.kind === "proposal") {
      const item = proposalItem(a);
      if (!item) continue;
      // After the reply: the explanation, then the decision.
      byTurn(a, RANK.decision, item);
    } else if (a.kind === "widget") {
      const p = (a.payload ?? {}) as {
        spec?: unknown;
        rows?: unknown;
        comparisonRows?: unknown;
      };
      if (!p.spec) continue;
      items.push({
        t: a.createdAt ?? "",
        rank: RANK.reply,
        t2: "",
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
      // Before the reply: the steps its turn took to get there.
      byTurn(a, RANK.step, {
        kind: "activity",
        label: p.label,
        status: p.status ?? "ok",
        agent: p.agent,
        model: p.model,
        ...(reportId ? { reportId } : {}),
      });
    }
  }
  items.sort(
    (x, y) =>
      x.t.localeCompare(y.t) || x.rank - y.rank || x.t2.localeCompare(y.t2)
  );
  return items.map((s) => s.item);
}

/** A persisted proposal artifact as a replay item, or null when it has nothing
 *  to draw: no id or tool name, or it was dismissed. */
function proposalItem(a: {
  id?: string;
  payload?: unknown;
  status?: string;
}): ReplayProposalItem | null {
  const p = (a.payload ?? {}) as {
    name?: unknown;
    args?: unknown;
    agent?: unknown;
    fields?: unknown;
    accountId?: unknown;
    artifactId?: unknown;
    result?: unknown;
  };
  if (!a.id || typeof p.name !== "string" || !p.name) return null;
  if (a.status !== "proposed" && a.status !== "applied") return null;
  const str = (v: unknown): string | undefined =>
    typeof v === "string" && v ? v : undefined;
  const r =
    p.result && typeof p.result === "object"
      ? (p.result as Record<string, unknown>)
      : null;
  const result = r
    ? {
        ...(str(r.message) ? { message: str(r.message) } : {}),
        ...(str(r.href) ? { href: str(r.href) } : {}),
        ...(str(r.hrefLabel) ? { hrefLabel: str(r.hrefLabel) } : {}),
      }
    : undefined;
  return {
    kind: "proposal",
    id: a.id,
    name: p.name,
    args:
      p.args && typeof p.args === "object" && !Array.isArray(p.args)
        ? (p.args as Record<string, unknown>)
        : {},
    ...(str(p.agent) ? { agent: str(p.agent) } : {}),
    ...(p.fields !== undefined ? { fields: p.fields } : {}),
    ...(str(p.accountId) ? { accountId: str(p.accountId) } : {}),
    ...(str(p.artifactId) ? { artifactId: str(p.artifactId) } : {}),
    status: a.status,
    ...(result && Object.keys(result).length ? { result } : {}),
  };
}
