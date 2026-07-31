/**
 * Embeddable AI chatbox widget — framework-agnostic vanilla DOM, so it drops
 * into the analytics app, the marketing studio, OR an external site with one
 * call. It POSTs to a streaming chat endpoint and renders the reply live.
 *
 * Transport is intentionally tolerant: it reads a streamed body and accepts
 * BOTH shapes this platform emits —
 *   - analytics SSE  : `data: {"type":"assistant_delta","text":"…"}`
 *   - studio NDJSON  : `{"d":"…"}`
 * plus `{type:"thread",threadId}` / `{type:"error"}` / `{type:"done"}`.
 *
 * SECURITY: the widget never holds long-lived secrets — the host supplies a
 * token (Clerk session for in-app, or a short-lived embed token for external
 * use). The backend's OBO scoping remains the real ceiling; this is just UI.
 * See [[project_unified_managed_ai]].
 */

// Shared host protocol — standard page context + in-app action map every
// surface (org/admin/marketing/onboarding) wires the same way.
export {
  makePageContext,
  matchManifest,
  formatPageContext,
  createHostActions,
  STANDARD_ACTIONS,
  STANDARD_ACTION_PATHS,
  isNavigationAction,
  type PageContext,
  type PageManifestEntry,
  type NavTarget,
  type AppSurface,
  type HostActionsConfig,
  type HostActionHandler,
} from "./host-actions";
// Used locally too (the block above only RE-exports for consumers): the
// auto-navigate gate needs to know what counts as navigation.
import { isNavigationAction } from "./host-actions";
// Same reason: the block below re-exports these for consumers, but the widget
// itself subscribes so a finished background job can refresh the transcript.
import { subscribeAiChange } from "./ai-invalidation";
// Read-only UI control — point the Copilot at on-page controls by their stable
// `data-ai-target` id. `scanAiTargets` feeds the current page's controls into
// the turn context so the model knows what it may highlight/scroll-to/focus.
export {
  scanAiTargets,
  clearHighlight,
  isUiControlAction,
  isOperateAction,
  UI_CONTROL_ACTIONS,
  OPERATE_ACTIONS,
  type AiTargetInfo,
  type UiControlAction,
  type OperateAction,
} from "./ui-control";
import { isOperateAction, isUiControlAction } from "./ui-control";
import {
  createFrameTransport,
  type FrameTransport,
  type BridgeAction,
} from "@sgiant/ai-agent-bridge";
export {
  AI_DOMAIN_KEYS,
  AI_ACTION_DOMAINS,
  invalidateAiTouched,
  invalidateForAction,
  broadcastAiChange,
  subscribeAiChange,
  applyAiChange,
  subscribeLiveSync,
  type QueryInvalidator,
  type AiChangeEvent,
  type LiveSyncOptions,
} from "./ai-invalidation";
import type { PageContext } from "./host-actions";
import { renderMarkdown } from "./markdown";

/** One item replayed from a past thread: a chat message, or an inline data
 *  widget (so reopening restores the conversation's charts/tables, not just
 *  text). The render hooks / fallback handle the actual drawing. */
export type LoadedThreadItem =
  | {
      role: "user" | "assistant";
      content: string;
      /** Stable message id (branching). Absent on hosts that predate branching. */
      id?: string;
      /** Parent turn in the conversation tree (null on a root message). */
      parentId?: string | null;
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
    }
  | { kind: "creation"; name?: string; format?: string; payload: unknown };

/** The message variant of a replay item (carries the branch metadata). */
type ReplayMessageItem = Extract<
  LoadedThreadItem,
  { role: "user" | "assistant" }
>;

/** ‹n/m› sibling navigation for one message (mirrors the panel's BranchNav). */
interface BranchNav {
  index: number;
  count: number;
  prevLeaf?: string;
  nextLeaf?: string;
}

/** A stored message reduced to what branch navigation needs. */
interface BranchMsg {
  id?: string;
  parentId?: string | null;
  createdAt?: string;
}

const ROOT_KEY = "__root__";

/** Deepest leaf under a message, following the most recent child at each step
 *  (memoised, cycle-guarded) — the target the ‹n/m› switcher jumps to. Mirrors
 *  the full-page panel's `leafUnder`. */
function leafUnder(
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
function computeBranchNav(
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
  }>;
  artifacts?: Array<{
    kind: string;
    messageId?: string | null;
    payload?: unknown;
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
      };
      if (!p.label) continue;
      items.push({
        t: a.createdAt ?? "",
        item: {
          kind: "activity",
          label: p.label,
          status: p.status ?? "ok",
          agent: p.agent,
          model: p.model,
        },
      });
    } else if (a.kind === "creation") {
      // A creation the AI designed in this thread — replays the .sgiant preview
      // (clickable → lightbox) on reopen, so past reels/posts stay visible.
      const p = (a.payload ?? {}) as {
        name?: string;
        format?: string;
        payload?: unknown;
      };
      if (!p.payload) continue;
      items.push({
        t: a.createdAt ?? "",
        item: {
          kind: "creation",
          name: p.name,
          format: p.format,
          payload: p.payload,
        },
      });
    }
  }
  items.sort((x, y) => x.t.localeCompare(y.t));
  return items.map((s) => s.item);
}

/**
 * A background job as the CHAT needs to draw it.
 *
 * Deliberately the GENERIC job shape (`JobSummary`'s status + done-of-total
 * progress) rather than anything a site import or a video render owns: the
 * platform is heading toward AI-defined job types, and a card that switched on
 * the type would have to be rewritten for each of them. The host maps the API's
 * `JobRecord` onto this — which is a structural widening, not a translation.
 *
 * Every field but `status` is optional so a job type that has no answer for one
 * simply omits it, and the card draws what it was given.
 */
export interface WidgetJobView {
  /**
   * The job's id. Optional because a card fetched BY id already knows it — but
   * required in practice for `listThreadJobs`, where the whole point is
   * learning which jobs exist. A view without one simply cannot be re-attached.
   */
  id?: string;
  /** The generic job type, used ONLY to pick nicer copy for the types we happen
   *  to know. An unrecognised type renders with the neutral fallback title —
   *  which is the test that this stays type-agnostic. */
  type?: string;
  /** The coarse, type-agnostic lifecycle — `JobStatus` on the wire. */
  status: "queued" | "running" | "done" | "failed" | "cancelled";
  /** Done-of-total, with a short label for what is happening right now (the page
   *  being crawled). `total` is null while it is not yet known. */
  progress?: { done?: number; total?: number | null; label?: string | null };
  /** Overrides the type-derived title when the host knows better. */
  title?: string | null;
  /** Why it failed / what went wrong inside it. Shown verbatim. */
  error?: string | null;
  /** Where the finished work landed — an in-app, root-relative path the card
   *  links to (e.g. "/assets"). Omit when the job produced nothing to open. */
  resultPath?: string | null;
  /**
   * The job's FLOW — the runner's own narration (which pages the AI picked,
   * how it grouped them, what each step yielded), oldest first. Server text,
   * escaped like every other untrusted string. Rides the same poll as
   * progress, so the card is live while the job runs — and because it comes
   * from the server, a page refresh replays it instead of losing it.
   */
  events?: Array<{
    /** "status" | "decision" | "step" | "problem" — coarse render hint. */
    kind?: string;
    message: string;
    at?: string;
  }>;
}

export interface AiChatWidgetOptions {
  /** Streaming chat endpoint (POST). e.g. https://api.sgiant.io/accounts/:id/ai/chat */
  endpoint: string;
  /** Media-upload endpoint (POST multipart) for chat attachments — e.g.
   *  https://api.sgiant.io/accounts/:id/assets/media. When set (authed
   *  surfaces), the composer shows a paperclip so the user can attach files the
   *  assistant reads. Omit on the anonymous surface (no library to store into). */
  uploadEndpoint?: string;
  /** Account the chat is scoped to. Omit for the public/anonymous endpoint. */
  accountId?: string;
  /**
   * DYNAMIC account scope, read at call time and preferred over `accountId`.
   * For hosts whose page context changes while the widget lives on (the admin
   * backoffice follows staff across accounts): re-creating the widget per
   * account aborts an in-flight reply and visibly resets the chat, so such a
   * host mounts ONE instance and feeds the current account through here.
   */
  getAccountScope?: () => string | undefined;
  /** Dynamic twin of `uploadEndpoint`, same reason. The attach button exists
   *  when either is provided. */
  getUploadEndpoint?: () => string | undefined;
  /**
   * Extra fields merged into every POST body — e.g. `{ visitorId, source }` for
   * the anonymous marketing endpoint. Never put secrets here; it's plain JSON.
   */
  extraBody?: Record<string, unknown>;
  /**
   * Dynamic per-send context (current page, recent navigation, last actions).
   * Merged into each POST body under `pageContext` so the assistant can answer
   * about what the user is looking at. Called right before every send.
   */
  getContext?: () =>
    | PageContext
    | Record<string, unknown>
    | undefined
    | Promise<PageContext | Record<string, unknown> | undefined>;
  /**
   * Window event name that opens the panel (e.g. "sgiant:open-assistant"), so a
   * nav/sidebar link elsewhere in the app can summon the widget.
   */
  openEventName?: string;
  /** Bearer token (Clerk session or embed token). Use getToken for refresh. */
  token?: string;
  /** Async token provider — called before each send (overrides `token`). */
  getToken?: () => string | Promise<string>;
  /** Send cookies (same-origin in-app embedding). Default false. */
  withCredentials?: boolean;
  /**
   * Authed surfaces (org + admin): a persistent status bar shows the remaining
   * AI credits and which Copilot role is acting. Called on open + after each turn;
   * return the current credit balance (null = unknown/hidden).
   */
  getBalance?: () => Promise<number | null> | number | null;
  /** Assistant name shown in the header + bubble aria-label. Default "Copilot". */
  title?: string;
  /** Small line under the name. Default "Growth assistant". */
  subtitle?: string;
  /** Avatar image URL (the brand logo mark). Falls back to a crescent glyph. */
  avatarUrl?: string;
  /** CSS gradient for the chrome (header/bubble) for a premium look. */
  gradient?: string;
  greeting?: string;
  /**
   * Page-aware shortcuts. Returns a few suggested questions/actions for the
   * CURRENT page (the host derives them from the path) — rendered as clickable
   * chips under the greeting whenever the conversation is empty. Clicking a chip
   * sends it as the user's message. Called on open + new chat, so the shortcuts
   * follow the user around the app. Return [] (or omit) to show none.
   */
  getSuggestions?: () => string[] | Promise<string[]>;
  accent?: string;
  /**
   * Theme token overrides. The widget's entire stylesheet reads from
   * `--aiw-*` CSS custom properties set on its roots; pass any subset here to
   * restyle it (e.g. a dark theme: `{ surface:"#16161e", bg:"#101016",
   * text:"#e7e7ec", "text-2":"#b6b6c2", muted:"#8a8a96", border:"#2b2b36",
   * "border-strong":"#3a3a48", "border-soft":"#22222c" }`). Known tokens:
   * accent, accent-contrast, gradient, surface, surface-2, bg, text, text-2,
   * muted, border, border-strong, border-soft. `accent`/`gradient` options
   * remain the shorthand for the two most common ones.
   */
  theme?: Record<string, string>;
  /**
   * Custom directive renderers — the OPEN extension point. The assistant can
   * emit `[[<tag>:{json}]]` for any tag registered here; the widget strips the
   * directive, mounts a host element in the log, and calls your renderer with
   * the parsed JSON. Return a disposer to be called when the message clears.
   * Built-in tags (widget/preview/navigate/action/chips/form) are reserved and
   * cannot be overridden. Also available post-mount via
   * `handle.registerRenderer(tag, fn)`.
   */
  renderers?: Record<string, DirectiveRenderer>;
  /**
   * Fallback chart renderer for embeds WITHOUT `renderDataWidget` (no React
   * host). When the assistant streams a `render_chart` frame and no host
   * renderer is wired, this is consulted before the built-in degrade
   * (kpi → stat, else a plain table) — plug a lightweight chart lib here to
   * get real charts in a standalone embed. Same contract as renderDataWidget.
   */
  renderChartFallback?: (
    host: HTMLElement,
    spec: unknown,
    rows: unknown,
    comparisonRows?: unknown
  ) => (() => void) | void;
  position?: "bottom-right" | "bottom-left";
  /** Mount target; defaults to document.body. */
  container?: HTMLElement;
  /**
   * When set, the conversation (thread id + messages) is persisted to
   * localStorage under this key and restored on reload — so a page refresh
   * doesn't lose the chat. Use a per-visitor/per-user key (e.g. the visitorId).
   */
  persistKey?: string;
  /**
   * Scope for LAYOUT preferences — the panel's dragged position and its
   * open/closed state. Distinct from `persistKey` (which scopes the CONVERSATION)
   * on purpose: a host that changes persistKey per account (so each account keeps
   * its own thread) would otherwise reset the panel's position and re-close it on
   * every account switch — the user drags it once and it "jumps" as they navigate.
   * Pass a stable app-level value (e.g. "backoffice" / "org") so position + open
   * state follow the user across accounts and pages. Falls back to `persistKey`.
   */
  layoutKey?: string;
  /**
   * Called when the user clicks "Report issue" on an error state — wire it to
   * your Backoffice/contact endpoint so the admin team gets the failed turn.
   */
  onReportIssue?: (details: {
    error: string;
    lastUserMessage: string;
    threadId?: string;
  }) => void | Promise<void>;
  /**
   * Flag the CURRENT conversation for oversight (agent/admin surfaces only). When
   * provided, a flag control appears in the header; clicking it asks for a reason
   * and calls this with the reason + the live thread id. Wire it to the flags API
   * (e.g. POST /admin/ai/conversations/:kind/:threadId/flag). Omit to hide the
   * control (e.g. the public visitor widget). Throw to surface a failure.
   */
  onFlag?: (details: {
    reason: string;
    threadId?: string;
  }) => void | Promise<void>;
  /**
   * Lead capture. When the assistant emits the sentinel `[[collect-email]]` in a
   * reply, the widget strips it and renders an inline email form; submitting it
   * calls this with the email (+ the last user message as context). Wire it to
   * your contact/lead API. Omit to disable lead capture entirely.
   */
  onLead?: (lead: { email: string; context?: string }) => Promise<void>;
  /**
   * Generic AI-rendered input forms. When the assistant emits a
   * `[[form:{...}]]` directive, the widget renders the described form inline and,
   * on submit, calls this with the directive's `action` name + the collected
   * field values. SECURITY: the AI only names an `action`; the HOST maps action
   * names to real API calls here — the AI can never call an arbitrary endpoint.
   * Throw to surface a retry. Return a string to show as the success message.
   */
  onWidgetAction?: (
    action: string,
    data: Record<string, string>
  ) => Promise<string | void>;
  /**
   * Show an expand/restore control in the header to grow the panel to a larger
   * reading size (and back). Default true. Set false for tight embeds.
   */
  expandable?: boolean;
  /**
   * Offer an "auto-navigate" toggle in the header. When the user turns it ON,
   * the assistant's `[[navigate:…]]` suggestions are followed AUTOMATICALLY (no
   * confirm button) — a hands-free "drive me there" mode. State is BROWSER-LOCAL
   * (localStorage), off by default, and per-user controlled. In-app ACTIONS that
   * carry a `confirm` (anything that changes state or costs credits) are NEVER
   * auto-run — only pure page navigation is. Set true on surfaces where
   * navigation is enabled (org/admin/marketing).
   */
  autoNavOption?: boolean;
  /**
   * ADVANCED VIEW. When `getAdvancedUrl` is provided, a header toggle opens a
   * full-screen split: the chat on the left and the app in an <iframe> on the
   * right that Copilot can DRIVE (highlight / fill / click) via the postMessage
   * agent bridge (`@sgiant/ai-agent-bridge`). The framed page must mount the
   * agent (`mountAiAgent`). `getAdvancedUrl()` returns the embed URL for the
   * CURRENT page; `getAdvancedUrl(path)` returns it for an account-relative path
   * (used to navigate the frame). Omit to disable advanced view.
   */
  getAdvancedUrl?: (path?: string) => string;
  /**
   * Map a navigation-class action (`navigate` / `open-*`) to the account-relative
   * path it opens, so advanced view can route it to the FRAME instead of the
   * parent app. Return null for non-navigation actions (they run host-side). Only
   * consulted in advanced view.
   */
  resolveActionPath?: (
    name: string,
    data: Record<string, string>
  ) => string | null;
  /** Origin the embedded app is served from, for the agent bridge. Defaults to
   *  the current origin (same-origin embedding). */
  advancedOrigin?: string;
  /** Labels for the advanced-view controls (i18n; host supplies translations). */
  advancedLabel?: string;
  exitAdvancedLabel?: string;
  collapsePaneLabel?: string;
  expandPaneLabel?: string;
  /** Labels for the advanced-view fullscreen toggle (edge-to-edge on/off). */
  fullscreenLabel?: string;
  exitFullscreenLabel?: string;
  /** Label for the draggable chat⇆app divider (advanced view; drag to resize,
   *  double-click to reset). Width persists to localStorage per host. */
  resizeLabel?: string;
  /**
   * Past-conversation history. When provided, a history control appears in the
   * header; opening it lists the user's prior threads. Picking one calls
   * `loadThread` and replays its messages. Wire these to the authed endpoints
   * (e.g. GET /accounts/:id/ai/threads and …/threads/:threadId/messages). Omit
   * to disable history (the widget still restores the last thread via persistKey).
   */
  listThreads?: () => Promise<
    Array<{
      id: string;
      title?: string | null;
      updatedAt?: string;
      starred?: boolean;
    }>
  >;
  /** Toggle the SHARED star (team bookmark) on a past thread from the history
   *  panel. Resolves to the new starred state. Omit to hide the star toggle. */
  starThread?: (threadId: string) => Promise<{ starred: boolean }>;
  /** Load one past thread (oldest→newest) for replay in the log. Items are
   *  messages OR inline data widgets, so reopening a conversation restores its
   *  charts/tables — not just text (matching the full-page assistant). */
  loadThread?: (threadId: string) => Promise<LoadedThreadItem[]>;
  /** Switch the active branch of a conversation tree (the ‹n/m› sibling
   *  switcher, ChatGPT/Claude-style edit-and-continue). POSTs the chosen leaf so
   *  the server recomputes the active path; the widget then reloads the thread
   *  via `loadThread`. Omit on hosts without branching → the edit/regenerate/
   *  switcher controls stay hidden. */
  setActiveLeaf?: (threadId: string, messageId: string) => Promise<void>;
  /** UI labels for the branching controls. The host feeds translated strings
   *  (per the repo i18n rule); the widget uses the English fallbacks below only
   *  when an override is absent — it never hardcodes a user-visible string. */
  editLabel?: string;
  regenerateLabel?: string;
  saveLabel?: string;
  cancelLabel?: string;
  /** Record a thumbs up/down on an assistant reply (the chat quality signal).
   *  value: 1 = up, -1 = down, 0 = clear. When provided, vote buttons appear on
   *  replayed assistant turns; omit on hosts without the vote endpoint → buttons
   *  hidden. Wire to POST /ai/vote (reuses the AiMessageVote backend), mirroring
   *  the React panel's `vote`. */
  vote?: (input: {
    threadId: string;
    messageId: string;
    value: 1 | -1 | 0;
    model?: string;
  }) => Promise<void>;
  voteUpLabel?: string;
  voteDownLabel?: string;
  /** Translated copy for the widget's OWN chrome — header, More menu, composer,
   *  status bar, activity chips, proposal cards, history panel, error state. The
   *  widget is vanilla DOM and can't call i18next, so the host builds this from
   *  its own t() via `resolveWidgetLabels(t)`. Any omitted key falls back to the
   *  English default in WIDGET_LABELS — the widget never hardcodes visible copy. */
  labels?: Partial<WidgetLabels>;
  /** Where "Sign up" sends the visitor when the free token allowance runs out
   *  (and from the meter's CTA). When set, the widget shows the token meter. */
  signupUrl?: string;
  /**
   * Rich-content render hooks (in-app React hosts). When provided, the widget
   * hands the assistant's final reply markdown / data-widget frames to the host
   * to render with the REAL @sgiant/ui components (<Markdown>, <AiDataWidget>) —
   * pixel-identical to the full-page assistant. Each returns an optional
   * disposer the widget calls when it clears that message (new chat / history
   * switch / destroy) so the host can unmount its React root. Omit on external
   * embeds (no React) → the widget uses its built-in lightweight renderers.
   */
  renderMarkdown?: (host: HTMLElement, markdown: string) => (() => void) | void;
  /** Render an assistant `render_chart` frame (spec + rows) as a real chart. */
  renderDataWidget?: (
    host: HTMLElement,
    spec: unknown,
    rows: unknown,
    comparisonRows?: unknown
  ) => (() => void) | void;
  /**
   * Render a `.sgiant` creation PAYLOAD as a live visual preview — the SAME
   * CreationPreview the Studio uses. Wired by the in-app host (mounts a React
   * root); used in the `render_creation` proposal card so the user SEES the
   * design before they apply it. Returns a disposer (unmount). Omit on external
   * embeds (no React) → the card falls back to its text summary.
   */
  renderCreation?: (host: HTMLElement, payload: unknown) => (() => void) | void;
  /**
   * Apply a confirm-gated WRITE-tool proposal (e.g. `update_creation`). The AI
   * never mutates directly — it proposes; the widget shows a card and THIS runs
   * only when the user clicks Apply (a Clerk-authed action in the host). Map the
   * tool name → a real, access-checked API call. Return a string to show as the
   * success note; throw to let the user retry. Omit to hide write proposals.
   */
  onApplyProposal?: (
    name: string,
    args: Record<string, unknown>,
    /** The account this proposal is FOR, when the worker said. The host applies
     *  on its own session and would otherwise aim at whatever account its page
     *  is scoped to — which is not always the account the assistant reasoned
     *  about, and on a platform page is not an account at all. */
    opts?: { accountId?: string }
  ) => Promise<string | void | { message?: string; jobId?: string }>;
  /**
   * OBSERVE the human's answer to a `question` frame — analytics, or resolving
   * the same question on another surface (a critical one also pushed to
   * Telegram). NOT the delivery path: the ask_user turn has already ENDED
   * server-side, so the widget itself delivers the answer as the next user
   * message. A host that omits this loses nothing but the notification.
   */
  onAnswer?: (answer: {
    questionId: string;
    optionIds?: string[];
    text?: string;
  }) => void;
  /**
   * Poll one async media render job (video). `generate_video` enqueues a job and
   * returns immediately; the widget polls this so the "Rendering video…" process
   * chip resolves on REAL completion (the clip is actually ready) instead of the
   * chat going silent until it appears in the library. Omit → the chip falls back
   * to a "queued" state right after Apply.
   */
  getMediaJob?: (jobId: string) => Promise<{
    status: "queued" | "processing" | "done" | "error";
    error?: string | null;
  }>;
  /**
   * Read ONE background job, GENERICALLY. Wire it to the type-agnostic job read
   * (`GET /accounts/:id/jobs/:jobId`) — never to a per-type endpoint, because
   * the whole point of the generic row is that a fourth job type must not need a
   * new poller here. Whenever `onApplyProposal` answers with a `jobId`, the
   * widget draws a live card in the conversation and polls this until the job
   * reaches a terminal state.
   *
   * Omit it and nothing changes: an apply that returns a job id is reported
   * exactly as it is today (a one-line "started ✓" and no card).
   */
  getJob?: (jobId: string) => Promise<WidgetJobView | null>;
  /**
   * Jobs still RUNNING for a thread, asked of the server on reopen.
   *
   * The widget also remembers its own jobs in browser storage, which is fast
   * and enough for the device that started them — and wrong everywhere else. A
   * crawl begun on a phone, or before the cache was cleared, left the desktop
   * showing a conversation with nothing happening in it while it ran. This is
   * the authoritative answer; storage is the instant one.
   *
   * Omit it and re-attach stays per-browser, exactly as before.
   */
  listThreadJobs?: (threadId: string) => Promise<WidgetJobView[]>;
  /**
   * Cancel a running/queued job the chat is watching (the card's Cancel
   * button). Cooperative on the server — a crawl stops at the next page
   * boundary — so the card keeps polling and flips to "Cancelled" when the
   * runner actually stops. Omit to hide the button.
   */
  cancelJob?: (jobId: string) => Promise<void>;
  /** This thread's UNSAVED session artifacts (media generated/scraped in the
   *  conversation, hidden from the library until saved) — drives the artifact
   *  strip above the composer. Omit on hosts without asset storage. */
  listSessionArtifacts?: (threadId: string) => Promise<
    {
      id: string;
      filename: string;
      contentType: string;
      label?: string | null;
    }[]
  >;
}

/**
 * SINGLE SOURCE for every user-facing string baked into the vanilla-DOM widget,
 * with its English default. The widget can't call i18next, so the host passes a
 * translated `labels` bag (built by `resolveWidgetLabels`); the widget falls back
 * to these English defaults for any missing key. A `{token}` in a value is filled
 * at runtime by the widget (single-brace so a host's i18next leaves it intact).
 */
export const WIDGET_LABELS = {
  // Question cards — the assistant asking the human to decide.
  questionConfirm: "Send",
  questionPlaceholder: "Type your answer…",
  questionSendFailed:
    "Couldn't send your answer — wait for the current reply to finish, then try again.",
  // Header / bubble
  openBubble: "Open {name}",
  panelAria: "{name} chat",
  newChat: "New chat",
  pastConversations: "Past conversations",
  history: "History",
  moreOptions: "More options",
  more: "More",
  expandChat: "Expand chat",
  expand: "Expand",
  restore: "Restore",
  restoreChat: "Restore chat size",
  closeChat: "Close chat",
  conversation: "Conversation",
  // "More" overflow menu
  on: "On",
  off: "Off",
  downloadChat: "Download chat (.txt)",
  flagConversation: "Flag this conversation",
  flagConversationHint: "Flag this conversation for review",
  flagSendFirst: "Send a message first — then you can flag this chat.",
  flagPrompt: "Flag this conversation — why? (reason is logged for review)",
  flagged: "🚩 Conversation flagged for review ✓",
  flagFailed: "Couldn't flag: {msg}",
  flagFailedGeneric: "please try again",
  notificationSound: "Notification sound",
  soundOnHint: "Chime when a reply arrives — click to mute",
  soundOffHint: "Muted — click to enable the reply chime",
  autoNavigate: "Auto-navigate",
  autoNavOnHint: "Copilot opens pages for you — click to turn off",
  autoNavOffHint: "Copilot asks before opening pages — click to turn on",
  // Status bar (Copilot role + credits)
  roleTalk: "Talk",
  roleAnalytics: "Analytics",
  roleCreation: "Creation",
  creditsSuffix: " credits",
  // Composer
  askAnything: "Ask {name} anything…",
  messageAria: "Message {name}",
  send: "Send",
  removeAttachment: "Remove {file}",
  attachFile: "Attach a file",
  attachFileHint: "Attach images, PDFs or documents",
  // Media-generation activity chips
  renderingVideo: "Rendering video…",
  generatingImage: "Generating image…",
  stillRendering: "Still rendering — it'll appear in your assets shortly",
  videoReady: "Video ready — added to your assets",
  videoFailed: "Video render failed",
  videoQueued: "Video queued — rendering in the background",
  imageAdded: "Image added to your assets",
  generationFailed: "Generation failed",
  // Live background-job card — a job the chat started and now watches. The
  // titles are per known TYPE, with a neutral fallback for a type this build
  // has never heard of (an AI-defined job type must still render).
  jobTitleSiteIngest: "Importing the website",
  jobTitleMedia: "Rendering media",
  jobTitleCoder: "Working on a code task",
  jobTitleFallback: "Background job",
  jobQueued: "Queued",
  jobRunning: "Running",
  jobDone: "Finished",
  jobFailed: "Failed",
  jobCancelled: "Cancelled",
  jobCancel: "Cancel",
  jobCancelling: "Cancelling…",
  jobProgress: "{done} of {total}",
  /** Used while the total is still unknown — a crawl learns it after page one. */
  jobProgressOpen: "{done} so far",
  jobOpenResult: "Open the result",
  /** Toggle under the flow tail that reveals the job's full activity feed. */
  jobFlowAll: "Show all {count} steps",
  jobUnreachable: "Still running in the background — check back shortly",
  // Proposal confirm cards
  proposalUpdateCreation: "Apply this update to the creation?",
  proposalAddCreation: "Add this creation to your studio?",
  proposalAddStock: "Add this stock media to your assets?",
  proposalAddImage: "Add this image to your assets?",
  proposalGenImage: "Generate this image? (uses credits)",
  proposalGenVideo: "Generate this video? (renders in the background)",
  proposalUpscale: "Upscale this image? (uses credits)",
  proposalCutout: "Remove this image's background? (uses credits)",
  proposalOutpaint: "Expand this image beyond its frame? (uses credits)",
  proposalReframe: "Reframe this video to a new shape? (uses credits)",
  proposalEditAsset: "Apply this change to your assets?",
  proposalSaveFile: "Save these changes to the file?",
  proposalCreateFile: "Create this file in your library?",
  proposalShareAsset: "Create a public share link?",
  proposalSaveArtifact: "Save this to your asset library?",
  artifactsTitle: "This chat's files:",
  artifactSave: "Save",
  artifactSaving: "Saving…",
  proposalUpdateBrandProfile: "Update your brand profile?",
  proposalEditBrand: "Update your brand?",
  proposalApiRequest: "Apply this platform action?",
  videoBadge: "▶ video",
  apply: "Apply",
  dismiss: "Dismiss",
  applying: "Applying…",
  applied: "Applied",
  tryAgain: "Try again",
  // History panel
  close: "Close",
  loading: "Loading…",
  noConversations: "No past conversations yet.",
  untitledConversation: "Untitled conversation",
  star: "Star this conversation",
  unstar: "Unstar",
  historyLoadFailed: "Couldn't load history — try again.",
  bucketToday: "Today",
  bucketYesterday: "Yesterday",
  bucketWeek: "Earlier this week",
  bucketMonth: "This month",
  bucketOlder: "Older",
  // Lead form / preview / action chips
  submit: "Submit",
  sending: "Sending…",
  /** Why a form's Send, or a proposal card's Apply, refused to go through. */
  requiredFields: "Please fill in the highlighted fields first.",
  done: "Done ✓",
  preview: "Preview",
  otherOption: "+ Other…",
  confirm: "Confirm",
  cancel: "Cancel",
  // Error state
  errorSnag: "{name} hit a snag and couldn't answer. Please try again.",
  reportIssue: "Report issue",
  reporting: "Reporting…",
  reported: "Reported ✓ — our team will look into it",
  reportFailed: "Couldn't report — try later",
  // Signup CTA (anonymous surfaces)
  signupCta: "Sign up — it's free to start",
} as const;

/** The widget's label bag — same keys as WIDGET_LABELS, all resolved to strings. */
export type WidgetLabels = Record<keyof typeof WIDGET_LABELS, string>;

/**
 * Build the widget's `labels` bag from a host translator (react-i18next's `t`).
 * Each label resolves the `chatWidget.<key>` locale key, defaulting to the
 * English string in WIDGET_LABELS. Call once per (re-)mount so the widget picks
 * up the active language.
 */
export function resolveWidgetLabels(
  t: (key: string, defaultValue: string) => string
): WidgetLabels {
  const out = {} as WidgetLabels;
  for (const k of Object.keys(WIDGET_LABELS) as (keyof WidgetLabels)[]) {
    out[k] = t(`chatWidget.${k}`, WIDGET_LABELS[k]);
  }
  return out;
}

/** A data widget the assistant can render inline via `[[widget:{json}]]`. */
interface WidgetSpec {
  /** "stat" | "kpis" | "list" | "table". Unknown kinds fall back to a list. */
  kind?: string;
  title?: string;
  /** stat: the big value + caption + optional delta. */
  value?: string | number;
  caption?: string;
  delta?: string;
  /** kpis: tiles of {label,value}. */
  items?: Array<{ label?: string; value?: string | number; delta?: string }>;
  /** list: plain bullet lines. */
  lines?: string[];
  /** table: header columns + row cells. */
  columns?: string[];
  rows?: Array<Array<string | number>>;
}

/** A navigation suggestion the assistant emits via `[[navigate:{json}]]`. */
interface NavigateSpec {
  path: string;
  label?: string;
}

/** A dynamic HTML preview the assistant draws via `[[preview:{json}]]` — rendered
 *  in a fully sandboxed iframe (no scripts, no same-origin) so arbitrary HTML+CSS
 *  paints the real look but nothing can execute or reach out. */
interface PreviewSpec {
  html: string;
  title?: string;
}

/** An in-app action the assistant proposes via `[[action:{json}]]`. The host
 *  maps `name` to a real operation; `confirm` (if set) requires user approval. */
interface ActionSpec {
  name: string;
  label?: string;
  /** Confirmation prompt — when set, the user must approve before it runs. */
  confirm?: string;
  /** Opaque data passed to the host's onWidgetAction(name, data). */
  data?: Record<string, string>;
}

/** Quick-reply chips the assistant offers via `[[chips:{json}]]` — tappable
 *  answer options so the user picks instead of typing. Single-select sends on
 *  tap; multi-select toggles + a Send button; `other` adds a "type your own"
 *  chip. The chosen text is sent as a NORMAL message (history stays in order). */
interface ChipsSpec {
  options: string[];
  multi?: boolean;
  other?: boolean;
}

/** Sentinel the assistant emits to ask the widget to render an email form. */
const LEAD_TOKEN = "[[collect-email]]";

/** One field in an AI-rendered form directive. */
interface FormField {
  name: string;
  label?: string;
  /** Kept in step with what `buildField` can actually draw — a spec allowed to
   *  ask for a control the builder cannot render is a promise to the model that
   *  the UI then breaks. */
  type?:
    | "text"
    | "email"
    | "number"
    | "textarea"
    | "select"
    | "checkbox"
    | "radio";
  placeholder?: string;
  required?: boolean;
  options?: string[];
}
interface FormSpec {
  action: string;
  title?: string;
  fields: FormField[];
  submit?: string;
}

/**
 * A field the ASSISTANT asked the user to fill in on a proposal card.
 *
 * Declared by the proposal, never by the widget. A table of "which args are
 * editable for which tool" hardcoded in the UI would mean the chat can only
 * ever ask the questions the frontend was built to ask — a new tool, or a
 * decision the model wants confirmed, would need a UI release. The model knows
 * what it is unsure about; it says so, and the card renders it.
 *
 * Same shape as a `[[form:…]]` field, and built by the same `buildField`, so an
 * input looks identical wherever the chat draws one.
 */
interface ProposalField {
  /** The proposal ARG this field overwrites on apply. */
  arg: string;
  label?: string;
  type?: string;
  placeholder?: string;
  options?: string[];
  required?: boolean;
}

/**
 * A control `buildField` produced, plus how to read its answer.
 *
 * The reader is part of the return value because "what the user chose" is not
 * `.value` for every control type — a checkbox is `.checked`, a radio group is
 * whichever of its inputs is checked — and every caller wants the same thing: a
 * string to put in the payload.
 */
interface BuiltField {
  /** Append THIS — the control, or the wrapper a labelled/grouped one needs. */
  node: HTMLElement;
  read: () => string;
  /** The control draws its own caption; a caller adding one would double it. */
  selfLabelled?: boolean;
}

/** Truthiness for a prefilled checkbox — model output, so accept the obvious
 *  spellings rather than demanding exactly `"true"`. */
function isTruthyValue(v: string | undefined): boolean {
  return ["true", "1", "yes", "on"].includes((v ?? "").trim().toLowerCase());
}

/** A proposal arg a field can be PREFILLED from: anything JSON-primitive, which
 *  is everything with one obvious rendering. Objects/arrays have none, and
 *  null/undefined mean the assistant proposed nothing for that arg. */
function isPrimitiveArg(v: unknown): v is string | number | boolean {
  return (
    typeof v === "string" || typeof v === "number" || typeof v === "boolean"
  );
}

/** Read the fields off a proposal frame, defensively — this is model output. */
function proposalFields(raw: unknown): ProposalField[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (f): f is ProposalField =>
        Boolean(f) &&
        typeof f === "object" &&
        typeof (f as ProposalField).arg === "string" &&
        Boolean((f as ProposalField).arg)
    )
    .slice(0, 6);
}

/** Pull a `[[form:{json}]]` directive out of assistant text, if present. Uses
 *  the shared brace-matching extractor, then validates the form shape. */
function parseFormDirective(
  text: string
): { spec: FormSpec; stripped: string } | null {
  const r = parseJsonDirective<FormSpec>(text, "form");
  if (!r) return null;
  const { spec } = r;
  if (!spec || typeof spec.action !== "string" || !Array.isArray(spec.fields))
    return null;
  return r;
}

/**
 * REPLAY view of a stored message: strip every interactive directive (which the
 * live turn already rendered as buttons/forms) so a reopened conversation shows
 * clean prose instead of raw `[[navigate:…]]` / `[[form:…]]` code, with a short
 * INERT note per directive (no re-execution). Used by the history/thread
 * restore path; live turns still render the real interactive widgets.
 */
function stripDirectivesForReplay(text: string): {
  clean: string;
  notes: string[];
  navs: NavigateSpec[];
} {
  let t = text;
  const notes: string[] = [];
  // Navigation is idempotent and side-effect-free, so on replay we hand it back
  // to be re-rendered as a REAL clickable chip rather than flattened to an inert
  // note — otherwise every "Open <page>" the assistant offered goes dead the
  // moment the thread reloads (which send() does after each turn for canonical
  // ids). This is the true cause of #111: the model DID emit [[navigate]], the
  // restore path is what killed it.
  const navs: NavigateSpec[] = [];
  for (let i = 0; i < 8; i++) {
    const w = parseJsonDirective<NavigateSpec>(t, "navigate");
    if (!w) break;
    t = w.stripped;
    if (w.spec.path) navs.push(w.spec);
    else notes.push(`↗ ${w.spec.label || "Open page"}`);
  }
  for (let i = 0; i < 8; i++) {
    const w = parseJsonDirective<ActionSpec>(t, "action");
    if (!w) break;
    t = w.stripped;
    notes.push(`• ${w.spec.label || w.spec.name}`);
  }
  for (let i = 0; i < 8; i++) {
    const w = parseJsonDirective<WidgetSpec>(t, "widget");
    if (!w) break;
    t = w.stripped;
    notes.push(`▦ ${w.spec.title || "widget"}`);
  }
  for (let i = 0; i < 3; i++) {
    const p = parseJsonDirective<PreviewSpec>(t, "preview");
    if (!p) break;
    t = p.stripped;
    notes.push(`[preview] ${p.spec.title || "Preview"}`);
  }
  for (let i = 0; i < 4; i++) {
    const c = parseJsonDirective<ChipsSpec>(t, "chips");
    if (!c) break;
    t = c.stripped;
    notes.push("💬 options offered");
  }
  const f = parseFormDirective(t);
  if (f) {
    t = f.stripped;
    notes.push(`📝 ${f.spec.title || "Form"} — submitted`);
  }
  if (t.includes(LEAD_TOKEN)) {
    t = t.replace(LEAD_TOKEN, "").trim();
    notes.push("📝 Form — submitted");
  }
  return { clean: t, notes, navs };
}

/**
 * Is this an AI-supplied in-app path we're willing to navigate to? Model output
 * is untrusted (it can carry text scraped from third-party sites), so a path is
 * only ever a SITE-ROOT-RELATIVE route: it must start with a single `/` and
 * must not start with `//` or `/\` (both read as protocol-relative, i.e. another
 * origin) — which also rules out `javascript:`/`data:` payloads.
 */
function isSafeRelPath(path: unknown): path is string {
  return (
    typeof path === "string" &&
    path.startsWith("/") &&
    !path.startsWith("//") &&
    !path.startsWith("/\\")
  );
}

/**
 * Final gate in front of the advanced-view iframe's `src`. That frame is
 * deliberately un-sandboxed (it hosts our own app with the live session), so
 * only a same-origin http(s) URL may ever be loaded into it.
 */
function isSafeFrameUrl(url: string): boolean {
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

/**
 * Generic `[[tag:{json}]]` directive extractor (first occurrence). Robust to the
 * model mis-counting brackets: it brace-matches the JSON object (string-aware,
 * so a `]]` or `}` inside a quoted value doesn't fool it), then consumes 0–2
 * trailing `]`. So `[[navigate:{…}]`, `…}]]` and `…}` all parse — otherwise a
 * single-`]` slip would leave the raw directive showing as text.
 */
function parseJsonDirective<T>(
  text: string,
  tag: string
): { spec: T; stripped: string } | null {
  const open = `[[${tag}:`;
  const start = text.indexOf(open);
  if (start < 0) return null;
  const braceStart = text.indexOf("{", start + open.length);
  if (braceStart < 0) return null;
  // Walk the JSON object, tracking string state, to find its true closing brace.
  let depth = 0;
  let inStr = false;
  let esc = false;
  let end = -1;
  for (let i = braceStart; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end < 0) return null;
  try {
    const spec = JSON.parse(text.slice(braceStart, end + 1)) as T;
    // Consume up to two trailing `]` (tolerate `]]`, `]`, or none).
    let after = end + 1;
    if (text[after] === "]") after++;
    if (text[after] === "]") after++;
    const stripped = (text.slice(0, start) + text.slice(after)).trim();
    return { spec, stripped };
  } catch {
    return null;
  }
}

/**
 * Renders one custom `[[<tag>:{json}]]` directive into `host` (already
 * mounted in the chat log). `spec` is the directive's parsed JSON — validate
 * it yourself, the assistant authored it. Optionally return a disposer; the
 * widget calls it when the surrounding message clears (new chat / history
 * switch / destroy).
 */
export type DirectiveRenderer = (
  host: HTMLElement,
  spec: unknown
) => (() => void) | void;

export interface AiChatWidgetHandle {
  open(): void;
  close(): void;
  toggle(): void;
  destroy(): void;
  /** Register a custom directive renderer at runtime (see `renderers`).
   *  Reserved built-in tags are rejected with an Error. */
  registerRenderer(tag: string, renderer: DirectiveRenderer): void;
}

interface StreamFrame {
  type?: string;
  text?: string;
  d?: string;
  threadId?: string;
  message?: string;
  /** render_chart widget frame (analytics lane): spec = model args, rows = data. */
  spec?: { title?: string; chartType?: string };
  rows?: unknown;
  /** Optional prior-period rows for the same chart (comparison overlay). */
  comparisonRows?: unknown;
  /** question frame — the assistant asking the human to DECIDE (see WsQuestion). */
  questionId?: string;
  prompt?: string;
  context?: string;
  options?: Array<{ id: string; label: string; description?: string }>;
  multi?: boolean;
  critical?: boolean;
  /** activity frame — a live agent process step (running → ok/error). */
  callId?: string;
  name?: string;
  label?: string;
  status?: string;
  /** tool_proposal frame — a confirm-gated write tool's args. */
  args?: unknown;
  /** usage frame — per-turn token counts (drives the session meter). */
  inputTokens?: number;
  outputTokens?: number;
  /** quota frame — the free visitor allowance snapshot. */
  granted?: number;
  used?: number;
  remaining?: number;
  exhausted?: boolean;
  /** meta frame — staff-only "model" chip: which model/agent runs the turn. */
  isStaff?: boolean;
  modelLabel?: string;
}

const PREFIX = "sgiant-aiw";

// Copilot — a tiny living LIQUID blob (not a face): a brand-gradient droplet that
// morphs organically with a wet highlight. Editorial, not cartoon; reads
// cleanly at 24–36px. Morph via SMIL <animate>; float in CSS.
// Shared gradient + goo filter — appended to the root ONCE so the bubble and
// the in-panel avatar (two copies of AVATAR_SVG) reference the same defs.
// Duplicate <defs> ids in the DOM break the second instance's filter (the
// blob disappears), so the defs live here, not inside each avatar svg.
const AVATAR_DEFS = `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
<radialGradient id="${PREFIX}-av-g" cx="38%" cy="30%" r="72%">
<stop offset="0%" stop-color="#FFC98A"/><stop offset="50%" stop-color="#FA712D"/><stop offset="100%" stop-color="#DB3F1B"/>
</radialGradient>
<filter id="${PREFIX}-av-goo" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur in="SourceGraphic" stdDeviation="1.5" result="b"/>
<feColorMatrix in="b" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -8"/></filter></defs></svg>`;

const AVATAR_SVG = `<svg viewBox="6 6 36 36" class="${PREFIX}-ayca" aria-hidden="true">
<g filter="url(#${PREFIX}-av-goo)" fill="url(#${PREFIX}-av-g)">
<path d="M24 8C31 8 40 13 40 24C40 31 31 40 24 40C17 40 8 31 8 24C8 17 17 8 24 8Z">
<animate attributeName="d" dur="4.2s" repeatCount="indefinite"
 values="M24 8C31 8 40 13 40 24C40 31 31 40 24 40C17 40 8 31 8 24C8 17 17 8 24 8Z;M24 9C34 6 42 15 39 25C38 34 29 42 23 39C14 42 6 31 9 23C11 14 17 11 24 9Z;M25 7C33 9 42 16 40 24C42 33 33 42 24 40C15 43 6 32 8 24C6 15 17 7 25 7Z;M23 8C31 7 41 14 40 24C40 32 32 41 24 40C16 42 7 31 8 23C9 16 16 9 23 8Z;M24 8C31 8 40 13 40 24C40 31 31 40 24 40C17 40 8 31 8 24C8 17 17 8 24 8Z"/>
</path>
<circle r="5">
<animate attributeName="cx" dur="3.1s" repeatCount="indefinite" values="36;41;33;38;36"/>
<animate attributeName="cy" dur="3.1s" repeatCount="indefinite" values="15;22;19;13;15"/>
<animate attributeName="r" dur="3.1s" repeatCount="indefinite" values="5;6.2;3.8;5.5;5"/>
</circle>
<circle r="4.4">
<animate attributeName="cx" dur="3.7s" repeatCount="indefinite" values="12;7;15;9;12"/>
<animate attributeName="cy" dur="3.7s" repeatCount="indefinite" values="33;27;34;30;33"/>
<animate attributeName="r" dur="3.7s" repeatCount="indefinite" values="4.4;5.4;3.4;4.8;4.4"/>
</circle>
</g>
<ellipse cx="19" cy="18" rx="5" ry="3.2" fill="#fff" opacity=".42">
<animate attributeName="cx" dur="4.2s" repeatCount="indefinite" values="19;22;17;20;19"/>
<animate attributeName="cy" dur="4.2s" repeatCount="indefinite" values="18;16;20;17;18"/>
</ellipse>
</svg>`;

// Small line icons for the header controls (currentColor, 18px).
const ICON_HISTORY = `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3v5h5"/><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8"/><path d="M12 7v5l3 2"/></svg>`;
const ICON_EXPAND = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/></svg>`;
const ICON_COLLAPSE = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 14h6v6"/><path d="M20 10h-6V4"/><path d="M14 10l7-7"/><path d="M3 21l7-7"/></svg>`;
// Compass — the auto-navigate ("drive me there") toggle.
const ICON_COMPASS = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><polygon points="16.2 7.8 13.4 13.4 7.8 16.2 10.6 10.6 16.2 7.8"/></svg>`;
// Advanced view: a panel split into a sidebar + main area (Copilot ⇆ live app).
const ICON_ADVANCED = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><line x1="10" y1="4" x2="10" y2="20"/></svg>`;
const ICON_CHEVRON_R = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>`;
// Download — export the current conversation as a .txt transcript.
const ICON_DOWNLOAD = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;
// Flag — agent/admin oversight: flag the current conversation with a reason.
const ICON_FLAG = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>`;
// Bell — toggle a soft chime when a reply arrives.
const ICON_BELL = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>`;
const ICON_BELL_OFF = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13.73 21a2 2 0 0 1-3.46 0"/><path d="M18.63 13A17.9 17.9 0 0 1 18 8"/><path d="M6.26 6.26A6 6 0 0 0 6 8c0 7-3 9-3 9h14"/><path d="M18 8a6 6 0 0 0-9.33-5"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;
// Kebab (vertical dots) — the "More" overflow menu that collects the secondary
// header controls so they no longer crowd the title bar side-by-side.
const ICON_MORE = `<svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="12" cy="19" r="1.7"/></svg>`;
// Paperclip — the composer's attach-a-file control. A crisp line icon replaces
// the flat 📎 emoji so the button reads as part of the widget, not an OS glyph.
const ICON_ATTACH = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21.44 11.05l-9.19 9.19a5.5 5.5 0 0 1-7.78-7.78l9.19-9.19a3.5 3.5 0 0 1 4.95 4.95l-9.2 9.19a1.5 1.5 0 0 1-2.12-2.12l8.49-8.49"/></svg>`;
// Branching controls: edit a user turn, regenerate an assistant reply, and the
// ‹n/m› sibling switcher arrows.
const ICON_EDIT = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`;
const ICON_REGEN = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 2v6h6"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L3 8"/></svg>`;
const ICON_CHEV_L = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>`;
const ICON_CHEV_R = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>`;
// Per-message quality vote (thumbs up/down) — mirrors the React panel's VoteButtons.
const ICON_THUMB_UP = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 10v12"/><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z"/></svg>`;
const ICON_THUMB_DOWN = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 14V2"/><path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z"/></svg>`;

export function createAiChatWidget(
  opts: AiChatWidgetOptions
): AiChatWidgetHandle {
  const accent = opts.accent ?? "#6d28d9";
  const gradient =
    opts.gradient ?? `linear-gradient(135deg,${accent},${accent})`;
  const side = opts.position === "bottom-left" ? "left" : "right";
  const root = opts.container ?? document.body;
  const name = opts.title ?? "Copilot";
  // Resolve a widget-chrome label: host-provided translation (opts.labels) →
  // English default (WIDGET_LABELS). `{token}` placeholders are filled from
  // params so runtime values (name, filename, error) interpolate in any language.
  const L = (
    key: keyof WidgetLabels,
    params?: Record<string, string | number>
  ): string => {
    let s: string = opts.labels?.[key] ?? WIDGET_LABELS[key];
    if (params)
      for (const p of Object.keys(params))
        s = s.split(`{${p}}`).join(String(params[p]));
    return s;
  };
  // Avatar markup: the brand logo mark (img) when given, else a crescent glyph.
  const avatarInner = opts.avatarUrl
    ? `<img src="${opts.avatarUrl}" alt="${name}" class="${PREFIX}-av-img"/>`
    : AVATAR_SVG;
  /** Aborted by `destroy()`. Every in-flight turn is tied to it, so a widget
   *  that has been torn down stops writing to its own dead DOM and storage. */
  const alive = new AbortController();
  let threadId: string | undefined;
  let busy = false;
  let lastUserContent = "";
  // The navigable pages from the most recent turn's pageContext, cached so the
  // #111 prose-nav fallback (linkifyProseNav) can match a model's "Open <page>"
  // prose against a real path even after the turn's getContext() has gone.
  let knownNavTargets: Array<{
    path?: string;
    title?: string;
    action?: string;
  }> = [];

  // Conversation memory across page reloads (opt-in via persistKey). Kept in
  // localStorage so a refresh restores the thread + messages.
  type WidgetAtt = {
    mediaId: string;
    kind: string;
    filename: string;
    contentType: string;
  };
  type StoredMsg = {
    role: "user" | "assistant";
    content: string;
    attachments?: WidgetAtt[];
  };
  const storeKey = opts.persistKey ? `ayca:v1:${opts.persistKey}` : null;
  // Remember whether the panel was left open, so a page refresh restores it
  // (in-app surfaces only — external embeds shouldn't auto-pop for visitors).
  // Layout prefs (open state + position) use layoutKey so they follow the user
  // across accounts, not persistKey which re-scopes per account (see layoutKey).
  const layoutScope = opts.layoutKey ?? opts.persistKey;
  const openStateKey = layoutScope ? `ayca:open:${layoutScope}` : null;
  // Keep the UNSENT composer draft across refreshes so typing isn't lost.
  const draftKey = opts.persistKey ? `ayca:draft:${opts.persistKey}` : null;
  function saveDraft(v: string): void {
    if (!draftKey) return;
    try {
      if (v) localStorage.setItem(draftKey, v);
      else localStorage.removeItem(draftKey);
    } catch {
      /* storage blocked */
    }
  }
  function loadDraft(): string {
    if (!draftKey) return "";
    try {
      return localStorage.getItem(draftKey) ?? "";
    } catch {
      return "";
    }
  }
  function rememberOpen(isOpen: boolean): void {
    if (!openStateKey) return;
    try {
      localStorage.setItem(openStateKey, isOpen ? "1" : "0");
    } catch {
      /* storage blocked — non-fatal */
    }
  }
  const history: StoredMsg[] = [];
  /**
   * How long a conversation keeps auto-restoring after its last activity.
   *
   * Restore exists so a refresh or a page change mid-task doesn't lose the
   * chat — a WORKING-SESSION convenience, not an archive. Without a cutoff the
   * widget reopened on whatever was said last, however long ago: days later
   * the first thing on screen was a stale test message instead of the
   * greeting. Older conversations are one click away in History; only a
   * recent one comes back on its own.
   */
  const RESTORE_MAX_AGE_MS = 12 * 60 * 60 * 1000;
  function loadState(): void {
    if (!storeKey) return;
    try {
      const raw = localStorage.getItem(storeKey);
      if (!raw) return;
      const s = JSON.parse(raw) as {
        threadId?: string;
        messages?: StoredMsg[];
        savedAt?: number;
      };
      // No stamp (a pre-cutoff save) counts as stale — the greeting wins.
      if (
        typeof s.savedAt !== "number" ||
        Date.now() - s.savedAt > RESTORE_MAX_AGE_MS
      ) {
        return;
      }
      threadId = s.threadId;
      if (Array.isArray(s.messages)) history.push(...s.messages);
    } catch {
      /* corrupt/unavailable storage — start fresh */
    }
  }
  function saveState(): void {
    if (!storeKey) return;
    try {
      localStorage.setItem(
        storeKey,
        JSON.stringify({
          threadId,
          messages: history.slice(-40),
          savedAt: Date.now(),
        })
      );
    } catch {
      /* storage full/blocked — non-fatal */
    }
  }
  loadState();

  injectStyles(side);

  const bubble = el("button", `${PREFIX}-bubble`);
  bubble.setAttribute("aria-label", L("openBubble", { name }));
  bubble.innerHTML = `<span class="${PREFIX}-bubble-av">${avatarInner}</span>`;
  const panel = el("div", `${PREFIX}-panel`);
  // Theme: the stylesheet is written entirely against --aiw-* custom
  // properties, with light defaults + a prefers-color-scheme:dark token block
  // baked into the sheet. Only what the host EXPLICITLY passed goes inline on
  // the roots — inline wins over both scheme blocks, so a themed host is
  // deterministic while an untouched widget still follows the OS scheme.
  // Form controls additionally borrow the HOST app's control tokens when the
  // page actually has them — see `hostDefinesPlatformTokens`. Resolved once at
  // mount (the answer is a property of which page we're on, not of the moment),
  // and expressed as a class so the CSS keeps reading live `var()`s: the app's
  // own light/dark switch still repaints the chat's inputs with it.
  if (hostDefinesPlatformTokens()) {
    bubble.classList.add(`${PREFIX}-host-tokens`);
    panel.classList.add(`${PREFIX}-host-tokens`);
  }
  const themeTokens: Record<string, string> = { ...(opts.theme ?? {}) };
  if (opts.accent && !themeTokens.accent) themeTokens.accent = opts.accent;
  if ((opts.gradient || opts.accent) && !themeTokens.gradient) {
    themeTokens.gradient = gradient;
  }
  for (const [k, v] of Object.entries(themeTokens)) {
    bubble.style.setProperty(`--aiw-${k}`, v);
    panel.style.setProperty(`--aiw-${k}`, v);
  }
  panel.style.display = "none";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", L("panelAria", { name }));

  // ── Drag-to-reposition (floating mode only) ────────────────────────────
  //
  // The panel is anchored to a fixed corner, where it covers whatever the user
  // is trying to read. Let them drag it by the header, double-click to reset,
  // and remember where they put it.
  //
  // Pointer Events (not mouse events) so it works with touch and pen as well as
  // a mouse; the header sets `touch-action:none` so a drag doesn't scroll the
  // page underneath on a touchscreen.
  const posKey = layoutScope ? `ayca:pos:${layoutScope}` : null;

  /**
   * Keep the panel fully on screen.
   *
   * Runs on drop AND on window resize — without the resize pass, a position
   * saved on a large screen leaves the panel off-canvas when the same user
   * opens a smaller window later, with no way back except clearing storage.
   */
  const clampPos = (x: number, y: number): { x: number; y: number } => {
    const w = panel.offsetWidth || 368;
    const h = panel.offsetHeight || 540;
    const maxX = Math.max(0, window.innerWidth - w);
    const maxY = Math.max(0, window.innerHeight - h);
    return {
      x: Math.min(Math.max(0, x), maxX),
      y: Math.min(Math.max(0, y), maxY),
    };
  };

  const toCorner = (): void => {
    // Back to the CSS-anchored corner: clear the inline overrides rather than
    // hard-coding the default, so the corner stays whatever CSS says.
    panel.style.left = panel.style.top = "";
    panel.style.right = panel.style.bottom = "";
  };

  const applyPos = (p: { x: number; y: number } | null): void => {
    if (!p) return toCorner();
    const { x, y } = clampPos(p.x, p.y);
    // Atomic: a non-finite result (a NaN slipping in from a drag/resize edge
    // case) must NEVER leave the panel half-positioned — `left` set but `top`
    // empty makes `top` resolve to `auto`, which drops the panel to its static
    // flow position off-screen, and a refresh restores it there (stranded). Fall
    // back to the visible corner instead.
    if (!Number.isFinite(x) || !Number.isFinite(y)) return toCorner();
    panel.style.left = `${x}px`;
    panel.style.top = `${y}px`;
    panel.style.right = "auto";
    panel.style.bottom = "auto";
  };

  const readPos = (): { x: number; y: number } | null => {
    if (!posKey) return null;
    try {
      const raw = localStorage.getItem(posKey);
      if (!raw) return null;
      const p = JSON.parse(raw) as { x?: number; y?: number };
      if (typeof p?.x !== "number" || typeof p?.y !== "number") return null;
      return { x: p.x, y: p.y };
    } catch {
      return null;
    }
  };

  const savePos = (p: { x: number; y: number } | null): void => {
    if (!posKey) return;
    try {
      if (p) localStorage.setItem(posKey, JSON.stringify(p));
      else localStorage.removeItem(posKey);
    } catch {
      /* storage full or blocked — position just won't persist */
    }
  };

  const header = el("div", `${PREFIX}-header`);
  header.classList.add(`${PREFIX}-draggable`);

  let panelDrag: { dx: number; dy: number; id: number } | null = null;

  header.addEventListener("pointerdown", (ev) => {
    // Never start a drag from a control in the header (menu, close, model chip)
    // — the buttons must keep working.
    if ((ev.target as HTMLElement)?.closest("button,a,input,select")) return;
    // Advanced/full-screen mode owns its own layout; only the floating panel moves.
    if (panel.classList.contains(`${PREFIX}-advanced`)) return;
    const r = panel.getBoundingClientRect();
    panelDrag = {
      dx: ev.clientX - r.left,
      dy: ev.clientY - r.top,
      id: ev.pointerId,
    };
    header.setPointerCapture(ev.pointerId);
    panel.style.transition = "none"; // no easing while it follows the finger
  });

  header.addEventListener("pointermove", (ev) => {
    if (!panelDrag || ev.pointerId !== panelDrag.id) return;
    ev.preventDefault();
    applyPos({ x: ev.clientX - panelDrag.dx, y: ev.clientY - panelDrag.dy });
  });

  const endPanelDrag = (ev: PointerEvent): void => {
    if (!panelDrag || ev.pointerId !== panelDrag.id) return;
    panelDrag = null;
    panel.style.transition = "";
    const r = panel.getBoundingClientRect();
    const p = clampPos(r.left, r.top);
    applyPos(p);
    savePos(p);
  };
  header.addEventListener("pointerup", endPanelDrag);
  header.addEventListener("pointercancel", endPanelDrag);

  // Double-click the header to snap back to the default corner — the same
  // gesture the advanced view's resize divider already uses, so there is one
  // thing to learn rather than two.
  header.addEventListener("dblclick", (ev) => {
    if ((ev.target as HTMLElement)?.closest("button,a,input,select")) return;
    savePos(null);
    applyPos(null);
  });

  // Re-clamp when the viewport changes so a saved position can never strand the
  // panel off-screen on a smaller window. Named so `destroy()` can remove it —
  // an anonymous listener here leaked the entire widget graph (panel, log,
  // history, disposers) on every mount/unmount cycle, and admin remounts on
  // account and language change.
  const onResize = (): void => {
    const p = readPos();
    if (p) applyPos(p);
  };
  window.addEventListener("resize", onResize);

  applyPos(readPos());

  const avatar = el("div", `${PREFIX}-avatar`);
  avatar.innerHTML = avatarInner;
  const hName = el("div", `${PREFIX}-hname`);
  const titleEl = el("span", `${PREFIX}-title`);
  titleEl.textContent = name;
  const subEl = el("span", `${PREFIX}-sub`);
  subEl.textContent = opts.subtitle ?? "Growth assistant";
  // Staff-only "model" chip — set from the server `meta` frame (which model/agent
  // runs the turn). Hidden until a staff turn reports it, so customers never see
  // a model id (isStaff is server-authoritative).
  const metaChip = el("span", `${PREFIX}-metachip`);
  metaChip.hidden = true;
  hName.append(titleEl, subEl, metaChip);
  const hActions = el("div", `${PREFIX}-hactions`);
  // New chat — start a fresh conversation (keeps the prior one in history).
  const newChatBtn = el("button", `${PREFIX}-icon`);
  newChatBtn.setAttribute("aria-label", L("newChat"));
  newChatBtn.title = L("newChat");
  newChatBtn.innerHTML =
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>';
  hActions.appendChild(newChatBtn);
  // History (past conversations) — only when the host wired a thread lister.
  let historyBtn: HTMLElement | null = null;
  if (opts.listThreads) {
    historyBtn = el("button", `${PREFIX}-icon`);
    historyBtn.setAttribute("aria-label", L("pastConversations"));
    historyBtn.title = L("history");
    historyBtn.innerHTML = ICON_HISTORY;
    hActions.appendChild(historyBtn);
  }
  // ── "More" overflow menu ──────────────────────────────────────────────────
  // The secondary/toggle controls (download, auto-save, flag, sound, auto-nav)
  // used to sit side-by-side in the header. As their number grew the title bar
  // became a cramped, unreadable strip of look-alike icons. They now live in a
  // labeled dropdown behind a single kebab button, so the header keeps only the
  // primary actions (new chat, history, expand, close). Each menu row carries a
  // text label (+ an On/Off pill for toggles) — far clearer than bare icons.
  const moreWrap = el("div", `${PREFIX}-morewrap`);
  const moreBtn = el("button", `${PREFIX}-icon`) as HTMLButtonElement;
  moreBtn.setAttribute("aria-label", L("moreOptions"));
  moreBtn.setAttribute("aria-haspopup", "menu");
  moreBtn.setAttribute("aria-expanded", "false");
  moreBtn.title = L("more");
  moreBtn.innerHTML = ICON_MORE;
  const moreMenu = el("div", `${PREFIX}-menu`);
  moreMenu.setAttribute("role", "menu");
  moreMenu.style.display = "none";
  moreWrap.append(moreBtn, moreMenu);
  let menuOpen = false;
  const setMenu = (open: boolean): void => {
    menuOpen = open;
    moreMenu.style.display = open ? "flex" : "none";
    moreBtn.classList.toggle(`${PREFIX}-icon-on`, open);
    moreBtn.setAttribute("aria-expanded", open ? "true" : "false");
  };
  moreBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    setMenu(!menuOpen);
  });
  // Dismiss on any click outside the menu, and on Escape. Both listeners live on
  // `panel` (removed on destroy) so nothing leaks when the widget is torn down.
  panel.addEventListener("click", (e) => {
    if (menuOpen && !moreWrap.contains(e.target as Node)) setMenu(false);
  });
  panel.addEventListener("keydown", (e) => {
    if (menuOpen && e.key === "Escape") {
      e.stopPropagation();
      setMenu(false);
    }
  });
  // Build one labeled menu row. Returns handles so toggle syncs can update just
  // the icon / state pill without clobbering the label text.
  const menuItem = (
    label: string
  ): {
    btn: HTMLButtonElement;
    ico: HTMLElement;
    setState: (on: boolean) => void;
  } => {
    const btn = el("button", `${PREFIX}-menu-item`) as HTMLButtonElement;
    btn.type = "button";
    btn.setAttribute("role", "menuitem");
    const ico = el("span", `${PREFIX}-menu-ico`);
    const lab = el("span", `${PREFIX}-menu-label`);
    lab.textContent = label;
    const state = el("span", `${PREFIX}-menu-state`);
    btn.append(ico, lab, state);
    return {
      btn,
      ico,
      setState: (on: boolean) => {
        state.textContent = on ? L("on") : L("off");
        btn.classList.toggle(`${PREFIX}-menu-item-on`, on);
      },
    };
  };

  // Download — export the current conversation as a plain-text transcript.
  const downloadItem = menuItem(L("downloadChat"));
  downloadItem.ico.innerHTML = ICON_DOWNLOAD;
  downloadItem.btn.addEventListener("click", () => {
    setMenu(false);
    exportConversation();
  });
  moreMenu.appendChild(downloadItem.btn);
  // Flag — oversight control (agent/admin surfaces). Asks for a reason, then
  // hands it to the host's onFlag with the live thread id. Hidden when unwired.
  if (opts.onFlag) {
    const flagItem = menuItem(L("flagConversation"));
    flagItem.ico.innerHTML = ICON_FLAG;
    flagItem.btn.title = L("flagConversationHint");
    flagItem.btn.addEventListener("click", () => {
      setMenu(false);
      // A flag needs a live conversation (the thread id is created on the first
      // turn). Tell the user plainly instead of silently doing nothing.
      if (!threadId) {
        flagNote(L("flagSendFirst"), false);
        return;
      }
      const reason = window.prompt(L("flagPrompt"));
      if (!reason || !reason.trim()) return;
      flagItem.btn.disabled = true;
      Promise.resolve(opts.onFlag!({ reason: reason.trim(), threadId }))
        .then(() => {
          // Visible confirmation — a tooltip change alone is invisible, so the
          // user couldn't tell the flag worked.
          flagNote(L("flagged"), true);
        })
        .catch((err) => {
          flagNote(
            L("flagFailed", {
              msg: (err as Error)?.message || L("flagFailedGeneric"),
            }),
            false
          );
        })
        .finally(() => {
          flagItem.btn.disabled = false;
        });
    });
    moreMenu.appendChild(flagItem.btn);
  }
  // Notification sound — a soft chime when a reply arrives (browser-local toggle).
  const SOUND_KEY = "sg_ayca_sound";
  let soundOn = false;
  try {
    soundOn = window.localStorage.getItem(SOUND_KEY) === "1";
  } catch {
    /* storage blocked */
  }
  const soundItem = menuItem(L("notificationSound"));
  const syncSound = (): void => {
    soundItem.ico.innerHTML = soundOn ? ICON_BELL : ICON_BELL_OFF;
    soundItem.setState(soundOn);
    soundItem.btn.title = soundOn ? L("soundOnHint") : L("soundOffHint");
  };
  syncSound();
  soundItem.btn.addEventListener("click", () => {
    soundOn = !soundOn;
    try {
      window.localStorage.setItem(SOUND_KEY, soundOn ? "1" : "0");
    } catch {
      /* storage blocked */
    }
    syncSound();
    if (soundOn) maybeDing(true); // preview on enable
  });
  moreMenu.appendChild(soundItem.btn);
  // Soft two-note chime via WebAudio (no asset). Plays only when enabled.
  function maybeDing(force?: boolean): void {
    if (!soundOn && !force) return;
    try {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      const ctx = new AudioCtx();
      const now = ctx.currentTime;
      [
        [880, 0],
        [1175, 0.12],
      ].forEach(([freq, at]) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = "sine";
        o.frequency.value = freq;
        g.gain.setValueAtTime(0.0001, now + at);
        g.gain.exponentialRampToValueAtTime(0.12, now + at + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, now + at + 0.18);
        o.connect(g).connect(ctx.destination);
        o.start(now + at);
        o.stop(now + at + 0.2);
      });
      window.setTimeout(() => void ctx.close().catch(() => {}), 500);
    } catch {
      /* audio blocked — non-fatal */
    }
  }
  // Auto-navigate toggle — a BROWSER-LOCAL setting: when on, Copilot follows its
  // own navigation suggestions automatically (no confirm button). Off by default.
  const AUTONAV_KEY = "sg_ayca_autonav";
  let autoNav = false;
  try {
    autoNav = window.localStorage.getItem(AUTONAV_KEY) === "1";
  } catch {
    /* storage blocked */
  }
  if (opts.autoNavOption) {
    const autoNavItem = menuItem(L("autoNavigate"));
    autoNavItem.ico.innerHTML = ICON_COMPASS;
    const syncAutoNav = (): void => {
      autoNavItem.setState(autoNav);
      autoNavItem.btn.title = autoNav
        ? L("autoNavOnHint")
        : L("autoNavOffHint");
    };
    syncAutoNav();
    autoNavItem.btn.addEventListener("click", () => {
      autoNav = !autoNav;
      try {
        window.localStorage.setItem(AUTONAV_KEY, autoNav ? "1" : "0");
      } catch {
        /* storage blocked */
      }
      syncAutoNav();
    });
    moreMenu.appendChild(autoNavItem.btn);
  }
  // The "More" menu holds the secondary controls; drop it into the header after
  // the primary actions (new chat / history), before expand + close.
  hActions.appendChild(moreWrap);
  // Expand / restore — grows the panel for easier reading (default on).
  let expandBtn: HTMLElement | null = null;
  const expandable = opts.expandable !== false;
  if (expandable) {
    expandBtn = el("button", `${PREFIX}-icon ${PREFIX}-expand`);
    expandBtn.setAttribute("aria-label", L("expandChat"));
    expandBtn.title = L("expand");
    expandBtn.innerHTML = ICON_EXPAND;
    hActions.appendChild(expandBtn);
  }
  // Advanced view — full-screen split with the app in a drivable iframe. Only
  // shown when the host wired `getAdvancedUrl`.
  let advancedBtn: HTMLElement | null = null;
  if (opts.getAdvancedUrl) {
    advancedBtn = el("button", `${PREFIX}-icon ${PREFIX}-advbtn`);
    advancedBtn.setAttribute(
      "aria-label",
      opts.advancedLabel || "Advanced view"
    );
    advancedBtn.title = opts.advancedLabel || "Advanced view";
    advancedBtn.innerHTML = ICON_ADVANCED;
    hActions.appendChild(advancedBtn);
  }
  // Advanced view always opens edge-to-edge — no separate fullscreen toggle
  // button; the exit-advanced control (advancedBtn) is the way back out.
  const closeBtn = el("button", `${PREFIX}-close`);
  closeBtn.innerHTML = "&times;";
  closeBtn.setAttribute("aria-label", L("closeChat"));
  hActions.appendChild(closeBtn);
  header.append(avatar, hName, hActions);

  const log = el("div", `${PREFIX}-log`);
  // Accessible, scrollable conversation region. role=log + aria-live announces
  // streamed replies to screen readers; tabindex makes it keyboard-scrollable.
  log.setAttribute("role", "log");
  log.setAttribute("aria-live", "polite");
  log.setAttribute("aria-label", L("conversation"));
  log.setAttribute("tabindex", "0");
  // Scroll state + scrollDown MUST be defined here, BEFORE the history restore
  // below: restoring a persisted assistant message runs addAssistantMessage →
  // renderNavigate (for a `[[navigate]]` directive), which calls scrollDown.
  // Defining these later put them in the temporal dead zone during restore —
  // "Cannot access 'scrollDown' (minified: 'He') before initialization" — which
  // crashed the widget on load for any thread whose history contained a nav.
  let pinned = true;
  let scrollQueued = false;
  const scrollDown = (force?: boolean): void => {
    if (force) pinned = true;
    if (!pinned || scrollQueued) return;
    scrollQueued = true;
    requestAnimationFrame(() => {
      scrollQueued = false;
      log.scrollTop = log.scrollHeight;
    });
  };
  // Rich-content lifecycle. Host-mounted React roots (markdown / data widgets)
  // hand back a disposer; we keep them so they can be unmounted when the log is
  // cleared (new chat / history switch / destroy), avoiding leaked roots.
  const richDisposers: Array<() => void> = [];
  // Custom directive renderers (the OSS extension point). Seeded from
  // opts.renderers; extendable at runtime via handle.registerRenderer.
  // Built-in tags stay ours so a plugin can't hijack action/form security.
  const RESERVED_TAGS = new Set([
    "widget",
    "preview",
    "navigate",
    "action",
    "chips",
    "form",
  ]);
  const customRenderers: Record<string, DirectiveRenderer> = {};
  const registerRenderer = (tag: string, renderer: DirectiveRenderer): void => {
    if (!/^[a-z][a-z0-9_-]*$/i.test(tag) || RESERVED_TAGS.has(tag)) {
      throw new Error(`invalid or reserved directive tag: ${tag}`);
    }
    customRenderers[tag] = renderer;
  };
  for (const [tag, renderer] of Object.entries(opts.renderers ?? {})) {
    registerRenderer(tag, renderer);
  }
  // Live agent-activity chips, keyed by tool callId so a `running` chip can be
  // updated to `ok`/`error` in place. Cleared whenever the log is replaced.
  const liveActivity = new Map<string, HTMLElement>();
  function clearRich(): void {
    liveActivity.clear();
    for (const dispose of richDisposers.splice(0)) {
      try {
        dispose();
      } catch {
        /* host cleanup best-effort */
      }
    }
  }
  // One process-step chip (spinner while running → check / cross when done).
  // `agent` is the AI role that ran the step (Vega/Nova/…) — shown as a small
  // badge so the user sees WHICH agent did WHAT.
  // A model id → a compact label for the flow chip ("claude-sonnet-4-6" →
  // "sonnet-4-6"; "managed" stays). Keeps the badge short.
  function shortModel(model?: string): string {
    if (!model) return "";
    return model.replace(/^claude-/, "").replace(/-\d{8}$/, "");
  }
  function paintActivity(
    chip: HTMLElement,
    label: string,
    status: string,
    agent?: string,
    model?: string
  ): void {
    const icon =
      status === "running"
        ? `<span class="${PREFIX}-act-spin" aria-hidden="true"></span>`
        : status === "error"
          ? `<span class="${PREFIX}-act-x" aria-hidden="true">✕</span>`
          : `<span class="${PREFIX}-act-ok" aria-hidden="true">✓</span>`;
    const badge = agent
      ? `<span class="${PREFIX}-act-agent">${escapeHtml(agent)}</span>`
      : "";
    // The MODEL acting on this step — shown so the user sees model selection live.
    const m = shortModel(model);
    const modelBadge = m
      ? `<span class="${PREFIX}-act-model">${escapeHtml(m)}</span>`
      : "";
    chip.className =
      `${PREFIX}-activity` +
      (status !== "running" ? ` ${PREFIX}-activity-done` : "");
    chip.innerHTML = `${icon}${badge}${modelBadge}<span class="${PREFIX}-act-label">${escapeHtml(label)}</span>`;
  }
  function addActivityChip(
    label: string,
    status: string,
    agent?: string,
    model?: string
  ): HTMLElement {
    const chip = el("div", `${PREFIX}-activity`);
    paintActivity(chip, label, status, agent, model);
    log.appendChild(chip);
    return chip;
  }
  // Live frame: create the chip on `running`, update the same one on ok/error.
  function liveActivityFrame(
    callId: string,
    label: string,
    status: string,
    agent?: string,
    model?: string
  ): void {
    const existing = liveActivity.get(callId);
    if (existing) {
      paintActivity(existing, label, status, agent, model);
      return;
    }
    const chip = addActivityChip(label, status, agent, model);
    liveActivity.set(callId, chip);
    scrollDown();
  }
  // Media generation (image/video) is applied AFTER the turn, so the server never
  // emits an `activity` frame for it. Drive a live process chip here so the user
  // watches generation as a step (spinner → ✓/✗), the same as a read tool. For
  // video (an async render that takes minutes) poll the job so the chip resolves
  // on REAL completion instead of the chat going silent until the clip appears.
  const MEDIA_GEN_TOOLS = new Set(["generate_image", "generate_video"]);
  /**
   * Sleep, but tied to the widget's lifetime: resolves `true` after `ms`, or
   * `false` the moment `destroy()` aborts. Every polling loop waits through this
   * so a torn-down widget leaves no pending timer behind and no loop that wakes
   * up to paint into DOM that is no longer on the page.
   */
  function waitAlive(ms: number): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      if (alive.signal.aborted) {
        resolve(false);
        return;
      }
      const timer = setTimeout(() => {
        alive.signal.removeEventListener("abort", onAbort);
        resolve(true);
      }, ms);
      const onAbort = (): void => {
        clearTimeout(timer);
        resolve(false);
      };
      alive.signal.addEventListener("abort", onAbort, { once: true });
    });
  }
  async function applyMediaGen(
    name: string,
    args: Record<string, unknown>
  ): Promise<void> {
    const isVideo = name === "generate_video";
    const chip = addActivityChip(
      isVideo ? L("renderingVideo") : L("generatingImage"),
      "running"
    );
    scrollDown(true);
    try {
      // Carry the originating thread so the api can persist this generation onto
      // the conversation (history replay + admin viewer), not just the live chip.
      const genArgs = threadId ? { ...args, threadId } : args;
      const res = await opts.onApplyProposal!(name, genArgs);
      const jobId = res && typeof res === "object" ? res.jobId : undefined;
      const message = typeof res === "string" ? res : res?.message;
      const getJob = opts.getMediaJob;
      if (isVideo && jobId && getJob) {
        const started = Date.now();
        const MAX_MS = 10 * 60 * 1000; // stop babysitting a stuck render after 10m
        for (;;) {
          if (Date.now() - started >= MAX_MS) {
            paintActivity(chip, L("stillRendering"), "ok");
            break;
          }
          if (!(await waitAlive(4000))) return;
          let st;
          try {
            st = await getJob(jobId);
          } catch {
            continue; // transient poll failure — keep the spinner, retry
          }
          if (st.status === "done") {
            paintActivity(chip, L("videoReady"), "ok");
            break;
          }
          if (st.status === "error") {
            paintActivity(chip, st.error || L("videoFailed"), "error");
            break;
          }
        }
      } else {
        paintActivity(
          chip,
          message || (isVideo ? L("videoQueued") : L("imageAdded")),
          "ok"
        );
      }
      scrollDown(true);
    } catch (err) {
      paintActivity(
        chip,
        (err as Error)?.message || L("generationFailed"),
        "error"
      );
      scrollDown(true);
    }
  }
  // ── Live background jobs ────────────────────────────────────────────────────
  //
  // An apply that ENQUEUES (a whole-site import, a render) answers in a second
  // and then works for minutes. The chat used to say "I'll notify you when it's
  // ready ✓" and then show nothing at all until the completion artifact appeared
  // on a reload — the one place the user was watching was the one place the work
  // was invisible. So the apply's job id is kept, a card is drawn in the log, and
  // the GENERIC job read is polled until the job is terminal.
  //
  // Nothing here knows what a site import is. It renders a status, a
  // done-of-total, a label and a terminal outcome — which is all `JobSummary`
  // promises for a job of ANY type, including one this build has never seen.

  /** How often a live job is re-read. Slow enough not to be a poll storm, fast
   *  enough that "3 of 12" visibly moves on a crawl. */
  const JOB_POLL_MS = 3000;
  /** Stop babysitting a job that never lands — the card says so rather than
   *  spinning forever. */
  const JOB_POLL_MAX_MS = 30 * 60 * 1000;

  /** One job this conversation is watching, as remembered across a refresh. */
  interface TrackedJob {
    jobId: string;
    /** The thread the job was started FROM — a job only re-attaches to its own
     *  conversation, never to whichever thread happens to be open. */
    threadId: string;
    /** When we started watching (ms). Old entries are pruned, so a job whose
     *  completion we never saw cannot haunt the chat forever. */
    at: number;
  }
  /** Tracked jobs outlive the page, so they live beside the conversation in
   *  localStorage (same opt-in: no persistKey → in-memory for this session only,
   *  which is exactly today's behaviour minus the refresh). */
  const jobsKey = opts.persistKey ? `ayca:jobs:${opts.persistKey}` : null;
  const TRACKED_JOB_TTL_MS = 24 * 60 * 60 * 1000;
  /** The card currently drawn for a job id. Re-pointed (not re-created) whenever
   *  the transcript is re-rendered, so a poll always paints the LIVE node. */
  const jobCards = new Map<string, HTMLElement>();
  /** Job ids with a poll loop already running — a re-attach must never start a
   *  second one. */
  const jobPolling = new Set<string>();

  function loadTrackedJobs(): TrackedJob[] {
    if (!jobsKey) return [];
    try {
      const raw = localStorage.getItem(jobsKey);
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      const cutoff = Date.now() - TRACKED_JOB_TTL_MS;
      return parsed.filter(
        (j): j is TrackedJob =>
          Boolean(j) &&
          typeof j === "object" &&
          typeof (j as TrackedJob).jobId === "string" &&
          typeof (j as TrackedJob).threadId === "string" &&
          typeof (j as TrackedJob).at === "number" &&
          (j as TrackedJob).at > cutoff
      );
    } catch {
      return []; // corrupt/unavailable storage — nothing to re-attach
    }
  }
  function saveTrackedJobs(jobs: TrackedJob[]): void {
    if (!jobsKey) return;
    try {
      if (jobs.length) localStorage.setItem(jobsKey, JSON.stringify(jobs));
      else localStorage.removeItem(jobsKey);
    } catch {
      /* storage blocked — the card still works for this session */
    }
  }
  function rememberJob(jobId: string, tid: string): void {
    const jobs = loadTrackedJobs().filter((j) => j.jobId !== jobId);
    jobs.push({ jobId, threadId: tid, at: Date.now() });
    saveTrackedJobs(jobs);
  }
  /** A finished job is not a live job: forgetting it here is what stops the card
   *  from being redrawn on the next refresh (the transcript's own completion
   *  artifact is the lasting record). */
  function forgetJob(jobId: string): void {
    saveTrackedJobs(loadTrackedJobs().filter((j) => j.jobId !== jobId));
  }

  /** The card's title: the host's own wording, else the copy for a type we know,
   *  else a neutral one — an unknown type must still read as something. */
  function jobTitle(view: WidgetJobView): string {
    if (view.title) return view.title;
    if (view.type === "site_ingest") return L("jobTitleSiteIngest");
    if (view.type === "media") return L("jobTitleMedia");
    if (view.type === "coder") return L("jobTitleCoder");
    return L("jobTitleFallback");
  }

  /** "3 of 12" / "3 so far" / nothing at all — `total` is null until a crawl has
   *  read its first page, and "3 of 0" would be a lie. */
  function jobCounts(view: WidgetJobView): string {
    const done = view.progress?.done ?? 0;
    const total = view.progress?.total ?? null;
    if (total && total > 0) return L("jobProgress", { done, total });
    return done > 0 ? L("jobProgressOpen", { done }) : "";
  }

  /** (Re)paint a job card from the latest read. Same element throughout the
   *  job's life, so the card the user is looking at is the one that updates. */
  function paintJob(card: HTMLElement, view: WidgetJobView): void {
    const terminal =
      view.status === "done" ||
      view.status === "failed" ||
      view.status === "cancelled";
    const failed = view.status === "failed";
    card.className =
      `${PREFIX}-job` +
      (terminal ? ` ${PREFIX}-job-done` : "") +
      (failed ? ` ${PREFIX}-job-failed` : "");
    const icon = failed
      ? `<span class="${PREFIX}-act-x" aria-hidden="true">✕</span>`
      : view.status === "done"
        ? `<span class="${PREFIX}-act-ok" aria-hidden="true">✓</span>`
        : view.status === "cancelled"
          ? `<span class="${PREFIX}-act-x" aria-hidden="true">–</span>`
          : `<span class="${PREFIX}-act-spin" aria-hidden="true"></span>`;
    const state = failed
      ? L("jobFailed")
      : view.status === "done"
        ? L("jobDone")
        : view.status === "cancelled"
          ? L("jobCancelled")
          : view.status === "queued"
            ? L("jobQueued")
            : L("jobRunning");
    const counts = jobCounts(view);
    // The progress LABEL is server text (for a crawl, a URL off the site being
    // imported) — escaped like every other untrusted string the widget draws.
    const detail = failed ? (view.error ?? "") : (view.progress?.label ?? "");
    const total = view.progress?.total ?? 0;
    const done = view.progress?.done ?? 0;
    // A bar only where there is a real ratio to show; otherwise the counts line
    // carries the progress on its own.
    const pct =
      total > 0
        ? Math.max(0, Math.min(100, Math.round((done / total) * 100)))
        : 0;
    // The FLOW: the last few narration lines while running (the live feel),
    // the whole story behind a toggle once it is long. All server text —
    // escaped per line.
    const events = view.events ?? [];
    const tailStart = terminal
      ? Math.max(0, events.length - 3)
      : Math.max(0, events.length - 5);
    const flowLine = (e: { kind?: string; message: string }) =>
      `<li class="${PREFIX}-job-ev${
        e.kind === "problem"
          ? ` ${PREFIX}-job-ev-problem`
          : e.kind === "decision"
            ? ` ${PREFIX}-job-ev-decision`
            : ""
      }">${escapeHtml(e.message)}</li>`;
    const flow = events.length
      ? `<ul class="${PREFIX}-job-flow">${events
          .slice(tailStart)
          .map(flowLine)
          .join("")}</ul>` +
        (tailStart > 0
          ? `<details class="${PREFIX}-job-flow-all"><summary>${escapeHtml(
              L("jobFlowAll", { count: events.length })
            )}</summary><ul class="${PREFIX}-job-flow">${events
              .map(flowLine)
              .join("")}</ul></details>`
          : "")
      : "";
    card.innerHTML =
      `<div class="${PREFIX}-job-head">${icon}` +
      `<span class="${PREFIX}-job-title">${escapeHtml(jobTitle(view))}</span>` +
      `<span class="${PREFIX}-job-state">${escapeHtml(state)}</span></div>` +
      (counts
        ? `<div class="${PREFIX}-job-counts">${escapeHtml(counts)}</div>`
        : "") +
      (total > 0 && !terminal
        ? `<div class="${PREFIX}-job-bar"><i style="width:${pct}%"></i></div>`
        : "") +
      (detail
        ? `<div class="${PREFIX}-job-detail">${escapeHtml(detail)}</div>`
        : "") +
      flow;
    // Finished WITH something to look at — the notification's "here's the
    // folder" without leaving the conversation.
    if (view.status === "done" && isSafeRelPath(view.resultPath)) {
      const path = view.resultPath;
      const btn = el("button", `${PREFIX}-nav-btn`) as HTMLButtonElement;
      btn.type = "button";
      btn.innerHTML = `<span>${escapeHtml(L("jobOpenResult"))}</span> <span aria-hidden="true">→</span>`;
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        try {
          await dispatchAction("navigate", { path });
        } catch {
          btn.disabled = false;
        }
      });
      card.appendChild(btn);
    }
    // Still in flight and the host can stop it → Cancel. The server cancel is
    // cooperative, so the button just asks: the card keeps polling and flips
    // to "Cancelled" when the runner actually stops at its next boundary.
    if (!terminal && view.id && opts.cancelJob) {
      const jobId = view.id;
      const cancel = opts.cancelJob;
      const btn = el("button", `${PREFIX}-nav-btn`) as HTMLButtonElement;
      btn.type = "button";
      btn.innerHTML = `<span>${escapeHtml(L("jobCancel"))}</span>`;
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        btn.textContent = L("jobCancelling");
        try {
          await cancel(jobId);
        } catch {
          // Couldn't reach the server — the button is usable again.
          btn.disabled = false;
          btn.innerHTML = `<span>${escapeHtml(L("jobCancel"))}</span>`;
        }
      });
      card.appendChild(btn);
    }
  }

  /** A placeholder card for a job we have not read yet (the moment after Apply,
   *  and the moment after a refresh) — the chat is never blank about it. */
  function pendingJobView(): WidgetJobView {
    return { status: "queued" };
  }

  /**
   * Watch one job: draw its card (or re-point an existing one) and, unless a
   * loop is already running for it, poll the generic read until it is terminal.
   *
   * Stops on: a terminal status, the safety ceiling, or `destroy()` (every wait
   * goes through `waitAlive`, so an aborted widget never wakes up again).
   */
  function trackJob(jobId: string, tid: string | undefined): void {
    const getJob = opts.getJob;
    if (!getJob || !jobId) return;
    if (tid) rememberJob(jobId, tid);
    // Idempotent per id, and it has to be: `reattachTrackedJobs` calls this
    // TWICE for the same job (once from browser storage, once when the server
    // listing resolves). The dedupe used to sit below the append, so the second
    // call drew a second card and overwrote the map entry — leaving the first
    // one orphaned in the log, repainted by nobody and frozen on "Queued"
    // forever. Bail before touching the DOM when the card is already on screen;
    // a stale entry left detached by a transcript wipe is rebuilt instead.
    const existing = jobCards.get(jobId);
    if (existing?.isConnected) return;
    const card = el("div", `${PREFIX}-job`);
    paintJob(card, pendingJobView());
    log.appendChild(card);
    jobCards.set(jobId, card);
    scrollDown(true);
    if (jobPolling.has(jobId)) return; // already being polled — the card is enough
    jobPolling.add(jobId);
    void (async () => {
      const started = Date.now();
      try {
        for (;;) {
          if (Date.now() - started >= JOB_POLL_MAX_MS) {
            // Give up WATCHING, not on the job: it is still running server-side,
            // and saying so is more honest than a spinner that never resolves.
            const stalled = jobCards.get(jobId);
            if (stalled) {
              stalled.className = `${PREFIX}-job ${PREFIX}-job-done`;
              stalled.textContent = L("jobUnreachable");
            }
            forgetJob(jobId);
            return;
          }
          let view: WidgetJobView | null;
          try {
            view = await getJob(jobId);
          } catch {
            // A transient read failure is not a failed job — keep the spinner
            // and try again on the next tick.
            if (!(await waitAlive(JOB_POLL_MS))) return;
            continue;
          }
          // A job the account can no longer read (deleted, or never existed) is
          // not something to keep asking about.
          if (!view) {
            jobCards.get(jobId)?.remove();
            jobCards.delete(jobId);
            forgetJob(jobId);
            return;
          }
          const live = jobCards.get(jobId);
          if (live) paintJob(live, view);
          if (
            view.status === "done" ||
            view.status === "failed" ||
            view.status === "cancelled"
          ) {
            forgetJob(jobId);
            scrollDown();
            return;
          }
          if (!(await waitAlive(JOB_POLL_MS))) return;
        }
      } finally {
        jobPolling.delete(jobId);
      }
    })();
  }

  /**
   * Re-attach the live cards for jobs started FROM this thread.
   *
   * This is what makes a running import survive a refresh — and also what
   * restores the card after any transcript re-render (the end-of-turn reload and
   * the completion broadcast both wipe the log). Cards are always rebuilt from
   * the tracked list rather than moved, so there is one path, not two.
   */
  function reattachTrackedJobs(tid: string | undefined): void {
    if (!opts.getJob || !tid) return;
    jobCards.clear();
    // Browser storage FIRST so the card is back on the same tick as the
    // transcript — a job this device started is already known here, and waiting
    // on a round-trip would flash an empty conversation.
    for (const j of loadTrackedJobs()) {
      if (j.threadId === tid) trackJob(j.jobId, undefined);
    }
    // Then ask the SERVER what this thread actually has running. Storage only
    // knows what this browser started, so an import begun on a phone, or before
    // the cache was cleared, was invisible on every other device — the card
    // said nothing was happening while the crawl ran. `trackJob` is idempotent
    // per id, so a job both sources know about is drawn once.
    const listRunning = opts.listThreadJobs;
    if (!listRunning) return;
    void listRunning(tid)
      .then((running) => {
        // The thread may have been switched while the request was in flight.
        if (threadId !== tid) return;
        for (const j of running) if (j.id) trackJob(j.id, tid);
      })
      .catch(() => {
        /* offline or unauthorised — storage already covered this device */
      });
  }

  // Turn a FINAL assistant bubble's text into rich content: the host's real
  // <Markdown> when wired, else the built-in safe markdown→HTML, else plain.
  function applyAssistantRich(
    bubble: HTMLElement,
    text: string,
    animate?: boolean
  ): void {
    // Cool swap: when a streamed reply finishes, the raw markdown text is
    // replaced by the rendered markdown — fade it in so it doesn't pop.
    if (animate) {
      bubble.classList.remove(`${PREFIX}-rich-in`);
      // reflow so re-adding the class restarts the animation
      void bubble.offsetWidth;
      bubble.classList.add(`${PREFIX}-rich-in`);
    }
    if (opts.renderMarkdown) {
      bubble.textContent = "";
      const dispose = opts.renderMarkdown(bubble, text);
      if (dispose) richDisposers.push(dispose);
    } else {
      bubble.innerHTML = renderMarkdown(text);
    }
  }
  // Append a complete assistant message rendered as markdown (history restore,
  // greeting, "no response"). The streaming path stays plain until finalize.
  function addAssistantMessage(text: string): HTMLElement {
    // Replay: render clean prose (directives the live turn already handled are
    // stripped) + an inert note per directive — never raw [[…]] code.
    const { clean, notes, navs } = stripDirectivesForReplay(text);
    const bubble = addMsg(log, "assistant", "");
    applyAssistantRich(bubble, clean);
    for (const n of notes) {
      const note = el("div", `${PREFIX}-replay-note`);
      note.textContent = n;
      log.appendChild(note);
    }
    // Re-render navigation as a REAL chip so "Open <page>" stays clickable after
    // a reload/restore (#111) — in replay mode so it never auto-navigates on open.
    if (opts.onWidgetAction)
      for (const nav of navs)
        if (isSafeRelPath(nav.path)) renderNavigate(nav, true);
    return bubble;
  }
  // Re-render a full thread (messages + inline DATA WIDGETS) into the log,
  // replacing whatever is shown. Shared by history-reopen + refresh-restore.
  // `tid` is the thread being rendered, which is NOT always the active one yet:
  // reopening from history renders first and adopts the thread after. The live
  // job cards belong to a THREAD, so they have to be re-attached for the one on
  // screen, not the one that was open a moment ago.
  function renderThreadItems(
    items: LoadedThreadItem[],
    tid: string | undefined = threadId
  ): void {
    // A `question` card is NOT persisted server-side (unlike a creation or a
    // data widget), and this re-render runs at the END of every turn — which is
    // exactly when `ask_user` has just drawn one. Rebuilding purely from the
    // transcript would erase the decision the assistant is waiting on: the card
    // flashed in and vanished a moment later, so ask_user was dead on the
    // floating widget. Carry the UNANSWERED cards across the wipe (they keep
    // their listeners while detached, so they stay clickable). ANSWERED ones are
    // dropped on purpose — the answer is a real user message in the reloaded
    // transcript by now, and keeping the card would print the same decision
    // twice. Only for the thread already on screen: switching conversations must
    // not drag another one's question along. Same semantics as the React panel.
    const carriedQuestions =
      tid === threadId
        ? Array.from(
            log.querySelectorAll<HTMLElement>(
              `.${PREFIX}-question:not(.${PREFIX}-question-done)`
            )
          )
        : [];
    clearRich();
    log.innerHTML = "";
    history.length = 0;
    for (const it of items) {
      if ("kind" in it && it.kind === "widget") {
        renderServerWidget(
          it.spec as { title?: string; chartType?: string } | undefined,
          it.rows,
          it.comparisonRows
        );
      } else if ("kind" in it && it.kind === "activity") {
        // Replay a persisted process step (static, already finished) + its agent.
        addActivityChip(it.label, it.status, it.agent, it.model);
      } else if ("kind" in it && it.kind === "creation") {
        renderCreationCard(it.name, it.payload);
      } else if ("role" in it) {
        // The message's first DOM node — the anchor an edit/regenerate rewrites
        // the transcript FROM (bubble, or attachment row before it).
        const before = log.lastChild;
        if (it.role === "assistant") addAssistantMessage(it.content);
        else addMsg(log, it.role, it.content);
        history.push({ role: it.role, content: it.content });
        // Branch controls (edit / regenerate / ‹n/m›) on branching hosts, and/or
        // the per-message vote when a vote endpoint is wired.
        if (opts.setActiveLeaf || opts.vote) {
          const anchor = before ? before.nextSibling : log.firstChild;
          addMessageActions(it, anchor);
        }
      }
    }
    // The transcript we just drew is the finished record; anything this thread
    // started that is STILL running goes back underneath it, live — and so does
    // the question the assistant is still blocked on.
    for (const q of carriedQuestions) log.appendChild(q);
    reattachTrackedJobs(tid);
    scrollDown(true);
  }

  /** ‹n/m› sibling-branch switcher (ChatGPT/Claude-style): the arrows jump to the
   *  deepest leaf of the previous/next sibling branch (disabled at the ends). */
  function buildBranchNav(branch: BranchNav): HTMLElement {
    const nav = el("div", `${PREFIX}-branchnav`);
    const prev = el("button", `${PREFIX}-branch-btn`) as HTMLButtonElement;
    prev.type = "button";
    prev.setAttribute("aria-label", "Previous version");
    prev.innerHTML = ICON_CHEV_L;
    prev.disabled = !branch.prevLeaf;
    if (branch.prevLeaf) {
      const leaf = branch.prevLeaf;
      prev.addEventListener("click", () => void switchBranch(leaf));
    }
    const count = el("span", `${PREFIX}-branch-count`);
    count.textContent = `${branch.index}/${branch.count}`;
    const next = el("button", `${PREFIX}-branch-btn`) as HTMLButtonElement;
    next.type = "button";
    next.setAttribute("aria-label", "Next version");
    next.innerHTML = ICON_CHEV_R;
    next.disabled = !branch.nextLeaf;
    if (branch.nextLeaf) {
      const leaf = branch.nextLeaf;
      next.addEventListener("click", () => void switchBranch(leaf));
    }
    nav.appendChild(prev);
    nav.appendChild(count);
    nav.appendChild(next);
    return nav;
  }

  /** Remove `anchor` and every DOM node after it from the log — the "rewrite from
   *  here onward" a fork (edit / regenerate) does before streaming its branch. */
  function removeFrom(anchor: ChildNode | null): void {
    let node: ChildNode | null = anchor;
    while (node) {
      const next = node.nextSibling;
      node.remove();
      node = next;
    }
  }

  // Swap a replayed user bubble for an inline editor (prefilled text + Save /
  // Cancel). Save forks a new branch off this turn's parent and re-runs from
  // there; Cancel restores the original message. `nodes` are the message's DOM
  // rows (hidden while editing), `anchor` its first node (the rewrite point).
  function beginEdit(
    item: ReplayMessageItem,
    anchor: ChildNode | null,
    nodes: HTMLElement[]
  ): void {
    if (busy) return;
    const editor = el("div", `${PREFIX}-edit ${PREFIX}-user`);
    const ta = el("textarea", `${PREFIX}-edit-input`) as HTMLTextAreaElement;
    ta.value = item.content;
    ta.rows = Math.min(8, Math.max(2, item.content.split("\n").length));
    const row = el("div", `${PREFIX}-edit-actions`);
    const cancel = el("button", `${PREFIX}-edit-cancel`) as HTMLButtonElement;
    cancel.type = "button";
    cancel.textContent = opts.cancelLabel ?? "Cancel";
    const save = el("button", `${PREFIX}-edit-save`) as HTMLButtonElement;
    save.type = "button";
    save.textContent = opts.saveLabel ?? "Save & send";
    row.appendChild(cancel);
    row.appendChild(save);
    editor.appendChild(ta);
    editor.appendChild(row);
    log.insertBefore(editor, anchor);
    for (const n of nodes) n.style.display = "none";
    ta.focus();
    const restore = (): void => {
      editor.remove();
      for (const n of nodes) n.style.display = "";
    };
    const submit = (): void => {
      const text = ta.value.trim();
      if (!text || busy) return;
      editor.remove();
      // Drop the old (now off-branch) DOM, then stream the edited turn; the
      // reload in `send` brings back the canonical ids + ‹n/m› switchers.
      removeFrom(anchor);
      void send(text, { parentId: item.parentId ?? null });
    };
    cancel.addEventListener("click", restore);
    save.addEventListener("click", submit);
    ta.addEventListener("keydown", (e) => {
      if (e.key === "Escape") restore();
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        submit();
      }
    });
  }

  /** Thumbs up/down for one assistant message (mirrors the panel's VoteButtons).
   *  Clicking the active vote clears it; the chosen vote stays lit. Optimistic —
   *  reverts on failure. Wrapped so both buttons share the toggle state. */
  function buildVoteButtons(messageId: string): HTMLElement {
    const wrap = el("div", `${PREFIX}-votes`);
    let cur: 1 | -1 | 0 = 0;
    const up = el(
      "button",
      `${PREFIX}-msgact ${PREFIX}-vote`
    ) as HTMLButtonElement;
    const down = el(
      "button",
      `${PREFIX}-msgact ${PREFIX}-vote`
    ) as HTMLButtonElement;
    up.type = "button";
    down.type = "button";
    up.setAttribute("aria-label", opts.voteUpLabel ?? "Helpful");
    down.setAttribute("aria-label", opts.voteDownLabel ?? "Not helpful");
    up.title = opts.voteUpLabel ?? "Helpful";
    down.title = opts.voteDownLabel ?? "Not helpful";
    up.innerHTML = ICON_THUMB_UP;
    down.innerHTML = ICON_THUMB_DOWN;
    const paint = (): void => {
      up.classList.toggle(`${PREFIX}-vote-on`, cur === 1);
      down.classList.toggle(`${PREFIX}-vote-on`, cur === -1);
    };
    const cast = (next: 1 | -1): void => {
      if (!opts.vote) return;
      const value = (cur === next ? 0 : next) as 1 | -1 | 0;
      const prev = cur;
      cur = value;
      paint();
      // messageId is globally unique; the current threadId scopes the vote.
      void opts
        .vote({ threadId: threadId ?? "", messageId, value })
        .catch(() => {
          cur = prev;
          paint();
        });
    };
    up.addEventListener("click", () => cast(1));
    down.addEventListener("click", () => cast(-1));
    wrap.appendChild(up);
    wrap.appendChild(down);
    return wrap;
  }

  // Hover action row under a replayed message: EDIT (user) / REGENERATE + VOTE
  // (assistant) + the ‹n/m› switcher. Rendered on hosts that wired `setActiveLeaf`
  // and/or `vote`; appended right after the message's bubble.
  function addMessageActions(
    item: ReplayMessageItem,
    anchor: ChildNode | null
  ): void {
    if (!opts.setActiveLeaf && !opts.vote) return;
    const isUser = item.role === "user";
    // A regenerate needs the user turn it answered (an assistant's parentId).
    const canRegen =
      !!opts.setActiveLeaf && !isUser && typeof item.parentId === "string";
    // A vote needs a stable message id + a wired endpoint (assistant turns only).
    const canVote = !isUser && !!opts.vote && typeof item.id === "string";
    if (!item.branch && !isUser && !canRegen && !canVote) return;
    const rowEl = el("div", `${PREFIX}-msgactions ${PREFIX}-${item.role}`);
    if (item.branch && opts.setActiveLeaf)
      rowEl.appendChild(buildBranchNav(item.branch));
    if (isUser) {
      // The message's DOM rows (attachment chips + bubble) to hide while editing.
      const btn = el(
        "button",
        `${PREFIX}-msgact ${PREFIX}-msgact-icon`
      ) as HTMLButtonElement;
      btn.type = "button";
      const label = opts.editLabel ?? "Edit";
      btn.setAttribute("aria-label", label);
      btn.title = label;
      btn.innerHTML = ICON_EDIT;
      btn.addEventListener("click", () => {
        const nodes: HTMLElement[] = [];
        for (let n: ChildNode | null = anchor; n; n = n.nextSibling) {
          if (n instanceof HTMLElement) nodes.push(n);
          if (n === rowEl) break;
        }
        beginEdit(item, anchor, nodes);
      });
      rowEl.appendChild(btn);
    } else {
      if (canRegen) {
        const parentId = item.parentId;
        const btn = el("button", `${PREFIX}-msgact`) as HTMLButtonElement;
        btn.type = "button";
        const label = opts.regenerateLabel ?? "Regenerate";
        btn.setAttribute("aria-label", label);
        btn.innerHTML = `${ICON_REGEN}<span>${escapeHtml(label)}</span>`;
        btn.addEventListener("click", () => {
          if (busy || typeof parentId !== "string") return;
          // Drop the current assistant turn's DOM, then stream a fresh sibling
          // answer to the same user turn (empty content + regenerate flag).
          removeFrom(anchor);
          void send("", { regenerate: true, parentId });
        });
        rowEl.appendChild(btn);
      }
      if (canVote) rowEl.appendChild(buildVoteButtons(item.id as string));
    }
    log.appendChild(rowEl);
  }

  // Switch which branch is active (the ‹n/m› arrows): persist the chosen leaf
  // server-side, then reload so the transcript follows that path.
  async function switchBranch(leaf: string): Promise<void> {
    if (busy || !threadId || !opts.setActiveLeaf || !opts.loadThread) return;
    try {
      await opts.setActiveLeaf(threadId, leaf);
      const items = await opts.loadThread(threadId);
      renderThreadItems(items);
      saveState();
    } catch {
      /* leave the current branch visible on failure */
    }
  }

  if (history.length) {
    // Restore a prior conversation (survives refresh) — text only at first.
    for (const m of history)
      if (m.role === "assistant") addAssistantMessage(m.content);
      else addMsg(log, m.role, m.content, m.attachments);
  } else if (opts.greeting) {
    addAssistantMessage(opts.greeting);
  }
  // A background job this thread started may still be running from BEFORE the
  // refresh — put its live card back immediately, off the restored thread id,
  // without waiting for the (optional, async) full thread fetch below.
  reattachTrackedJobs(threadId);
  // Persisted history is TEXT-ONLY (data widgets aren't stored in localStorage),
  // so on refresh the charts/tables were lost. If we have the thread id + a
  // loader, re-fetch the full thread and re-render WITH its widgets — matching
  // reopen-from-history. Async + best-effort; the text restore above is the
  // instant fallback.
  if (threadId && opts.loadThread) {
    const tid = threadId;
    void opts
      .loadThread(tid)
      .then((items) => {
        if (items.length) renderThreadItems(items);
      })
      .catch(() => {
        /* keep the text-only restore */
      });
  }

  // Smooth auto-scroll: stay pinned to the newest message ONLY while the user is
  // already near the bottom — so streaming text doesn't yank the view when they
  // scrolled up to read. rAF-batched to avoid per-token layout thrash (the
  // "glitch"). Pinning resets whenever they scroll back down.
  log.addEventListener("scroll", () => {
    pinned = log.scrollHeight - log.scrollTop - log.clientHeight < 90;
  });
  // Defensive wheel scrolling. The widget lives in the host's light DOM, so a
  // host that installs a global wheel handler — scroll-lock from an open
  // drawer/dialog (react-remove-scroll/Radix), or a smooth-scroll library —
  // can preventDefault our wheel events and a scroll region won't move. We
  // drive the scroll ourselves and only claim the gesture when the region
  // actually moves, so page overscroll still hands off cleanly at the edges.
  // Applied to EVERY internal scroll area (the log AND the history list — the
  // latter previously relied on native scrolling and was dead on such hosts).
  const attachWheelScroll = (elm: HTMLElement): void => {
    elm.addEventListener(
      "wheel",
      (e) => {
        const step =
          e.deltaMode === 1
            ? e.deltaY * 16 // lines → px
            : e.deltaMode === 2
              ? e.deltaY * elm.clientHeight // pages → px
              : e.deltaY;
        const before = elm.scrollTop;
        elm.scrollTop = before + step;
        if (elm.scrollTop !== before) {
          e.preventDefault();
          e.stopPropagation();
        }
      },
      { passive: false }
    );
  };
  attachWheelScroll(log);

  /** Show a brief, VISIBLE system line in the transcript (flag result, guidance)
   *  — a tooltip/title change alone is invisible, so users can't tell it worked. */
  function flagNote(text: string, ok: boolean): void {
    const note = el(
      "div",
      `${PREFIX}-replay-note ${PREFIX}-flag-note${ok ? ` ${PREFIX}-flag-ok` : ""}`
    );
    note.textContent = text;
    log.appendChild(note);
    scrollDown(true);
    // Auto-dismiss the ephemeral notice so it doesn't clutter the transcript.
    setTimeout(() => note.remove(), 6000);
  }

  // Token meter — shown only for the free visitor preview (when signupUrl is
  // set). Surfaces remaining allowance + tokens used this browser session.
  const meterEl = el("div", `${PREFIX}-meter`);
  meterEl.style.display = "none";
  let quotaGranted = 0;
  let quotaRemaining: number | null = null;
  let sessionUsed = 0;
  function renderMeter(): void {
    if (!opts.signupUrl || (quotaRemaining === null && sessionUsed === 0)) {
      meterEl.style.display = "none";
      return;
    }
    meterEl.style.display = "block";
    const pct =
      quotaGranted > 0 && quotaRemaining !== null
        ? Math.max(0, Math.min(100, (quotaRemaining / quotaGranted) * 100))
        : 100;
    const remTxt =
      quotaRemaining !== null
        ? `${quotaRemaining.toLocaleString()} free tokens left`
        : "Free preview";
    meterEl.innerHTML = `<div class="${PREFIX}-meter-bar"><span style="width:${pct}%"></span></div><div class="${PREFIX}-meter-row"><span>${remTxt}</span><span>${sessionUsed.toLocaleString()} used this session</span></div>`;
  }

  // Authed status bar — remaining credits + the active Copilot role. Shown only
  // when a balance provider is wired (org + admin), independent of the visitor
  // token meter above.
  const ROLE_NAMES: Record<string, string> = {
    talk: L("roleTalk"),
    analytics: L("roleAnalytics"),
    creation: L("roleCreation"),
  };
  // Which role an in-app ACTION belongs to, so the badge reflects the live task.
  const ACTION_ROLE: Record<string, string> = {
    "research-brand": "analytics",
    "open-dashboards": "analytics",
    "open-dashboard-builder": "analytics",
    "open-studio": "creation",
  };
  // Which role a live TOOL (activity step) belongs to — flips the badge from
  // Talk to Analytics/Creation as the agent actually queries data / builds.
  const TOOL_ROLE: Record<string, string> = {
    run_stats_query: "analytics",
    render_chart: "analytics",
    list_metrics: "analytics",
    list_dimensions: "analytics",
    list_hotels: "analytics",
    list_connections: "analytics",
    apply_dashboard: "analytics",
    save_template: "analytics",
    platform_ai_stats: "analytics",
  };
  // Persistent status structure so the credits number can ANIMATE (a live
  // count-down after a turn / count-up after a top-up) instead of snapping.
  const statusEl = el("div", `${PREFIX}-status`);
  statusEl.style.display = "none";
  const statusRoleEl = el("span", `${PREFIX}-status-role`);
  const statusCreditsEl = el("span", `${PREFIX}-status-credits`);
  const statusCreditsVal = el("span", `${PREFIX}-status-credits-val`);
  statusCreditsEl.append(
    document.createTextNode("★ "),
    statusCreditsVal,
    document.createTextNode(L("creditsSuffix"))
  );
  statusEl.append(statusRoleEl, statusCreditsEl);
  let activeRole = "talk";
  let creditBalance: number | null = null;
  let displayedCredits = 0; // number currently on screen (drives the tween)
  let creditInit = false; // first value snaps; later changes animate
  let creditRaf = 0;
  function setCreditsText(n: number): void {
    statusCreditsVal.textContent = Math.round(n).toLocaleString();
  }
  function renderStatus(): void {
    if (!opts.getBalance) {
      statusEl.style.display = "none";
      return;
    }
    statusEl.style.display = "flex";
    statusRoleEl.textContent = ROLE_NAMES[activeRole] ?? activeRole;
    if (creditBalance === null) statusCreditsVal.textContent = "—";
    else if (!creditRaf) {
      displayedCredits = creditBalance;
      setCreditsText(displayedCredits);
    }
  }
  // Tween the on-screen credits to `to` (easeOut), honoring reduced motion.
  function animateCredits(to: number): void {
    if (creditRaf) {
      cancelAnimationFrame(creditRaf);
      creditRaf = 0;
    }
    const from = displayedCredits;
    const reduce = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)"
    ).matches;
    if (from === to || reduce) {
      displayedCredits = to;
      setCreditsText(to);
      return;
    }
    const dur = Math.min(900, 250 + Math.abs(to - from) * 1.2);
    statusCreditsVal.classList.add(`${PREFIX}-credits-live`);
    let start = 0;
    const step = (now: number): void => {
      if (!start) start = now;
      const p = Math.min(1, (now - start) / dur);
      const e = 1 - Math.pow(1 - p, 3); // easeOutCubic
      displayedCredits = from + (to - from) * e;
      setCreditsText(displayedCredits);
      if (p < 1) creditRaf = requestAnimationFrame(step);
      else {
        creditRaf = 0;
        displayedCredits = to;
        setCreditsText(to);
        statusCreditsVal.classList.remove(`${PREFIX}-credits-live`);
      }
    };
    creditRaf = requestAnimationFrame(step);
  }
  async function refreshBalance(): Promise<void> {
    if (!opts.getBalance) return;
    try {
      creditBalance = await opts.getBalance();
    } catch {
      return; // keep last
    }
    if (!opts.getBalance) return;
    statusEl.style.display = "flex";
    statusRoleEl.textContent = ROLE_NAMES[activeRole] ?? activeRole;
    if (creditBalance === null) {
      statusCreditsVal.textContent = "—";
    } else if (!creditInit) {
      creditInit = true; // first read snaps (no count-up from zero on open)
      displayedCredits = creditBalance;
      setCreditsText(creditBalance);
    } else {
      animateCredits(creditBalance); // subsequent changes count to the new value
    }
  }
  function setRole(role: string): void {
    activeRole = role;
    renderStatus();
  }

  // Page-aware shortcut chips (filled by renderSuggestions); sits just above the
  // composer and only while the conversation is empty.
  const suggestionsEl = el("div", `${PREFIX}-suggestions`);
  suggestionsEl.style.display = "none";

  const form = el("form", `${PREFIX}-form`) as HTMLFormElement;
  const input = el("input", `${PREFIX}-input`) as HTMLInputElement;
  // "Always ready" cue — an inviting prompt the assistant is waiting for input.
  input.placeholder = L("askAnything", { name });
  input.setAttribute("aria-label", L("messageAria", { name }));
  input.autocomplete = "off";
  // Restore an unsent draft from a prior session; keep it in sync as they type.
  input.value = loadDraft();
  input.addEventListener("input", () => saveDraft(input.value));
  const sendBtn = el("button", `${PREFIX}-send`) as HTMLButtonElement;
  sendBtn.type = "submit";
  sendBtn.textContent = L("send");

  // Session artifacts — media generated/scraped in THIS conversation, hidden
  // from the library until saved. A slim chip strip above the composer with a
  // per-item Save action (promotes via save_artifact_to_assets). Best-effort:
  // hosts without the lister never see it.
  const artifactsEl = el("div", `${PREFIX}-artifacts`);
  artifactsEl.style.display = "none";
  let savingArtifact = false;
  async function refreshArtifacts(): Promise<void> {
    if (!opts.listSessionArtifacts || !threadId) {
      artifactsEl.style.display = "none";
      artifactsEl.innerHTML = "";
      return;
    }
    let items: {
      id: string;
      filename: string;
      contentType: string;
      label?: string | null;
    }[] = [];
    try {
      items = await opts.listSessionArtifacts(threadId);
    } catch {
      return; // strip is best-effort
    }
    artifactsEl.innerHTML = "";
    if (!items.length) {
      artifactsEl.style.display = "none";
      return;
    }
    artifactsEl.style.display = "flex";
    const title = el("span", `${PREFIX}-artifacts-title`);
    title.textContent = L("artifactsTitle");
    artifactsEl.appendChild(title);
    for (const a of items) {
      const chip = el("span", `${PREFIX}-artifact`);
      const label = el("span", `${PREFIX}-artifact-name`);
      label.textContent = a.label || a.filename;
      label.title = a.filename;
      chip.appendChild(label);
      if (opts.onApplyProposal) {
        const save = el(
          "button",
          `${PREFIX}-artifact-save`
        ) as HTMLButtonElement;
        save.type = "button";
        save.textContent = L("artifactSave");
        save.addEventListener("click", async () => {
          if (savingArtifact) return;
          savingArtifact = true;
          save.textContent = L("artifactSaving");
          save.disabled = true;
          try {
            await opts.onApplyProposal!("save_artifact_to_assets", {
              mediaId: a.id,
            });
            chip.remove();
            if (!artifactsEl.querySelector(`.${PREFIX}-artifact`))
              artifactsEl.style.display = "none";
          } catch {
            save.textContent = L("tryAgain");
            save.disabled = false;
          } finally {
            savingArtifact = false;
          }
        });
        chip.appendChild(save);
      }
      artifactsEl.appendChild(chip);
    }
  }

  // Attachments (authed surfaces only): a paperclip that opens a file picker,
  // uploads into the media library, and stages refs for the next turn.
  const stagedAtts: WidgetAtt[] = [];
  const attBar = el("div", `${PREFIX}-attbar`);
  attBar.style.display = "none";
  let attachBtn: HTMLButtonElement | null = null;
  let fileInput: HTMLInputElement | null = null;
  function renderStaged(): void {
    attBar.innerHTML = "";
    attBar.style.display = stagedAtts.length ? "flex" : "none";
    stagedAtts.forEach((a, i) => {
      const chip = el("span", `${PREFIX}-att ${PREFIX}-att-staged`);
      chip.title = `${a.filename} (${a.contentType})`;
      const label = el("span", "");
      label.textContent = `${a.kind === "image" ? "🖼" : "📄"} ${a.filename}`;
      const x = el("button", `${PREFIX}-att-x`) as HTMLButtonElement;
      x.type = "button";
      x.textContent = "×";
      x.setAttribute("aria-label", L("removeAttachment", { file: a.filename }));
      x.addEventListener("click", () => {
        stagedAtts.splice(i, 1);
        renderStaged();
      });
      chip.append(label, x);
      attBar.appendChild(chip);
    });
  }
  // Max size for one attachment (matches the api's multipart cap).
  const MAX_ATT_BYTES = 25 * 1024 * 1024;
  function attError(msg: string): void {
    const chip = el("span", `${PREFIX}-att ${PREFIX}-att-err`);
    chip.textContent = `⚠ ${msg}`;
    attBar.appendChild(chip);
    attBar.style.display = "flex";
    setTimeout(() => {
      chip.remove();
      if (!attBar.children.length) attBar.style.display = "none";
    }, 4000);
  }
  async function uploadFiles(files: FileList | null): Promise<void> {
    const uploadEndpoint = opts.getUploadEndpoint?.() ?? opts.uploadEndpoint;
    if (!files || !uploadEndpoint) return;
    if (attachBtn) attachBtn.disabled = true;
    try {
      const token = opts.getToken ? await opts.getToken() : opts.token;
      for (const file of Array.from(files).slice(0, 6)) {
        if (stagedAtts.length >= 6) break;
        if (file.size > MAX_ATT_BYTES) {
          attError(`"${file.name}" is too large (max 25 MB)`);
          continue;
        }
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch(uploadEndpoint, {
          method: "POST",
          headers: token ? { authorization: `Bearer ${token}` } : {},
          credentials: opts.withCredentials ? "include" : "same-origin",
          body: fd,
        });
        if (!res.ok) continue;
        const j = (await res.json()) as {
          media?: { id: string; filename: string; contentType: string };
        };
        if (!j.media) continue;
        const ct = j.media.contentType || file.type || "";
        stagedAtts.push({
          mediaId: j.media.id,
          kind: ct.startsWith("image/")
            ? "image"
            : ct.includes("pdf")
              ? "pdf"
              : "doc",
          filename: j.media.filename,
          contentType: ct,
        });
        renderStaged();
      }
    } catch {
      /* upload failed — silent; the user can retry */
    } finally {
      if (attachBtn) attachBtn.disabled = false;
      if (fileInput) fileInput.value = "";
    }
  }
  if (opts.uploadEndpoint || opts.getUploadEndpoint) {
    fileInput = el("input", "") as HTMLInputElement;
    fileInput.type = "file";
    fileInput.multiple = true;
    fileInput.accept =
      "image/*,.svg,application/pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.md,.json";
    fileInput.style.display = "none";
    fileInput.addEventListener(
      "change",
      () => void uploadFiles(fileInput!.files)
    );
    attachBtn = el("button", `${PREFIX}-attach`) as HTMLButtonElement;
    attachBtn.type = "button";
    attachBtn.innerHTML = ICON_ATTACH;
    attachBtn.setAttribute("aria-label", L("attachFile"));
    attachBtn.title = L("attachFileHint");
    attachBtn.addEventListener("click", () => fileInput!.click());
    form.append(attachBtn, input, sendBtn, fileInput);
  } else {
    form.append(input, sendBtn);
  }

  // The chat lives in its own column so advanced view can lay a drivable app
  // pane beside it. In normal mode `chatCol` fills the panel; `pane` is hidden.
  const chatCol = el("div", `${PREFIX}-chatcol`);
  chatCol.append(
    header,
    log,
    meterEl,
    statusEl,
    suggestionsEl,
    artifactsEl,
    attBar,
    form
  );
  const pane = el("div", `${PREFIX}-pane`);
  panel.append(chatCol, pane);
  renderStatus();
  // Shared avatar gradient/filter defs (once) — see AVATAR_DEFS.
  if (!document.getElementById(`${PREFIX}-av-g`)) {
    const defs = document.createElement("div");
    defs.style.cssText = "position:absolute;width:0;height:0;overflow:hidden";
    defs.innerHTML = AVATAR_DEFS;
    root.append(defs);
  }
  root.append(bubble, panel);

  // Drop the active thread + transcript (the old one stays in history) and
  // start fresh with the greeting. Shared by the "New chat" button and any
  // caller that opens the widget on a fresh thread (see open's forceNew).
  const startNewChat = (): void => {
    threadId = undefined;
    history.length = 0;
    saveState();
    clearRich();
    log.innerHTML = "";
    if (opts.greeting) addAssistantMessage(opts.greeting);
    void renderSuggestions();
    void refreshArtifacts();
  };

  const open = (prefill?: unknown, forceNew?: boolean): void => {
    panel.style.display = "flex";
    panel.style.transform = ""; // clear any leftover drag offset
    // Re-apply the saved position NOW that the panel is visible and laid out, so
    // clampPos measures its REAL size and can never strand it off-screen. A saved
    // {0,0} / stale position combined with leftover inline anchors used to render
    // the panel below the fold — the "invisible widget" bug. No saved position →
    // applyPos(null) restores the default CSS corner.
    applyPos(readPos());
    // Belt AND braces: whatever happened above, if the panel is not actually
    // on-screen now, discard the saved position and snap to the default corner.
    // A visible assistant on open is non-negotiable — a stranded panel reads as
    // "the assistant is gone", which is exactly the bug this closes.
    const pr = panel.getBoundingClientRect();
    if (
      pr.right < 40 ||
      pr.bottom < 40 ||
      pr.left > window.innerWidth - 40 ||
      pr.top > window.innerHeight - 40
    ) {
      savePos(null);
      applyPos(null);
    }
    bubble.style.display = "none";
    // Show the latest message + focus the composer (always-ready assistant feel).
    pinned = true;
    // A caller (e.g. "Regenerate showcase") can demand a FRESH chat so the
    // starter lands in a clean thread, not tacked onto whatever was open.
    if (forceNew) startNewChat();
    log.scrollTop = log.scrollHeight;
    // A caller (e.g. the "Build with AI" button) can open PREFILLED with a
    // starter via a CustomEvent detail — seed the composer, so the user just
    // hits send. Non-string args (a click MouseEvent) are ignored. Normally we
    // only seed an EMPTY composer, but forceNew (fresh thread) always seeds.
    if (
      typeof prefill === "string" &&
      prefill.trim() &&
      (forceNew || !input.value.trim())
    ) {
      input.value = prefill;
      saveDraft(input.value);
    }
    input.focus();
    bindKeyboard();
    void refreshBalance();
    // Refresh shortcuts for the page the user opened the widget on.
    void renderSuggestions();
    rememberOpen(true);
  };
  const close = (): void => {
    unbindKeyboard();
    panel.style.display = "none";
    panel.style.transform = "";
    panel.style.transition = "";
    panel.style.height = "";
    // Clear ALL position overrides (not just top) so the next open re-applies the
    // saved position from a clean slate. A lone leftover left/right/bottom used to
    // combine with a re-applied axis into an off-screen anchor.
    panel.style.left = panel.style.top = "";
    panel.style.right = panel.style.bottom = "";
    bubble.style.display = "flex";
    rememberOpen(false);
  };
  const toggle = (): void =>
    panel.style.display === "none" ? open() : close();

  bubble.addEventListener("click", open);
  closeBtn.addEventListener("click", close);

  // Swipe-down-to-close (mobile bottom sheet). Dragging the header/grab-handle
  // pulls the panel down with the finger; releasing past a threshold dismisses
  // it, otherwise it springs back. No-op on desktop widths.
  const isSheet = (): boolean => window.matchMedia("(max-width:640px)").matches;

  // iOS keyboard handling. On the mobile full-screen sheet the soft keyboard
  // shrinks the VISUAL viewport but NOT 100dvh, so a focused composer would sit
  // behind the keyboard / off-screen. Size the sheet to window.visualViewport
  // (which DOES shrink for the keyboard) while it's open, and follow its offset.
  let vvCleanup: (() => void) | null = null;
  const bindKeyboard = (): void => {
    const vv = window.visualViewport;
    if (!vv || vvCleanup) return;
    const apply = (): void => {
      if (!isSheet() || panel.style.display === "none") {
        panel.style.height = "";
        // Desktop / non-sheet: the panel's `top` is owned by the drag-to-
        // reposition logic, NOT the keyboard handler. Clearing it here dropped a
        // dragged panel to `top:auto` → off-screen, and a refresh re-stranded it.
        // Restore the saved position (or the CSS corner) instead of clobbering it.
        applyPos(readPos());
        return;
      }
      panel.style.height = `${vv.height}px`;
      panel.style.top = `${vv.offsetTop}px`;
    };
    apply();
    vv.addEventListener("resize", apply);
    vv.addEventListener("scroll", apply);
    vvCleanup = (): void => {
      vv.removeEventListener("resize", apply);
      vv.removeEventListener("scroll", apply);
    };
  };
  const unbindKeyboard = (): void => {
    vvCleanup?.();
    vvCleanup = null;
  };
  let dragStartY = 0;
  let dragging = false;
  header.addEventListener(
    "touchstart",
    (e: TouchEvent) => {
      if (!isSheet() || e.touches.length !== 1) return;
      dragStartY = e.touches[0].clientY;
      dragging = true;
      panel.style.transition = "none";
    },
    { passive: true }
  );
  header.addEventListener(
    "touchmove",
    (e: TouchEvent) => {
      if (!dragging) return;
      const dy = e.touches[0].clientY - dragStartY;
      if (dy > 0) panel.style.transform = `translateY(${dy}px)`;
    },
    { passive: true }
  );
  const endDrag = (e: TouchEvent): void => {
    if (!dragging) return;
    dragging = false;
    const dy = (e.changedTouches[0]?.clientY ?? dragStartY) - dragStartY;
    panel.style.transition = "transform .25s cubic-bezier(.22,1,.36,1)";
    if (dy > 110) {
      panel.style.transform = "translateY(100%)";
      window.setTimeout(close, 230);
    } else {
      panel.style.transform = "";
    }
  };
  header.addEventListener("touchend", endDrag, { passive: true });
  header.addEventListener("touchcancel", endDrag, { passive: true });

  // Expand / restore the panel (bigger reading area). Toggles a class + icon.
  // "Wide view" in the UI: the same button flips between grow (expand) and
  // shrink-back-to-widget (restore). Advanced view reuses `setExpanded(false)`
  // to drop the plain wide size, so the icon/label never drift out of sync.
  let expanded = false;
  const setExpanded = (v: boolean): void => {
    expanded = v;
    panel.classList.toggle(`${PREFIX}-expanded`, expanded);
    if (expandBtn) {
      expandBtn.innerHTML = expanded ? ICON_COLLAPSE : ICON_EXPAND;
      expandBtn.setAttribute(
        "aria-label",
        expanded ? L("restoreChat") : L("expandChat")
      );
      expandBtn.title = expanded ? L("restore") : L("expand");
    }
  };
  if (expandBtn) {
    expandBtn.addEventListener("click", () => {
      setExpanded(!expanded);
      scrollDown(true);
    });
  }

  // --- Advanced view -----------------------------------------------------------
  // A full-screen split: chat on the left, the app in an <iframe> on the right
  // that Copilot drives via the agent bridge. Navigation moves the FRAME; on-page
  // actions (highlight/fill/click) run INSIDE the frame over postMessage, so they
  // hit the app the user is watching — not the parent shell behind the overlay.
  let advanced = false;
  let advancedFull = false;
  let paneCollapsed = false;
  let transport: FrameTransport | null = null;
  let advFrame: HTMLIFrameElement | null = null;
  let frameUrlLabel: HTMLElement | null = null;
  let collapseBtnEl: HTMLButtonElement | null = null;
  const advKey = opts.persistKey ? `ayca:adv:${opts.persistKey}` : "";
  const rememberAdvanced = (): void => {
    if (!advKey) return;
    try {
      localStorage.setItem(advKey, advanced ? "1" : "0");
    } catch {
      /* storage blocked */
    }
  };

  const setFrameUrlLabel = (url: string): void => {
    if (!frameUrlLabel) return;
    let text = url;
    try {
      const u = new URL(url, location.href);
      text = u.pathname + u.search;
    } catch {
      /* keep raw */
    }
    frameUrlLabel.textContent = text;
  };

  /** Point the frame at a full URL (a full document load — the embedded app boots
   *  at that route and re-mounts its agent). */
  const navigateFrame = (url: string): void => {
    if (!advFrame) return;
    // Untrusted target (cross-origin, protocol-relative or a `javascript:`
    // payload smuggled through a model-authored path) — refuse silently.
    if (!isSafeFrameUrl(url)) return;
    advFrame.src = url;
    setFrameUrlLabel(url);
  };

  // Collapse the app pane to a thin strip (not display:none — the strip keeps the
  // toggle visible so it can be re-expanded). Also refreshes the toggle's label.
  const setPaneCollapsed = (v: boolean): void => {
    paneCollapsed = v;
    panel.classList.toggle(`${PREFIX}-pane-collapsed`, v);
    if (collapseBtnEl) {
      const label = v
        ? opts.expandPaneLabel || "Show page"
        : opts.collapsePaneLabel || "Hide page";
      collapseBtnEl.setAttribute("aria-label", label);
      collapseBtnEl.title = label;
    }
  };

  const buildFrame = (): void => {
    pane.innerHTML = "";
    const bar = el("div", `${PREFIX}-pane-bar`);
    const collapseBtn = el(
      "button",
      `${PREFIX}-icon ${PREFIX}-pane-collapse`
    ) as HTMLButtonElement;
    collapseBtn.type = "button";
    collapseBtn.setAttribute(
      "aria-label",
      opts.collapsePaneLabel || "Hide page"
    );
    collapseBtn.title = opts.collapsePaneLabel || "Hide page";
    collapseBtn.innerHTML = ICON_CHEVRON_R;
    collapseBtn.addEventListener("click", () =>
      setPaneCollapsed(!paneCollapsed)
    );
    collapseBtnEl = collapseBtn;
    frameUrlLabel = el("div", `${PREFIX}-pane-url`);
    bar.append(collapseBtn, frameUrlLabel);
    const frame = el("iframe", `${PREFIX}-pane-frame`) as HTMLIFrameElement;
    frame.setAttribute("title", opts.advancedLabel || "App preview");
    // No sandbox: the framed page is our OWN app and needs full capability
    // (same-origin session cookies, storage, popups). For untrusted third-party
    // targets an embedder would add a sandbox with explicit allows.
    // The frame sits in a padded body so the driven app reads as an inset,
    // rounded "screen" with breathing room rather than a flush edge-to-edge slab.
    const body = el("div", `${PREFIX}-pane-body`);
    body.append(frame);
    pane.append(bar, body);
    advFrame = frame;
    transport = createFrameTransport(frame, {
      targetOrigin: opts.advancedOrigin || location.origin,
    });
  };

  const teardownFrame = (): void => {
    transport?.destroy();
    transport = null;
    advFrame = null;
    frameUrlLabel = null;
    collapseBtnEl = null;
    pane.innerHTML = "";
  };

  const updateAdvancedBtn = (): void => {
    if (!advancedBtn) return;
    advancedBtn.classList.toggle(`${PREFIX}-advbtn-on`, advanced);
    const label = advanced
      ? opts.exitAdvancedLabel || "Exit advanced view"
      : opts.advancedLabel || "Advanced view";
    advancedBtn.setAttribute("aria-label", label);
    advancedBtn.title = label;
  };

  // Fullscreen — advanced view is edge-to-edge by default (the `-advanced-full`
  // class drops the max-width + margins + radius). openAdvanced sets it on;
  // closeAdvanced resets it. There is no user-facing toggle button.
  const setAdvancedFull = (v: boolean): void => {
    advancedFull = v;
    panel.classList.toggle(`${PREFIX}-advanced-full`, v);
  };

  // Draggable divider between the chat column and the app pane (advanced view).
  // Drag to resize; the width persists per host so it survives reloads; a
  // double-click resets to the default. Only active in advanced, non-collapsed.
  const advWidthKey = opts.persistKey ? `ayca:advw:${opts.persistKey}` : "";
  const resizer = el("div", `${PREFIX}-resizer`);
  resizer.setAttribute("role", "separator");
  resizer.setAttribute("aria-orientation", "vertical");
  const resizeLabel = opts.resizeLabel || "Resize panels";
  resizer.setAttribute("aria-label", resizeLabel);
  resizer.title = resizeLabel;
  panel.insertBefore(resizer, pane);

  const clampChatWidth = (px: number): number => {
    const total = panel.getBoundingClientRect().width || 900;
    const max = Math.max(360, total - 360); // keep the app pane usable
    return Math.round(Math.min(Math.max(px, 320), max));
  };
  const setChatWidth = (px: number, persist: boolean): void => {
    const w = clampChatWidth(px);
    panel.style.setProperty("--aiw-chatw", `${w}px`);
    if (persist && advWidthKey) {
      try {
        localStorage.setItem(advWidthKey, String(w));
      } catch {
        /* storage blocked */
      }
    }
  };
  const restoreChatWidth = (): void => {
    if (!advWidthKey) return;
    try {
      const raw = localStorage.getItem(advWidthKey);
      if (raw) setChatWidth(parseInt(raw, 10), false);
    } catch {
      /* storage blocked */
    }
  };
  let resizing = false;
  const onResizeMove = (e: PointerEvent): void => {
    if (!resizing) return;
    setChatWidth(e.clientX - panel.getBoundingClientRect().left, true);
  };
  const stopResize = (): void => {
    if (!resizing) return;
    resizing = false;
    panel.classList.remove(`${PREFIX}-resizing`);
    window.removeEventListener("pointermove", onResizeMove);
    window.removeEventListener("pointerup", stopResize);
  };
  resizer.addEventListener("pointerdown", (e) => {
    if (!advanced || paneCollapsed) return;
    e.preventDefault();
    resizing = true;
    panel.classList.add(`${PREFIX}-resizing`);
    window.addEventListener("pointermove", onResizeMove);
    window.addEventListener("pointerup", stopResize);
  });
  // Double-click the divider → reset to the default width.
  resizer.addEventListener("dblclick", () => {
    panel.style.removeProperty("--aiw-chatw");
    if (advWidthKey) {
      try {
        localStorage.removeItem(advWidthKey);
      } catch {
        /* storage blocked */
      }
    }
  });

  const openAdvanced = (): void => {
    if (advanced || !opts.getAdvancedUrl) return;
    advanced = true;
    setPaneCollapsed(false);
    panel.classList.add(`${PREFIX}-advanced`);
    // Advanced view is a CSS-driven layout. A leftover inline drag position
    // (left/top/right:auto) would OVERRIDE that CSS, so drop the floating
    // position here; closeAdvanced restores it. Advanced always opens
    // edge-to-edge (there is no separate fullscreen toggle anymore).
    toCorner();
    setAdvancedFull(true);
    restoreChatWidth();
    // Advanced owns the full screen and IS the wide view, so the "wide" button
    // is redundant here (hidden via CSS). Drop the plain expanded size + reset
    // the button so it shows the right icon/label when advanced is exited.
    if (expanded) setExpanded(false);
    buildFrame();
    navigateFrame(opts.getAdvancedUrl());
    updateAdvancedBtn();
    rememberAdvanced();
    scrollDown(true);
  };

  const closeAdvanced = (): void => {
    if (!advanced) return;
    advanced = false;
    if (advancedFull) setAdvancedFull(false);
    panel.classList.remove(`${PREFIX}-advanced`, `${PREFIX}-pane-collapsed`);
    // Restore the floating drag position cleared on enter.
    applyPos(readPos());
    teardownFrame();
    updateAdvancedBtn();
    rememberAdvanced();
    scrollDown(true);
  };

  if (advancedBtn) {
    advancedBtn.addEventListener("click", () =>
      advanced ? closeAdvanced() : openAdvanced()
    );
  }

  /**
   * The single funnel for every in-app action Copilot requests. In advanced view
   * it retargets: on-page control/operate → the iframe (via the bridge); a
   * navigation-class action → the iframe's URL. Otherwise (and for app-specific
   * handlers like research-brand) it falls back to the host's `onWidgetAction`.
   */
  const dispatchAction = async (
    name: string,
    data: Record<string, string>
  ): Promise<string | void> => {
    // AI-supplied navigation targets are untrusted: only a root-relative in-app
    // route is ever followed — in the advanced-view frame OR by the host router.
    // Refusing is right; refusing SILENTLY was not: an undefined return resolves
    // as success, so the chip ticked green over a path we had just declined.
    if (name === "navigate" && !isSafeRelPath(data.path))
      throw new Error("that navigation target is not an in-app page");
    if (advanced && transport) {
      if (isUiControlAction(name) || isOperateAction(name)) {
        const r = await transport.act(name as BridgeAction, {
          target: data.target ?? "",
          ...(data.value !== undefined ? { value: data.value } : {}),
        });
        return r.ok
          ? "Shown on the page"
          : r.message || "Couldn't do that on the page";
      }
      const candidate =
        name === "navigate"
          ? (data.path ?? null)
          : (opts.resolveActionPath?.(name, data) ?? null);
      // Only root-relative in-app routes may be handed to `getAdvancedUrl`.
      const relPath = isSafeRelPath(candidate) ? candidate : null;
      if (relPath != null && opts.getAdvancedUrl) {
        navigateFrame(opts.getAdvancedUrl(relPath));
        return "Opened";
      }
    }
    return opts.onWidgetAction ? opts.onWidgetAction(name, data) : undefined;
  };

  // History (past conversations) — fetch the thread list, show a picker, and on
  // select replay that thread's messages into the log (sets it as the active
  // thread so the next turn continues it).
  if (historyBtn && opts.listThreads) {
    historyBtn.addEventListener("click", () => void openHistory());
  }

  // New chat — reset to a fresh thread + greeting, then focus the composer.
  newChatBtn.addEventListener("click", () => {
    startNewChat();
    input.focus();
  });

  // Page-aware shortcut chips — rendered only while the conversation is empty
  // (no user turn yet). The host returns suggestions for the current path, so
  // the chips change as the user moves around the app. A click sends the chip.
  let suggestToken = 0;
  async function renderSuggestions(): Promise<void> {
    const empty = !busy && !history.some((m) => m.role === "user");
    if (!opts.getSuggestions || !empty) {
      suggestionsEl.style.display = "none";
      suggestionsEl.innerHTML = "";
      return;
    }
    const my = ++suggestToken;
    let items: string[] = [];
    try {
      items = (await opts.getSuggestions()) ?? [];
    } catch {
      items = [];
    }
    // Superseded by a newer call (navigated again) or conversation started.
    if (my !== suggestToken) return;
    const stillEmpty = !busy && !history.some((m) => m.role === "user");
    items = items.filter((s) => s && s.trim()).slice(0, 4);
    suggestionsEl.innerHTML = "";
    if (!items.length || !stillEmpty) {
      suggestionsEl.style.display = "none";
      return;
    }
    for (const text of items) {
      const chip = el("button", `${PREFIX}-suggestion`) as HTMLButtonElement;
      chip.type = "button";
      chip.textContent = text;
      chip.addEventListener("click", () => {
        suggestionsEl.style.display = "none";
        suggestionsEl.innerHTML = "";
        void send(text);
      });
      suggestionsEl.appendChild(chip);
    }
    suggestionsEl.style.display = "flex";
    scrollDown(true);
  }

  /** Append a "sign up to continue" call-to-action when the free allowance is
   *  spent (only when the host provided a signupUrl). */
  function showSignupCta(): void {
    if (!opts.signupUrl) return;
    const wrap = el("div", `${PREFIX}-cta`);
    const a = document.createElement("a");
    a.className = `${PREFIX}-cta-btn`;
    a.href = opts.signupUrl;
    a.textContent = L("signupCta");
    wrap.appendChild(a);
    log.appendChild(wrap);
    scrollDown(true);
  }
  /** Export the current conversation as a plain-text .txt download (client-side;
   *  reads the in-memory transcript). Data widgets aren't textual, so the
   *  transcript is the messages — same as the full-page assistant's export. */
  function exportConversation(): void {
    const msgs = history.filter((m) => m.content.trim().length > 0);
    if (msgs.length === 0) return;
    const body = msgs.map(
      (m) => `${m.role === "user" ? "You" : name}:\n${m.content}\n`
    );
    // BOM so editors read the UTF-8 (incl. Turkish characters) correctly.
    const text =
      "﻿" + [`${name} — conversation`, "=".repeat(40), "", ...body].join("\n");
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "copilot-conversation.txt";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }
  async function openHistory(): Promise<void> {
    if (!opts.listThreads) return;
    const overlay = el("div", `${PREFIX}-history`);
    const head = el("div", `${PREFIX}-history-head`);
    head.textContent = L("pastConversations");
    const back = el("button", `${PREFIX}-history-back`);
    back.textContent = L("close");
    back.addEventListener("click", () => overlay.remove());
    head.appendChild(back);
    const listEl = el("div", `${PREFIX}-history-list`);
    listEl.textContent = L("loading");
    // Same defensive wheel handling as the log, so the past-conversations list
    // scrolls even on hosts that globally intercept wheel events.
    attachWheelScroll(listEl);
    overlay.append(head, listEl);
    panel.appendChild(overlay);
    try {
      const threads = await opts.listThreads();
      listEl.innerHTML = "";
      if (!threads.length) {
        listEl.textContent = L("noConversations");
        return;
      }
      let lastBucket = "";
      for (const th of threads.slice(0, 50)) {
        // Relative-time group separators (Today / Yesterday / This month / …).
        if (th.updatedAt) {
          const bucket = relBucket(th.updatedAt);
          if (bucket !== lastBucket) {
            lastBucket = bucket;
            const sep = el("div", `${PREFIX}-history-sep`);
            sep.textContent = L(bucket);
            listEl.appendChild(sep);
          }
        }
        const item = el("button", `${PREFIX}-history-item`);
        const ti = el("span", `${PREFIX}-history-title`);
        ti.textContent = th.title || L("untitledConversation");
        item.appendChild(ti);
        if (th.updatedAt) {
          const dt = el("span", `${PREFIX}-history-date`);
          dt.textContent = relTime(th.updatedAt);
          item.appendChild(dt);
        }
        // Shared star toggle — team-visible bookmark on the conversation.
        if (opts.starThread) {
          const star = el("span", `${PREFIX}-history-star`);
          let on = Boolean(th.starred);
          const paint = () => {
            star.textContent = on ? "★" : "☆";
            star.style.color = on ? "#f59e0b" : "";
            star.title = on ? L("unstar") : L("star");
          };
          paint();
          star.addEventListener("click", (e) => {
            e.stopPropagation();
            const prev = on;
            on = !on;
            paint(); // optimistic
            opts.starThread!(th.id).then(
              (r) => {
                on = r.starred;
                paint();
              },
              () => {
                on = prev;
                paint();
              }
            );
          });
          item.appendChild(star);
        }
        item.addEventListener(
          "click",
          () => void loadPastThread(th.id, overlay)
        );
        listEl.appendChild(item);
      }
    } catch {
      listEl.textContent = L("historyLoadFailed");
    }
  }
  async function loadPastThread(
    id: string,
    overlay: HTMLElement
  ): Promise<void> {
    if (!opts.loadThread) return;
    try {
      const items = await opts.loadThread(id);
      // Replace the visible conversation with the chosen thread (messages +
      // inline data widgets). renderThreadItems clears rich roots + the log.
      renderThreadItems(items, id);
      threadId = id;
      saveState();
      void refreshArtifacts();
      overlay.remove();
    } catch {
      overlay.querySelector(`.${PREFIX}-history-list`)!.textContent =
        "Couldn't open that conversation.";
    }
  }

  // Let a nav/sidebar link anywhere in the host app open the panel — optionally
  // PREFILLED via `new CustomEvent(name, { detail: { prompt } })`.
  const onOpenEvent = (e: Event): void => {
    const detail = (
      e as CustomEvent<{
        prompt?: string;
        newChat?: boolean;
        advanced?: boolean;
      }>
    ).detail;
    open(detail?.prompt, detail?.newChat);
    // Let a host entry point (e.g. the AI Hub "Open assistant" button) jump
    // straight into advanced view.
    if (detail?.advanced) openAdvanced();
  };
  if (opts.openEventName) {
    window.addEventListener(opts.openEventName, onOpenEvent);
  }

  // Initial page-aware shortcuts. Done HERE (not at greeting time) so every
  // const it reads — suggestionsEl, busy, send — is already initialized; calling
  // it earlier hits the temporal dead zone (Cannot access before init).
  void renderSuggestions();

  // Restore the open/closed state across reloads — a user who left the assistant
  // open finds it open again (done after open() + bindKeyboard are defined).
  try {
    if (openStateKey && localStorage.getItem(openStateKey) === "1") open();
  } catch {
    /* storage blocked — start closed */
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const content = input.value.trim();
    // A turn needs text OR at least one staged attachment.
    if ((!content && stagedAtts.length === 0) || busy) return;
    input.value = "";
    saveDraft(""); // sent — drop the persisted draft
    void send(content);
  });

  /** Parse + render any inline directives in a finished reply, returning the
   *  text with them stripped. [[widget]]/[[navigate]]/[[action]]/[[form]]/lead. */
  function renderDirectives(text: string): string {
    let t = text;
    // Custom renderers first (the open extension point) — each registered tag
    // gets its own host card in the log; a throwing renderer removes its host
    // instead of wedging the message.
    for (const [tag, renderer] of Object.entries(customRenderers)) {
      for (let i = 0; i < 4; i++) {
        const d = parseJsonDirective<unknown>(t, tag);
        if (!d) break;
        t = d.stripped;
        const host = el("div", `${PREFIX}-widget ${PREFIX}-custom`);
        log.appendChild(host);
        try {
          const dispose = renderer(host, d.spec);
          if (dispose) richDisposers.push(dispose);
        } catch {
          host.remove();
        }
        scrollDown(true);
      }
    }
    for (let i = 0; i < 6; i++) {
      const w = parseJsonDirective<WidgetSpec>(t, "widget");
      if (!w) break;
      t = w.stripped;
      renderWidget(w.spec);
    }
    // Dynamic HTML previews — the AI draws a mockup/preview and we paint it in a
    // FULLY sandboxed iframe (no scripts, no same-origin) right in the chat.
    for (let i = 0; i < 3; i++) {
      const p = parseJsonDirective<PreviewSpec>(t, "preview");
      if (!p || typeof p.spec.html !== "string") break;
      t = p.stripped;
      renderPreview(p.spec);
    }
    const nav = parseJsonDirective<NavigateSpec>(t, "navigate");
    if (nav && opts.onWidgetAction && nav.spec.path) {
      t = nav.stripped;
      // Strip the directive either way, but only offer/auto-follow a target
      // that is a plain root-relative in-app route.
      if (isSafeRelPath(nav.spec.path)) renderNavigate(nav.spec);
    }
    for (let i = 0; i < 4; i++) {
      const act = parseJsonDirective<ActionSpec>(t, "action");
      if (!act || !opts.onWidgetAction || !act.spec.name) break;
      t = act.stripped;
      renderAction(act.spec);
    }
    // Quick-reply chips — tappable answer options for a choice question.
    const chips = parseJsonDirective<ChipsSpec>(t, "chips");
    if (chips && Array.isArray(chips.spec.options)) {
      t = chips.stripped;
      renderChips(chips.spec);
    }
    const form = parseFormDirective(t);
    if (form && (opts.onWidgetAction || opts.onLead)) {
      t = form.stripped;
      renderForm(form.spec);
    } else if ((opts.onLead || opts.onWidgetAction) && t.includes(LEAD_TOKEN)) {
      t = t.replace(LEAD_TOKEN, "").trim();
      renderForm({
        action: "lead",
        fields: [
          {
            name: "email",
            type: "email",
            placeholder: "you@company.com",
            required: true,
          },
        ],
        submit: L("send"),
      });
    }
    t = linkifyProseNav(t);
    return t;
  }

  /**
   * #111 fallback — turn a model's PROSE navigation into a real chip.
   *
   * The prompt tells the model to emit [[navigate:{…}]] for in-app destinations,
   * but some lanes (notably the codebase-agent, whose coding framing deprioritises
   * the directive syntax) still narrate "↗ Open Products & apps" as a plain bullet
   * — which renders as dead text the user can't click. This is the deterministic
   * safety net: after the real directives are parsed, if a SHORT standalone line
   * names a page from THIS turn's "Pages you can open" catalog, drop the prose and
   * render the same nav chip renderNavigate would have. Lane- and model-agnostic:
   * it fixes the symptom no matter which model produced the prose.
   *
   * Deliberately conservative to avoid a wrong chip: only navigable targets (a
   * path, no named action), only lines ≤ 60 chars whose text — after stripping a
   * leading bullet/arrow and an open-verb — EQUALS a known page title, at most 2
   * per reply.
   */
  function linkifyProseNav(text: string): string {
    if (!opts.onWidgetAction || !knownNavTargets.length) return text;
    const targets = knownNavTargets.filter(
      (n): n is { path: string; title: string } =>
        typeof n.path === "string" &&
        !!n.path &&
        typeof n.title === "string" &&
        !!n.title &&
        !n.action
    );
    if (!targets.length) return text;
    // Leading bullet/arrow glyphs + an optional open-verb (en + tr).
    const lead =
      /^[\s>*+\-•·–—↗→▶►]*\s*(?:open|go to|goto|visit|view|see|aç|git|görüntüle)?\s+/i;
    const kept: string[] = [];
    let chips = 0;
    for (const line of text.split("\n")) {
      const raw = line.trim();
      if (chips < 2 && raw && raw.length <= 60) {
        const bare = raw
          .replace(lead, "")
          .replace(/\s+(?:page|sayfası|sayfasına)$/i, "")
          .replace(/[.:；;→↗\s]+$/u, "")
          .trim()
          .toLowerCase();
        const hit = targets.find((n) => {
          const title = n.title.toLowerCase();
          return bare === title || bare === `the ${title}`;
        });
        if (hit) {
          renderNavigate({ path: hit.path, label: hit.title });
          chips += 1;
          continue; // drop the now-redundant prose line
        }
      }
      kept.push(line);
    }
    return kept.join("\n");
  }

  // Confirm cards for write-tool proposals (the AI proposes; the USER applies).
  const PROPOSAL_LABELS: Record<string, string> = {
    update_creation: L("proposalUpdateCreation"),
    render_creation: L("proposalAddCreation"),
    add_stock_to_assets: L("proposalAddStock"),
    add_scraped_media: L("proposalAddImage"),
    generate_image: L("proposalGenImage"),
    generate_video: L("proposalGenVideo"),
    upscale_image: L("proposalUpscale"),
    remove_background: L("proposalCutout"),
    outpaint_image: L("proposalOutpaint"),
    reframe_video: L("proposalReframe"),
    organize_assets: L("proposalEditAsset"),
    edit_asset: L("proposalSaveFile"),
    create_asset: L("proposalCreateFile"),
    share_asset: L("proposalShareAsset"),
    save_artifact_to_assets: L("proposalSaveArtifact"),
    update_brand_profile: L("proposalUpdateBrandProfile"),
    edit_brand: L("proposalEditBrand"),
    mcp__sgiant__api_request: L("proposalApiRequest"),
  };
  function proposalSummary(
    name: string,
    args: Record<string, unknown>
  ): string {
    // Generic staff platform write (#72): show WHAT will be sent WHERE so the
    // admin approves the real action, not a vague "apply". For a write that
    // carries a text body (e.g. an issue comment) surface that text in full —
    // the whole point of the confirm gate is that they see it before it posts.
    if (name === "mcp__sgiant__api_request") {
      const method = String(args.method ?? "").toUpperCase();
      const path = typeof args.path === "string" ? args.path : "";
      const head = [method, path].filter(Boolean).join(" ");
      if (args.body === undefined || args.body === null) return head;
      // Show the WHOLE body, whatever its shape — never just the paths that
      // happen to look like a comment.
      //
      // The host applies this by sending `JSON.stringify(args.body)` verbatim,
      // so anything not rendered here is a write the admin approved WITHOUT
      // SEEING. That is not hypothetical: the issue text feeding this
      // conversation is written by agents and by anyone with board access, so a
      // poisoned comment could steer a proposal toward, say,
      // `POST /admin/accounts/:id/entitlements` with a hostile payload — and a
      // card that printed only the method and path would look unremarkable
      // beside the issue being discussed.
      //
      // A confirm gate that hides what it is confirming is theatre. The
      // plain-text shortcut below stays for the common comment case (raw JSON
      // for a paragraph of prose is worse to read), but it is now the SPECIAL
      // case, not the only case that renders anything.
      const body = args.body as { body?: unknown };
      const onlyText =
        typeof body === "object" &&
        body !== null &&
        typeof body.body === "string" &&
        Object.keys(body).length === 1;
      const rendered = onlyText
        ? String(body.body).trim()
        : JSON.stringify(args.body, null, 2);
      return rendered ? `${head}\n\n${rendered}` : head;
    }
    if (name === "add_stock_to_assets") {
      const parts: string[] = [];
      if (typeof args.type === "string") parts.push(String(args.type));
      if (typeof args.provider === "string") parts.push(String(args.provider));
      if (typeof args.creator === "string") parts.push(`© ${args.creator}`);
      return parts.join(" · ");
    }
    if (name === "add_scraped_media") {
      const parts: string[] = [];
      if (typeof args.filename === "string") parts.push(String(args.filename));
      if (typeof args.sourceUrl === "string") {
        try {
          parts.push(`from ${new URL(String(args.sourceUrl)).hostname}`);
        } catch {
          /* ignore bad url */
        }
      }
      return parts.join(" · ");
    }
    if (name === "generate_image" || name === "generate_video") {
      // No media to preview — it doesn't exist until Apply. Show the prompt +
      // aspect (+ duration for video) so the user knows what they're generating.
      const parts: string[] = [];
      if (typeof args.prompt === "string")
        parts.push(`“${String(args.prompt).slice(0, 140)}”`);
      if (typeof args.aspect === "string") parts.push(String(args.aspect));
      if (name === "generate_video" && typeof args.durationS === "number")
        parts.push(`${args.durationS}s`);
      return parts.join(" · ");
    }
    if (name === "render_creation") {
      const parts: string[] = [];
      if (typeof args.name === "string") parts.push(`“${args.name}”`);
      if (typeof args.format === "string") parts.push(String(args.format));
      const payload = args.payload as { scenes?: unknown[] } | undefined;
      const scenes = Array.isArray(payload?.scenes)
        ? payload!.scenes.length
        : 0;
      if (scenes) parts.push(`${scenes} scene${scenes === 1 ? "" : "s"}`);
      return parts.join(" · ");
    }
    if (name === "update_creation") {
      const parts: string[] = [];
      if (typeof args.title === "string") parts.push(`Title → “${args.title}”`);
      if (typeof args.status === "string")
        parts.push(`Status → ${args.status}`);
      return parts.join("\n");
    }
    if (name === "organize_assets") {
      const ids = Array.isArray(args.mediaIds) ? args.mediaIds.length : 0;
      const items = `${ids} item${ids === 1 ? "" : "s"}`;
      const action = String(args.action ?? "");
      if (action === "move") {
        const dest =
          (typeof args.folderName === "string" && args.folderName) ||
          (typeof args.folderId === "string" && "the selected folder") ||
          "a folder";
        return `Move ${items} → ${dest}`;
      }
      if (action === "tag") {
        const tags = Array.isArray(args.tags) ? args.tags.join(", ") : "";
        return `Tag ${items}${tags ? ` → ${tags}` : ""}`;
      }
      if (action === "trash") return `Move ${items} to Trash`;
      if (action === "restore") return `Restore ${items} from Trash`;
      return `${action} ${items}`;
    }
    if (name === "edit_asset") {
      const content = typeof args.content === "string" ? args.content : "";
      const lines = content ? content.split("\n").length : 0;
      const preview = content.slice(0, 220);
      return `Replace the file contents (${lines} line${
        lines === 1 ? "" : "s"
      }):\n${preview}${content.length > 220 ? "…" : ""}`;
    }
    if (name === "save_artifact_to_assets") {
      const dest =
        (typeof args.folderName === "string" && args.folderName) ||
        (typeof args.folderId === "string" && "the selected folder") ||
        "";
      return dest ? `Save to library → ${dest}` : "Save to library";
    }
    if (name === "share_asset") {
      if (String(args.action ?? "create") === "revoke")
        return "Revoke the share link";
      const what =
        args.targetKind === "folder" ? "the folder" : "the selected file";
      const parts = [`Share ${what} publicly`];
      if (typeof args.password === "string" && args.password)
        parts.push("password-protected");
      if (typeof args.expiresInDays === "number" && args.expiresInDays > 0)
        parts.push(`expires in ${args.expiresInDays}d`);
      return parts.join(" · ");
    }
    if (name === "create_asset") {
      const filename =
        typeof args.filename === "string" ? args.filename : "file";
      const folder =
        typeof args.folderName === "string" && args.folderName
          ? ` → ${args.folderName}`
          : "";
      const content = typeof args.content === "string" ? args.content : "";
      const preview = content.slice(0, 200);
      return `New file: ${filename}${folder}\n${preview}${
        content.length > 200 ? "…" : ""
      }`;
    }
    if (name === "update_brand_profile") {
      const lines: string[] = [];
      const scalar = (k: string, label: string) => {
        if (typeof args[k] === "string" && args[k])
          lines.push(`${label}: ${args[k]}`);
      };
      const list = (k: string, label: string) => {
        if (Array.isArray(args[k]) && args[k].length)
          lines.push(`${label}: ${(args[k] as unknown[]).join(", ")}`);
      };
      scalar("summary", "Brief");
      scalar("audience", "Audience");
      scalar("voice", "Voice");
      scalar("positioning", "Positioning");
      list("facts", "Facts");
      list("dos", "Always");
      list("donts", "Never");
      list("preferredFormats", "Formats");
      list("winningPatterns", "Patterns");
      return lines.join("\n");
    }
    if (name === "edit_brand") {
      const lines: string[] = [];
      const scalar = (k: string, label: string) => {
        if (typeof args[k] === "string" && args[k])
          lines.push(`${label}: ${args[k]}`);
      };
      scalar("name", "Name");
      scalar("tagline", "Tagline");
      scalar("voice", "Voice");
      scalar("audience", "Audience");
      const colours = [
        typeof args.primary === "string" ? `primary ${args.primary}` : "",
        typeof args.accent === "string" ? `accent ${args.accent}` : "",
      ].filter(Boolean);
      if (colours.length) lines.push(`Colours: ${colours.join(", ")}`);
      const fonts = [
        typeof args.fontDisplay === "string" ? String(args.fontDisplay) : "",
        typeof args.fontSans === "string" ? String(args.fontSans) : "",
      ].filter(Boolean);
      if (fonts.length) lines.push(`Fonts: ${fonts.join(" / ")}`);
      if (
        (typeof args.logoMediaId === "string" && args.logoMediaId) ||
        (typeof args.logoSymbolMediaId === "string" && args.logoSymbolMediaId)
      )
        lines.push("+ brand logo");
      if (Array.isArray(args.keyPhrases) && args.keyPhrases.length)
        lines.push(`Phrases: ${(args.keyPhrases as unknown[]).join(", ")}`);
      if (typeof args.showcaseHtml === "string" && args.showcaseHtml.trim())
        lines.push("+ a visual showcase preview");
      return lines.join("\n");
    }
    // A whole-site import is ONE argument with enormous consequences. Dumping
    // "url: example.com" tells the user nothing about what they are approving —
    // how many pages, where it lands, that it runs in the background. Spell it
    // out; this is the card people hesitate on.
    if (name === "ingest_site") {
      const site = String(args.url ?? "").replace(/^https?:\/\//, "");
      const pages = Number(args.maxPages);
      const cap = Number.isFinite(pages) && pages > 0 ? pages : 20;
      return [
        `Import the whole of ${site} into assets.`,
        `Up to ${cap} pages — the server picks the real content pages (rooms,` +
          ` gallery, about) and skips carts and policies.`,
        `Each page gets its own subfolder under "${String(
          args.folderName ?? site
        )}"${args.withReadme === false ? "" : ", with a README per page"}.`,
        "Runs in the background — a notification arrives when it lands.",
      ].join("\n");
    }
    return Object.entries(args)
      .filter(([k]) => k !== "id")
      .map(([k, v]) => `${k}: ${String(v)}`)
      .join("\n");
  }
  /**
   * Render a `question` frame — the assistant asking the human to DECIDE.
   *
   * Distinct from a proposal card: a proposal asks permission for an action the
   * model already chose, a question asks for something the model cannot decide
   * itself. Answering resolves it; the card then collapses to the chosen answer
   * so the transcript reads as a conversation rather than a dead form.
   *
   * Options render as buttons and free-text as an input, because the SAME
   * question may also be answered from Telegram, where buttons work and prose
   * does not. Keeping both shapes here means one question definition serves
   * every surface.
   */
  function renderQuestion(q: {
    questionId: string;
    prompt: string;
    context?: string;
    options?: Array<{ id: string; label: string; description?: string }>;
    multi?: boolean;
    critical?: boolean;
  }): void {
    const wrap = el("div", `${PREFIX}-question`);
    if (q.critical) wrap.classList.add(`${PREFIX}-question-critical`);

    const title = el("div", `${PREFIX}-question-title`);
    title.textContent = q.prompt;
    wrap.appendChild(title);

    if (q.context) {
      const ctx = el("div", `${PREFIX}-question-ctx`);
      ctx.textContent = q.context;
      wrap.appendChild(ctx);
    }

    const answered = (summary: string): void => {
      // Collapse to what was decided. Leaving live controls after an answer
      // invites a second, conflicting reply to a question already resolved.
      wrap.innerHTML = "";
      wrap.classList.add(`${PREFIX}-question-done`);
      const done = el("div", `${PREFIX}-question-answer`);
      done.textContent = summary;
      wrap.appendChild(done);
    };

    // Shown in place of collapsing the card when the answer could NOT leave the
    // browser. Collapsing anyway would tell the user their choice was accepted
    // while the assistant never heard it.
    const undelivered = el("div", `${PREFIX}-question-err`);
    undelivered.textContent = L("questionSendFailed");
    undelivered.style.display = "none";

    /**
     * Deliver the answer as an ordinary user message.
     *
     * The ask_user turn ENDED server-side the moment the question was emitted
     * (see runAgentTurn) — there is no mid-turn channel to reply on, and "the
     * answer arrives as the next message" is the design. `onAnswer` is only an
     * observer hook, so it can never be what makes the answer land.
     */
    const deliver = (optionIds: string[], text?: string): void => {
      const chosen = optionIds
        .map((id) => q.options?.find((o) => o.id === id)?.label ?? id)
        .filter(Boolean);
      const answer = chosen.length ? chosen.join(", ") : (text ?? "").trim();
      if (!answer) return;
      // A turn is already streaming — sending now would be dropped by the
      // composer guard, so say so and leave the controls live to retry.
      if (busy) {
        undelivered.style.display = "";
        return;
      }
      opts.onAnswer?.({ questionId: q.questionId, optionIds, text });
      void send(answer);
      answered(answer);
    };

    if (q.options?.length) {
      const list = el("div", `${PREFIX}-question-opts`);
      const picked = new Set<string>();
      // Built before the options so toggling one can enable it. A multi-select
      // confirm with nothing picked has nothing to send: leaving it enabled made
      // the click a silent no-op (`deliver` bails on an empty answer), which
      // reads as a broken button. The React panel disables it; so does this.
      const confirm = q.multi
        ? (el("button", `${PREFIX}-question-send`) as HTMLButtonElement)
        : null;
      if (confirm) {
        confirm.type = "button";
        confirm.textContent = L("questionConfirm");
        confirm.disabled = true;
        confirm.addEventListener("click", () => deliver([...picked]));
      }
      for (const o of q.options) {
        const b = el("button", `${PREFIX}-question-opt`) as HTMLButtonElement;
        b.type = "button";
        const lab = el("span", `${PREFIX}-question-opt-label`);
        lab.textContent = o.label;
        b.appendChild(lab);
        if (o.description) {
          const d = el("span", `${PREFIX}-question-opt-desc`);
          d.textContent = o.description;
          b.appendChild(d);
        }
        b.addEventListener("click", () => {
          if (!q.multi) {
            deliver([o.id]);
            return;
          }
          // Multi-select: toggle, and confirm explicitly — otherwise the first
          // click would submit and the user could never pick a second option.
          if (picked.has(o.id)) picked.delete(o.id);
          else picked.add(o.id);
          b.classList.toggle(`${PREFIX}-question-opt-on`, picked.has(o.id));
          if (confirm) confirm.disabled = picked.size === 0;
        });
        list.appendChild(b);
      }
      wrap.appendChild(list);
      if (confirm) wrap.appendChild(confirm);
    } else {
      // Free text.
      const row = el("div", `${PREFIX}-question-free`);
      const input = el("input", `${PREFIX}-question-input`) as HTMLInputElement;
      input.type = "text";
      input.placeholder = L("questionPlaceholder");
      const go = el("button", `${PREFIX}-question-send`) as HTMLButtonElement;
      go.type = "button";
      go.textContent = L("questionConfirm");
      const submit = (): void => {
        const v = input.value.trim();
        if (v) deliver([], v);
      };
      go.addEventListener("click", submit);
      input.addEventListener("keydown", (ev) => {
        if ((ev as KeyboardEvent).key === "Enter") submit();
      });
      row.appendChild(input);
      row.appendChild(go);
      wrap.appendChild(row);
    }

    wrap.appendChild(undelivered);
    log.appendChild(wrap);
    scrollDown(true);
  }

  function renderProposal(
    name: string,
    args: Record<string, unknown>,
    agent?: string,
    /** Inputs the ASSISTANT asked for on this card — see ProposalField. */
    fields: ProposalField[] = [],
    /** The account this write targets, per the worker. */
    proposalAccountId?: string
  ): void {
    // `-pending` marks a card that is still AWAITING the user, and it is what
    // the end-of-turn reload checks. The reload used to look for `-proposal`,
    // which also matches a replayed creation card and an already-applied card
    // (the success path empties the node but keeps the class) — so one Apply,
    // or any creation in the thread, disabled the reload for the whole session
    // and with it every edit/regenerate/branch control.
    const wrap = el("div", `${PREFIX}-proposal ${PREFIX}-proposal-pending`);
    const title = el("div", `${PREFIX}-proposal-title`);
    /**
     * Args the user may correct before applying — see EDITABLE_ARGS.
     *
     * Each entry keeps the field's TYPE and its node, not just a reader: the
     * apply path has to post a boolean as a boolean (not the string "false"),
     * and has to be able to point at the control it is refusing to send without.
     */
    const edits: Array<{
      arg: string;
      type: string;
      required: boolean;
      read: () => string;
      node: HTMLElement;
    }> = [];
    // Show the acting agent (e.g. Nova) so the user sees WHO proposed this.
    if (agent) {
      const badge = el("span", `${PREFIX}-act-agent`);
      badge.textContent = agent;
      badge.style.marginRight = "6px";
      title.appendChild(badge);
    }
    title.appendChild(
      document.createTextNode(PROPOSAL_LABELS[name] ?? "Apply this change?")
    );
    wrap.appendChild(title);
    // Live `.sgiant` preview — for render_creation, show the actual design (the
    // host mounts CreationPreview) so the user sees what they're about to add.
    let disposePreview: (() => void) | undefined;
    if (
      name === "render_creation" &&
      opts.renderCreation &&
      args.payload &&
      typeof args.payload === "object"
    ) {
      const previewHost = el("div", `${PREFIX}-creation-preview`);
      wrap.appendChild(previewHost);
      const d = opts.renderCreation(previewHost, args.payload);
      if (d) disposePreview = d;
    }
    // Stock import — PREVIEW the media (loaded from the provider, NOT saved) so
    // the user sees exactly what they're about to add before clicking Apply.
    if (name === "add_stock_to_assets") {
      const thumb =
        typeof args.thumbUrl === "string" && args.thumbUrl ? args.thumbUrl : "";
      const full =
        typeof args.url === "string" && args.url && args.type !== "video"
          ? args.url
          : "";
      const src = thumb || full;
      if (src) {
        const img = el("img", `${PREFIX}-proposal-media`) as HTMLImageElement;
        img.src = src;
        img.loading = "lazy";
        img.alt =
          typeof args.creator === "string" && args.creator
            ? `Stock preview — ${args.creator}`
            : "Stock preview";
        if (args.type === "video") {
          const badge = el("span", `${PREFIX}-proposal-media-badge`);
          badge.textContent = L("videoBadge");
          const holder = el("div", `${PREFIX}-proposal-media-holder`);
          holder.append(img, badge);
          wrap.appendChild(holder);
        } else {
          wrap.appendChild(img);
        }
      }
    }
    // Scraped-media import — PREVIEW the actual image/video (loaded from its
    // source URL, NOT saved) before the user clicks Apply.
    if (name === "add_scraped_media") {
      const src = typeof args.url === "string" ? args.url : "";
      if (src && args.type === "video") {
        const video = el(
          "video",
          `${PREFIX}-proposal-media`
        ) as HTMLVideoElement;
        video.src = src;
        video.controls = true;
        video.preload = "metadata";
        video.playsInline = true;
        if (typeof args.poster === "string" && args.poster)
          video.poster = String(args.poster);
        wrap.appendChild(video);
      } else if (src) {
        const img = el("img", `${PREFIX}-proposal-media`) as HTMLImageElement;
        img.src = src;
        img.loading = "lazy";
        img.alt =
          typeof args.alt === "string" && args.alt
            ? String(args.alt)
            : "Web image preview";
        wrap.appendChild(img);
      }
    }
    // Editable args: the assistant's suggestion is a STARTING POINT, not a
    // decision the user has to accept whole. Importing a site into a folder
    // called "Website" and then renaming it afterwards is a worse experience
    // than being handed the name with a cursor in it.
    for (const field of fields) {
      const row = el("label", `${PREFIX}-proposal-edit`);
      const built = buildField({
        name: field.arg,
        ...(field.type ? { type: field.type } : {}),
        ...(field.label ? { label: field.label } : {}),
        ...(field.options ? { options: field.options } : {}),
        ...(field.required ? { required: field.required } : {}),
        // Prefilled with what the assistant proposed: the user confirms or
        // corrects, rather than typing from nothing. Any PRIMITIVE counts —
        // reading only strings meant `withReadme: true` drew an UNTICKED box and
        // `maxPages: 20` drew an empty number field, so the card contradicted
        // the very proposal it was there to confirm.
        value: isPrimitiveArg(args[field.arg]) ? String(args[field.arg]) : "",
        ...(field.placeholder ? { placeholder: field.placeholder } : {}),
      });
      // Caption first — unless the control already draws one (a checkbox), in
      // which case the card adding its own would say the same thing twice.
      if (field.label && !built.selfLabelled) {
        const cap = el("span", `${PREFIX}-proposal-edit-label`);
        cap.textContent = field.label;
        row.appendChild(cap);
      }
      row.appendChild(built.node);
      wrap.appendChild(row);
      edits.push({
        arg: field.arg,
        type: field.type ?? "text",
        required: Boolean(field.required),
        read: built.read,
        node: built.node,
      });
    }
    const summary = proposalSummary(name, args);
    if (summary) {
      const s = el("div", `${PREFIX}-proposal-summary`);
      s.textContent = summary;
      wrap.appendChild(s);
    }
    // Shown when Apply is REFUSED because a field the assistant marked required
    // was left blank. Applying anyway (which is what dropping the empty value
    // did) sent an incomplete write; doing nothing at all reads as a dead
    // button. Say which way it went.
    const editErr = el("div", `${PREFIX}-proposal-err`);
    editErr.textContent = L("requiredFields");
    editErr.style.display = "none";
    if (edits.length) wrap.appendChild(editErr);
    const row = el("div", `${PREFIX}-confirm-row`);
    const apply = el("button", `${PREFIX}-nav-btn`) as HTMLButtonElement;
    apply.type = "button";
    apply.textContent = L("apply");
    const cancel = el("button", `${PREFIX}-confirm-no`) as HTMLButtonElement;
    cancel.type = "button";
    cancel.textContent = L("dismiss");
    cancel.addEventListener("click", () => {
      disposePreview?.();
      wrap.remove();
    });
    apply.addEventListener("click", async () => {
      // Collect the edits BEFORE anything is disabled or dispatched: a required
      // field left blank has to stop the apply, and a blocked card must stay
      // usable so the user can fill it in and click again.
      // What the user typed WINS over what the assistant proposed — that is the
      // entire point of showing them the field. An emptied OPTIONAL field means
      // "you choose", so it is dropped rather than sent as "".
      const edited: Record<string, unknown> = { ...args };
      const missing: HTMLElement[] = [];
      for (const f of edits) {
        f.node.classList.remove(`${PREFIX}-field-invalid`);
        const raw = f.read();
        // Post the type the ARG actually is. Every control reads back a string,
        // and the string "false" is TRUTHY server-side (`withReadme !== false`
        // passes), so an unticked box used to change nothing at all.
        if (f.type === "checkbox") {
          const on = isTruthyValue(raw);
          if (f.required && !on) {
            missing.push(f.node);
            continue;
          }
          edited[f.arg] = on;
          continue;
        }
        if (!raw) {
          if (f.required) {
            missing.push(f.node);
            continue;
          }
          delete edited[f.arg];
          continue;
        }
        if (f.type === "number") {
          const n = Number(raw);
          // Non-numeric text in a number field is the user's answer, not a
          // NaN to post — hand it over as typed and let the API judge it.
          edited[f.arg] = Number.isFinite(n) ? n : raw;
          continue;
        }
        edited[f.arg] = raw;
      }
      if (missing.length) {
        for (const n of missing) n.classList.add(`${PREFIX}-field-invalid`);
        editErr.style.display = "";
        return;
      }
      editErr.style.display = "none";
      apply.disabled = true;
      apply.textContent = L("applying");
      // Media generation gets a live process chip (running → ✓/✗, video polled)
      // instead of a static "done" line — swap the card for the chip on click.
      if (MEDIA_GEN_TOOLS.has(name)) {
        disposePreview?.();
        wrap.remove();
        await applyMediaGen(name, args);
        return;
      }
      try {
        // Carry the originating thread on EVERY apply — session-scoped asset
        // writes (scraped imports, generations) use it to keep chat debris
        // out of the library until explicitly saved. Tools that don't care
        // simply ignore the extra key.
        const res = await opts.onApplyProposal!(
          name,
          threadId ? { ...edited, threadId } : edited,
          proposalAccountId ? { accountId: proposalAccountId } : undefined
        );
        const msg = typeof res === "string" ? res : res?.message;
        // An apply that ENQUEUED answers with a job id. Keeping it is the whole
        // difference between "I'll notify you when it's ready ✓" followed by
        // minutes of silence, and a card that shows the work happening.
        const jobId = res && typeof res === "object" ? res.jobId : undefined;
        disposePreview?.();
        // Resolved: it no longer blocks the end-of-turn reload.
        wrap.classList.remove(`${PREFIX}-proposal-pending`);
        wrap.innerHTML = "";
        const ok = el("div", `${PREFIX}-proposal-ok`);
        ok.innerHTML =
          `<span class="${PREFIX}-act-ok" aria-hidden="true">✓</span>` +
          `<span>${escapeHtml(msg || L("applied"))}</span>`;
        wrap.appendChild(ok);
        if (jobId) trackJob(jobId, threadId);
      } catch {
        apply.disabled = false;
        apply.textContent = L("tryAgain");
      }
    });
    row.append(apply, cancel);
    wrap.appendChild(row);
    log.appendChild(wrap);
    scrollDown(true);
  }

  async function send(
    content: string,
    fork?: { parentId?: string | null; regenerate?: boolean }
  ): Promise<void> {
    // A regenerate re-answers an existing user turn — it carries no new user
    // message, so it must NOT push a user bubble to the DOM / history.
    const isRegen = fork?.regenerate === true;
    busy = true;
    if (!isRegen) lastUserContent = content;
    // Take + clear any staged attachments for THIS turn.
    const atts = stagedAtts.splice(0);
    renderStaged();
    // The conversation is starting — page shortcuts give way to the thread.
    suggestionsEl.style.display = "none";
    suggestionsEl.innerHTML = "";
    sendBtn.disabled = true;
    setRole("talk"); // each turn starts as the conversational copilot
    if (!isRegen) {
      addMsg(log, "user", content, atts.length ? atts : undefined);
      history.push({
        role: "user",
        content,
        ...(atts.length ? { attachments: atts } : {}),
      });
    }
    saveState();
    // Animated typing indicator until the first token lands.
    const typing = el("div", `${PREFIX}-typing`);
    typing.innerHTML = "<span></span><span></span><span></span>";
    log.appendChild(typing);
    scrollDown(true);
    let assistant: HTMLElement | null = null;
    let assistantRaw = "";
    let producedAny = false;
    /**
     * Write proposals seen this turn, rendered only AFTER the reply text.
     *
     * The model almost always emits a tool call BEFORE it writes the sentence
     * explaining it, so rendering each card where it arrives put "Apply this
     * change?" above the reasoning for it — the user was asked to approve
     * something before being told what it was. Buffering and flushing at the
     * end of the turn makes the order match how a person reads: the
     * explanation, then the decision.
     */
    const deferredProposals: Array<{
      name: string;
      args: Record<string, unknown>;
      agent?: string;
      fields: ProposalField[];
      /** The account the worker said this write is for. */
      accountId?: string;
    }> = [];
    let turnIn = 0;
    let turnOut = 0;
    let failure: string | null = null;
    // Close the current text bubble and render its markdown, so the NEXT thing
    // (a widget/activity, or more text) lands AFTER it — keeping the reply in
    // true order instead of dumping widgets below all the text. `final` also
    // parses inline directives. Returns the rendered bubble (for the token tag).
    const flushSegment = (final: boolean): HTMLElement | null => {
      const bubble = assistant;
      if (!bubble) return null;
      assistant = null;
      let raw = assistantRaw;
      assistantRaw = "";
      bubble.classList.remove(`${PREFIX}-streaming`);
      if (!raw.trim()) {
        bubble.remove();
        return null;
      }
      if (final) raw = renderDirectives(raw);
      history.push({ role: "assistant", content: raw });
      applyAssistantRich(bubble, raw, true);
      return bubble;
    };
    try {
      const token = opts.getToken ? await opts.getToken() : opts.token;
      const baseCtx = opts.getContext ? await opts.getContext() : undefined;
      // In advanced view the controllable page is the FRAME, not the parent
      // shell — so the on-page targets (and the current path) come from the
      // frame's agent, overriding whatever the host scanned locally.
      const pageContext =
        advanced && transport && baseCtx && typeof baseCtx === "object"
          ? {
              ...(baseCtx as Record<string, unknown>),
              path: transport.getPath() ?? (baseCtx as { path?: string }).path,
              uiTargets: transport.getTargets(),
            }
          : baseCtx;
      // Cache this turn's navigable pages for the #111 prose-nav fallback below.
      const ctxTargets = (pageContext as { navTargets?: unknown } | undefined)
        ?.navTargets;
      if (Array.isArray(ctxTargets)) knownNavTargets = ctxTargets;
      const res = await fetch(opts.endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        credentials: opts.withCredentials ? "include" : "same-origin",
        // Tied to the widget's lifetime. Without this the reader loop outlived
        // `destroy()`: it kept appending to a detached log, kept fetching, and
        // kept calling saveState() — into the SAME storage key the replacement
        // widget was already writing. Admin re-keys the widget on account and
        // language change, so a mid-stream account switch could clobber the new
        // account's transcript with the old one's.
        signal: alive.signal,
        body: JSON.stringify({
          ...(opts.extraBody ?? {}),
          ...(pageContext ? { pageContext } : {}),
          accountId: opts.getAccountScope?.() ?? opts.accountId ?? "",
          threadId,
          content,
          ...(atts.length ? { attachments: atts.map((a) => a.mediaId) } : {}),
          ...(fork?.parentId !== undefined ? { parentId: fork.parentId } : {}),
          ...(fork?.regenerate ? { regenerate: true } : {}),
        }),
      });
      if (!res.ok || !res.body) {
        failure = `Server error (${res.status}).`;
      } else {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let idx: number;
          while ((idx = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, idx).trim();
            buf = buf.slice(idx + 1);
            const frame = parseLine(line);
            if (!frame) continue;
            if (frame.threadId) threadId = frame.threadId;
            const piece = frame.text ?? frame.d;
            if (piece) {
              if (!assistant) {
                typing.remove();
                assistant = addMsg(log, "assistant", "");
                assistant.classList.add(`${PREFIX}-streaming`);
              }
              assistantRaw += piece;
              producedAny = true;
              // Stream MASKED plain text (markdown marks hidden) with a per-token
              // fade+blur reveal — a cool typing feel without showing raw ** / ##
              // / | while typing. The real markdown renders once at the end.
              const masked = maskMarkdown(piece);
              if (masked) {
                const tok = el("span", `${PREFIX}-tok`);
                tok.textContent = masked;
                assistant.appendChild(tok);
              }
              scrollDown();
            }
            // Inline data widget (render_chart). Flush the current text first so
            // the chart lands AFTER it, in order — not below the whole reply.
            if (frame.type === "widget") {
              typing.remove();
              flushSegment(false);
              renderServerWidget(frame.spec, frame.rows, frame.comparisonRows);
              producedAny = true;
            }
            // Live agent-activity step — a process chip (running → ok/error). On
            // start, flush text so the chip sits AFTER it (true order) and flip
            // the role badge to match the tool (Talk → Analytics, etc.).
            if (frame.type === "activity" && frame.label && frame.status) {
              typing.remove();
              if (frame.status === "running") {
                flushSegment(false);
                if (frame.name && TOOL_ROLE[frame.name])
                  setRole(TOOL_ROLE[frame.name]);
              }
              liveActivityFrame(
                frame.callId ?? frame.label,
                frame.label,
                frame.status,
                (frame as { agent?: string }).agent,
                (frame as { model?: string }).model
              );
              producedAny = true;
            }
            // The assistant is ASKING the human to decide something.
            if (frame.type === "question" && frame.questionId && frame.prompt) {
              typing.remove();
              flushSegment(false);
              renderQuestion(
                frame as unknown as Parameters<typeof renderQuestion>[0]
              );
              producedAny = true;
            }
            // Confirm-gated WRITE tool — the AI PROPOSES; show a card the user
            // applies (the actual mutation is a host, Clerk-authed action).
            if (
              frame.type === "tool_proposal" &&
              frame.name &&
              opts.onApplyProposal
            ) {
              // Every write proposal shows a confirm card — the human applies it.
              // (Saving a generated image/video/PDF into the library is just this:
              // the AI proposes the save, the user clicks Apply, or asks for it.)
              // HELD until the turn's text has been rendered — see
              // deferredProposals. Do NOT flush the segment here: splitting the
              // bubble at the tool call is what let the card jump the queue.
              deferredProposals.push({
                name: frame.name,
                args: (frame.args ?? {}) as Record<string, unknown>,
                agent: (frame as { agent?: string }).agent,
                // Inputs the assistant wants filled in before this is applied.
                // Absent on every proposal that needs no decision, which is
                // most of them — the card stays a plain confirmation.
                fields: proposalFields((frame as { fields?: unknown }).fields),
                accountId: (frame as { accountId?: string }).accountId,
              });
              producedAny = true;
            }
            // Free-allowance meter (visitor preview). `quota` is the server's
            // snapshot; `usage` is this turn's tokens (count toward the session).
            if (frame.type === "quota") {
              if (typeof frame.granted === "number")
                quotaGranted = frame.granted;
              if (typeof frame.remaining === "number")
                quotaRemaining = frame.remaining;
              renderMeter();
              if (frame.exhausted) showSignupCta();
            }
            if (frame.type === "usage") {
              turnIn += frame.inputTokens ?? 0;
              turnOut += frame.outputTokens ?? 0;
              const turn = (frame.inputTokens ?? 0) + (frame.outputTokens ?? 0);
              sessionUsed += turn;
              if (quotaRemaining !== null)
                quotaRemaining = Math.max(0, quotaRemaining - turn);
              renderMeter();
            }
            if (frame.type === "meta" && frame.isStaff && frame.modelLabel) {
              metaChip.textContent = frame.modelLabel;
              metaChip.hidden = false;
            }
            if (frame.type === "error" && frame.message)
              failure = frame.message;
          }
        }
      }
    } catch (err) {
      failure = (err as Error).message || "Network error.";
    } finally {
      busy = false;
      sendBtn.disabled = false;
      input.focus();
      // A turn just consumed credits — refresh the remaining-credits readout.
      void refreshBalance();
      // A generation/import may have just landed — refresh the artifact strip.
      void refreshArtifacts();
    }

    // Clear the typing indicator + render the FINAL text segment (with
    // directives). Earlier segments were already flushed around widgets/chips.
    typing.remove();
    const lastBubble = flushSegment(true);
    // The reply is on screen; NOW ask for the decisions, in the order the model
    // proposed them.
    for (const p of deferredProposals)
      renderProposal(p.name, p.args, p.agent, p.fields, p.accountId);
    if (deferredProposals.length) scrollDown();
    if (!producedAny) {
      if (failure) showError(failure);
      else {
        addMsg(log, "assistant", "(no response)");
        scrollDown(true);
      }
    } else {
      // A reply did stream; surface a late error inline (partial + error).
      if (failure) showError(failure);
      // Per-message token badge under the reply (UI-friendly tokens caption).
      if (turnIn + turnOut > 0) {
        const cap = el("div", `${PREFIX}-usage`);
        cap.innerHTML =
          `<span class="${PREFIX}-usage-pill">↑ ${turnIn.toLocaleString()}</span>` +
          `<span class="${PREFIX}-usage-pill">↓ ${turnOut.toLocaleString()}</span>` +
          `<span class="${PREFIX}-usage-sep">·</span>` +
          `<span>${(turnIn + turnOut).toLocaleString()} tokens</span>`;
        if (lastBubble) lastBubble.insertAdjacentElement("afterend", cap);
        else log.appendChild(cap);
      }
      maybeDing();
      scrollDown();
    }
    saveState();
    // Reload the canonical thread after the turn so every message (incl. the one
    // just sent) carries its persisted id + ‹n/m› switcher — that's what makes
    // the edit / regenerate / branch controls appear WITHOUT a manual reopen. A
    // fork turn (edit / regenerate) also needs this to land the rewritten tree.
    // Only when branching is wired (setActiveLeaf) — otherwise the streamed view
    // is already canonical and reloading would just cause a needless re-render.
    // A live, un-applied WRITE PROPOSAL card is ephemeral — it is NOT persisted
    // as a thread artifact (unlike a creation), so a full renderThreadItems()
    // reload (which does `log.innerHTML = ""`) would silently WIPE it: the
    // agent proposes, the card flashes in, the end-of-turn reload deletes it,
    // and the admin never gets to click Apply. When a proposal card is on
    // screen, keep the streamed view instead. The only thing the reload adds is
    // the ‹n/m› branch switcher + persisted ids on this turn's messages, which
    // self-heal on the next send or when the thread is reopened — a fair trade
    // to avoid destroying a pending Apply card.
    const hasLiveProposal = !!log.querySelector(`.${PREFIX}-proposal-pending`);
    if (threadId && opts.loadThread && opts.setActiveLeaf && !hasLiveProposal) {
      try {
        const reloaded = await opts.loadThread(threadId);
        renderThreadItems(reloaded);
      } catch {
        /* keep the streamed view if the reload fails */
      }
    }
  }

  /**
   * Build ONE input from a field spec — the widget's only place that turns a
   * described field into a DOM control.
   *
   * Extracted because the editable proposal card needs exactly this and was
   * about to grow its own copy. A second implementation would drift: the same
   * `select` would look one way inside a form and another inside a card, and a
   * later fix to one would quietly miss the other.
   *
   * Returns a node + a reader rather than the raw element, because not every
   * control IS one element: a checkbox needs its label beside it to mean
   * anything, and a radio needs one input per option. Handing the caller a
   * `<select>` and letting it read `.value` worked only as long as every field
   * happened to be a single text-ish box.
   */
  function buildField(field: {
    name: string;
    type?: string;
    label?: string;
    placeholder?: string;
    options?: string[];
    required?: boolean;
    value?: string;
  }): BuiltField {
    const type = field.type ?? "text";
    // Boolean/choice controls carry their own caption — a bare 16px box with
    // the label somewhere above it reads as decoration, not as a question.
    if (type === "checkbox") {
      const row = el("label", `${PREFIX}-field-check`);
      const box = el("input", `${PREFIX}-check`) as HTMLInputElement;
      box.type = "checkbox";
      box.checked = isTruthyValue(field.value);
      if (field.required) box.required = true;
      row.appendChild(box);
      const cap = el("span", `${PREFIX}-field-check-label`);
      cap.textContent = field.label ?? field.placeholder ?? field.name;
      row.appendChild(cap);
      // Stringified so a field's answer is always a string, whatever it was
      // drawn as — the submit path posts a flat Record<string,string>.
      return {
        node: row,
        selfLabelled: true,
        read: () => (box.checked ? "true" : "false"),
      };
    }
    if (type === "radio" && field.options?.length) {
      const group = el("div", `${PREFIX}-field-group`);
      // The `name` attribute is what makes radios mutually exclusive, so it has
      // to be unique per rendered group — two proposal cards asking the same
      // question would otherwise fight over one selection.
      const groupName = `${PREFIX}-${field.name}-${Math.random().toString(36).slice(2, 9)}`;
      for (const o of field.options) {
        const row = el("label", `${PREFIX}-field-check`);
        const radio = el("input", `${PREFIX}-check`) as HTMLInputElement;
        radio.type = "radio";
        radio.name = groupName;
        radio.value = o;
        // Required propagates to the inputs (one required radio makes the whole
        // group required). It was dropped here, so a required choice reported
        // itself as answered while nothing was selected.
        if (field.required) radio.required = true;
        if (o === field.value) radio.checked = true;
        row.appendChild(radio);
        const cap = el("span", `${PREFIX}-field-check-label`);
        cap.textContent = o;
        row.appendChild(cap);
        group.appendChild(row);
      }
      return {
        node: group,
        read: () =>
          group.querySelector<HTMLInputElement>("input:checked")?.value ?? "",
      };
    }
    let input: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
    if (type === "textarea") {
      input = el("textarea", `${PREFIX}-field`) as HTMLTextAreaElement;
    } else if (type === "select") {
      const sel = el("select", `${PREFIX}-field`) as HTMLSelectElement;
      for (const o of field.options ?? []) {
        const opt = document.createElement("option");
        opt.value = o;
        opt.textContent = o;
        sel.appendChild(opt);
      }
      input = sel;
    } else {
      const i = el("input", `${PREFIX}-field`) as HTMLInputElement;
      i.type = type === "number" ? "number" : type;
      input = i;
    }
    if ("placeholder" in input && field.placeholder)
      (input as HTMLInputElement).placeholder = field.label
        ? `${field.label} — ${field.placeholder}`
        : field.placeholder;
    else if ("placeholder" in input && field.label)
      (input as HTMLInputElement).placeholder = field.label;
    if (field.required) (input as HTMLInputElement).required = true;
    // Prefilled: the card hands back a value the user can accept or rewrite.
    if (field.value !== undefined) input.value = field.value;
    return { node: input, read: () => input.value.trim() };
  }

  /** Render an AI-described input form inline; submit → host action. */
  function renderForm(spec: FormSpec): void {
    const wrap = el("div", `${PREFIX}-lead`);
    if (spec.title) {
      const t = el("div", `${PREFIX}-form-title`);
      t.textContent = spec.title;
      wrap.appendChild(t);
    }
    const f = el("form", `${PREFIX}-lead-form`) as HTMLFormElement;
    const controls: {
      name: string;
      get: () => string;
      required: boolean;
      /** A checkbox answers "false" when unticked — a real answer for a normal
       *  field, and "not filled in" for this one. */
      boolish: boolean;
      /** Highlighted when the form is held back on this control. */
      node: HTMLElement;
    }[] = [];
    // Fields are built by ONE function, shared with the editable proposal card
    // — see `buildField`. Two implementations of "render an input from a spec"
    // is how a select ends up styled differently depending on which part of the
    // chat drew it.
    for (const field of spec.fields.slice(0, 8)) {
      const built = buildField(field);
      f.appendChild(built.node);
      controls.push({
        name: field.name,
        get: built.read,
        required: Boolean(field.required),
        boolish: field.type === "checkbox",
        node: built.node,
      });
    }
    // Why Send did nothing. A silent `return` on a missing required field left
    // the user clicking a button that never reacted — with no way to guess which
    // field was at fault.
    const err = el("div", `${PREFIX}-form-err`);
    err.textContent = L("requiredFields");
    err.style.display = "none";
    f.appendChild(err);
    const submit = el("button", `${PREFIX}-lead-btn`) as HTMLButtonElement;
    submit.type = "submit";
    submit.textContent = spec.submit ?? L("submit");
    f.appendChild(submit);
    wrap.appendChild(f);
    log.appendChild(wrap);
    scrollDown(true);
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const data: Record<string, string> = {};
      for (const c of controls) data[c.name] = c.get();
      // Check the REQUIRED fields, each on its own. This used to ask "is any
      // control empty AND is any field required", which failed both ways: an
      // untouched OPTIONAL field blocked a form whose required ones were all
      // filled, and a required checkbox passed while unticked because it reads
      // the string "false", which is not empty.
      const missing = controls.filter((c) => {
        if (!c.required) return false;
        const v = data[c.name];
        return c.boolish ? !isTruthyValue(v) : !v;
      });
      for (const c of controls)
        c.node.classList.toggle(`${PREFIX}-field-invalid`, missing.includes(c));
      if (missing.length) {
        err.style.display = "";
        // Put the cursor on the offending control — its node is the input
        // itself for a text field, and a wrapper for a checkbox/radio group.
        const first = missing[0]?.node;
        (first?.matches("input,select,textarea")
          ? first
          : first?.querySelector<HTMLElement>("input,select,textarea")
        )?.focus();
        return;
      }
      err.style.display = "none";
      submit.disabled = true;
      submit.textContent = L("sending");
      try {
        let msg: string | void = undefined;
        if (opts.onWidgetAction) {
          msg = await opts.onWidgetAction(spec.action, data);
        } else if (opts.onLead && spec.action === "lead") {
          await opts.onLead({
            email: data.email ?? "",
            context: lastUserContent,
          });
        }
        wrap.innerHTML = "";
        const ok = el("div", `${PREFIX}-lead-ok`);
        ok.textContent = (typeof msg === "string" && msg) || L("done");
        wrap.appendChild(ok);
      } catch {
        submit.disabled = false;
        submit.textContent = L("tryAgain");
      }
    });
  }

  /** Render an inline data widget (stat / kpis / list / table) in the log. */
  function renderWidget(spec: WidgetSpec): void {
    const card = el("div", `${PREFIX}-widget`);
    if (spec.title) {
      const t = el("div", `${PREFIX}-widget-title`);
      t.textContent = spec.title;
      card.appendChild(t);
    }
    const kind =
      spec.kind ?? (spec.rows ? "table" : spec.items ? "kpis" : "list");
    if (kind === "stat") {
      const v = el("div", `${PREFIX}-widget-stat`);
      v.textContent = String(spec.value ?? "");
      card.appendChild(v);
      if (spec.caption) {
        const c = el("div", `${PREFIX}-widget-cap`);
        c.textContent = spec.caption;
        card.appendChild(c);
      }
      if (spec.delta) {
        const d = el("div", `${PREFIX}-widget-delta`);
        d.textContent = spec.delta;
        card.appendChild(d);
      }
    } else if (kind === "kpis") {
      const grid = el("div", `${PREFIX}-widget-kpis`);
      for (const it of (spec.items ?? []).slice(0, 8)) {
        const tile = el("div", `${PREFIX}-kpi`);
        const kv = el("div", `${PREFIX}-kpi-v`);
        kv.textContent = String(it.value ?? "");
        const kl = el("div", `${PREFIX}-kpi-l`);
        kl.textContent = it.label ?? "";
        tile.append(kv, kl);
        if (it.delta) {
          const kd = el("div", `${PREFIX}-kpi-d`);
          kd.textContent = it.delta;
          tile.appendChild(kd);
        }
        grid.appendChild(tile);
      }
      card.appendChild(grid);
    } else if (kind === "table" && spec.rows) {
      const table = document.createElement("table");
      table.className = `${PREFIX}-widget-table`;
      if (spec.columns?.length) {
        const thead = table.createTHead().insertRow();
        for (const c of spec.columns) {
          const th = document.createElement("th");
          th.textContent = String(c);
          thead.appendChild(th);
        }
      }
      const tbody = table.createTBody();
      for (const row of spec.rows.slice(0, 30)) {
        const tr = tbody.insertRow();
        for (const cell of row) tr.insertCell().textContent = String(cell);
      }
      card.appendChild(table);
    } else {
      const ul = el("ul", `${PREFIX}-widget-list`);
      for (const line of (spec.lines ?? []).slice(0, 30)) {
        const li = document.createElement("li");
        li.textContent = line;
        ul.appendChild(li);
      }
      card.appendChild(ul);
    }
    log.appendChild(card);
    scrollDown(true);
  }

  /** Map an analytics render_chart frame (spec + StatsQueryRow[]) to an inline
   *  widget. kpi → a stat; everything else → a table of the returned rows. */
  /** Replay a past creation in the log — the host mounts the real .sgiant
   *  preview (clickable → lightbox), so reopening a thread shows the reels/posts
   *  the AI designed, not just the text around them. */
  function renderCreationCard(
    name: string | undefined,
    payload: unknown
  ): void {
    if (!opts.renderCreation || !payload || typeof payload !== "object") return;
    const card = el("div", `${PREFIX}-proposal ${PREFIX}-creation-card`);
    const title = el("div", `${PREFIX}-proposal-title`);
    title.textContent = name ? `Creation · ${name}` : "Creation";
    card.appendChild(title);
    const host = el("div", `${PREFIX}-creation-preview`);
    card.appendChild(host);
    log.appendChild(card);
    const dispose = opts.renderCreation(host, payload);
    if (dispose) richDisposers.push(dispose);
    scrollDown(true);
  }

  function renderServerWidget(
    spec: { title?: string; chartType?: string } | undefined,
    rows: unknown,
    comparisonRows?: unknown
  ): void {
    // In-app: hand the frame to the host's REAL dashboard renderer (charts).
    if (opts.renderDataWidget) {
      const host = el("div", `${PREFIX}-widget ${PREFIX}-widget-host`);
      log.appendChild(host);
      const dispose = opts.renderDataWidget(host, spec, rows, comparisonRows);
      if (dispose) richDisposers.push(dispose);
      scrollDown(true);
      return;
    }
    // Embedder-supplied chart fallback (no React host) — real charts in a
    // standalone embed via whatever lightweight lib the embedder plugs in.
    if (opts.renderChartFallback) {
      const host = el("div", `${PREFIX}-widget ${PREFIX}-widget-host`);
      log.appendChild(host);
      try {
        const dispose = opts.renderChartFallback(
          host,
          spec,
          rows,
          comparisonRows
        );
        if (dispose) richDisposers.push(dispose);
        scrollDown(true);
        return;
      } catch {
        host.remove(); // fall through to the built-in degrade
      }
    }
    // External embed: lightweight fallback (kpi → stat, else a table).
    const title = spec?.title;
    const data = Array.isArray(rows)
      ? (rows as Array<Record<string, unknown>>)
      : [];
    if (spec?.chartType === "kpi" && data[0]) {
      const first = data[0];
      const keys = Object.keys(first);
      const valueKey = keys[keys.length - 1];
      renderWidget({
        kind: "stat",
        title,
        value: String(first[valueKey] ?? ""),
        caption: valueKey,
      });
      return;
    }
    if (!data.length) {
      renderWidget({ kind: "list", title, lines: ["(no data)"] });
      return;
    }
    const columns = Object.keys(data[0]);
    const tableRows = data
      .slice(0, 30)
      .map((r) => columns.map((c) => (r[c] == null ? "" : String(r[c]))));
    renderWidget({ kind: "table", title, columns, rows: tableRows });
  }

  /** Render a navigation suggestion. With auto-navigate ON it follows the link
   *  immediately (showing a "Opening …" chip); OFF it offers a confirm button. */
  function renderNavigate(spec: NavigateSpec, replay = false): void {
    const wrap = el("div", `${PREFIX}-nav`);
    const label = spec.label || "Open page";
    // On replay (history / post-turn thread restore) always render the button,
    // never auto-follow — re-opening a conversation must not navigate the app.
    if (autoNav && !replay) {
      const chip = el("div", `${PREFIX}-autonav`);
      chip.innerHTML = `${ICON_COMPASS}<span>${escapeHtml(`Opening ${label}…`)}</span>`;
      wrap.appendChild(chip);
      log.appendChild(wrap);
      scrollDown(true);
      // The chip must always land on an OUTCOME. It used to be written once as
      // "Opening …" and only rewritten on failure, so a successful navigation
      // left it saying "Opening Open Assets…" for the rest of the conversation
      // — which reads as a click that never finished, and was reported as
      // exactly that. The handler's own words win when it has any ("Already on
      // assets" is more use than a tick).
      void Promise.resolve(
        dispatchAction("navigate", { path: spec.path })
      ).then(
        (msg) => {
          chip.querySelector("span")!.textContent =
            (typeof msg === "string" && msg) || `${label} ✓`;
        },
        () => {
          chip.querySelector("span")!.textContent = `Couldn't open ${label}`;
        }
      );
      return;
    }
    const btn = el("button", `${PREFIX}-nav-btn`) as HTMLButtonElement;
    btn.type = "button";
    btn.innerHTML = `<span>${escapeHtml(label)}</span> <span aria-hidden="true">→</span>`;
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      try {
        const msg = await dispatchAction("navigate", { path: spec.path });
        // Say what actually happened. A blanket tick hid the difference
        // between "opened" and "you are already there", which is the whole
        // reason a click on the page you are on looked broken.
        btn.innerHTML = `<span>${escapeHtml(
          (typeof msg === "string" && msg) || `${label} ✓`
        )}</span>`;
      } catch {
        // Re-enabling in silence left the user to guess. Refusing an off-app
        // path is a decision worth stating.
        btn.disabled = false;
        btn.innerHTML = `<span>${escapeHtml(label)} — try again</span>`;
      }
    });
    wrap.appendChild(btn);
    log.appendChild(wrap);
    scrollDown(true);
  }

  /** Render an AI-proposed in-app action as a button (with optional confirm
   *  step), dispatched to the host via onWidgetAction(name, data). */
  function renderChips(spec: ChipsSpec): void {
    const options = (Array.isArray(spec.options) ? spec.options : [])
      .map((o) => String(o).trim())
      .filter(Boolean)
      .slice(0, 8);
    if (!options.length) return;
    const multi = spec.multi === true;
    const wrap = el("div", `${PREFIX}-chips`);
    const chosen = new Set<string>();
    let answered = false;
    const answer = (text: string): void => {
      if (answered || !text.trim()) return;
      answered = true;
      wrap
        .querySelectorAll("button")
        .forEach((b) => ((b as HTMLButtonElement).disabled = true));
      void send(text.trim());
    };
    for (const opt of options) {
      const b = el("button", `${PREFIX}-chip`) as HTMLButtonElement;
      b.type = "button";
      b.textContent = opt;
      b.addEventListener("click", () => {
        if (answered) return;
        if (!multi) {
          answer(opt);
          return;
        }
        if (chosen.has(opt)) {
          chosen.delete(opt);
          b.classList.remove(`${PREFIX}-chip-on`);
        } else {
          chosen.add(opt);
          b.classList.add(`${PREFIX}-chip-on`);
        }
      });
      wrap.appendChild(b);
    }
    // "Other" — let the user type a free answer instead of picking.
    if (spec.other !== false) {
      const other = el(
        "button",
        `${PREFIX}-chip ${PREFIX}-chip-other`
      ) as HTMLButtonElement;
      other.type = "button";
      other.textContent = L("otherOption");
      other.addEventListener("click", () => input.focus());
      wrap.appendChild(other);
    }
    // Multi-select needs an explicit Send (collect the toggled options).
    if (multi) {
      const go = el(
        "button",
        `${PREFIX}-chip ${PREFIX}-chip-send`
      ) as HTMLButtonElement;
      go.type = "button";
      go.textContent = L("send");
      go.addEventListener("click", () => {
        const picks = options.filter((o) => chosen.has(o));
        if (picks.length) answer(picks.join(", "));
      });
      wrap.appendChild(go);
    }
    log.appendChild(wrap);
    scrollDown(true);
  }

  /** Render an AI-authored HTML preview in a fully sandboxed iframe (sandbox=""
   *  → no scripts, no same-origin) so it paints the real look but can't execute
   *  or reach out. The chat-side twin of @sgiant/ui's <AiPlayground>. */
  function renderPreview(spec: PreviewSpec): void {
    const wrap = el("div", `${PREFIX}-preview`);
    const bar = el("div", `${PREFIX}-preview-bar`);
    const dots = el("span", `${PREFIX}-preview-dots`);
    dots.innerHTML = `<i></i><i></i><i></i>`;
    const title = el("span", `${PREFIX}-preview-title`);
    title.textContent = spec.title || L("preview");
    bar.append(dots, title);
    const frame = el("iframe", `${PREFIX}-preview-frame`) as HTMLIFrameElement;
    frame.setAttribute("sandbox", "");
    frame.setAttribute("title", spec.title || L("preview"));
    frame.srcdoc = wrapPreviewHtml(spec.html);
    wrap.append(bar, frame);
    log.appendChild(wrap);
    scrollDown(true);
  }

  // Default confirm copy for a state-changing UI action the model didn't caption.
  function operateConfirmText(spec: ActionSpec): string {
    const target = spec.data?.target ?? "this control";
    if (spec.name === "fill") {
      const v = spec.data?.value ?? "";
      const short = v.length > 40 ? `${v.slice(0, 40)}…` : v;
      return short
        ? `Type “${short}” into ${target}?`
        : `Fill ${target} for you?`;
    }
    return `Click ${target} for you?`;
  }

  function renderAction(spec: ActionSpec): void {
    // Reflect the acting capability in the status badge (e.g. research-brand →
    // Analytics, open-studio → Creation); plain navigation stays Talk.
    if (ACTION_ROLE[spec.name]) setRole(ACTION_ROLE[spec.name]);
    const wrap = el("div", `${PREFIX}-nav`);
    // State-changing UI control (fill / click) is ALWAYS confirm-gated: force a
    // confirm prompt even if the model forgot one, and never auto-run it — the
    // user must approve typing/clicking on their behalf. Read-only nudges
    // (highlight/scroll/focus) never reach renderAction (they carry no button).
    if (isOperateAction(spec.name) && !spec.confirm) {
      spec = { ...spec, confirm: operateConfirmText(spec) };
    }
    // Auto-navigate: a confirm-LESS action is pure navigation (open-studio,
    // open-dashboards, …) — run it immediately. Anything with `confirm` (changes
    // state / costs credits) ALWAYS asks, even in auto mode.
    if (autoNav && isNavigationAction(spec.name) && !spec.confirm) {
      const label = spec.label || "Opening…";
      const chip = el("div", `${PREFIX}-autonav`);
      chip.innerHTML = `${ICON_COMPASS}<span>${escapeHtml(`Opening ${label}…`)}</span>`;
      wrap.appendChild(chip);
      log.appendChild(wrap);
      scrollDown(true);
      void Promise.resolve(dispatchAction(spec.name, spec.data ?? {})).then(
        (msg) => {
          chip.querySelector("span")!.textContent =
            (typeof msg === "string" && msg) || `${label} ✓`;
        },
        () => {
          chip.querySelector("span")!.textContent = `Couldn't run ${label}`;
        }
      );
      return;
    }
    const btn = el("button", `${PREFIX}-nav-btn`) as HTMLButtonElement;
    btn.type = "button";
    const label = spec.label || "Run";
    btn.innerHTML = `<span>${escapeHtml(label)}</span>`;
    const run = async (): Promise<void> => {
      btn.disabled = true;
      try {
        const msg = await dispatchAction(spec.name, spec.data ?? {});
        btn.innerHTML = `<span>${escapeHtml(
          (typeof msg === "string" && msg) || `${label} ✓`
        )}</span>`;
      } catch {
        btn.disabled = false;
        btn.innerHTML = `<span>${escapeHtml(label)} — try again</span>`;
      }
    };
    btn.addEventListener("click", () => {
      // "Critic permission": ask the user to confirm before acting.
      if (spec.confirm) {
        wrap.innerHTML = "";
        const q = el("div", `${PREFIX}-confirm-q`);
        q.textContent = spec.confirm;
        const row = el("div", `${PREFIX}-confirm-row`);
        const yes = el("button", `${PREFIX}-nav-btn`) as HTMLButtonElement;
        yes.type = "button";
        yes.textContent = L("confirm");
        const no = el("button", `${PREFIX}-confirm-no`) as HTMLButtonElement;
        no.type = "button";
        no.textContent = L("cancel");
        yes.addEventListener("click", () => {
          wrap.innerHTML = "";
          wrap.appendChild(btn);
          btn.innerHTML = `<span>${escapeHtml(label)}</span>`;
          void run();
        });
        no.addEventListener("click", () => wrap.remove());
        row.append(yes, no);
        wrap.append(q, row);
        scrollDown(true);
      } else {
        void run();
      }
    });
    wrap.appendChild(btn);
    log.appendChild(wrap);
    scrollDown(true);
  }

  /** Render a recoverable error card: friendly copy + retry + (optional) report. */
  function showError(raw: string): void {
    const wrap = el("div", `${PREFIX}-error`);
    const txt = el("div", `${PREFIX}-error-text`);
    txt.textContent = L("errorSnag", { name });
    const detail = el("div", `${PREFIX}-error-detail`);
    detail.textContent = raw;
    const actions = el("div", `${PREFIX}-error-actions`);

    const retry = el("button", `${PREFIX}-error-btn ${PREFIX}-error-retry`);
    retry.setAttribute("type", "button");
    retry.textContent = L("tryAgain");
    retry.addEventListener("click", () => {
      wrap.remove();
      if (lastUserContent) void send(lastUserContent);
    });
    actions.appendChild(retry);

    if (opts.onReportIssue) {
      const report = el("button", `${PREFIX}-error-btn`);
      report.setAttribute("type", "button");
      report.textContent = L("reportIssue");
      report.addEventListener("click", async () => {
        (report as HTMLButtonElement).disabled = true;
        report.textContent = L("reporting");
        try {
          await opts.onReportIssue!({
            error: raw,
            lastUserMessage: lastUserContent,
            threadId,
          });
          report.textContent = L("reported");
        } catch {
          report.textContent = L("reportFailed");
          (report as HTMLButtonElement).disabled = false;
        }
      });
      actions.appendChild(report);
    }

    wrap.append(txt, detail, actions);
    log.appendChild(wrap);
    scrollDown(true);
  }

  /**
   * A background job this conversation started has finished.
   *
   * `ingest_site` and friends return immediately and run for minutes, then
   * report back onto the THREAD — which the chat only ever saw on a reload, so
   * "I'll notify you when the folder is ready" was followed, in the chat, by
   * nothing at all. The api announces the change (`publishLiveChange`) and the
   * host forwards it here.
   *
   * Guarded: never reload mid-turn (it would wipe the streaming view), never
   * over a card still awaiting the user, and only for the `ai` domain.
   */
  const offAiChange = subscribeAiChange((e) => {
    const scope = opts.getAccountScope?.() ?? opts.accountId;
    if (scope && e.accountId && e.accountId !== scope) return;
    if (!e.domains?.includes("ai")) return;
    if (busy || !threadId || !opts.loadThread) return;
    if (log.querySelector(`.${PREFIX}-proposal-pending`)) return;
    void opts
      .loadThread(threadId)
      .then((t) => renderThreadItems(t))
      .catch(() => {
        /* a missed refresh just means the old manual reload */
      });
  });

  return {
    open,
    close,
    toggle,
    registerRenderer,
    destroy() {
      // FIRST: cut the in-flight turn loose. Everything below tears down the
      // DOM it would otherwise keep writing to.
      alive.abort();
      offAiChange();
      if (opts.openEventName) {
        window.removeEventListener(opts.openEventName, onOpenEvent);
      }
      window.removeEventListener("resize", onResize);
      unbindKeyboard();
      clearRich();
      teardownFrame();
      bubble.remove();
      panel.remove();
    },
  };
}

/** Parse one stream line — tolerates `data: ` SSE prefix and bare NDJSON. */
function parseLine(line: string): StreamFrame | null {
  if (!line) return null;
  let json = line;
  if (json.startsWith("data:")) json = json.slice(5).trim();
  if (!json || json === "[DONE]") return null;
  try {
    return JSON.parse(json) as StreamFrame;
  } catch {
    return null;
  }
}

function el(tag: string, cls: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = cls;
  return node;
}

/** Coarse "when" bucket for grouping past conversations (Today / Yesterday / …). */
/** Relative-time group for a timestamp — returns a WIDGET_LABELS key so the
 *  caller resolves the localized separator text via L(). */
function relBucket(
  iso: string
):
  | "bucketToday"
  | "bucketYesterday"
  | "bucketWeek"
  | "bucketMonth"
  | "bucketOlder" {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "bucketOlder";
  const now = new Date();
  const startToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  ).getTime();
  const day = 86_400_000;
  const t = d.getTime();
  if (t >= startToday) return "bucketToday";
  if (t >= startToday - day) return "bucketYesterday";
  if (t >= startToday - 6 * day) return "bucketWeek";
  if (t >= startToday - 29 * day) return "bucketMonth";
  return "bucketOlder";
}

/** Short relative label, e.g. "3h ago", "2w ago" — falls back to a date. */
function relTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const diff = Date.now() - d.getTime();
  const min = 60_000;
  const hr = 3_600_000;
  const day = 86_400_000;
  const wk = 7 * day;
  if (diff < hr) return `${Math.max(1, Math.floor(diff / min))}m ago`;
  if (diff < day) return `${Math.floor(diff / hr)}h ago`;
  if (diff < wk) return `${Math.floor(diff / day)}d ago`;
  if (diff < 30 * day) return `${Math.floor(diff / wk)}w ago`;
  return d.toLocaleDateString();
}

/** Hide raw markdown control marks from a streamed chunk so the user reads clean
 *  text WHILE the bot types (the real markdown renders once at the end). Light +
 *  per-chunk — it only needs to look clean for the moment it streams. */
function maskMarkdown(s: string): string {
  return s
    .replace(/`+/g, "") // code ticks
    .replace(/[*~]/g, "") // bold / italic / strike markers
    .replace(/^#{1,6}\s*/gm, "") // heading hashes
    .replace(/^\s{0,3}>\s?/gm, "") // blockquote
    .replace(/\|/g, " "); // table pipes
}

/** Escape text for the few places we build innerHTML (nav button label). */
function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c] as string
  );
}

/** Wrap a bare HTML fragment in a minimal document so a preview always renders
 *  sanely; a full document is used as-is. Mirrors @sgiant/ui's AiPlayground. */
function wrapPreviewHtml(html: string): string {
  const s = (html ?? "").trim();
  if (/<!doctype|<html[\s>]/i.test(s)) return s;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>*{box-sizing:border-box}body{margin:0;padding:16px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#0f172a}</style></head><body>${s}</body></html>`;
}

function addMsg(
  log: HTMLElement,
  role: "user" | "assistant",
  text: string,
  attachments?: { kind: string; filename: string; contentType: string }[]
): HTMLElement {
  // Attachment chips render as their own row above the text bubble so a
  // file-only turn (no text) still shows what the user sent.
  if (attachments && attachments.length) {
    const chips = el("div", `${PREFIX}-atts ${PREFIX}-${role}`);
    for (const a of attachments) {
      const chip = el("span", `${PREFIX}-att`);
      chip.title = `${a.filename} (${a.contentType})`;
      chip.textContent = `${a.kind === "image" ? "🖼" : "📄"} ${a.filename}`;
      chips.appendChild(chip);
    }
    log.appendChild(chips);
  }
  const msg = el("div", `${PREFIX}-msg ${PREFIX}-${role}`);
  msg.textContent = text;
  if (!text && attachments && attachments.length) msg.style.display = "none";
  log.appendChild(msg);
  return msg;
}

let stylesInjected = false;
/**
 * Does the page around us define the PLATFORM's control variables?
 *
 * When the widget is mounted inside one of our own apps, `--input` / `--ring` /
 * `--card` / … are already on `<html>` (packages/ui/src/styles/globals.css), and
 * a text field in chat should be the same object as a text field on the page
 * behind it — same border, same focus ring, same radius, flipping together when
 * the app toggles `.dark`. When the widget is embedded on a customer's site,
 * none of that exists and it must fall back to its own `--aiw-*` palette.
 *
 * The check is deliberately shape-based, not merely presence-based: `--input`
 * is a plausible name for anyone to invent, but our tokens are HSL COMPONENTS
 * ("220 9% 85%") so they can be used with an alpha. A site whose `--input` is
 * `#fff` fails the test and we leave its page alone — the failure mode of
 * guessing wrong here is an unreadable chat form on someone else's website.
 */
function hostDefinesPlatformTokens(): boolean {
  try {
    const cs = getComputedStyle(document.documentElement);
    const hslTriplet = /^-?[\d.]+\s+[\d.]+%\s+[\d.]+%$/;
    const required = [
      "--input",
      "--ring",
      "--card",
      "--foreground",
      "--muted-foreground",
      "--primary-foreground",
    ];
    if (!required.every((v) => hslTriplet.test(cs.getPropertyValue(v).trim())))
      return false;
    return cs.getPropertyValue("--radius").trim().length > 0;
  } catch {
    // No DOM/computed style (SSR, hostile sandbox) — own palette is always safe.
    return false;
  }
}

function injectStyles(side: "left" | "right"): void {
  if (stylesInjected) return;
  stylesInjected = true;
  const css = `
/* Theme tokens — every color in this sheet reads from these. Light defaults
   here; the dark media block below only REDEFINES tokens; explicit host
   overrides (accent/gradient/theme) land INLINE on the roots and win over
   both, so a themed host is never surprised by the OS color scheme. */
.${PREFIX}-bubble,.${PREFIX}-panel{--aiw-accent:#6d28d9;--aiw-accent-contrast:#fff;--aiw-gradient:linear-gradient(135deg,var(--aiw-accent),var(--aiw-accent));--aiw-surface:#fff;--aiw-surface-raised:#fff;--aiw-surface-2:#f7f7f8;--aiw-bg:#fafafa;--aiw-text:#111;--aiw-text-2:#555;--aiw-muted:#888;--aiw-border:#e6e6e6;--aiw-border-strong:#ddd;--aiw-border-soft:#f0f0f0}
@keyframes ${PREFIX}-spin{to{transform:rotate(360deg)}}
@keyframes ${PREFIX}-rise{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
@keyframes ${PREFIX}-blink{0%,80%,100%{opacity:.25;transform:translateY(0)}40%{opacity:1;transform:translateY(-3px)}}
@keyframes ${PREFIX}-richin{from{opacity:.15;transform:translateY(3px)}to{opacity:1;transform:none}}
.${PREFIX}-rich-in{animation:${PREFIX}-richin .28s cubic-bezier(.22,1,.36,1)}
@keyframes ${PREFIX}-tokin{from{opacity:0;filter:blur(5px)}to{opacity:1;filter:blur(0)}}
.${PREFIX}-tok{animation:${PREFIX}-tokin .34s ease forwards}
.${PREFIX}-activity{align-self:flex-start;display:inline-flex;align-items:center;gap:7px;max-width:92%;border:1px solid color-mix(in srgb,var(--aiw-accent) 15%,transparent);background:color-mix(in srgb,var(--aiw-accent) 5%,transparent);border-radius:10px;padding:5px 10px;font-size:12px;font-weight:500;animation:${PREFIX}-rise .2s ease}
.${PREFIX}-activity-done{opacity:.72}
.${PREFIX}-act-label{color:var(--aiw-text-2)}
.${PREFIX}-act-agent{flex:0 0 auto;font-size:10px;font-weight:700;letter-spacing:.3px;text-transform:uppercase;color:var(--aiw-accent);background:color-mix(in srgb,var(--aiw-accent) 12%,transparent);border:1px solid color-mix(in srgb,var(--aiw-accent) 24%,transparent);border-radius:6px;padding:1px 6px}
.${PREFIX}-act-model{flex:0 0 auto;font-size:9.5px;font-weight:600;letter-spacing:.2px;color:var(--aiw-muted);background:#9aa0a614;border:1px solid #9aa0a630;border-radius:6px;padding:1px 5px;font-variant-numeric:tabular-nums}
.${PREFIX}-act-spin{width:11px;height:11px;flex:0 0 auto;border-radius:50%;border:2px solid color-mix(in srgb,var(--aiw-accent) 27%,transparent);border-top-color:var(--aiw-accent);animation:${PREFIX}-spin .7s linear infinite}
.${PREFIX}-act-ok{color:#10b981;font-weight:700}
.${PREFIX}-act-x{color:#ef4444;font-weight:700}
.${PREFIX}-job{align-self:flex-start;display:flex;flex-direction:column;gap:6px;max-width:92%;min-width:min(260px,100%);border:1px solid color-mix(in srgb,var(--aiw-accent) 18%,transparent);background:color-mix(in srgb,var(--aiw-accent) 5%,transparent);border-radius:12px;padding:9px 11px;font-size:12px;animation:${PREFIX}-rise .2s ease}
.${PREFIX}-job-done{opacity:.85}
.${PREFIX}-job-failed{border-color:#e5b8b8;background:#fdf3f3}
.${PREFIX}-job-head{display:flex;align-items:center;gap:7px}
.${PREFIX}-job-title{font-weight:600;color:var(--aiw-text)}
.${PREFIX}-job-state{margin-left:auto;font-size:10px;font-weight:700;letter-spacing:.3px;text-transform:uppercase;color:var(--aiw-muted)}
.${PREFIX}-job-counts{color:var(--aiw-text-2);font-variant-numeric:tabular-nums}
.${PREFIX}-job-bar{height:4px;border-radius:3px;background:color-mix(in srgb,var(--aiw-accent) 14%,transparent);overflow:hidden}
.${PREFIX}-job-bar>i{display:block;height:100%;background:var(--aiw-accent);transition:width .4s ease}
.${PREFIX}-job-detail{color:var(--aiw-muted);font-size:11px;word-break:break-word}
.${PREFIX}-job-flow{list-style:none;margin:6px 0 0;padding:0 0 0 2px;display:flex;flex-direction:column;gap:3px}
.${PREFIX}-job-ev{position:relative;padding-left:12px;color:var(--aiw-text-2);font-size:11px;line-height:1.35;word-break:break-word}
.${PREFIX}-job-ev::before{content:"";position:absolute;left:0;top:6px;width:5px;height:5px;border-radius:50%;background:var(--aiw-muted)}
.${PREFIX}-job-ev-decision{color:var(--aiw-text)}
.${PREFIX}-job-ev-decision::before{background:var(--aiw-accent,currentColor)}
.${PREFIX}-job-ev-problem{color:#e5484d}
.${PREFIX}-job-ev-problem::before{background:#e5484d}
.${PREFIX}-job-flow-all{margin-top:4px}
.${PREFIX}-job-flow-all>summary{cursor:pointer;color:var(--aiw-muted);font-size:11px;user-select:none}
.${PREFIX}-replay-note{align-self:flex-start;display:inline-flex;align-items:center;border:1px dashed var(--aiw-border-strong);border-radius:9px;padding:4px 10px;font-size:12px;color:var(--aiw-muted);background:var(--aiw-bg)}
.${PREFIX}-flag-note{align-self:center;border-style:solid;border-color:#e5b8b8;color:#a23b3b;background:#fdf3f3;font-weight:600}
.${PREFIX}-flag-ok{border-color:#bfe3c8;color:#2f7d43;background:#f2fbf5}
.${PREFIX}-usage{align-self:flex-start;display:inline-flex;align-items:center;gap:6px;margin-top:-4px;padding:0 2px;font-size:10.5px;color:var(--aiw-muted);font-variant-numeric:tabular-nums}
.${PREFIX}-usage-pill{display:inline-flex;align-items:center;border:1px solid var(--aiw-border);border-radius:6px;padding:0 5px;line-height:16px}
.${PREFIX}-usage-sep{opacity:.5}
@keyframes ${PREFIX}-pulse{0%{box-shadow:0 0 0 0 rgba(96,199,200,.5)}70%{box-shadow:0 0 0 12px rgba(96,199,200,0)}100%{box-shadow:0 0 0 0 rgba(96,199,200,0)}}
@keyframes ${PREFIX}-float{0%,100%{transform:translateY(0)}50%{transform:translateY(-2.5px)}}
@keyframes ${PREFIX}-blink2{0%,90%,100%{transform:scaleY(1)}95%{transform:scaleY(.12)}}
.${PREFIX}-ayca{display:block;width:100%;height:100%;overflow:visible;animation:${PREFIX}-float 4s ease-in-out infinite;filter:drop-shadow(0 5px 14px rgba(250,113,45,.5))}
.${PREFIX}-eyes{transform-origin:24px 23px;animation:${PREFIX}-blink2 5.5s ease-in-out infinite}
/* The collapsed launcher is a real, recognisable FAB: a circular surface chip
   with a soft shadow and a hairline ring, the animated mascot centred inside.
   Without the chip the mascot floated as a formless gradient blob that did not
   read as "a chat" at all — the reported "I can't see any chatbox" (#88): the
   widget was mounted and working, just invisible as an affordance. */
.${PREFIX}-bubble{position:fixed;bottom:18px;${side}:18px;z-index:2147483000;width:64px;height:64px;border:2px solid transparent;border-radius:50%;background:linear-gradient(var(--aiw-surface-raised),var(--aiw-surface-raised)) padding-box,var(--aiw-gradient) border-box;color:var(--aiw-accent-contrast);cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;box-shadow:0 10px 26px rgba(0,0,0,.32),0 2px 8px rgba(0,0,0,.18);transition:transform .2s ease,box-shadow .2s ease}
.${PREFIX}-bubble:hover{transform:translateY(-2px) scale(1.06);box-shadow:0 14px 32px rgba(0,0,0,.4),0 3px 10px rgba(0,0,0,.2)}
.${PREFIX}-bubble-av{position:relative;width:100%;height:100%;display:flex;align-items:center;justify-content:center}
.${PREFIX}-bubble .${PREFIX}-ayca{width:54px;height:54px}
.${PREFIX}-av-img{width:100%;height:100%;object-fit:cover;border-radius:50%}
.${PREFIX}-bubble svg{width:26px;height:26px}
.${PREFIX}-panel{position:fixed;bottom:20px;${side}:20px;z-index:2147483000;width:368px;max-width:calc(100vw - 32px);height:540px;max-height:calc(100vh - 40px);background:var(--aiw-surface);color:var(--aiw-text);border-radius:18px;box-shadow:0 18px 52px rgba(0,0,0,.32);display:flex;flex-direction:column;overflow:hidden;font-family:system-ui,-apple-system,sans-serif;animation:${PREFIX}-rise .22s ease;transition:width .32s cubic-bezier(.22,1,.36,1),height .32s cubic-bezier(.22,1,.36,1)}
.${PREFIX}-header{background:var(--aiw-gradient);color:var(--aiw-accent-contrast);padding:12px 14px;display:flex;align-items:center;gap:10px}
/* Drag-to-reposition. touch-action:none is what makes this work on a
   touchscreen — without it the browser claims the gesture as a scroll and the
   panel never moves. user-select:none stops the title being selected mid-drag. */
/* Question card — the assistant asking the human to decide. Visually distinct
   from a proposal card: this one BLOCKS progress until answered, so it should
   read as something needing you, not as another message. */
.${PREFIX}-question{margin:8px 0;padding:12px;border-radius:12px;background:var(--aiw-surface-raised);border:1px solid var(--aiw-border);animation:${PREFIX}-rise .18s ease}
.${PREFIX}-question-critical{border-color:#d93f0b;box-shadow:0 0 0 1px rgba(217,63,11,.25)}
.${PREFIX}-question-title{font-size:14px;font-weight:600;margin-bottom:4px;color:var(--aiw-text)}
.${PREFIX}-question-ctx{font-size:12px;color:var(--aiw-muted);margin-bottom:8px;line-height:1.45}
.${PREFIX}-question-opts{display:flex;flex-direction:column;gap:6px}
.${PREFIX}-question-opt{display:flex;flex-direction:column;gap:2px;text-align:left;padding:9px 11px;border-radius:9px;border:1px solid var(--aiw-border);background:var(--aiw-surface);color:var(--aiw-text);cursor:pointer;font:inherit;transition:border-color .14s ease,background .14s ease}
.${PREFIX}-question-opt:hover{border-color:var(--aiw-accent);background:var(--aiw-surface-raised)}
.${PREFIX}-question-opt-on{border-color:var(--aiw-accent);background:var(--aiw-surface-raised)}
.${PREFIX}-question-opt-label{font-size:13px;font-weight:600}
.${PREFIX}-question-opt-desc{font-size:12px;color:var(--aiw-muted);line-height:1.4}
.${PREFIX}-question-free{display:flex;gap:6px;margin-top:2px}
.${PREFIX}-question-input{flex:1 1 auto;min-width:0;padding:9px 11px;border-radius:9px;border:1px solid var(--aiw-border);background:var(--aiw-surface);color:var(--aiw-text);font:inherit;font-size:13px}
.${PREFIX}-question-send{padding:9px 14px;border-radius:9px;border:none;background:var(--aiw-accent);color:var(--aiw-accent-contrast);font:inherit;font-size:13px;font-weight:600;cursor:pointer;margin-top:6px}
/* A multi-select confirm with nothing picked has nothing to send — it says so
   rather than looking clickable and doing nothing. */
.${PREFIX}-question-send:disabled{opacity:.5;cursor:not-allowed}
.${PREFIX}-question-err{margin-top:8px;font-size:12px;line-height:1.45;color:#d93f0b}
/* Answered: collapsed to the decision, so the transcript reads as a
   conversation rather than a dead form. */
.${PREFIX}-question-done{border-style:dashed;opacity:.75}
.${PREFIX}-question-answer{font-size:13px;color:var(--aiw-text-2)}
.${PREFIX}-question-answer::before{content:"✓ ";color:var(--aiw-accent)}
.${PREFIX}-draggable{cursor:grab;touch-action:none;user-select:none;-webkit-user-select:none}
.${PREFIX}-draggable:active{cursor:grabbing}
/* Controls inside the header keep normal behaviour — the drag handler ignores
   them, and this keeps the cursor honest about that. */
.${PREFIX}-draggable button,.${PREFIX}-draggable a{cursor:pointer;touch-action:auto}
/* Advanced view is a fixed edge-to-edge layout — dragging is disabled there
   (the pointerdown handler bails), so drop the grab affordance too. */
.${PREFIX}-advanced .${PREFIX}-draggable{cursor:default}
.${PREFIX}-avatar{position:relative;width:38px;height:38px;flex:0 0 auto;display:flex;align-items:center;justify-content:center;border-radius:50%;background:rgba(12,17,30,.55)}
.${PREFIX}-avatar .${PREFIX}-ayca{width:34px;height:34px}
.${PREFIX}-hname{display:flex;flex-direction:column;line-height:1.15;min-width:0;flex:1 1 auto}
.${PREFIX}-title{font-weight:700;font-size:15px;letter-spacing:.04em}
.${PREFIX}-sub{font-size:11px;opacity:.85}
.${PREFIX}-metachip{align-self:flex-start;margin-top:3px;font-size:9.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;padding:1px 6px;border-radius:6px;background:rgba(255,255,255,.22);color:var(--aiw-accent-contrast);white-space:nowrap;max-width:100%;overflow:hidden;text-overflow:ellipsis}
.${PREFIX}-close{background:rgba(255,255,255,.15);border:none;color:var(--aiw-accent-contrast);font-size:18px;line-height:1;width:26px;height:26px;border-radius:8px;cursor:pointer;flex:0 0 auto}
.${PREFIX}-log{flex:1 1 auto;min-height:0;overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;padding:14px;display:flex;flex-direction:column;gap:10px;background:var(--aiw-bg);scrollbar-width:thin}
.${PREFIX}-log:focus-visible{outline:none}
.${PREFIX}-log::-webkit-scrollbar{width:8px}
.${PREFIX}-log::-webkit-scrollbar-thumb{background:rgba(0,0,0,.18);border-radius:8px}
@keyframes ${PREFIX}-caret{0%,55%{opacity:.85}55.01%,100%{opacity:0}}
.${PREFIX}-streaming::after{content:"";display:inline-block;width:2px;height:1.05em;margin-left:1px;border-radius:1px;background:var(--aiw-accent);vertical-align:-2px;animation:${PREFIX}-caret 1.1s steps(1) infinite}
.${PREFIX}-msg{max-width:85%;padding:9px 12px;border-radius:14px;font-size:14px;line-height:1.45;white-space:pre-wrap;word-break:break-word;animation:${PREFIX}-rise .2s ease}
.${PREFIX}-msg.${PREFIX}-user{align-self:flex-end;background:color-mix(in srgb,var(--aiw-accent) 76%,#04191b);color:#fff;border-bottom-right-radius:4px}
.${PREFIX}-assistant{align-self:flex-start;background:var(--aiw-surface-raised);color:var(--aiw-text);border:1px solid var(--aiw-border);border-bottom-left-radius:4px}
.${PREFIX}-assistant p{margin:0 0 8px}.${PREFIX}-assistant>:last-child{margin-bottom:0}
.${PREFIX}-assistant h1,.${PREFIX}-assistant h2,.${PREFIX}-assistant h3,.${PREFIX}-assistant h4{margin:10px 0 6px;font-weight:700;line-height:1.25}
.${PREFIX}-assistant h1{font-size:17px}.${PREFIX}-assistant h2{font-size:16px}.${PREFIX}-assistant h3{font-size:14.5px}.${PREFIX}-assistant h4{font-size:13.5px}
.${PREFIX}-assistant ul,.${PREFIX}-assistant ol{margin:6px 0;padding-left:20px}
.${PREFIX}-assistant li{line-height:1.45;margin:2px 0}
.${PREFIX}-assistant a{color:var(--aiw-accent);text-decoration:underline;text-underline-offset:2px}
.${PREFIX}-assistant code{background:rgba(0,0,0,.06);border-radius:5px;padding:1px 5px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px}
.${PREFIX}-assistant pre.md-pre{background:#0d1117;color:#e6edf3;border-radius:10px;padding:10px 12px;overflow:auto;margin:8px 0}
.${PREFIX}-assistant pre.md-pre code{background:none;padding:0;color:inherit;font-size:12px;white-space:pre}
.${PREFIX}-assistant blockquote{margin:8px 0;padding:2px 12px;border-left:3px solid color-mix(in srgb,var(--aiw-accent) 40%,transparent);color:var(--aiw-text-2)}
.${PREFIX}-assistant hr{border:none;border-top:1px solid var(--aiw-border);margin:10px 0}
.${PREFIX}-assistant table.md-table{width:100%;border-collapse:collapse;font-size:12.5px;margin:8px 0}
.${PREFIX}-assistant table.md-table th{text-align:left;font-weight:700;color:var(--aiw-text-2);border-bottom:1px solid var(--aiw-border);padding:5px 8px}
.${PREFIX}-assistant table.md-table td{border-bottom:1px solid var(--aiw-border-soft);padding:5px 8px}
.${PREFIX}-assistant strong{font-weight:700}.${PREFIX}-assistant del{opacity:.7}
.${PREFIX}-widget-host{padding:8px}
.${PREFIX}-typing{align-self:flex-start;display:flex;gap:4px;padding:10px 12px}
.${PREFIX}-typing span{width:7px;height:7px;border-radius:50%;background:var(--aiw-accent);animation:${PREFIX}-blink 1.2s infinite}
.${PREFIX}-typing span:nth-child(2){animation-delay:.2s}
.${PREFIX}-typing span:nth-child(3){animation-delay:.4s}
.${PREFIX}-error{align-self:stretch;border:1px solid #f3c5b6;background:#fff6f2;border-radius:14px;padding:11px 12px;animation:${PREFIX}-rise .2s ease}
.${PREFIX}-error-text{font-size:13px;font-weight:600;color:#b23b18}
.${PREFIX}-error-detail{font-size:11px;color:#9a6b5c;margin-top:3px;word-break:break-word}
.${PREFIX}-error-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:9px}
.${PREFIX}-error-btn{border:1px solid #e3b9a8;background:var(--aiw-surface);color:#a33;border-radius:9px;padding:6px 12px;font-size:12px;font-weight:600;cursor:pointer}
.${PREFIX}-error-retry{background:var(--aiw-accent);border-color:var(--aiw-accent);color:var(--aiw-accent-contrast)}
.${PREFIX}-error-btn:disabled{opacity:.6;cursor:default}
.${PREFIX}-suggestions{display:flex;flex-wrap:wrap;gap:6px;padding:8px 10px 0;background:var(--aiw-surface)}
.${PREFIX}-suggestion{border:1px solid color-mix(in srgb,var(--aiw-accent) 20%,transparent);background:color-mix(in srgb,var(--aiw-accent) 5%,transparent);color:var(--aiw-accent);border-radius:999px;padding:6px 11px;font-size:12.5px;font-weight:500;line-height:1.2;cursor:pointer;transition:background .15s ease,border-color .15s ease;text-align:left}
.${PREFIX}-suggestion:hover{background:color-mix(in srgb,var(--aiw-accent) 10%,transparent);border-color:color-mix(in srgb,var(--aiw-accent) 40%,transparent)}
.${PREFIX}-form{display:flex;gap:8px;padding:10px;border-top:1px solid var(--aiw-border);background:var(--aiw-surface)}
.${PREFIX}-input{flex:1;background:var(--aiw-surface);color:var(--aiw-text);border:1px solid var(--aiw-border-strong);border-radius:11px;padding:10px 12px;font-size:14px;outline:none}
.${PREFIX}-meter{padding:7px 12px 0;background:var(--aiw-surface)}
.${PREFIX}-meter-bar{height:4px;border-radius:999px;background:var(--aiw-surface-2);overflow:hidden}
.${PREFIX}-meter-bar>span{display:block;height:100%;border-radius:999px;background:linear-gradient(90deg,var(--aiw-accent),#FBAA34);transition:width .3s ease}
.${PREFIX}-meter-row{display:flex;justify-content:space-between;gap:8px;margin-top:3px;font-size:10.5px;color:var(--aiw-muted)}
.${PREFIX}-status{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:7px 12px;font-size:11px;background:var(--aiw-surface);border-top:1px solid var(--aiw-border-soft)}
.${PREFIX}-status-role{display:inline-flex;align-items:center;padding:2px 8px;border-radius:999px;font-weight:600;color:var(--aiw-accent);background:color-mix(in srgb,var(--aiw-accent) 10%,transparent)}
.${PREFIX}-status-credits{font-weight:600;color:var(--aiw-text-2);font-variant-numeric:tabular-nums}
.${PREFIX}-status-credits-val{display:inline-block;transition:color .2s ease}
.${PREFIX}-credits-live{color:var(--aiw-accent)}
.${PREFIX}-cta{display:flex;justify-content:center;padding:6px 0 2px}
.${PREFIX}-cta-btn{display:inline-flex;align-items:center;justify-content:center;border-radius:999px;padding:9px 18px;font-size:13px;font-weight:600;color:var(--aiw-accent-contrast);text-decoration:none;background:linear-gradient(90deg,var(--aiw-accent),#FBAA34);box-shadow:0 4px 14px color-mix(in srgb,var(--aiw-accent) 25%,transparent)}
.${PREFIX}-lead{align-self:stretch;border:1px solid var(--aiw-border);border-radius:14px;padding:11px 12px;background:var(--aiw-surface-raised);animation:${PREFIX}-rise .2s ease}
.${PREFIX}-form-title{font-size:13px;font-weight:600;margin-bottom:8px}
.${PREFIX}-lead-form{display:flex;flex-direction:column;gap:8px}
/* ── Form controls ───────────────────────────────────────────────────────
   Everything the chat can draw as an input goes through ONE token layer
   (--aiw-field-*) instead of its own hexes and radii, and that layer is
   remapped below to the platform's semantic control variables when the host
   page has them. The geometry (40px tall, 12px inline padding, 14px text, a
   recessed inner shadow, a 2px focus ring) MIRRORS packages/ui/src/components/
   input.tsx — the widget is vanilla DOM in a detached root and cannot import
   the React primitive, so the numbers are copied deliberately; that file is the
   source of truth if they ever move. */
.${PREFIX}-bubble,.${PREFIX}-panel{--aiw-field-bg:var(--aiw-surface);--aiw-field-fg:var(--aiw-text);--aiw-field-border:var(--aiw-border-strong);--aiw-field-placeholder:var(--aiw-muted);--aiw-field-ring:var(--aiw-accent);--aiw-field-ring-fg:var(--aiw-accent-contrast);--aiw-field-radius:10px}
/* Host-token mode. Added at mount only when the page really defines our
   variables, so a customer site that happens to own an --input cannot repaint
   the chat's controls. Values stay as var() references, never snapshots, so the
   app's dark-mode class keeps driving them after mount. */
.${PREFIX}-bubble.${PREFIX}-host-tokens,.${PREFIX}-panel.${PREFIX}-host-tokens{--aiw-field-bg:hsl(var(--card));--aiw-field-fg:hsl(var(--foreground));--aiw-field-border:hsl(var(--input));--aiw-field-placeholder:hsl(var(--muted-foreground));--aiw-field-ring:hsl(var(--ring));--aiw-field-ring-fg:hsl(var(--primary-foreground));--aiw-field-radius:calc(var(--radius) - 2px)}
.${PREFIX}-field{width:100%;box-sizing:border-box;min-height:40px;padding:8px 12px;font-family:inherit;font-size:14px;line-height:1.45;color:var(--aiw-field-fg);background:var(--aiw-field-bg);border:1px solid var(--aiw-field-border);border-radius:var(--aiw-field-radius);outline:none;box-shadow:inset 0 1px 2px 0 color-mix(in srgb,var(--aiw-field-fg) 5%,transparent);transition:border-color .15s ease,box-shadow .15s ease}
.${PREFIX}-field::placeholder{color:var(--aiw-field-placeholder);opacity:1}
.${PREFIX}-field:hover:not(:disabled){border-color:color-mix(in srgb,var(--aiw-field-border) 70%,var(--aiw-field-fg))}
.${PREFIX}-field:focus{border-color:var(--aiw-field-ring);box-shadow:0 0 0 2px var(--aiw-field-ring)}
.${PREFIX}-field:disabled{opacity:.5;cursor:not-allowed}
textarea.${PREFIX}-field{min-height:76px;resize:vertical}
/* The native select arrow is drawn by the OS and ignores our palette — in dark
   mode it renders a black-on-dark wedge. Draw our own instead. */
select.${PREFIX}-field{appearance:none;-webkit-appearance:none;cursor:pointer;padding-right:32px;background-image:url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%239aa0a6' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 10px center;background-size:15px}
/* Options are drawn by the OS popup, which does NOT inherit the panel — without
   this a dark-mode select opens as black text on a black list. */
.${PREFIX}-field option{background:var(--aiw-field-bg);color:var(--aiw-field-fg)}
.${PREFIX}-field-group{display:flex;flex-direction:column;gap:6px}
/* "This is the field that's holding you up." An outline rather than a border so
   it lands the same on a bare input, a checkbox row and a radio GROUP — the
   three shapes buildField can hand back. */
.${PREFIX}-field-invalid{outline:1px solid #d93f0b;outline-offset:2px;border-radius:var(--aiw-field-radius)}
.${PREFIX}-form-err,.${PREFIX}-proposal-err{font-size:12.5px;line-height:1.45;color:#d93f0b}
.${PREFIX}-field-check{display:flex;align-items:center;gap:8px;font-size:13.5px;line-height:1.4;color:var(--aiw-field-fg);cursor:pointer}
.${PREFIX}-field-check-label{min-width:0}
.${PREFIX}-check{appearance:none;-webkit-appearance:none;position:relative;flex:0 0 auto;width:16px;height:16px;margin:0;box-sizing:border-box;background:var(--aiw-field-bg);border:1px solid var(--aiw-field-border);border-radius:4px;cursor:pointer;outline:none;transition:background .15s ease,border-color .15s ease,box-shadow .15s ease}
.${PREFIX}-check[type=radio]{border-radius:50%}
.${PREFIX}-check:hover:not(:disabled){border-color:color-mix(in srgb,var(--aiw-field-border) 70%,var(--aiw-field-fg))}
.${PREFIX}-check:focus-visible{border-color:var(--aiw-field-ring);box-shadow:0 0 0 2px var(--aiw-field-ring)}
.${PREFIX}-check:checked{background:var(--aiw-field-ring);border-color:var(--aiw-field-ring)}
/* Tick + dot are drawn from borders rather than a glyph so they scale with the
   box and take the accent's contrast colour in both schemes. */
.${PREFIX}-check[type=checkbox]:checked::after{content:"";position:absolute;left:4.5px;top:1.5px;width:4px;height:8px;border:solid var(--aiw-field-ring-fg);border-width:0 2px 2px 0;transform:rotate(45deg)}
.${PREFIX}-check[type=radio]:checked::after{content:"";position:absolute;left:3.5px;top:3.5px;width:7px;height:7px;border-radius:50%;background:var(--aiw-field-ring-fg)}
.${PREFIX}-check:disabled{opacity:.5;cursor:not-allowed}
.${PREFIX}-lead-btn{border:none;background:var(--aiw-accent);color:var(--aiw-accent-contrast);border-radius:11px;padding:10px 16px;font-size:14px;font-weight:600;cursor:pointer}
.${PREFIX}-lead-btn:disabled{opacity:.6;cursor:default}
.${PREFIX}-lead-ok{font-size:13px;font-weight:600;color:var(--aiw-accent)}
.${PREFIX}-input:focus{border-color:var(--aiw-accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--aiw-accent) 13%,transparent)}
.${PREFIX}-send{border:none;background:var(--aiw-accent);color:var(--aiw-accent-contrast);border-radius:11px;padding:0 16px;font-size:14px;font-weight:600;cursor:pointer}
.${PREFIX}-send:disabled{opacity:.5;cursor:default}
.${PREFIX}-attach{flex:0 0 auto;display:flex;align-items:center;justify-content:center;border:1px solid var(--aiw-border-strong);background:var(--aiw-surface);border-radius:11px;width:38px;line-height:1;cursor:pointer;color:var(--aiw-text-2);transition:border-color .12s,color .12s,background .12s}
.${PREFIX}-attach:hover{border-color:var(--aiw-accent);color:var(--aiw-accent)}
.${PREFIX}-attach:disabled{opacity:.5;cursor:default}
.${PREFIX}-attbar{display:flex;flex-wrap:wrap;gap:6px;padding:8px 10px 0;background:var(--aiw-surface)}
.${PREFIX}-artifacts{display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:6px 10px 0;background:var(--aiw-surface)}
.${PREFIX}-artifacts-title{font-size:11px;font-weight:600;color:var(--aiw-muted)}
.${PREFIX}-artifact{display:inline-flex;align-items:center;gap:6px;max-width:200px;border:1px solid var(--aiw-border);background:var(--aiw-surface-2);border-radius:9px;padding:3px 8px;font-size:11px;color:var(--aiw-text-2);white-space:nowrap}
.${PREFIX}-artifact-name{overflow:hidden;text-overflow:ellipsis;max-width:130px}
.${PREFIX}-artifact-save{border:none;background:transparent;color:#0b6cff;font-size:11px;font-weight:600;cursor:pointer;padding:0}
.${PREFIX}-artifact-save:disabled{color:var(--aiw-muted);cursor:default}
.${PREFIX}-att{display:inline-flex;align-items:center;gap:5px;max-width:180px;border:1px solid var(--aiw-border);background:var(--aiw-surface-2);border-radius:9px;padding:3px 8px;font-size:12px;color:var(--aiw-text-2);white-space:nowrap}
.${PREFIX}-att>span{overflow:hidden;text-overflow:ellipsis}
.${PREFIX}-atts{display:flex;flex-wrap:wrap;gap:6px;max-width:92%}
.${PREFIX}-atts.${PREFIX}-user{align-self:flex-end;justify-content:flex-end}
.${PREFIX}-att-x{border:none;background:transparent;color:var(--aiw-muted);font-size:15px;line-height:1;cursor:pointer;padding:0 0 0 2px}
.${PREFIX}-att-x:hover{color:#e11}
.${PREFIX}-att-err{border-color:#e9c2c2;background:#fdf3f3;color:#a23b3b}
.${PREFIX}-msgactions{display:inline-flex;align-items:center;gap:6px;margin-top:3px;color:var(--aiw-muted);opacity:.55;transition:opacity .15s ease}
.${PREFIX}-msgactions:hover,.${PREFIX}-msgactions:focus-within{opacity:1}
/* User edit sits at the message's bottom-RIGHT, hugging the bubble edge, and is
   HIDDEN until the user hovers their message (or the row/button itself) — an
   always-visible bordered pencil floating under every user turn read as a stray
   box. Its row is the immediate next sibling of the user bubble, so a hover-plus
   sibling selector reveals it; the row's own :hover/:focus-within keeps it up
   while you reach the
   button across the small gap. Higher specificity than the base .msgactions:hover
   rule so it wins the cascade. */
.${PREFIX}-msgactions.${PREFIX}-user{align-self:flex-end;justify-content:flex-end;padding-right:2px;opacity:0}
.${PREFIX}-msg.${PREFIX}-user:hover + .${PREFIX}-msgactions.${PREFIX}-user,.${PREFIX}-msgactions.${PREFIX}-user:hover,.${PREFIX}-msgactions.${PREFIX}-user:focus-within{opacity:1}
.${PREFIX}-msgactions.${PREFIX}-assistant{align-self:flex-start}
.${PREFIX}-msgact{display:inline-flex;align-items:center;gap:4px;border:none;background:transparent;color:inherit;border-radius:6px;padding:2px 5px;font-size:11px;font-weight:500;cursor:pointer;line-height:1}
.${PREFIX}-msgact:hover{color:var(--aiw-accent);background:color-mix(in srgb,var(--aiw-accent) 7%,transparent)}
/* Icon-only variant (edit) — a small, quiet chip (subtle surface + border) that
   is revealed on message hover, then tints ACCENT (not a hard white-on-accent
   fill) on its own hover so it reads as an affordance, not a loud button. */
.${PREFIX}-msgact-icon{padding:5px;border-radius:8px;color:var(--aiw-muted);background:color-mix(in srgb,var(--aiw-surface) 92%,transparent);border:1px solid var(--aiw-border);transition:color .15s ease,background .15s ease,border-color .15s ease}
.${PREFIX}-msgact-icon:hover{color:var(--aiw-accent);background:color-mix(in srgb,var(--aiw-accent) 12%,transparent);border-color:color-mix(in srgb,var(--aiw-accent) 45%,transparent)}
.${PREFIX}-msgact-icon svg{width:15px;height:15px}
/* Per-message vote (thumbs) — light icon buttons; the chosen vote stays lit. */
.${PREFIX}-votes{display:inline-flex;align-items:center;gap:2px}
.${PREFIX}-vote{padding:3px;border-radius:6px;color:var(--aiw-muted);background:transparent}
.${PREFIX}-vote:hover{color:var(--aiw-accent);background:color-mix(in srgb,var(--aiw-accent) 10%,transparent)}
.${PREFIX}-vote-on{color:var(--aiw-accent)}
.${PREFIX}-vote svg{width:14px;height:14px;display:block}
.${PREFIX}-branchnav{display:inline-flex;align-items:center;gap:2px;color:inherit;font-variant-numeric:tabular-nums}
.${PREFIX}-branch-btn{display:inline-flex;align-items:center;justify-content:center;border:none;background:transparent;color:inherit;border-radius:6px;padding:2px;cursor:pointer;line-height:1}
.${PREFIX}-branch-btn:hover:not(:disabled){color:var(--aiw-accent)}
.${PREFIX}-branch-btn:disabled{opacity:.35;cursor:default}
.${PREFIX}-branch-count{font-size:11px;padding:0 2px}
.${PREFIX}-edit{display:flex;flex-direction:column;gap:6px;max-width:94%;animation:${PREFIX}-rise .2s ease}
.${PREFIX}-edit.${PREFIX}-user{align-self:stretch}
/* Edit mode keeps the USER BUBBLE look (same fill + radius), so clicking edit
   doesn't swap the message for a different-looking box — just a subtle focus
   ring, matching the inline-edit request. */
.${PREFIX}-edit-input{width:100%;background:color-mix(in srgb,var(--aiw-accent) 76%,#04191b);color:#fff;caret-color:#fff;box-sizing:border-box;border:1.5px solid transparent;border-radius:14px;padding:9px 12px;font-size:14px;line-height:1.45;font-family:inherit;resize:none;outline:none;transition:border-color .15s ease,box-shadow .15s ease}
.${PREFIX}-edit-input::placeholder{color:rgba(255,255,255,.6)}
.${PREFIX}-edit-input:focus{border-color:rgba(255,255,255,.55);box-shadow:0 0 0 3px color-mix(in srgb,var(--aiw-accent) 28%,transparent)}
.${PREFIX}-edit-actions{display:flex;justify-content:flex-end;gap:6px}
.${PREFIX}-edit-cancel{border:none;background:transparent;color:var(--aiw-muted);border-radius:999px;padding:5px 11px;font-size:12px;font-weight:600;cursor:pointer}
.${PREFIX}-edit-cancel:hover{background:var(--aiw-surface-2)}
.${PREFIX}-edit-save{border:none;background:var(--aiw-accent);color:var(--aiw-accent-contrast);border-radius:999px;padding:5px 13px;font-size:12px;font-weight:600;cursor:pointer}
.${PREFIX}-edit-save:hover{opacity:.92}
.${PREFIX}-hactions{display:flex;align-items:center;gap:4px;flex:0 0 auto}
.${PREFIX}-icon{background:rgba(255,255,255,.15);border:none;color:var(--aiw-accent-contrast);width:26px;height:26px;border-radius:8px;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0}
.${PREFIX}-icon:hover{background:rgba(255,255,255,.28)}
.${PREFIX}-icon-on{background:var(--aiw-surface);color:var(--aiw-accent)}
.${PREFIX}-icon-on:hover{background:var(--aiw-surface)}
.${PREFIX}-morewrap{position:relative;display:inline-flex}
.${PREFIX}-menu{position:absolute;top:calc(100% + 8px);right:0;z-index:6;flex-direction:column;min-width:212px;padding:6px;background:var(--aiw-surface-raised);color:var(--aiw-text);border:1px solid var(--aiw-border);border-radius:12px;box-shadow:0 12px 34px rgba(15,23,42,.18);animation:${PREFIX}-rise .14s ease}
.${PREFIX}-menu::before{content:"";position:absolute;top:-5px;right:14px;width:10px;height:10px;background:var(--aiw-surface-raised);border-left:1px solid var(--aiw-border);border-top:1px solid var(--aiw-border);transform:rotate(45deg)}
.${PREFIX}-menu-item{display:flex;align-items:center;gap:10px;width:100%;text-align:left;border:none;background:transparent;color:var(--aiw-text-2);border-radius:9px;padding:9px 10px;font-size:13px;font-weight:500;cursor:pointer;line-height:1.2}
.${PREFIX}-menu-item:hover{background:color-mix(in srgb,var(--aiw-accent) 7%,transparent);color:var(--aiw-accent)}
.${PREFIX}-menu-item:disabled{opacity:.5;cursor:default}
.${PREFIX}-menu-ico{flex:0 0 auto;display:flex;align-items:center;justify-content:center;width:18px;height:18px;color:var(--aiw-text-2)}
.${PREFIX}-menu-item:hover .${PREFIX}-menu-ico,.${PREFIX}-menu-item-on .${PREFIX}-menu-ico{color:var(--aiw-accent)}
.${PREFIX}-menu-label{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.${PREFIX}-menu-state{flex:0 0 auto;font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--aiw-muted);background:var(--aiw-surface-2);border-radius:999px;padding:2px 7px}
.${PREFIX}-menu-item-on .${PREFIX}-menu-state{color:var(--aiw-accent-contrast);background:var(--aiw-accent)}
.${PREFIX}-autonav{align-self:flex-start;display:inline-flex;align-items:center;gap:7px;border:1px solid color-mix(in srgb,var(--aiw-accent) 20%,transparent);background:color-mix(in srgb,var(--aiw-accent) 6%,transparent);color:var(--aiw-accent);border-radius:11px;padding:8px 12px;font-size:13px;font-weight:600;animation:${PREFIX}-rise .2s ease}
.${PREFIX}-expanded{width:min(760px,calc(100vw - 32px));height:calc(100vh - 40px)}
.${PREFIX}-expanded .${PREFIX}-msg{max-width:75%}
/* Advanced view — chat column + drivable app pane. The chat column always wraps
   the chat (fills the panel in normal mode); the pane only shows in advanced. */
.${PREFIX}-chatcol{display:flex;flex-direction:column;flex:1 1 auto;min-height:0;min-width:0;height:100%}
.${PREFIX}-pane{display:none;flex-direction:column;min-width:0;min-height:0;background:#f4f5f7}
.${PREFIX}-advbtn-on{background:rgba(255,255,255,.34)}
/* Advanced view IS the wide view (owns the screen), so the plain "wide" toggle
   is redundant here — hide it and leave advanced/exit + close. */
.${PREFIX}-advanced .${PREFIX}-expand{display:none}
/* Fullscreen toggle only makes sense in advanced view — hidden otherwise. */
.${PREFIX}-fullbtn{display:none}
.${PREFIX}-advanced .${PREFIX}-fullbtn{display:flex}
.${PREFIX}-advanced{width:calc(100vw - 40px);max-width:1240px;height:calc(100vh - 40px);flex-direction:row;align-items:stretch}
/* Fullscreen: drop the inset margins, width cap and radius so advanced view
   fills the whole viewport edge-to-edge. Two classes → wins over .advanced. */
.${PREFIX}-advanced.${PREFIX}-advanced-full{inset:0;width:100vw;height:100vh;height:100dvh;max-width:none;max-height:none;border-radius:0}
.${PREFIX}-advanced .${PREFIX}-chatcol{flex:0 0 var(--aiw-chatw,400px);min-width:320px;border-right:1px solid var(--aiw-border)}
.${PREFIX}-advanced .${PREFIX}-pane{display:flex;flex:1 1 auto}
.${PREFIX}-advanced.${PREFIX}-pane-collapsed .${PREFIX}-chatcol{flex:1 1 auto;min-width:0;max-width:none;border-right:0}
/* Draggable divider between chat + app pane. Hidden unless advanced & expanded.
   A thin bar with a wider invisible hit-area; brightens on hover/drag. */
.${PREFIX}-resizer{display:none}
.${PREFIX}-advanced .${PREFIX}-resizer{display:block;flex:0 0 6px;align-self:stretch;cursor:col-resize;background:var(--aiw-border);touch-action:none;position:relative;transition:background .15s}
.${PREFIX}-advanced .${PREFIX}-resizer::after{content:"";position:absolute;top:0;bottom:0;left:-4px;right:-4px}
.${PREFIX}-advanced .${PREFIX}-resizer:hover,.${PREFIX}-resizing .${PREFIX}-resizer{background:var(--aiw-accent,#6366f1)}
.${PREFIX}-advanced.${PREFIX}-pane-collapsed .${PREFIX}-resizer{display:none}
/* While dragging: kill text selection + let pointer events pass over the iframe
   (an iframe would otherwise swallow the drag and drop the pointer). */
.${PREFIX}-resizing{user-select:none}
.${PREFIX}-resizing .${PREFIX}-pane-frame{pointer-events:none}
/* Collapsed: the pane shrinks to a thin strip that still shows the toggle (so it
   can be re-opened), and its url + framed body hide. */
.${PREFIX}-advanced.${PREFIX}-pane-collapsed .${PREFIX}-pane{flex:0 0 40px;min-height:0}
.${PREFIX}-pane-collapsed .${PREFIX}-pane-body{display:none}
.${PREFIX}-pane-collapsed .${PREFIX}-pane-url{display:none}
.${PREFIX}-pane-collapsed .${PREFIX}-pane-bar{padding:6px 5px}
.${PREFIX}-pane-collapsed .${PREFIX}-pane-collapse{transform:rotate(180deg)}
.${PREFIX}-pane-bar{display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid #e7e8ec;background:#eef0f3;flex:0 0 auto}
.${PREFIX}-pane-url{font-size:11.5px;color:#777;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
/* Padded gutter around the driven app so it reads as an inset "screen". */
.${PREFIX}-pane-body{flex:1 1 auto;min-width:0;min-height:0;display:flex;padding:12px}
.${PREFIX}-pane-frame{flex:1 1 auto;width:100%;border:1px solid #e6e7ea;border-radius:12px;background:var(--aiw-surface);min-height:0;box-shadow:0 1px 4px rgba(15,23,42,.07)}
/* Narrow: stack the app pane on top and the chat (with composer) below. */
@media (max-width:820px){
  .${PREFIX}-advanced{flex-direction:column-reverse}
  .${PREFIX}-advanced .${PREFIX}-chatcol{flex:1 1 auto;min-width:0;max-width:none;border-right:0;border-top:1px solid var(--aiw-border)}
  .${PREFIX}-advanced .${PREFIX}-pane{flex:1 1 auto;min-height:38%}
  /* Stacked layout: the horizontal divider doesn't apply. */
  .${PREFIX}-advanced .${PREFIX}-resizer{display:none}
  .${PREFIX}-pane-body{padding:8px}
}
@media (prefers-color-scheme:dark){
  .${PREFIX}-pane{background:#121212}
  .${PREFIX}-pane-bar{background:#1a1a1a;border-bottom-color:#262626}
  .${PREFIX}-pane-url{color:#9b9b9b}
  .${PREFIX}-pane-frame{background:#161616;border-color:#2a2a2a;box-shadow:0 1px 4px rgba(0,0,0,.4)}
  .${PREFIX}-advanced .${PREFIX}-chatcol{border-right-color:#262626}
  .${PREFIX}-advanced.${PREFIX}-pane-collapsed .${PREFIX}-chatcol{border-right:0}
}
.${PREFIX}-history{position:absolute;inset:0;background:var(--aiw-surface);display:flex;flex-direction:column;z-index:5;animation:${PREFIX}-rise .18s ease}
.${PREFIX}-history-head{display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-bottom:1px solid var(--aiw-border);font-weight:600;font-size:14px}
.${PREFIX}-history-back{border:1px solid var(--aiw-border-strong);background:var(--aiw-surface-raised);border-radius:9px;padding:5px 11px;font-size:12px;font-weight:600;cursor:pointer;color:var(--aiw-text-2)}
.${PREFIX}-history-list{flex:1 1 auto;min-height:0;overflow-y:auto;padding:8px;display:flex;flex-direction:column;gap:4px;font-size:13px;color:var(--aiw-text-2)}
.${PREFIX}-history-sep{padding:8px 4px 2px;font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--aiw-muted)}
.${PREFIX}-history-item{display:flex;align-items:center;justify-content:space-between;gap:8px;text-align:left;border:1px solid var(--aiw-border);background:var(--aiw-surface-raised);border-radius:10px;padding:10px 12px;cursor:pointer;width:100%}
.${PREFIX}-history-item:hover{border-color:var(--aiw-accent);background:color-mix(in srgb,var(--aiw-accent) 4%,transparent)}
.${PREFIX}-history-title{font-weight:600;color:var(--aiw-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.${PREFIX}-history-date{font-size:11px;color:var(--aiw-muted);flex:0 0 auto}
.${PREFIX}-history-star{font-size:15px;line-height:1;color:#cbcbcb;flex:0 0 auto;padding:0 2px;cursor:pointer}
.${PREFIX}-history-star:hover{color:#f59e0b}
.${PREFIX}-widget{align-self:stretch;border:1px solid var(--aiw-border);border-radius:14px;padding:12px;background:var(--aiw-surface-raised);animation:${PREFIX}-rise .2s ease}
.${PREFIX}-widget-title{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--aiw-muted);margin-bottom:8px}
.${PREFIX}-widget-stat{font-size:30px;font-weight:800;line-height:1.1;color:var(--aiw-text)}
.${PREFIX}-widget-cap{font-size:13px;color:var(--aiw-text-2);margin-top:2px}
.${PREFIX}-widget-delta{font-size:12px;font-weight:600;color:var(--aiw-accent);margin-top:4px}
.${PREFIX}-widget-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(90px,1fr));gap:8px}
.${PREFIX}-preview{align-self:stretch;border:1px solid var(--aiw-border);border-radius:14px;overflow:hidden;background:var(--aiw-surface);animation:${PREFIX}-rise .2s ease}
.${PREFIX}-preview-bar{display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid var(--aiw-border-soft)}
.${PREFIX}-preview-dots{display:inline-flex;gap:4px}
.${PREFIX}-preview-dots i{width:9px;height:9px;border-radius:50%;background:#e2e2e2}
.${PREFIX}-preview-dots i:nth-child(1){background:#ff5f57}
.${PREFIX}-preview-dots i:nth-child(2){background:#febc2e}
.${PREFIX}-preview-dots i:nth-child(3){background:#28c840}
.${PREFIX}-preview-title{font-size:12px;font-weight:600;color:var(--aiw-muted)}
.${PREFIX}-preview-frame{display:block;width:100%;height:340px;border:0;background:var(--aiw-surface)}
.${PREFIX}-creation-preview{display:flex;justify-content:center;border-radius:12px;overflow:hidden}
.${PREFIX}-proposal-media{display:block;width:100%;max-height:200px;object-fit:cover;border-radius:12px;border:1px solid var(--aiw-border);background:var(--aiw-surface-2)}
.${PREFIX}-proposal-media-holder{position:relative}
.${PREFIX}-proposal-media-badge{position:absolute;left:8px;bottom:8px;padding:2px 8px;border-radius:999px;background:rgba(0,0,0,.6);color:var(--aiw-accent-contrast);font-size:11px;font-weight:600}
.${PREFIX}-chips{display:flex;flex-wrap:wrap;gap:6px;margin:2px 0 10px}
.${PREFIX}-chip{padding:8px 14px;border-radius:999px;border:1px solid color-mix(in srgb,var(--aiw-accent) 35%,transparent);background:color-mix(in srgb,var(--aiw-accent) 7%,transparent);color:var(--aiw-accent);font-size:13px;font-weight:600;cursor:pointer;transition:background .12s,color .12s,border-color .12s}
.${PREFIX}-chip:hover{background:color-mix(in srgb,var(--aiw-accent) 14%,transparent)}
.${PREFIX}-chip-on,.${PREFIX}-chip-send{background:var(--aiw-accent);color:var(--aiw-accent-contrast);border-color:transparent}
.${PREFIX}-chip-send:hover{background:var(--aiw-accent)}
.${PREFIX}-chip-other{border-style:dashed;background:transparent;color:var(--aiw-muted);border-color:var(--aiw-border-strong)}
.${PREFIX}-chip:disabled{opacity:.45;cursor:default}
.${PREFIX}-kpi{border:1px solid var(--aiw-border-soft);border-radius:10px;padding:8px 10px;background:var(--aiw-bg)}
.${PREFIX}-kpi-v{font-size:18px;font-weight:700;color:var(--aiw-text)}
.${PREFIX}-kpi-l{font-size:11px;color:var(--aiw-muted);margin-top:1px}
.${PREFIX}-kpi-d{font-size:11px;font-weight:600;color:var(--aiw-accent);margin-top:2px}
.${PREFIX}-widget-table{width:100%;border-collapse:collapse;font-size:12.5px}
.${PREFIX}-widget-table th{text-align:left;font-weight:700;color:var(--aiw-text-2);border-bottom:1px solid var(--aiw-border);padding:6px 8px}
.${PREFIX}-widget-table td{border-bottom:1px solid var(--aiw-border-soft);padding:6px 8px;color:#222}
.${PREFIX}-widget-list{margin:0;padding-left:18px;font-size:13.5px;color:#222;display:flex;flex-direction:column;gap:3px}
.${PREFIX}-nav{align-self:flex-start;animation:${PREFIX}-rise .2s ease}
.${PREFIX}-nav-btn{display:inline-flex;align-items:center;gap:8px;border:1px solid var(--aiw-accent);background:color-mix(in srgb,var(--aiw-accent) 6%,transparent);color:var(--aiw-accent);border-radius:11px;padding:9px 14px;font-size:13.5px;font-weight:600;cursor:pointer}
.${PREFIX}-nav-btn:hover{background:color-mix(in srgb,var(--aiw-accent) 11%,transparent)}
.${PREFIX}-nav-btn:disabled{opacity:.7;cursor:default}
.${PREFIX}-proposal{align-self:stretch;border:1px solid color-mix(in srgb,var(--aiw-accent) 20%,transparent);background:color-mix(in srgb,var(--aiw-accent) 4%,transparent);border-radius:14px;padding:12px;display:flex;flex-direction:column;gap:8px;animation:${PREFIX}-rise .2s ease}
.${PREFIX}-proposal-title{font-size:13px;font-weight:700}
.${PREFIX}-proposal-edit{display:flex;flex-direction:column;gap:4px}
.${PREFIX}-proposal-edit-label{font-size:11.5px;font-weight:600;color:var(--aiw-text-2)}
.${PREFIX}-proposal-summary{font-size:12.5px;color:var(--aiw-text-2);white-space:pre-wrap;line-height:1.45}
.${PREFIX}-proposal-ok{font-size:13px;font-weight:600;color:#10b981;display:inline-flex;align-items:center;gap:6px}
.${PREFIX}-confirm-q{font-size:13px;color:var(--aiw-text-2);margin-bottom:8px}
.${PREFIX}-confirm-row{display:flex;gap:8px}
.${PREFIX}-confirm-no{border:1px solid var(--aiw-border-strong);background:var(--aiw-surface-raised);color:var(--aiw-text-2);border-radius:11px;padding:9px 14px;font-size:13px;font-weight:600;cursor:pointer}
@media (prefers-color-scheme:dark){.${PREFIX}-bubble,.${PREFIX}-panel{--aiw-surface:#161616;--aiw-surface-raised:#1d1d1d;--aiw-surface-2:#2c2c2c;--aiw-bg:#101010;--aiw-text:#eee;--aiw-text-2:#ddd;--aiw-muted:#9b9b9b;--aiw-border:#2a2a2a;--aiw-border-strong:#444;--aiw-border-soft:#262626}.${PREFIX}-error{background:#231613;border-color:#5a2c1d}}
@media (prefers-color-scheme:dark){.${PREFIX}-assistant code{background:rgba(255,255,255,.1)}.${PREFIX}-assistant blockquote{color:#aaa;border-left-color:color-mix(in srgb,var(--aiw-accent) 53%,transparent)}.${PREFIX}-assistant table.md-table th{color:#aaa;border-bottom-color:#2a2a2a}.${PREFIX}-assistant table.md-table td{border-bottom-color:#222}.${PREFIX}-assistant hr{border-top-color:#2a2a2a}}
@keyframes ${PREFIX}-sheetup{from{transform:translateY(100%)}to{transform:translateY(0)}}
/* On phones the panel becomes a full-width bottom sheet (slides up from the
   bottom edge, ~90% of the dynamic viewport, rounded top, grab handle) so the
   chat is comfortably usable instead of a cramped corner card. */
@media (max-width:640px){
  .${PREFIX}-panel{inset:0;width:100%;max-width:100%;height:100vh;height:100dvh;max-height:none;border-radius:0;animation:${PREFIX}-sheetup .3s cubic-bezier(.22,1,.36,1);transition:none}
  .${PREFIX}-expanded{width:100%;max-width:100%;height:100vh;height:100dvh}
  .${PREFIX}-expanded .${PREFIX}-msg{max-width:86%}
  /* Give the title its own full-width row: avatar + actions share the top row,
     the name/subtitle drop to a dedicated line below so the title never gets
     squeezed by the action buttons on narrow phones. */
  .${PREFIX}-header{position:relative;padding-top:calc(14px + env(safe-area-inset-top));display:grid;grid-template-columns:auto 1fr;grid-template-areas:"avatar actions" "name name";align-items:center;gap:8px 10px;touch-action:none}
  .${PREFIX}-header::before{content:"";position:absolute;top:calc(5px + env(safe-area-inset-top));left:50%;transform:translateX(-50%);width:38px;height:4px;border-radius:4px;background:rgba(255,255,255,.55)}
  .${PREFIX}-avatar{grid-area:avatar}
  .${PREFIX}-hactions{grid-area:actions;justify-self:end}
  .${PREFIX}-hname{grid-area:name}
  .${PREFIX}-title{font-size:16px}
  .${PREFIX}-log{padding-bottom:calc(14px + env(safe-area-inset-bottom))}
  .${PREFIX}-form{padding-bottom:calc(10px + env(safe-area-inset-bottom))}
  .${PREFIX}-bubble{bottom:16px;${side}:16px}
  /* Expand/restore is meaningless once the sheet is full-screen — hide it. */
  .${PREFIX}-expand{display:none}
}
@media (prefers-reduced-motion:reduce){.${PREFIX}-bubble,.${PREFIX}-bubble-av::before,.${PREFIX}-panel,.${PREFIX}-msg,.${PREFIX}-typing span,.${PREFIX}-ayca,.${PREFIX}-eyes,.${PREFIX}-streaming::after,.${PREFIX}-rich-in,.${PREFIX}-tok{animation:none}.${PREFIX}-log{scroll-behavior:auto}}
`;
  const style = document.createElement("style");
  style.setAttribute("data-sgiant-aiw", "");
  style.textContent = css;
  document.head.appendChild(style);
}
