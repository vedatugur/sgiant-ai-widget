/**
 * Embeddable AI chatbox widget — framework-agnostic vanilla DOM, so it drops
 * into the analytics app OR an external site with one call. It POSTs to a
 * streaming chat endpoint and renders the reply live.
 *
 * Transport is intentionally tolerant: it reads a streamed body and accepts
 * BOTH shapes this platform emits —
 *   - SSE    : `data: {"type":"assistant_delta","text":"…"}`
 *   - NDJSON : `{"d":"…"}`
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
  isKnownNavTarget,
  createHostActions,
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
import {
  CHAT_ATTACHMENT_MAX_AV_BYTES,
  CHAT_ATTACHMENT_MAX_BYTES,
  CHAT_ATTACHMENT_MAX_COUNT,
} from "./limits";
// From `./limits`, not `@sgiant/shared` — see the note in that file. The
// history is worth keeping: this import was first written as
// `@sgiant/ui/tokens`, which made a vanilla-DOM widget declare a React library
// carrying three.js, recharts and Clerk to read one function. It was moved to
// `@sgiant/tokens` to fix that, and then the same mistake arrived by a
// different door as `@sgiant/assets/actions` (#306). Now it is local, and a
// drift test holds the copies together instead of a manifest entry.
import { resolveAccentContrast, mixSrgb, accentInk } from "./contrast";
import { isNavigationAction } from "./host-actions";
import { shouldAutoNavigate, shouldCollapseNarration } from "./pane-follow";
// The component vocabulary composed UI cards are drawn from. Re-exported below
// for hosts that want to validate a spec before handing it over.
import { parseJsonDirective } from "./directive";
export { parseJsonDirective, type ParsedDirective } from "./directive";
import {
  normalizeUiSpec,
  uiSpecMediaIds,
  UI_SAY_ACTION,
  type UiAction,
  type UiItem,
  type UiStatus,
} from "./ui-spec";
export {
  normalizeUiSpec,
  uiSpecMediaIds,
  KNOWN_UI_STATUSES,
  UI_SAY_ACTION,
  type UiSpec,
  type UiItem,
  type UiAction,
  type UiLayout,
  type UiStatus,
} from "./ui-spec";
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
  broadcastAiChange,
  subscribeAiChange,
  applyAiChange,
  subscribeLiveSync,
  type QueryInvalidator,
  type AiChangeEvent,
  type LiveSyncOptions,
} from "./ai-invalidation";
// THE single tool-name → endpoint mapping for applying a confirm-gated write
// proposal — every host (org/admin widget adapters, the full-page panel
// client) calls this instead of keeping its own copy.
export { applyProposal, type ApplyProposalCtx } from "./apply-proposal";
import type { PageContext } from "./host-actions";
import { renderMarkdown } from "./markdown";
import { PREFIX } from "./prefix";
import {
  addMsg,
  attIcon,
  el,
  escapeHtml,
  maskMarkdown,
  parseLine,
  relBucket,
  relTime,
  wrapPreviewHtml,
} from "./dom";
import {
  hostDefinesPlatformTokens,
  injectStyles,
  USER_BUBBLE_INK,
} from "./styles";
import { WIDGET_LABELS, type WidgetLabels } from "./labels";
export { WIDGET_LABELS, resolveWidgetLabels } from "./labels";
export type { WidgetLabels };
export { PREFIX };

/**
 * The window event that opens the assistant panel. Owned here, next to the
 * `openEventName` option that consumes it, so a nav link and the widget host
 * can never drift onto different strings and silently produce a dead button.
 */
export const OPEN_ASSISTANT_EVENT = "sgiant:open-assistant";

// Thread replay + branch navigation moved to `./replay.ts` (#320): a pure
// transform, server payload in and render items out, with no DOM and no
// host context — the shape #306 needs more of.
import {
  type LoadedThreadItem,
  type ReplayMessageItem,
  type BranchNav,
} from "./replay";
export { buildThreadReplay } from "./replay";
export type { LoadedThreadItem } from "./replay";

/**
 * A background job as the CHAT needs to draw it.
 *
 * Deliberately the GENERIC job shape (`JobSummary`'s status + done-of-total
 * progress) rather than anything a site import or a report build owns: the
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
  /** Done-of-total, with a short label for what is happening right now (the
   *  report section being built). `total` is null while it is not yet known. */
  progress?: { done?: number; total?: number | null; label?: string | null };
  /** Overrides the type-derived title when the host knows better. */
  title?: string | null;
  /** Why it failed / what went wrong inside it. Shown verbatim. */
  error?: string | null;
  /** Where the finished work landed — an in-app, root-relative path the card
   *  links to (e.g. "/assets"). Omit when the job produced nothing to open. */
  resultPath?: string | null;
  /**
   * Where this work can be WATCHED while it runs — an in-app, root-relative
   * path, available from the moment the work exists rather than when it ends.
   *
   * Distinct from `resultPath`, which is the finished artefact and is null
   * until then. A report is the case that needs it: its whole premise is a
   * page you watch build, so "come and look" is useful at second one and
   * useless at the end. In advanced view the widget points the app pane here
   * itself (see `autoNavigateFrame`), which is the difference between telling
   * someone to watch it build and showing them.
   *
   * Omit for work with nothing to watch — a job whose only observable state is
   * the card itself.
   */
  livePath?: string | null;
  /**
   * The MEDIA this job produced, by id — what lets a `[[ui:…]]` tile that was
   * drawn empty fill itself in with the actual asset the moment the job
   * finishes, instead of asking the client to go and look.
   *
   * An id and not a URL, for the same reason everywhere else in this file: ours
   * are signed and short-lived, and a job runs for minutes. The widget
   * resolves it through the same batched `resolveMediaUrls` every other tile
   * uses. Omitted by every job type that produces no single asset.
   */
  resultMediaId?: string | null;
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
    /** The runner's MACHINE-readable note on this step. `code` is the one key
     *  read here: it lets a step be shown in the reader's own language instead
     *  of in the runner's English, which has no request locale to work from.
     *
     *  Nullable, not merely optional: the wire type sends an explicit `null`
     *  for a step that carries no payload, and the host forwards the API's
     *  events verbatim rather than mapping them one by one. */
    data?: Record<string, unknown> | null;
  }>;
}

export interface AiChatWidgetOptions {
  /** Streaming chat endpoint (POST). e.g. https://api.sgiant.io/accounts/:id/ai/chat */
  endpoint: string;
  /** Media-upload endpoint (POST multipart) for chat attachments — e.g.
   *  https://api.sgiant.io/accounts/:id/assets/media. When set (authed
   *  surfaces), the composer shows a paperclip so the user can attach files the
   *  assistant reads. Uploads are sent SESSION-scoped (`session=1` + the
   *  current threadId): reachable from the chat history, never filed into the
   *  asset library. Omit on the anonymous surface (nowhere to store). */
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
   * Window event name that opens the panel — pass `OPEN_ASSISTANT_EVENT`, so a
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
    /** One line of free text from the quality prompt (#299). The reason is
     *  where the signal actually is — "it answered the wrong question" is
     *  actionable in a way a finer number is not. */
    reason?: string;
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
  ) => (() => void) | void; /**
   * Resolve library media ids to URLs the browser can load, for `[[ui:…]]`
   * cards. Called ONCE per card with every id it needs; return a map (omit an
   * id that can't be resolved — the tile then says so rather than sitting
   * blank).
   *
   * This is the reason a composed card can show the account's own pictures at
   * all: the widget is embeddable and has no session of its own, so only the
   * host can mint a signed URL. It is also why the spec names media by ID and
   * never by URL — an id resolves against media the ACCOUNT owns, so a model
   * that invents one gets an empty tile instead of the client's browser
   * fetching a URL the model chose.
   */
  resolveMediaUrls?: (ids: string[]) => Promise<Record<string, string>>;
  /**
   * Apply a confirm-gated WRITE-tool proposal (e.g. `organize_assets`). The AI
   * never mutates directly — it proposes; the widget shows a card and THIS runs
   * only when the user clicks Apply (a Clerk-authed action in the host). Map the
   * tool name → a real, access-checked API call. Return a string to show as the
   * success note; throw to let the user retry. Omit to hide write proposals.
   */
  /**
   * Where a report lives in THIS app. The widget runs in three shells with
   * different route shapes, so it cannot build the URL itself — and guessing
   * one would produce a link that 404s in two of them.
   */
  reportHref?: (reportId: string) => string;
  onApplyProposal?: (
    name: string,
    args: Record<string, unknown>,
    /** The account this proposal is FOR, when the worker said. The host applies
     *  on its own session and would otherwise aim at whatever account its page
     *  is scoped to — which is not always the account the assistant reasoned
     *  about, and on a platform page is not an account at all. */
    opts?: { accountId?: string; artifactId?: string }
  ) => Promise<
    string | void | { message?: string; jobId?: string; reportId?: string }
  >;
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
   * Read ONE report. The single deliberate exception to `getJob`'s "never a
   * per-type endpoint" rule, and it is worth stating why.
   *
   * A report stopped being a `job` row: it owns its lifecycle, its narration
   * and its stage vocabulary outright, and after the contract migration there
   * is no generic row to read. That is not a fourth job type wanting its own
   * poller — it is a second SOURCE of tracked work, which is why the fan-out
   * below is untouched and only the READ dispatches. One poll loop still
   * serves every card and every tile.
   *
   * Omit it and a report card simply never polls.
   */
  getReport?: (reportId: string) => Promise<WidgetJobView | null>;
  /**
   * Jobs still RUNNING for a thread, asked of the server on reopen.
   *
   * The widget also remembers its own jobs in browser storage, which is fast
   * and enough for the device that started them — and wrong everywhere else. A
   * report begun on a phone, or before the cache was cleared, left the desktop
   * showing a conversation with nothing happening in it while it ran. This is
   * the authoritative answer; storage is the instant one.
   *
   * Omit it and re-attach stays per-browser, exactly as before.
   */
  listThreadJobs?: (threadId: string) => Promise<WidgetJobView[]>;
  /**
   * Cancel a running/queued job the chat is watching (the card's Cancel
   * button). Cooperative on the server — a report stops at the next step
   * boundary — so the card keeps polling and flips to "Cancelled" when the
   * runner actually stops. Omit to hide the button.
   */
  cancelJob?: (jobId: string) => Promise<void>;
  /** Cancel a running/queued REPORT — the same cooperative contract as
   *  `cancelJob`, against the report's own route. Omit to hide the button on
   *  report cards. */
  cancelReport?: (reportId: string) => Promise<void>;
  /** This thread's UNSAVED session artifacts (media scraped or imported in the
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

// The directive vocabulary moved to `./specs.ts` (#320): what the model may
// emit inside `[[tag:{json}]]`, and the parsing of it. #306 calls this the
// widget’s real extension point, so it needs to be findable.
import {
  type WidgetSpec,
  type NavigateSpec,
  type PreviewSpec,
  type ActionSpec,
  type ChipsSpec,
  LEAD_TOKEN,
  type FormSpec,
  type ProposalField,
  type BuiltField,
  isTruthyValue,
  isPrimitiveArg,
  proposalFields,
  parseFormDirective,
  stripDirectivesForReplay,
} from "./specs";

// URL safety moved to `./safe-url.ts` (#320): what the widget will navigate
// to, given that model output is untrusted. A public surface once the
// widget publishes.
import {
  isSafeRelPath,
  gateNavigationTarget,
  isSafeFrameUrl,
} from "./safe-url";
export { gateNavigationTarget } from "./safe-url";

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

/**
 * What the collapsed launcher is saying (#305).
 *
 * It had exactly ONE appearance, which is why an unread reply and an idle
 * corner animated about equally. Only `unread` and `working` move; the rest are
 * static differences, and that is what makes movement mean something again.
 */
export interface LauncherState {
  state?: "resting" | "unread" | "working" | "offline" | "parked";
  /** `unread` only — shown as a count badge. */
  count?: number;
  /** `pill` on a first visit (a word, not a puzzle — #88); `pebble` after. */
  variant?: "pebble" | "pill";
  /** Which way the mark and disc invert. "auto" reads the host's own surface. */
  ground?: "light" | "ink" | "auto";
}

export interface AiChatWidgetHandle {
  open(): void;
  close(): void;
  toggle(): void;
  destroy(): void;
  /** Register a custom directive renderer at runtime (see `renderers`).
   *  Reserved built-in tags are rejected with an Error. */
  registerRenderer(tag: string, renderer: DirectiveRenderer): void;
  /** Drive the collapsed launcher. Partial — omitted fields keep their value. */
  setLauncher(next: LauncherState): void;
}

// Every SVG this file draws now lives in `./icons.ts` (#320) — pure data,
// and the file an embedder must point at to replace the mark (#306:
// `avatarUrl` only accepts a bitmap today).
import {
  AVATAR_DEFS,
  AVATAR_SVG,
  ICON_HISTORY,
  ICON_EXPAND,
  ICON_COLLAPSE,
  ICON_COMPASS,
  ICON_ADVANCED,
  ICON_CHEVRON_R,
  ICON_DOWNLOAD,
  ICON_FLAG,
  ICON_BELL,
  ICON_BELL_OFF,
  ICON_MORE,
  ICON_ATTACH,
  ICON_EDIT,
  ICON_REGEN,
  ICON_CHEV_L,
  ICON_CHEV_R,
  ICON_THUMB_UP,
  ICON_THUMB_DOWN,
} from "./icons";

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
  /** True when the VIEW on screen has a turn in flight (per-thread, not
   *  global): it blocks double-sending into the same conversation, while other
   *  threads stay free to receive a new message. Derived from
   *  `pendingThreads` by `syncBusy()` — never written directly elsewhere. */
  let busy = false;
  /**
   * Cross-thread stream fence. Every send() captures the view generation;
   * switching threads / starting a new chat bumps it. A stale turn keeps
   * CONSUMING its stream so the server completes + persists normally, but
   * stops touching the visible log / `history` / localStorage — the reply
   * belongs to ITS thread, not whichever conversation is now on screen (the
   * exact bleed users reported when switching mid-answer).
   */
  let viewGen = 0;
  /** Placeholder key for a turn whose brand-new thread id hasn't arrived yet
   *  (the server names the thread in the first frame). */
  const NEW_TURN_KEY = "·new·";
  /** How long a single assistant turn must run before the widget asks whether
   *  the wait was worth it (#299). 20s is comfortably past a normal tool-using
   *  answer and far short of the 300s ceiling. */
  const QUALITY_SLOW_MS = 20_000;
  /** Threads with a response in flight — drives the History list's
   *  "answering…" spinner and the per-thread busy state. */
  const pendingThreads = new Set<string>();
  const isThreadPending = (key: string | undefined): boolean =>
    pendingThreads.has(key ?? NEW_TURN_KEY);
  /** Recompute `busy` for the CURRENT view (call after any switch or any
   *  pending-set change). Function-declared so early code can reference it;
   *  it only runs after the composer exists. */
  function syncBusy(): void {
    busy = isThreadPending(threadId);
    sendBtn.disabled = busy;
    // The launcher's `working` state, from the real in-flight turn rather than
    // a separate flag that could drift from it (#305). Only while the panel is
    // CLOSED — a breathing launcher next to an open panel that is already
    // streaming says nothing the panel is not saying louder.
    if (typeof applyLauncher === "function" && panel.style.display === "none") {
      setLauncher({ state: busy ? "working" : "resting" });
    }
  }
  let lastUserContent = "";
  // The navigable pages from the most recent turn's pageContext, cached so the
  // #111 prose-nav fallback (linkifyProseNav) can match a model's "Open <page>"
  // prose against a real path even after the turn's getContext() has gone —
  // and, since S4, the allow-list `dispatchAction` checks a navigation against.
  let knownNavTargets: Array<{
    path?: string;
    title?: string;
    action?: string;
  }> = [];
  /** Read the catalogue straight from the host, for a navigation dispatched
   *  before this session has sent a turn (a chip in a restored transcript). */
  async function refreshNavTargets(): Promise<void> {
    if (!opts.getContext) return;
    try {
      const ctx = await opts.getContext();
      const targets = (ctx as { navTargets?: unknown } | undefined)?.navTargets;
      if (Array.isArray(targets)) knownNavTargets = targets;
    } catch {
      // A host that cannot say what its pages are has not declared any.
    }
  }

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
  bubble.innerHTML =
    `<span class="${PREFIX}-bubble-av">${avatarInner}</span>` +
    `<span class="${PREFIX}-bubble-label"></span>` +
    `<span class="${PREFIX}-bubble-dot" hidden></span>`;

  /**
   * The launcher's six states (#305).
   *
   * Held as one object and applied wholesale so a partial update cannot leave
   * two states on at once — the reason the old launcher had one appearance is
   * that nothing owned this.
   *
   * `ground: "auto"` reads the HOST's own background rather than guessing: the
   * same widget mounts on a white app, a cream report and a near-black
   * marketing page, and the mark has to straddle navy on all three.
   */
  const launcher: Required<LauncherState> = {
    state: "resting",
    count: 0,
    // A reader who has opened it once does not need the word again. Its OWN
    // key, not the thread cache: that expires after 12 hours by design, and
    // "has this person ever met the widget" is not a fact that should expire.
    variant: hasOpenedBefore() ? "pebble" : "pill",
    ground: "auto",
  };

  const OPENED_KEY = `${PREFIX}.opened`;
  function hasOpenedBefore(): boolean {
    try {
      return localStorage.getItem(OPENED_KEY) === "1";
    } catch {
      // Blocked storage: show the pebble rather than greeting a returning
      // reader with the first-visit pill on every page.
      return true;
    }
  }
  function markOpened(): void {
    try {
      localStorage.setItem(OPENED_KEY, "1");
    } catch {
      /* non-fatal */
    }
  }

  function resolveGround(): "light" | "ink" {
    if (launcher.ground !== "auto") return launcher.ground;
    try {
      // SAMPLE WHERE THE LAUNCHER ACTUALLY SITS, not up its parent chain.
      // Walking parents reads <body>, and on a marketing page body is
      // near-white while the section under the corner is near-black — measured
      // on our own home page, which returned "light" over a dark hero. The
      // launcher is position:fixed, so its ancestors say nothing about what is
      // behind it.
      const r = bubble.getBoundingClientRect();
      const stack = document.elementsFromPoint(
        r.left + r.width / 2,
        r.top + r.height / 2
      );
      for (const node of stack) {
        // Skip the widget's own chrome, or it reads its own disc.
        if (node === bubble || bubble.contains(node) || panel.contains(node)) {
          continue;
        }
        const bg = getComputedStyle(node).backgroundColor;
        const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/.exec(bg);
        // `transparent` tells us nothing — keep looking behind it.
        if (!m || (m[4] !== undefined && Number(m[4]) <= 0.5)) continue;
        const [r8, g8, b8] = [Number(m[1]), Number(m[2]), Number(m[3])];
        // Perceived lightness, not the average — green dominates.
        return (0.2126 * r8 + 0.7152 * g8 + 0.0722 * b8) / 255 < 0.5
          ? "ink"
          : "light";
      }
    } catch {
      /* no DOM answer — the light default is the common case */
    }
    return "light";
  }

  function applyLauncher(): void {
    const dot = bubble.querySelector(
      `.${PREFIX}-bubble-dot`
    ) as HTMLElement | null;
    const label = bubble.querySelector(
      `.${PREFIX}-bubble-label`
    ) as HTMLElement | null;
    for (const s of ["unread", "working", "offline", "parked"]) {
      bubble.classList.toggle(`${PREFIX}-bubble-${s}`, launcher.state === s);
    }
    bubble.classList.toggle(
      `${PREFIX}-bubble-pill`,
      launcher.variant === "pill"
    );
    bubble.classList.toggle(`${PREFIX}-on-ink`, resolveGround() === "ink");
    if (label) label.textContent = launcher.variant === "pill" ? name : "";
    if (dot) {
      const showCount = launcher.state === "unread" && launcher.count > 0;
      dot.hidden = !showCount && launcher.state !== "offline";
      dot.textContent = showCount ? String(launcher.count) : "";
    }
    // The label carries the state for anyone not looking at it.
    bubble.setAttribute(
      "aria-label",
      launcher.state === "unread" && launcher.count > 0
        ? L("openBubbleUnread", { name, count: launcher.count })
        : L("openBubble", { name })
    );
  }

  function setLauncher(next: LauncherState): void {
    Object.assign(launcher, next);
    applyLauncher();
  }
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
  // DERIVE the foreground for accent-filled controls (#307). The sheet's
  // default is `#fff`, right against the widget's own violet (7.10:1) and wrong
  // against every accent a host actually passes — all three of ours send teal
  // `#60C7C8`, where white measures 2.00:1 across thirteen controls. A default
  // could not fix that, because the failing value WAS the default.
  //
  // An explicit `accent-contrast` still wins: a host that has measured its own
  // pairing is not overruled. And an accent we cannot parse (a `color-mix()`,
  // a var(), a named colour) leaves the token untouched rather than guessing.
  if (themeTokens.accent && !themeTokens["accent-contrast"]) {
    const fg = resolveAccentContrast(themeTokens.accent);
    if (fg) themeTokens["accent-contrast"] = fg;
  }
  // The user's own message bubble needs its OWN pairing, for the reason #307
  // exists and one level deeper. That bubble is not accent-filled: it is the
  // accent mixed 76% into a near-black navy, which lands somewhere the raw
  // accent's foreground was never measured against. Over the teal all three
  // hosts pass it resolves to `#4a9d9e`, where the sheet's literal `#fff` is
  // **3.18:1** — under the floor, on every message the user types, which is the
  // most-drawn element in the widget.
  //
  // Deriving against the MIX rather than the accent is the whole point; the mix
  // is computed once, in JS, and handed to CSS as a resolved value so the two
  // cannot disagree about what the background actually is. An explicit
  // `user-bg` / `user-contrast` from the host still wins, and an unparseable
  // accent leaves both untouched so the sheet's own defaults apply.
  // The accent as INK, per scheme (#326). `--aiw-accent` is a FILL colour, and
  // twenty rules also use it as text — links, hover states, the focused input,
  // chips, KPI deltas, the menu icons, the active vote. A fill is not an ink:
  //
  //   teal   #60C7C8 (all three hosts)     2.00:1 on the light surface
  //   violet #6d28d9 (our own default)     2.55:1 on the dark one
  //   amber  #FBAA34                       1.93:1 on the light one
  //
  // So this is not "the teal is a bad accent" — EVERY accent is illegible as
  // ink on one of the two schemes, and which one depends only on where the
  // colour sits between the surfaces. The widget's own default is the one that
  // fails in the dark.
  //
  // Two values, because the surface flips and an inline token would not: the
  // sheet picks between them (`--aiw-accent-ink` reads `-light` in the base
  // block and `-dark` in the dark one), so the app's own switch still drives it.
  // Both fall back to the raw accent when the accent cannot be parsed.
  if (themeTokens.accent) {
    for (const [suffix, surface] of [
      ["light", "#ffffff"],
      ["dark", "#161616"],
    ] as const) {
      const key = `accent-ink-${suffix}`;
      if (themeTokens[key]) continue;
      const ink = accentInk(themeTokens.accent, surface);
      if (ink) themeTokens[key] = ink;
    }
  }
  if (themeTokens.accent && !themeTokens["user-bg"]) {
    const bg = mixSrgb(themeTokens.accent, USER_BUBBLE_INK, 0.76);
    if (bg) {
      themeTokens["user-bg"] = bg;
      if (!themeTokens["user-contrast"]) {
        const fg = resolveAccentContrast(bg);
        if (fg) themeTokens["user-contrast"] = fg;
      }
    }
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
   * Below this width the panel is a FULL-SCREEN bottom sheet (see the
   * sheet media query below — see SHEET_QUERY). Declared up here because applyPos
   * needs it and runs at mount — a `const` defined later would be in the
   * temporal dead zone and throw.
   */
  // MUST match the media query below, character for character in meaning:
  // the JS decides where the panel is positioned and the CSS decides what it
  // looks like, and a phone in landscape used to fall between them (#309).
  const SHEET_QUERY =
    "(max-width:640px),(max-height:520px) and (pointer:coarse)";
  const isSheet = (): boolean => window.matchMedia(SHEET_QUERY).matches;

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
    // The mobile sheet is full-screen via CSS `inset:0`, and an INLINE
    // left/top beats a stylesheet rule. So a position saved by dragging the
    // panel on desktop used to survive onto the phone: the sheet never went
    // full-screen, it floated at the desktop coordinates with the host app's
    // header showing through — its logo and top-right actions colliding with
    // the widget's own. Below the breakpoint the saved position simply does
    // not apply. It stays in storage, so going back to desktop restores it.
    if (isSheet()) return toCorner();
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
  // The secondary/toggle controls (download, flag, sound, auto-nav)
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
  // Class, not `display` (#309): the menu transitions now, and display is not
  // animatable. See the -menu / -menu-open rules.
  moreMenu.classList.remove(`${PREFIX}-menu-open`);
  moreWrap.append(moreBtn, moreMenu);
  let menuOpen = false;
  const setMenu = (open: boolean): void => {
    menuOpen = open;
    moreMenu.classList.toggle(`${PREFIX}-menu-open`, open);
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
  // Star state per thread, learned from the History list (which already returns
  // it) and updated on every toggle. Without this the menu row would have to
  // guess, and showing "not starred" for a starred conversation is worse than
  // showing nothing.
  const starredThreads = new Map<string, boolean>();
  let paintStarItem = (): void => {};

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
  // Star THIS conversation (#299).
  //
  // The star was already reachable — but only from the History panel, i.e. only
  // on conversations you are NOT in. To bookmark the one you are reading you had
  // to leave it, find it in a list, and star it there. That is the same
  // reachability failure as the vote buttons, one surface over.
  //
  // It goes in the menu rather than the header on purpose: the header comment
  // above records that these controls used to sit side-by-side and became "a
  // cramped, unreadable strip of look-alike icons". A star is secondary.
  const starItem = opts.starThread ? menuItem(L("star")) : null;
  if (starItem) {
    starItem.ico.textContent = "☆";
    // Repainted from the cache below whenever the thread changes, so the row
    // states what IS rather than what was last clicked.
    starItem.btn.addEventListener("click", () => {
      if (!threadId || !opts.starThread) return;
      const id = threadId;
      starItem.btn.disabled = true;
      void opts
        .starThread(id)
        .then((r) => {
          starredThreads.set(id, r.starred);
          paintStarItem();
        })
        .finally(() => {
          starItem.btn.disabled = false;
        });
    });
    moreMenu.appendChild(starItem.btn);
    paintStarItem = (): void => {
      // No thread yet (a brand-new chat) means there is nothing to bookmark.
      const known = threadId ? starredThreads.get(threadId) : undefined;
      starItem.btn.hidden = !threadId;
      const on = known === true;
      starItem.ico.textContent = on ? "★" : "☆";
      starItem.ico.style.color = on ? "#f59e0b" : "";
      const lab = starItem.btn.querySelector(`.${PREFIX}-menu-label`);
      if (lab) lab.textContent = on ? L("unstar") : L("star");
    };
    paintStarItem();
  }
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
  // `agent` is the AI role that ran the step (Vega/AYCA/…) — shown as a small
  // badge so the user sees WHICH agent did WHAT.
  // A model id → a compact label for the flow chip ("claude-sonnet-4-6" →
  // "sonnet-4-6"; "managed" stays). Keeps the badge short.
  function shortModel(model?: string): string {
    if (!model) return "";
    return model.replace(/^claude-/, "").replace(/-\d{8}$/, "");
  }
  /** Chips draw their own ✓/✕ glyph, but many host apply messages (and a few
   *  labels) historically END in a textual "✓" too — rendered together they
   *  read as a double checkmark ("✓ Brand updated … ✓"). The glyph wins; the
   *  textual tick is stripped wherever text sits next to a glyph. */
  function stripTick(s: string): string {
    return s.replace(/\s*✓\s*$/u, "");
  }
  function paintActivity(
    chip: HTMLElement,
    label: string,
    status: string,
    agent?: string,
    model?: string
  ): void {
    label = stripTick(label);
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
    model?: string,
    href?: string
  ): HTMLElement {
    const chip = el("div", `${PREFIX}-activity`);
    paintActivity(chip, label, status, agent, model);
    // A produced REPORT gets a way in. Through the same dispatchAction +
    // isSafeRelPath guard the job card uses — the path came from a host
    // callback, but it still crosses into a navigation, and there is exactly
    // one gate for that in this file.
    if (isSafeRelPath(href)) {
      const path = href;
      const btn = el("button", `${PREFIX}-act-open`) as HTMLButtonElement;
      btn.type = "button";
      btn.innerHTML = `<span>${escapeHtml(L("openReport"))}</span> <span aria-hidden="true">→</span>`;
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        try {
          await dispatchAction("navigate", { path });
        } catch {
          btn.disabled = false;
        }
      });
      chip.appendChild(btn);
    }
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
  // ── Live background jobs ────────────────────────────────────────────────────
  //
  // An apply that ENQUEUES (a whole-site import, a render) answers in a second
  // and then works for minutes. The chat used to say "I'll notify you when it's
  // ready ✓" and then show nothing at all until the completion artifact appeared
  // on a reload — the one place the user was watching was the one place the work
  // was invisible. So the apply's job id is kept, a card is drawn in the log, and
  // the GENERIC job read is polled until the job is terminal.
  //
  // Nothing here knows what a report is. It renders a status, a
  // done-of-total, a label and a terminal outcome — which is all `JobSummary`
  // promises for a job of ANY type, including one this build has never seen.

  /** How often a live job is re-read. Slow enough not to be a poll storm, fast
   *  enough that "3 of 12" visibly moves while a job runs. */
  const JOB_POLL_MS = 3000;
  /** Stop babysitting a job that never lands — the card says so rather than
   *  spinning forever. */
  const JOB_POLL_MAX_MS = 30 * 60 * 1000;

  /**
   * WHICH SOURCE a piece of tracked work lives in.
   *
   * Everything below used to key on a bare id, which was correct while `job`
   * was the only source. It is not any more: a report is its own row in its own
   * table, so a report id and a job id are two namespaces, and one map keyed on
   * the raw string quietly assumes they cannot collide. They are both UUIDs, so
   * a collision is vanishingly unlikely and would be almost impossible to
   * diagnose — the cheap fix is to stop assuming.
   */
  type WorkKind = "job" | "report";
  interface WorkRef {
    kind: WorkKind;
    id: string;
  }
  /** The map key for one piece of tracked work. The ONLY place the two
   *  namespaces are joined, so they can never be conflated by accident. */
  const refKey = (ref: WorkRef): string => `${ref.kind}:${ref.id}`;
  /** A view carries its generic `type`; that is what tells re-attach which
   *  source a listed row came from. */
  const refOf = (view: { id?: string; type?: string }): WorkRef | null =>
    view.id
      ? { kind: view.type === "report" ? "report" : "job", id: view.id }
      : null;

  /** One piece of work this conversation is watching, as remembered across a
   *  refresh. */
  interface TrackedJob {
    jobId: string;
    /** Which source `jobId` belongs to. OPTIONAL on read: entries written
     *  before reports left the job model have no `kind`, and they are all
     *  generic jobs — so a missing value reads as "job" rather than dropping a
     *  card someone is watching. */
    kind?: WorkKind;
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
  /**
   * Everything ELSE that wants to know how a job is going.
   *
   * The job card was the only watcher for a long time, so the poll painted it
   * directly. It is not any more: a `[[ui:…]]` tile can name a jobId and has to
   * repaint itself as that render finishes. Two pollers for one job would be
   * two answers to the same question, drifting apart and costing double, so
   * there is ONE loop per job id and it fans out to whoever is listening.
   *
   * Each subscriber carries the node it paints, because the transcript is wiped
   * and redrawn on every turn (`reattachTrackedJobs`): the node a subscriber
   * closed over is detached moments later, and a subscriber list that never
   * forgot them would grow without bound and paint into nothing.
   */
  const jobWatchers = new Map<
    string,
    Set<{
      node: HTMLElement;
      paint: (view: WidgetJobView) => void;
      /** Has this node ever actually been in the document? A tile subscribes
       *  while it is still being BUILT — the card it belongs to is appended a
       *  few statements later — so "not connected" only means "gone" once it
       *  has been seen connected at least once. Pruning on the first poll
       *  instead would silently unsubscribe every tile whose job answered
       *  faster than the card was assembled. */
      seen: boolean;
    }>
  >();

  /**
   * Hand one poll result to everyone watching that job: the card, and any tile
   * that named it. Subscribers whose node has left the document are dropped
   * here rather than on a timer — a detached node is the definition of a
   * subscriber with nothing left to paint.
   */
  function emitJob(ref: WorkRef, view: WidgetJobView): void {
    const key = refKey(ref);
    const card = jobCards.get(key);
    if (card) paintJob(card, view);
    const subs = jobWatchers.get(key);
    if (!subs) return;
    for (const sub of subs) {
      if (!sub.node.isConnected) {
        // Detached AFTER having been on screen — the transcript that held it
        // was wiped, so there is nothing left to paint.
        if (sub.seen) subs.delete(sub);
        continue;
      }
      sub.seen = true;
      try {
        sub.paint(view);
      } catch {
        // One bad subscriber must not stop the others (or the poll) — a tile
        // that throws is a drawing bug, not a reason to stall the job.
      }
    }
    if (!subs.size) jobWatchers.delete(key);
  }

  /**
   * Poll one job to a terminal state, fanning every result out through
   * `emitJob`. Idempotent per id: a second call while a loop is running simply
   * returns, which is what lets a tile and a card share one poll.
   *
   * Stops on: a terminal status, the safety ceiling, or `destroy()` (every wait
   * goes through `waitAlive`, so an aborted widget never wakes up again).
   */
  function watchJob(ref: WorkRef): void {
    // THE ONLY DISPATCH. A report reads from its own endpoint because it no
    // longer has a generic row; everything after this line is source-agnostic,
    // which is what keeps one loop serving both.
    const read = ref.kind === "report" ? opts.getReport : opts.getJob;
    if (!read || !ref.id) return;
    const key = refKey(ref);
    if (jobPolling.has(key)) return;
    jobPolling.add(key);
    void (async () => {
      const started = Date.now();
      try {
        for (;;) {
          if (Date.now() - started >= JOB_POLL_MAX_MS) {
            // Give up WATCHING, not on the job: it is still running server-side,
            // and saying so is more honest than a spinner that never resolves.
            const stalled = jobCards.get(key);
            if (stalled) {
              stalled.className = `${PREFIX}-job ${PREFIX}-job-done`;
              stalled.textContent = L("jobUnreachable");
            }
            forgetJob(ref);
            return;
          }
          let view: WidgetJobView | null;
          try {
            view = await read(ref.id);
          } catch {
            // A transient read failure is not a failed job — keep the spinner
            // and try again on the next tick.
            if (!(await waitAlive(JOB_POLL_MS))) return;
            continue;
          }
          // A job the account can no longer read (deleted, or never existed) is
          // not something to keep asking about.
          if (!view) {
            jobCards.get(key)?.remove();
            jobCards.delete(key);
            jobWatchers.delete(key);
            forgetJob(ref);
            return;
          }
          emitJob(ref, view);
          if (
            view.status === "done" ||
            view.status === "failed" ||
            view.status === "cancelled"
          ) {
            forgetJob(ref);
            jobWatchers.delete(key);
            scrollDown();
            return;
          }
          if (!(await waitAlive(JOB_POLL_MS))) return;
        }
      } finally {
        jobPolling.delete(key);
      }
    })();
  }

  /**
   * Subscribe a node to a job's progress and make sure the job is being polled.
   *
   * The node is what a tile passes so it can be dropped once the transcript
   * that held it is gone.
   */
  function subscribeJob(
    ref: WorkRef,
    node: HTMLElement,
    paint: (view: WidgetJobView) => void
  ): void {
    const read = ref.kind === "report" ? opts.getReport : opts.getJob;
    if (!read || !ref.id) return;
    const key = refKey(ref);
    let subs = jobWatchers.get(key);
    if (!subs) {
      subs = new Set();
      jobWatchers.set(key, subs);
    }
    subs.add({ node, paint, seen: false });
    watchJob(ref);
  }

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
      // NOTE the absent `kind` check: an entry written by the previous build
      // has none, and rejecting it would drop the card for work that is still
      // running across the deploy. `trackedRef` below defaults it.
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
  /** The ref a stored entry refers to — `kind` defaults to "job" for entries
   *  written before reports had their own source. */
  function trackedRef(j: TrackedJob): WorkRef {
    return { kind: j.kind ?? "job", id: j.jobId };
  }
  function rememberJob(ref: WorkRef, tid: string): void {
    const jobs = loadTrackedJobs().filter(
      (j) => refKey(trackedRef(j)) !== refKey(ref)
    );
    jobs.push({ jobId: ref.id, kind: ref.kind, threadId: tid, at: Date.now() });
    saveTrackedJobs(jobs);
  }
  /** A finished job is not a live job: forgetting it here is what stops the card
   *  from being redrawn on the next refresh (the transcript's own completion
   *  artifact is the lasting record). */
  function forgetJob(ref: WorkRef): void {
    saveTrackedJobs(
      loadTrackedJobs().filter((j) => refKey(trackedRef(j)) !== refKey(ref))
    );
  }

  /** The card's title: the host's own wording, else the copy for a type we know,
   *  else a neutral one — an unknown type must still read as something. */
  function jobTitle(view: WidgetJobView): string {
    if (view.title) return view.title;
    if (view.type === "coder") return L("jobTitleCoder");
    if (view.type === "report") return L("jobTitleReport");
    return L("jobTitleFallback");
  }

  /** "3 of 12" / "3 so far" / nothing at all — `total` is null until the runner
   *  has planned its work, and "3 of 0" would be a lie. */
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
    // The progress LABEL is server text (for a report, the section being
    // built) — escaped like every other untrusted string the widget draws.
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
    //
    // A step is shown in the READER'S language when the runner tagged it with a
    // code we have a label for, and in the runner's own English otherwise. That
    // fallback is the point: a new step can be emitted by the server without a
    // widget release, and it degrades to an English sentence rather than to a
    // blank line or a raw key.
    // FOLLOW IT INTO THE PANE, and stop narrating twice.
    //
    // Owner's decision (S4): once the app pane is showing the same run, the
    // chat column collapses to ONE line. The report page owns the detail — it
    // has the stage rail and it is the authority on stage — and two renderings
    // of one job competing on one screen is the divergence advanced view makes
    // absurdly visible. When the pane is NOT showing it, the chat narrates in
    // full, because then it is the only account of what is happening.
    //
    // `livePath` rather than `resultPath`: this has to work while the thing is
    // RUNNING, which is the whole point of a page you watch build.
    // Keyed through `refOf`/`refKey`, the same way `jobCards` and
    // `userConfirmedWork` are: `type` is free-form copy ("import", "render"),
    // so composing the key by hand here gave the follow decision a key that
    // could not match the one the confirmation was recorded under.
    const followRef = !terminal && view.livePath ? refOf(view) : null;
    if (followRef && view.livePath) {
      autoNavigateFrame(refKey(followRef), view.livePath);
    }
    const mirrored = frameShowing(view.livePath);
    const events = mirrored ? [] : (view.events ?? []);
    const eventText = (e: {
      message: string;
      data?: Record<string, unknown> | null;
    }): string => {
      const code = e.data?.code;
      if (typeof code !== "string" || !code) return e.message;
      const key = `jobEv${code.charAt(0).toUpperCase()}${code.slice(1)}`;
      // Membership is checked against the label BAG rather than by calling `L`
      // and testing its answer: `L` indexes a record typed as total, so an
      // unknown key yields `undefined` rather than anything recognisable, and a
      // step we have no wording for must fall through to the server's sentence.
      if (!(key in WIDGET_LABELS)) return e.message;
      return L(key as keyof WidgetLabels) || e.message;
    };
    const tailStart = terminal
      ? Math.max(0, events.length - 3)
      : Math.max(0, events.length - 5);
    const flowLine = (e: {
      kind?: string;
      message: string;
      data?: Record<string, unknown> | null;
    }) =>
      `<li class="${PREFIX}-job-ev${
        e.kind === "problem"
          ? ` ${PREFIX}-job-ev-problem`
          : e.kind === "decision"
            ? ` ${PREFIX}-job-ev-decision`
            : ""
      }">${escapeHtml(eventText(e))}</li>`;
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
        ? `<div class="${PREFIX}-job-bar"><i style="transform:scaleX(${pct / 100})"></i></div>`
        : "") +
      (detail
        ? `<div class="${PREFIX}-job-detail">${escapeHtml(detail)}</div>`
        : "") +
      // The one line that replaces the narration when the pane is showing the
      // same run. Not silence: the card still has to say WHY it went quiet, or
      // it reads as the feed having stopped.
      (mirrored
        ? `<div class="${PREFIX}-job-mirrored">${escapeHtml(L("jobWatchingInPane"))}</div>`
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
    // The cancel goes to the route that OWNS the work: a report is cancelled
    // on its own row, and after the contract migration there is no generic job
    // to cancel it through.
    const cancelFor =
      view.type === "report" ? opts.cancelReport : opts.cancelJob;
    if (!terminal && view.id && cancelFor) {
      const jobId = view.id;
      const cancel = cancelFor;
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
   * Give one job a CARD in the log, and make sure it is being watched.
   *
   * The polling itself lives in `watchJob` — this is the card half, kept apart
   * because a tile wants the second half without the first.
   */
  function trackJob(ref: WorkRef, tid: string | undefined): void {
    const read = ref.kind === "report" ? opts.getReport : opts.getJob;
    if (!read || !ref.id) return;
    if (tid) rememberJob(ref, tid);
    // The poll is started BEFORE the card guard below, deliberately: that guard
    // protects the CARD from being drawn twice, and a job whose card is already
    // up still needs its loop running (and its tiles fed) after a re-attach.
    watchJob(ref);
    // Idempotent per id, and it has to be: `reattachTrackedJobs` calls this
    // TWICE for the same job (once from browser storage, once when the server
    // listing resolves). The dedupe used to sit below the append, so the second
    // call drew a second card and overwrote the map entry — leaving the first
    // one orphaned in the log, repainted by nobody and frozen on "Queued"
    // forever. Bail before touching the DOM when the card is already on screen;
    // a stale entry left detached by a transcript wipe is rebuilt instead.
    const existing = jobCards.get(refKey(ref));
    if (existing?.isConnected) return;
    const card = el("div", `${PREFIX}-job`);
    paintJob(card, pendingJobView());
    log.appendChild(card);
    jobCards.set(refKey(ref), card);
    scrollDown(true);
  }

  /**
   * Work THIS session's user started by pressing a button, keyed like `jobCards`.
   *
   * The only thing that separates "the report you just asked me to write" from
   * "an import some other tab left running" — and the difference matters because
   * the first earns the app pane and the second must never take it. `trackJob`
   * cannot tell them apart on its own: it is called with a threadId from the
   * apply below AND from the server-listing re-attach, so the presence of a
   * thread proves nothing about who asked. The fact is recorded where the
   * confirmation actually happens instead.
   */
  const userConfirmedWork = new Set<string>();
  function trackConfirmedJob(ref: WorkRef): void {
    userConfirmedWork.add(refKey(ref));
    trackJob(ref, threadId);
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
    if (!(opts.getJob || opts.getReport) || !tid) return;
    jobCards.clear();
    // Browser storage FIRST so the card is back on the same tick as the
    // transcript — a job this device started is already known here, and waiting
    // on a round-trip would flash an empty conversation.
    for (const j of loadTrackedJobs()) {
      if (j.threadId === tid) trackJob(trackedRef(j), undefined);
    }
    // Then ask the SERVER what this thread actually has running. Storage only
    // knows what this browser started, so a job begun on a phone, or before
    // the cache was cleared, was invisible on every other device — the card
    // said nothing was happening while it ran. `trackJob` is idempotent
    // per id, so a job both sources know about is drawn once.
    const listRunning = opts.listThreadJobs;
    if (!listRunning) return;
    void listRunning(tid)
      .then((running) => {
        // The thread may have been switched while the request was in flight.
        if (threadId !== tid) return;
        // The listing is MULTI-SOURCE: it carries reports as well as generic
        // jobs, and each row's `type` is what says which. Deriving the ref
        // here — rather than assuming "job" — is what makes a report started
        // on another device re-attach to the right poller.
        for (const j of running) {
          const ref = refOf(j);
          if (ref) trackJob(ref, tid);
        }
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
    const { clean, notes, navs, uis } = stripDirectivesForReplay(text);
    const bubble = addMsg(log, "assistant", "");
    applyAssistantRich(bubble, clean);
    for (const n of notes) {
      const note = el("div", `${PREFIX}-replay-note`);
      note.textContent = n;
      log.appendChild(note);
    }
    // Composed cards are re-drawn in full — see the note in
    // stripDirectivesForReplay for why they are not flattened to a note.
    for (const u of uis) renderUiCard(u);
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
  /** The ↑in / ↓out tokens caption under an assistant reply — one builder for
   *  the live stream and the transcript replay so the two can never drift. */
  function usageBadge(inTok: number, outTok: number): HTMLElement {
    const cap = el("div", `${PREFIX}-usage`);
    cap.innerHTML =
      `<span class="${PREFIX}-usage-pill">↑ ${inTok.toLocaleString()}</span>` +
      `<span class="${PREFIX}-usage-pill">↓ ${outTok.toLocaleString()}</span>` +
      `<span class="${PREFIX}-usage-sep">·</span>` +
      `<span>${(inTok + outTok).toLocaleString()} tokens</span>`;
    return cap;
  }

  function renderThreadItems(
    items: LoadedThreadItem[],
    tid: string | undefined = threadId
  ): void {
    // A `question` card is NOT persisted server-side (unlike a data widget),
    // and this re-render runs at the END of every turn — which is
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
        addActivityChip(
          it.label,
          it.status,
          it.agent,
          it.model,
          it.reportId ? opts.reportHref?.(it.reportId) : undefined
        );
      } else if ("role" in it) {
        // The message's first DOM node — the anchor an edit/regenerate rewrites
        // the transcript FROM (bubble, or attachment row before it).
        const before = log.lastChild;
        if (it.role === "assistant") addAssistantMessage(it.content);
        else addMsg(log, it.role, it.content);
        // Persisted per-turn token caption — the live stream draws this under
        // the reply, but this reload runs right after the turn and used to
        // wipe it. Rendered from the stored counts so it also survives reopen
        // (and shows on the free staff lane, where it's insight, not billing).
        if (it.role === "assistant" && (it.inputTokens || it.outputTokens)) {
          log.appendChild(
            usageBadge(it.inputTokens ?? 0, it.outputTokens ?? 0)
          );
        }
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
  /**
   * The widget ASKING for a quality signal (#299).
   *
   * Everything else about this signal is passive, and passive on surfaces where
   * the control was invisible or absent — which is most of why the vote table is
   * near-empty. This is the one place the widget raises the question itself.
   *
   * TWO TRIGGERS, TWO QUESTIONS, on purpose. Prompting a slow-but-excellent
   * answer with "was this helpful?" teaches us "slow = bad", which we already
   * knew. So a long wait asks about the WAIT and offers thumbs; a failed turn
   * asks about the GOAL and takes words, because "what were you trying to do"
   * is the thing a failure destroys and no thumb can carry.
   *
   * It needs a messageId — a vote is a row against a message. A turn that
   * persisted nothing has none, and gets no prompt: the error card's existing
   * Report is the path there, and stacking a second ask on a failure is exactly
   * the noise this is supposed to avoid.
   */
  function renderQualityPrompt(
    variant: "slow" | "failed",
    messageId: string,
    model?: string
  ): void {
    if (!opts.vote) return;
    const card = el("div", `${PREFIX}-quality`);
    const title = el("div", `${PREFIX}-quality-title`);
    title.textContent = L(
      variant === "slow" ? "qualitySlowTitle" : "qualityFailedTitle"
    );
    card.appendChild(title);

    // A slow turn asks for a verdict; a failed one asks what was wanted, and
    // the words ARE the answer, so no thumbs on that variant.
    let picked: 1 | -1 | null = variant === "failed" ? -1 : null;
    const row = el("div", `${PREFIX}-quality-row`);
    if (variant === "slow") {
      const mk = (
        v: 1 | -1,
        label: string,
        icon: string
      ): HTMLButtonElement => {
        const b = el(
          "button",
          `${PREFIX}-msgact ${PREFIX}-vote`
        ) as HTMLButtonElement;
        b.type = "button";
        b.setAttribute("aria-label", label);
        b.title = label;
        b.innerHTML = icon;
        b.addEventListener("click", () => {
          picked = v;
          row
            .querySelectorAll(`.${PREFIX}-vote`)
            .forEach((n) => n.classList.remove(`${PREFIX}-vote-on`));
          b.classList.add(`${PREFIX}-vote-on`);
        });
        return b;
      };
      row.appendChild(mk(1, opts.voteUpLabel ?? "Helpful", ICON_THUMB_UP));
      row.appendChild(
        mk(-1, opts.voteDownLabel ?? "Not helpful", ICON_THUMB_DOWN)
      );
    }
    const reason = el("input", `${PREFIX}-quality-reason`) as HTMLInputElement;
    reason.type = "text";
    reason.maxLength = 500;
    reason.placeholder = L(
      variant === "slow"
        ? "qualityReasonPlaceholder"
        : "qualityFailedPlaceholder"
    );
    reason.setAttribute("aria-label", title.textContent);
    row.appendChild(reason);
    card.appendChild(row);

    const actions = el("div", `${PREFIX}-quality-actions`);
    const send = el("button", `${PREFIX}-quality-send`) as HTMLButtonElement;
    send.type = "button";
    send.textContent = L("qualitySend");
    const dismiss = el(
      "button",
      `${PREFIX}-quality-dismiss`
    ) as HTMLButtonElement;
    dismiss.type = "button";
    dismiss.textContent = L("qualityDismiss");
    dismiss.addEventListener("click", () => card.remove());
    send.addEventListener("click", () => {
      const text = reason.value.trim();
      // Nothing said and nothing picked is a dismissal, not a datapoint.
      if (picked === null && !text) {
        card.remove();
        return;
      }
      send.disabled = true;
      void opts.vote!({
        threadId: threadId ?? "",
        messageId,
        value: picked ?? -1,
        ...(model ? { model } : {}),
        ...(text ? { reason: text } : {}),
      })
        .then(() => {
          card.textContent = L("qualityThanks");
          card.classList.add(`${PREFIX}-quality-done`);
        })
        .catch(() => {
          send.disabled = false;
        });
    });
    actions.append(send, dismiss);
    card.appendChild(actions);
    log.appendChild(card);
    scrollDown();
  }

  // Threads already asked for a quality signal THIS SESSION. At most once per
  // thread per session (#299): a widget that asks after every slow turn is a
  // widget people learn to dismiss without reading.
  const qualityAsked = new Set<string>();
  /** Turns completed per thread this session — the "never on the first turn"
   *  half of the rule above. */
  const threadTurns = new Map<string, number>();

  function buildVoteButtons(messageId: string, model?: string): HTMLElement {
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
        .vote({
          threadId: threadId ?? "",
          messageId,
          value,
          ...(model ? { model } : {}),
        })
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
      if (canVote)
        rowEl.appendChild(
          buildVoteButtons(item.id as string, item.model ?? undefined)
        );
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

  /**
   * Paint the opening view: a restored conversation, or the greeting.
   *
   * DEFINED HERE, CALLED AT THE END OF SETUP — and that is the whole point.
   * Restoring runs the ordinary render path, and those renderers read widget
   * state (`advanced`, and whatever a future card reaches for) declared with
   * `let` further down this same scope. Running the restore inline, where it
   * used to be, therefore read a binding in its temporal dead zone the moment a
   * restored message carried a `[[navigate]]` directive: renderNavigate touched
   * `advanced` ~700 lines before its declaration executed.
   *
   * The blast radius was the whole app, not the widget. The throw escaped the
   * factory, React's error boundary caught it, and ui-admin rendered "Something
   * went wrong" on EVERY route. Worse, the trigger was persisted: the offending
   * transcript sat in localStorage, so the crash survived every reload and the
   * only way out was clearing site data. Using the assistant broke the app.
   *
   * A render is not startup work. Do it once the state it renders against
   * exists.
   */
  function paintOpeningView(): void {
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
    // Persisted history is TEXT-ONLY (data widgets aren't stored in
    // localStorage), so on refresh the charts/tables were lost. If we have the
    // thread id + a loader, re-fetch the full thread and re-render WITH its
    // widgets — matching reopen-from-history. Async + best-effort; the text
    // restore above is the instant fallback.
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
        ? L("meterTokensLeft", { count: quotaRemaining.toLocaleString() })
        : L("meterFreePreview");
    const usedTxt = L("meterUsedThisSession", {
      count: sessionUsed.toLocaleString(),
    });
    meterEl.innerHTML = `<div class="${PREFIX}-meter-bar"><span style="transform:scaleX(${pct / 100})"></span></div><div class="${PREFIX}-meter-row"><span>${escapeHtml(remTxt)}</span><span>${escapeHtml(usedTxt)}</span></div>`;
  }

  // Authed status bar — remaining credits + the active Copilot role. Shown only
  // when a balance provider is wired (org + admin), independent of the visitor
  // token meter above.
  const ROLE_NAMES: Record<string, string> = {
    talk: L("roleTalk"),
    analytics: L("roleAnalytics"),
  };
  // Which role an in-app ACTION belongs to, so the badge reflects the live task.
  const ACTION_ROLE: Record<string, string> = {
    "open-dashboards": "analytics",
    "open-dashboard-builder": "analytics",
  };
  // Which role a live TOOL (activity step) belongs to — flips the badge from
  // Talk to Analytics as the agent actually queries data / builds.
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
    // null = "not credit-driven here" (the free staff lane): hide the credits
    // chip entirely — a dash read as a broken balance, and there is nothing
    // to show. The role indicator stays.
    statusCreditsEl.style.display = creditBalance === null ? "none" : "";
    if (creditBalance !== null && !creditRaf) {
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
    // Same null-hides-the-chip rule as renderStatus (free staff lane).
    statusCreditsEl.style.display = creditBalance === null ? "none" : "";
    if (creditBalance === null) {
      /* chip hidden */
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

  // Session artifacts — media scraped or imported in THIS conversation, hidden
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
  // uploads session-scoped (never into the asset library), and stages refs for
  // the next turn.
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
      label.textContent = `${attIcon(a.kind)} ${a.filename}`;
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
  // Max size for one attachment — the shared transport cap. NOTE the api's
  // TURN-time caps are tighter per kind (5 MB image vision block, 12 MB native
  // PDF — see @sgiant/shared chat-attachment-limits); an oversize image still
  // uploads but resolves as a skipped note the model sees.
  const MAX_ATT_BYTES = CHAT_ATTACHMENT_MAX_BYTES;
  /** A clip or track gets a far bigger allowance than a document: a 30-second
   *  1080p phone video is already past the document cap, so the everyday case
   *  would be refused for being ordinary. Video/audio is referenced by id and
   *  never sent to the model inline, so this bounds an upload, not a prompt. */
  const attCap = (file: File): number =>
    /^(video|audio)\//i.test(file.type)
      ? CHAT_ATTACHMENT_MAX_AV_BYTES
      : MAX_ATT_BYTES;
  const capLabel = (bytes: number): string =>
    `${Math.round(bytes / (1024 * 1024))} MB`;
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
      for (const file of Array.from(files).slice(
        0,
        CHAT_ATTACHMENT_MAX_COUNT
      )) {
        if (stagedAtts.length >= CHAT_ATTACHMENT_MAX_COUNT) break;
        const cap = attCap(file);
        if (file.size > cap) {
          attError(`"${file.name}" is too large (max ${capLabel(cap)})`);
          continue;
        }
        const fd = new FormData();
        fd.append("file", file);
        // Chat attachments are SESSION-scoped: reachable from the chat history
        // by id, but never filed into the asset library.
        fd.append("session", "1");
        if (threadId) fd.append("threadId", threadId);
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
      "image/*,video/*,audio/*,.svg,application/pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.md,.json,.yaml,.yml";
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
    // Paste-to-attach: a screenshot (or copied file) pasted into the composer
    // becomes a staged attachment — the same pipeline as the paperclip. Only
    // intercept when the clipboard actually carries files; plain text pastes
    // fall through untouched.
    input.addEventListener("paste", (e) => {
      const files = (e as ClipboardEvent).clipboardData?.files;
      if (files && files.length) {
        e.preventDefault();
        void uploadFiles(files);
      }
    });
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
    viewGen++; // fence: any in-flight turn stops painting into this view
    threadId = undefined;
    paintStarItem();
    history.length = 0;
    saveState();
    clearRich();
    log.innerHTML = "";
    if (opts.greeting) addAssistantMessage(opts.greeting);
    syncBusy();
    void renderSuggestions();
    void refreshArtifacts();
  };

  const open = (prefill?: unknown, forceNew?: boolean): void => {
    // The first-visit pill has done its job the moment it is opened, and an
    // unread count is answered by reading the thread (#305).
    markOpened();
    setLauncher({ variant: "pebble", state: "resting", count: 0 });
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
    // Same reason: a leftover keyboard flag would suppress the safe-area
    // padding on the next open, with no keyboard to justify it.
    panel.classList.remove(`${PREFIX}-kb`);
    bubble.style.display = "flex";
    rememberOpen(false);
  };
  const toggle = (): void =>
    panel.style.display === "none" ? open() : close();

  bubble.addEventListener("click", open);
  closeBtn.addEventListener("click", close);

  // Swipe-down-to-close (mobile bottom sheet). Dragging the header/grab-handle
  // pulls the panel down with the finger; releasing past a threshold dismisses
  // it, otherwise it springs back. No-op on desktop widths — `isSheet` is
  // declared next to `applyPos`, which needs it at mount.

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
        panel.style.bottom = "";
        panel.classList.remove(`${PREFIX}-kb`);
        // Desktop / non-sheet: the panel's `top` is owned by the drag-to-
        // reposition logic, NOT the keyboard handler. Clearing it here dropped a
        // dragged panel to `top:auto` → off-screen, and a refresh re-stranded it.
        // Restore the saved position (or the CSS corner) instead of clobbering it.
        applyPos(readPos());
        return;
      }
      panel.style.height = `${vv.height}px`;
      panel.style.top = `${vv.offsetTop}px`;
      // The sheet's CSS is `inset:0`, so `bottom:0` is still in play. top +
      // height + bottom is over-constrained; engines are entitled to resolve
      // that differently, and the one that honours `bottom` stretches the
      // panel back under the keyboard. Pin it to auto so the height we just
      // measured is the height that renders.
      panel.style.bottom = "auto";
      // Keyboard up ⇒ the home indicator is covered, so drop the safe-area
      // padding that iOS still reports (see the -kb rules).
      panel.classList.toggle(
        `${PREFIX}-kb`,
        vv.height < window.innerHeight - 80
      );
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
    panel.style.transition = "transform var(--duration-fast) var(--ease-out)";
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

  /**
   * THE PATH THE WIDGET LAST ASKED THE FRAME TO SHOW.
   *
   * Compared against where the frame ACTUALLY is on every load, which is how
   * "the user has driven the frame themselves" is detected: the pane hosts our
   * own app, so a click inside it navigates the iframe without going through
   * `navigateFrame` at all. Same-origin by construction (`isSafeFrameUrl`), so
   * the location is readable — but still guarded, because a frame mid-load has
   * no document to ask.
   */
  let frameRequestedPath: string | null = null;
  /** True once the frame has gone somewhere the widget did not send it. Blocks
   *  auto-navigation, so a report finishing never yanks a reader off the page
   *  they chose. */
  let frameUserDriven = false;

  const framePath = (): string | null => {
    try {
      return advFrame?.contentWindow?.location?.pathname ?? null;
    } catch {
      // Cross-origin should be impossible here, but a frame that has not
      // committed a document yet can also throw. Unknown, not "user drove it".
      return null;
    }
  };

  /** Point the frame at a full URL (a full document load — the embedded app boots
   *  at that route and re-mounts its agent). */
  const navigateFrame = (url: string): void => {
    if (!advFrame) return;
    // Untrusted target (cross-origin, protocol-relative or a `javascript:`
    // payload smuggled through a model-authored path) — refuse silently.
    if (!isSafeFrameUrl(url)) return;
    try {
      frameRequestedPath = new URL(url, location.origin).pathname;
    } catch {
      frameRequestedPath = null;
    }
    advFrame.src = url;
    setFrameUrlLabel(url);
  };

  /**
   * Follow a long operation into the pane — ONCE, and never over the user.
   *
   * A report tells the reader to "watch it build" and then leaves the frame
   * wherever it was, so watching it meant clicking. This does the click. Four
   * conditions, and each one is a way this could be obnoxious instead of
   * helpful:
   *
   *  - advanced view only. In floating mode there is no pane to move, and
   *    navigating the whole PAGE out from under someone because a background
   *    job started is not the same feature.
   *  - only work the user confirmed in THIS session (`userConfirmedWork`).
   *    Tracked jobs are restored from localStorage and re-discovered from the
   *    server listing, so a card can appear for an import another tab (or
   *    another device) started; `openAdvanced` clears `autoNavigated` for a
   *    fresh session, and without this condition the first poll after opening
   *    the pane would send it to that job's page.
   *  - not if the user has driven the frame since (`frameUserDriven`). They
   *    chose that page; a job finishing is not permission to leave it.
   *  - once per operation (`autoNavigated`). A poll runs every couple of
   *    seconds; re-navigating on each one would reload the page continuously
   *    and make it unreadable — which is the exact opposite of watching it
   *    build.
   */
  const autoNavigated = new Set<string>();
  const autoNavigateFrame = (key: string, path: string): void => {
    if (!advFrame || !opts.getAdvancedUrl) return;
    if (
      !shouldAutoNavigate({
        advanced,
        canNavigate: true,
        userConfirmedThisSession: userConfirmedWork.has(key),
        userDriven: frameUserDriven,
        alreadyFollowed: autoNavigated.has(key),
        path,
        currentPath: framePath() ?? frameRequestedPath,
      })
    ) {
      return;
    }
    autoNavigated.add(key);
    navigateFrame(opts.getAdvancedUrl(path));
  };

  /** Is the pane already showing this path? Drives the narration collapse —
   *  see `renderJobCard`. Compared on pathname: a query string is a filter
   *  within the same page, not a different destination. */
  const frameShowing = (path: string | null | undefined): boolean =>
    shouldCollapseNarration({
      advanced,
      livePath: path,
      currentPath: framePath() ?? frameRequestedPath,
    });

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
    // THE USER CAN DRIVE THIS FRAME WITHOUT US. It hosts our own app, so a
    // click inside it navigates the iframe directly — `navigateFrame` never
    // hears about it. Comparing where it LANDED against where we last asked it
    // to go is the only honest signal, and it is what stops a finishing job
    // from yanking someone off a page they chose to open.
    frame.addEventListener("load", () => {
      const here = framePath();
      if (!here) return;
      setFrameUrlLabel(here);
      if (frameRequestedPath === null) {
        // We never asked for anything and it moved: the user did.
        frameUserDriven = true;
        return;
      }
      if (here !== frameRequestedPath) frameUserDriven = true;
    });
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
    disposePaneWidget();
    pane.innerHTML = "";
  };

  /* ------------------------------------------------------------------ *
   * THE PANE IS A UNION: a ROUTE, or a WIDGET.
   *
   * It could only ever be `<iframe src>`, so anything the assistant computed —
   * a chart, a proposed dashboard, a preview — had to become a real route
   * before it could be shown at full size. The one that mattered most is the
   * ordinary case: "chart my revenue by channel" produced a picture squeezed
   * into a 368px chat column while a whole half-screen sat next to it showing
   * a page nobody was reading.
   *
   * EITHER/OR, not a layering. The frame is torn down when a widget takes the
   * pane and rebuilt when the route comes back — leaving a live iframe behind
   * an overlay would keep its app mounted, its polls running and its agent
   * bridge connected, invisibly.
   *
   * The widget half reuses `renderDataWidget` — the SAME host renderer the
   * chat log uses — so there is one rendering path, one validation story and no
   * second widget vocabulary. The host draws a real `<WidgetRender>` with its
   * actual data; the pane is not a picture of one.
   * ------------------------------------------------------------------ */
  let paneWidgetDispose: (() => void) | null = null;
  const disposePaneWidget = (): void => {
    const d = paneWidgetDispose;
    paneWidgetDispose = null;
    if (!d) return;
    try {
      d();
    } catch {
      /* a renderer that throws on unmount must not wedge the pane */
    }
  };

  /** True while the pane is showing a computed widget rather than a route. */
  let paneShowsWidget = false;

  const showPaneRoute = (): void => {
    if (!paneShowsWidget) return;
    paneShowsWidget = false;
    disposePaneWidget();
    buildFrame();
    if (opts.getAdvancedUrl) navigateFrame(opts.getAdvancedUrl());
  };

  /**
   * Put a computed widget in the pane. Returns false when the host wired no
   * renderer — the caller then keeps it in the chat log, which is where it went
   * before this existed.
   */
  const showPaneWidget = (
    spec: unknown,
    rows: unknown,
    comparisonRows?: unknown
  ): boolean => {
    if (!advanced || !opts.renderDataWidget) return false;
    teardownFrame();
    paneShowsWidget = true;
    const bar = el("div", `${PREFIX}-pane-bar`);
    const back = el("button", `${PREFIX}-icon`) as HTMLButtonElement;
    back.type = "button";
    // The way BACK to the page. Without it the pane is a dead end and the only
    // exit is leaving advanced view entirely.
    back.setAttribute("aria-label", L("paneBackToPage"));
    back.title = L("paneBackToPage");
    back.innerHTML = ICON_CHEVRON_R;
    back.addEventListener("click", () => showPaneRoute());
    const label = el("div", `${PREFIX}-pane-url`);
    label.textContent = L("paneShowingWidget");
    bar.append(back, label);
    const body = el("div", `${PREFIX}-pane-body`);
    const host = el("div", `${PREFIX}-pane-widget`);
    body.append(host);
    pane.append(bar, body);
    try {
      const dispose = opts.renderDataWidget(host, spec, rows, comparisonRows);
      if (dispose) paneWidgetDispose = dispose;
    } catch {
      // A renderer that throws must not leave an empty half-screen: fall back
      // to the route and let the caller put it in the log.
      showPaneRoute();
      return false;
    }
    return true;
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
    // A fresh advanced session: the user has not driven anything yet, and any
    // operation that auto-navigated in a PREVIOUS session may do so again.
    frameUserDriven = false;
    autoNavigated.clear();
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
   * navigation-class action → the iframe's URL. Otherwise (and for any
   * app-specific handlers) it falls back to the host's `onWidgetAction`.
   */
  const dispatchAction = async (
    name: string,
    data: Record<string, string>
  ): Promise<string | void> => {
    // Every navigation — frame or host router — goes through the one gate.
    // It THROWS on refusal, which is what makes the chip go red instead of
    // ticking green over a path we declined.
    if (name === "navigate")
      await gateNavigationTarget(
        data.path,
        () => knownNavTargets,
        refreshNavTargets
      );
    if (advanced && transport) {
      if (isUiControlAction(name) || isOperateAction(name)) {
        const r = await transport.act(name as BridgeAction, {
          target: data.target ?? "",
          ...(data.value !== undefined ? { value: data.value } : {}),
        });
        return r.ok
          ? L("actionShownOnPage")
          : r.message || L("actionPageFailed");
      }
      const candidate =
        name === "navigate"
          ? (data.path ?? null)
          : (opts.resolveActionPath?.(name, data) ?? null);
      // Only root-relative in-app routes may be handed to `getAdvancedUrl`.
      const relPath = isSafeRelPath(candidate) ? candidate : null;
      if (relPath != null && opts.getAdvancedUrl) {
        navigateFrame(opts.getAdvancedUrl(relPath));
        return L("actionOpened");
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
        // A response is in flight for this conversation — show it working.
        if (isThreadPending(th.id)) {
          const spin = el("span", `${PREFIX}-act-spin`);
          spin.title = L("threadAnswering");
          spin.setAttribute("aria-label", L("threadAnswering"));
          item.appendChild(spin);
        }
        if (th.updatedAt) {
          const dt = el("span", `${PREFIX}-history-date`);
          dt.textContent = relTime(th.updatedAt);
          item.appendChild(dt);
        }
        // Shared star toggle — team-visible bookmark on the conversation.
        if (opts.starThread) {
          const star = el("span", `${PREFIX}-history-star`);
          let on = Boolean(th.starred);
          // The list is the only place star state is READ, so it is also where
          // the menu row learns it.
          starredThreads.set(th.id, on);
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
                starredThreads.set(th.id, on);
                paintStarItem();
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
    /** The History overlay when opened from the list; absent when a HOST
     *  surface re-enters a conversation directly, which has no overlay to
     *  close and no list to write errors to. */
    overlay?: HTMLElement
  ): Promise<void> {
    if (!opts.loadThread) return;
    try {
      const items = await opts.loadThread(id);
      viewGen++; // fence: an in-flight turn from the previous view goes silent
      // Replace the visible conversation with the chosen thread (messages +
      // inline data widgets). renderThreadItems clears rich roots + the log.
      renderThreadItems(items, id);
      threadId = id;
      paintStarItem();
      syncBusy();
      saveState();
      void refreshArtifacts();
      overlay?.remove();
    } catch {
      if (overlay) {
        overlay.querySelector(`.${PREFIX}-history-list`)!.textContent =
          L("threadOpenFailed");
      } else {
        // No overlay to report into — say it in the conversation itself.
        addActivityChip(L("historyLoadFailed"), "error");
      }
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
        /** Re-enter an EXISTING conversation — a host surface lands the
         *  client back in the thread it came from. Wins over prompt/newChat:
         *  the point is the conversation that already exists. */
        threadId?: string;
      }>
    ).detail;
    if (detail?.threadId) {
      open();
      void loadPastThread(detail.threadId);
      if (detail?.advanced) openAdvanced();
      return;
    }
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
  //
  // ADVANCED VIEW RESTORES TOO, and did not for its whole life: every toggle
  // called `rememberAdvanced()` and wrote `ayca:adv:<persistKey>`, but nothing
  // ever read that key back — `advanced` was initialised `false` and stayed
  // false. A write with no reader, so the flag was perfectly maintained and
  // never consulted. Anyone working in the split view lost it on every refresh
  // and landed back in the small floating widget: the transcript and the thread
  // came back (those keys ARE read), the working surface did not, which reads
  // as "the chat didn't continue".
  //
  // Order matters — advanced is a layout of the OPEN panel, so it can only be
  // entered after open(). openAdvanced() no-ops without `getAdvancedUrl`, so a
  // host that doesn't offer the view is unaffected.
  try {
    if (openStateKey && localStorage.getItem(openStateKey) === "1") {
      open();
      if (advKey && localStorage.getItem(advKey) === "1") openAdvanced();
    }
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
    // Composed UI cards — the assistant's own layout, drawn from primitives.
    for (let i = 0; i < 4; i++) {
      const u = parseJsonDirective<unknown>(t, "ui");
      if (!u) break;
      t = u.stripped;
      renderUiCard(u.spec);
    }
    // Dynamic HTML previews — the AI draws a mockup/preview and we paint it in a
    // FULLY sandboxed iframe (no scripts, no same-origin) right in the chat.
    for (let i = 0; i < 3; i++) {
      const p = parseJsonDirective<PreviewSpec>(t, "preview");
      if (!p || typeof p.spec.html !== "string") break;
      t = p.stripped;
      renderPreview(p.spec);
    }
    // STRIP FIRST, RENDER SECOND — and strip even when nothing can render it.
    //
    // These two used to be gated on `opts.onWidgetAction`, so a host that wires
    // no actions never reached the strip and the raw `[[navigate:{...}]]` was
    // printed to the reader as text. Seen live on the public demo, whose whole
    // job is to impress a prospect. The comment below already said "strip the
    // directive either way"; the condition above it prevented exactly that.
    //
    // The model emits these because the system prompt offers them, which no
    // host can switch off — so "no handler" is a normal state, not a misuse.
    const nav = parseJsonDirective<NavigateSpec>(t, "navigate");
    if (nav) {
      t = nav.stripped;
      // Only offer/auto-follow a target that is a plain root-relative in-app
      // route, and only when a host can actually act on it.
      if (opts.onWidgetAction && nav.spec.path && isSafeRelPath(nav.spec.path))
        renderNavigate(nav.spec);
    }
    for (let i = 0; i < 4; i++) {
      const act = parseJsonDirective<ActionSpec>(t, "action");
      if (!act) break;
      t = act.stripped;
      if (opts.onWidgetAction && act.spec.name) renderAction(act.spec);
    }
    // Quick-reply chips — tappable answer options for a choice question.
    const chips = parseJsonDirective<ChipsSpec>(t, "chips");
    if (chips && Array.isArray(chips.spec.options)) {
      t = chips.stripped;
      renderChips(chips.spec);
    }
    const form = parseFormDirective(t);
    if (form) {
      // Same rule: the markup never survives to the reader, with or without a
      // host that can submit it.
      t = form.stripped;
      if (opts.onWidgetAction || opts.onLead) renderForm(form.spec);
    } else if (t.includes(LEAD_TOKEN)) {
      t = t.replace(LEAD_TOKEN, "").trim();
      if (!(opts.onLead || opts.onWidgetAction)) return linkifyProseNav(t);
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
    add_scraped_media: L("proposalAddImage"),
    organize_assets: L("proposalEditAsset"),
    edit_asset: L("proposalSaveFile"),
    create_asset: L("proposalCreateFile"),
    share_asset: L("proposalShareAsset"),
    save_artifact_to_assets: L("proposalSaveArtifact"),
    mcp__sgiant__api_request: L("proposalApiRequest"),
    generate_report: L("proposalGenerateReport"),
    ingest_website: L("proposalIngestWebsite"),
    run_browser_flow: L("proposalRunBrowserFlow"),
    set_account_settings: L("proposalSetAccountSettings"),
    manage_folders: L("proposalManageFolders"),
    apply_dashboard: L("proposalApplyDashboard"),
    save_template: L("proposalSaveTemplate"),
    wp_upsert_post: L("proposalWordpressDraft"),
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
      const restricted = args.audience === "restricted";
      const recipients = Array.isArray(args.recipients)
        ? args.recipients.filter((e) => typeof e === "string")
        : [];
      const parts = [
        restricted
          ? `Share ${what} with ${recipients.length ? recipients.join(", ").slice(0, 120) : "specific people"} (email-verified)`
          : `Share ${what} publicly`,
      ];
      if (!restricted && typeof args.password === "string" && args.password)
        parts.push("password-protected");
      if (typeof args.expiresInDays === "number" && args.expiresInDays > 0)
        parts.push(`expires in ${args.expiresInDays}d`);
      const sendTo = Array.isArray(args.sendTo) ? args.sendTo.length : 0;
      if (sendTo) parts.push(`emailed to ${sendTo}`);
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
    if (name === "wp_upsert_post") {
      const title = typeof args.title === "string" ? args.title : "Untitled";
      const type =
        typeof args.type === "string" && args.type ? args.type : "post";
      const content = typeof args.content === "string" ? args.content : "";
      const preview = content.replace(/<[^>]+>/g, "").slice(0, 200);
      return `Draft ${type}: ${title}\n${preview}${content.length > 200 ? "…" : ""}`;
    }
    // A report is one small card with minutes of consequences — say what will
    // happen, not just the raw args.
    if (name === "generate_report") {
      const lines = [String(args.request ?? "")];
      if (typeof args.title === "string" && args.title)
        lines.push(L("reportCardTitle", { title: String(args.title) }));
      lines.push(
        L("reportCardPeriod", {
          from: String(args.dateFrom ?? "?"),
          to: String(args.dateTo ?? "?"),
        })
      );
      // Staff-plane scope: the one fact that distinguishes a fleet report
      // from a single-account one belongs ON the card being approved.
      if (args.allAccounts === true) {
        lines.push(L("reportCardAllAccounts"));
      } else if (
        Array.isArray(args.subjectAccountIds) &&
        args.subjectAccountIds.length > 0
      ) {
        lines.push(
          L("reportCardNAccounts", { count: args.subjectAccountIds.length })
        );
      }
      // NOT "lands as a PDF in Assets → <folder>". It does not land anywhere:
      // the deliverable is a page, and `folderName` only pre-picks the shelf
      // for a PDF the client may later choose to save. Promising a file on the
      // card the user APPROVES is the worst place to get this wrong.
      lines.push(L("reportCardOutcome"));
      lines.push(L("reportCardBackground"));
      return lines.filter(Boolean).join("\n");
    }
    return Object.entries(args)
      .filter(([k]) => k !== "id")
      .map(([k, v]) => `${k}: ${describeArg(v)}`)
      .join("\n");
  }

  /**
   * One argument value, as a person can actually read it.
   *
   * `String(v)` on anything structured yields "[object Object]" — and on a list
   * of them, "[object Object],[object Object],[object Object]". A confirm card
   * that says that is asking the client to approve something they cannot see,
   * which is the one thing a confirm card must never do. Seen for real on a
   * three-scene storyboard: the whole point of the card is that the client
   * agrees the PLAN, and the plan was invisible.
   *
   * Deliberately a SUMMARY, not a JSON dump — a raw blob is technically honest
   * and just as unreadable. Objects are described by whichever of the handful
   * of naming fields they carry, so a scene reads as its title.
   */
  function describeArg(v: unknown, depth = 0): string {
    if (v === null || v === undefined) return "—";
    if (Array.isArray(v)) {
      if (!v.length) return "(none)";
      // Nested lists are summarised by count rather than expanded: a card is a
      // glance, not a document.
      if (depth > 0) return `${v.length} items`;
      return v.map((x) => `\n  • ${describeArg(x, depth + 1)}`).join("");
    }
    if (typeof v === "object") {
      const rec = v as Record<string, unknown>;
      // The fields something calls itself by, in the order a human would look.
      const named = ["title", "name", "label", "key", "id"]
        .map((k) => (typeof rec[k] === "string" ? (rec[k] as string) : ""))
        .find(Boolean);
      const detail =
        typeof rec.prompt === "string"
          ? rec.prompt
          : typeof rec.caption === "string"
            ? rec.caption
            : typeof rec.description === "string"
              ? rec.description
              : "";
      if (named || detail)
        return [named, detail && `— ${detail.slice(0, 90)}`]
          .filter(Boolean)
          .join(" ");
      // Nothing self-describing: name its shape rather than lie about it.
      const keys = Object.keys(rec);
      return keys.length ? `{${keys.slice(0, 4).join(", ")}}` : "{}";
    }
    return String(v);
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
    proposalAccountId?: string,
    /** The persisted artifact a dashboard/template apply needs. */
    proposalArtifactId?: string
  ): void {
    // `-pending` marks a card that is still AWAITING the user, and it is what
    // the end-of-turn reload checks. The reload used to look for `-proposal`,
    // which also matches an already-applied card (the success path empties the
    // node but keeps the class) — so one Apply disabled the reload for the
    // whole session and with it every edit/regenerate/branch control.
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
    // Show the acting agent (e.g. Vega) so the user sees WHO proposed this.
    if (agent) {
      const badge = el("span", `${PREFIX}-act-agent`);
      badge.textContent = agent;
      badge.style.marginRight = "6px";
      title.appendChild(badge);
    }
    title.appendChild(
      document.createTextNode(PROPOSAL_LABELS[name] ?? L("proposalGeneric"))
    );
    wrap.appendChild(title);
    let disposePreview: (() => void) | undefined;
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
      try {
        // Carry the originating thread on EVERY apply — session-scoped asset
        // writes (scraped imports) use it to keep chat debris out of the
        // library until explicitly saved. Tools that don't care simply
        // ignore the extra key.
        const res = await opts.onApplyProposal!(
          name,
          threadId ? { ...edited, threadId } : edited,
          // `artifactId` travels beside the account: the dashboard/template
          // applies are the two that cannot be reconstructed from `args` alone.
          proposalAccountId || proposalArtifactId
            ? {
                ...(proposalAccountId ? { accountId: proposalAccountId } : {}),
                ...(proposalArtifactId
                  ? { artifactId: proposalArtifactId }
                  : {}),
              }
            : undefined
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
          `<span>${escapeHtml(stripTick(msg || L("applied")))}</span>`;
        wrap.appendChild(ok);
        // A REPORT is a document, not just a task: once it exists it has a
        // page, and the useful thing to hand the user is a way in.
        const reportId =
          res && typeof res === "object" ? res.reportId : undefined;
        // TRACK THE REPORT, NOT ITS JOB ROW. Both ids come back today, but the
        // generic row is being retired — a card polling it would go blind the
        // moment the contract migration lands, and it would go blind SILENTLY,
        // stuck on "Queued" forever rather than erroring. Prefer the id that
        // will still exist; fall back to the job id for work that has no
        // report (an import, a render).
        if (reportId) trackConfirmedJob({ kind: "report", id: reportId });
        else if (jobId) trackConfirmedJob({ kind: "job", id: jobId });
        const href = reportId ? opts.reportHref?.(reportId) : undefined;
        if (href) {
          const open = el("a", `${PREFIX}-proposal-link`) as HTMLAnchorElement;
          open.href = href;
          open.textContent = L("openReport");
          ok.appendChild(open);
        }
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

  /**
   * Stream-loss recovery. The api runs a turn to completion and persists the
   * transcript even when the browser's stream dies (QUIC/proxy drops — seen
   * live: the reply landed 8 minutes after the client lost the connection).
   * So a transport failure is NOT a failed turn: keep the thread marked
   * "answering…" (which also blocks double-sending into it) and poll until
   * THIS turn's exchange lands, then show it. The transcript is persisted at
   * turn END (the user message and the reply arrive together), so the signal
   * is "the last user message is the one we sent, followed by an assistant
   * reply" — merely seeing a trailing assistant message would false-positive
   * on the PREVIOUS exchange in an existing thread. `sentContent` is null for
   * a regenerate (no new user message; any trailing reply counts). Bounded at
   * 15 minutes; on timeout the thread simply unlocks and the reply — if any —
   * shows on its next open.
   */
  async function recoverLostTurn(
    turnThread: string,
    sentContent: string | null
  ): Promise<void> {
    if (!opts.loadThread) return;
    pendingThreads.add(turnThread);
    syncBusy();
    try {
      for (let i = 0; i < 90 && !alive.signal.aborted; i++) {
        await new Promise((r) => setTimeout(r, 10_000));
        if (alive.signal.aborted) return;
        let items: LoadedThreadItem[];
        try {
          items = await opts.loadThread(turnThread);
        } catch {
          continue; // transient — the same outage that killed the stream
        }
        const msgs = items.filter(
          (it): it is Extract<LoadedThreadItem, { role: string }> =>
            "role" in it
        );
        const last = msgs[msgs.length - 1];
        if (!last || last.role !== "assistant") continue;
        if (sentContent !== null) {
          const lastUser = [...msgs].reverse().find((m) => m.role === "user");
          if (!lastUser || lastUser.content.trim() !== sentContent.trim())
            continue; // still the PREVIOUS exchange — our turn hasn't landed
        }
        pendingThreads.delete(turnThread);
        syncBusy();
        if (threadId === turnThread) {
          renderThreadItems(items, turnThread);
          maybeDing();
          scrollDown();
          saveState();
        }
        return;
      }
    } finally {
      pendingThreads.delete(turnThread);
      syncBusy();
    }
  }

  async function send(
    content: string,
    fork?: { parentId?: string | null; regenerate?: boolean }
  ): Promise<void> {
    // A regenerate re-answers an existing user turn — it carries no new user
    // message, so it must NOT push a user bubble to the DOM / history.
    const isRegen = fork?.regenerate === true;
    // Turn fence: this turn renders only while the user is still on the view
    // it started from. `turnThread` is the thread the reply BELONGS to (fixed
    // once the server names it); `live()` gates every visible side effect.
    const myGen = viewGen;
    let turnThread: string | undefined = threadId;
    const live = (): boolean => viewGen === myGen && !alive.signal.aborted;
    pendingThreads.add(turnThread ?? NEW_TURN_KEY);
    syncBusy();
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
      /** The artifact a dashboard/template apply needs — the runner emits it,
       *  and until now nothing on this side carried it. */
      artifactId?: string;
    }> = [];
    let turnIn = 0;
    let turnOut = 0;
    let failure: string | null = null;
    // Stamped by the turn's `done` frame — the handle for rating the answer
    // just streamed, on surfaces where no canonical reload paints one (#299).
    let liveMessageId: string | undefined;
    let liveModel: string | undefined;
    // Wall-clock for the quality prompt's 20s trigger — comfortably past a
    // normal tool-using answer and far short of the 300s ceiling.
    const turnStartedAt = Date.now();
    let transportLost = false;
    // Chars of assistantRaw already painted into the streaming bubble. The
    // display can lag behind assistantRaw: directive bytes ([[tag:{json}]])
    // are withheld from view while they stream (see processStreamDisplay).
    let shownLen = 0;
    // Close the current text bubble and render its markdown, so the NEXT thing
    // (a widget/activity, or more text) lands AFTER it — keeping the reply in
    // true order instead of dumping widgets below all the text. `final` also
    // parses inline directives. Returns the rendered bubble (for the token tag).
    const flushSegment = (final: boolean): HTMLElement | null => {
      const bubble = assistant;
      // On a NON-final flush, bake only what the user has SEEN and carry the
      // withheld tail (a directive still streaming) into the next segment —
      // baking half a [[widget:{…}]] would show raw JSON AND orphan its tail.
      let raw = final ? assistantRaw : assistantRaw.slice(0, shownLen);
      assistantRaw = final ? "" : assistantRaw.slice(shownLen);
      shownLen = 0;
      if (!bubble) return null;
      assistant = null;
      bubble.classList.remove(`${PREFIX}-streaming`);
      if (!raw.trim()) {
        bubble.remove();
        return null;
      }
      if (final) raw = renderDirectives(raw);
      history.push({ role: "assistant", content: raw });
      // A reply that arrived while the panel was CLOSED is the one thing the
      // launcher has ever needed to say and could not (#305). Counted here, at
      // the moment a reply is recorded, rather than from a transcript diff —
      // the diff would also count the replies the reader has already seen.
      if (panel.style.display === "none") {
        setLauncher({ state: "unread", count: launcher.count + 1 });
      }
      applyAssistantRich(bubble, raw, true);
      return bubble;
    };
    // ---- Directive-aware streaming display --------------------------------
    // Directives ([[tag:{json}]]) arrive INSIDE the text stream. They used to
    // scroll by as raw JSON and only become cards when the turn finished. Now
    // the stream painter WITHHOLDS directive bytes as they arrive, and purely
    // visual cards (widget / preview / custom tags) render the moment their
    // JSON completes — mid-reply, in true order. Side-effecting directives
    // (navigate / action / chips / form) stay hidden in assistantRaw for the
    // end-of-turn renderDirectives pass, unchanged.
    const streamDirectiveTag = (tag: string): "now" | "later" | null => {
      if (
        tag === "widget" ||
        tag === "ui" ||
        tag === "preview" ||
        customRenderers[tag]
      )
        return "now";
      if (
        tag === "navigate" ||
        tag === "action" ||
        tag === "chips" ||
        tag === "form"
      )
        return "later";
      return null;
    };
    const appendStreamText = (s: string): void => {
      if (!s) return;
      if (!assistant) {
        typing.remove();
        assistant = addMsg(log, "assistant", "");
        assistant.classList.add(`${PREFIX}-streaming`);
      }
      const masked = maskMarkdown(s);
      if (masked) {
        const tok = el("span", `${PREFIX}-tok`);
        tok.textContent = masked;
        assistant.appendChild(tok);
      }
    };
    const renderStreamDirective = (tag: string, spec: unknown): void => {
      const custom = customRenderers[tag];
      if (custom) {
        const host = el("div", `${PREFIX}-widget ${PREFIX}-custom`);
        log.appendChild(host);
        try {
          const dispose = custom(host, spec);
          if (dispose) richDisposers.push(dispose);
        } catch {
          host.remove();
        }
        scrollDown(true);
        return;
      }
      if (tag === "widget") {
        renderWidget(spec as WidgetSpec);
        return;
      }
      if (tag === "ui") {
        renderUiCard(spec);
        return;
      }
      const p = spec as PreviewSpec;
      if (typeof p.html === "string") renderPreview(p);
    };
    const processStreamDisplay = (): void => {
      for (;;) {
        const pending = assistantRaw.slice(shownLen);
        if (!pending) return;
        const open = pending.indexOf("[[");
        if (open < 0) {
          // Withhold a lone trailing "[" — it may grow into an opener.
          const cut = pending.endsWith("[")
            ? pending.length - 1
            : pending.length;
          appendStreamText(pending.slice(0, cut));
          shownLen += cut;
          return;
        }
        if (open > 0) {
          appendStreamText(pending.slice(0, open));
          shownLen += open;
          continue;
        }
        // pending starts with "[[" — read the tag.
        const m = /^\[\[([a-z-]{1,24})(:|\]\])?/i.exec(pending);
        if (!m) {
          if (pending.length <= 2) return; // bare "[[" — tag may follow
          appendStreamText("[["); // "[[" + a non-tag char — literal text
          shownLen += 2;
          continue;
        }
        if (!m[2] && pending.length === 2 + m[1].length) return; // tag typing
        if (m[2] === "]]") {
          if (`[[${m[1]}]]` === LEAD_TOKEN) {
            shownLen += m[0].length; // hide the token; final pass renders it
            continue;
          }
          appendStreamText("[[");
          shownLen += 2;
          continue;
        }
        if (!m[2]) {
          // Tag chars ended in something that is not ":" — literal text.
          appendStreamText("[[");
          shownLen += 2;
          continue;
        }
        const mode = streamDirectiveTag(m[1]);
        if (!mode) {
          appendStreamText("[[");
          shownLen += 2;
          continue;
        }
        const d = parseJsonDirective<unknown>(pending, m[1]);
        if (!d || d.start !== 0) {
          // Incomplete (still streaming) — hold. Give up on a pathological
          // never-closing directive so the rest of the reply isn't hostage.
          if (pending.length > 20000) {
            appendStreamText("[[");
            shownLen += 2;
            continue;
          }
          return;
        }
        if (mode === "later") {
          shownLen += d.end; // keep in raw (final pass acts on it), hide only
          continue;
        }
        // Renderable NOW: bake the text seen so far, paint the card, resume.
        const rest = pending.slice(d.end);
        assistantRaw = assistantRaw.slice(0, shownLen);
        flushSegment(false);
        renderStreamDirective(m[1], d.spec);
        assistantRaw = rest;
        shownLen = 0;
      }
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
            if (frame.threadId) {
              // The server named this turn's thread. Re-key the pending entry;
              // update the GLOBAL threadId only while the user is still here —
              // after a switch it must not clobber the view they moved to.
              if (turnThread !== frame.threadId) {
                pendingThreads.delete(turnThread ?? NEW_TURN_KEY);
                turnThread = frame.threadId;
                pendingThreads.add(turnThread);
              }
              if (live()) {
                threadId = frame.threadId;
                // A brand-new conversation just got its id — the star row can
                // stop hiding itself.
                paintStarItem();
              }
            }
            const piece = frame.text ?? frame.d;
            if (piece && live()) {
              assistantRaw += piece;
              producedAny = true;
              // Stream MASKED plain text (markdown marks hidden) with a
              // per-token fade+blur reveal — directive bytes are withheld and
              // visual cards paint mid-stream (see processStreamDisplay). The
              // real markdown still renders once at the end of each segment.
              processStreamDisplay();
              scrollDown();
            }
            // Inline data widget (render_chart). Flush the current text first so
            // the chart lands AFTER it, in order — not below the whole reply.
            if (frame.type === "widget" && live()) {
              typing.remove();
              flushSegment(false);
              renderServerWidget(frame.spec, frame.rows, frame.comparisonRows);
              producedAny = true;
            }
            // Live agent-activity step — a process chip (running → ok/error). On
            // start, flush text so the chip sits AFTER it (true order) and flip
            // the role badge to match the tool (Talk → Analytics, etc.).
            if (
              frame.type === "activity" &&
              frame.label &&
              frame.status &&
              live()
            ) {
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
            if (
              frame.type === "question" &&
              frame.questionId &&
              frame.prompt &&
              live()
            ) {
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
                artifactId: (frame as { artifactId?: string }).artifactId,
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
            // The turn's own message id + model (#299). This is what lets the
            // LIVE turn be rated on a surface that has no id-bearing replay to
            // fall back on — the visitor lane, whose transcript read carried no
            // ids at all until this change.
            if (frame.type === "done") {
              if (frame.messageId) liveMessageId = frame.messageId;
              if (frame.model) liveModel = frame.model;
            }
            if (frame.type === "error" && frame.message)
              failure = frame.message;
          }
        }
      }
    } catch (err) {
      // TRANSPORT loss (QUIC/network drop, proxy hiccup) — distinct from a
      // server-sent error frame: the api keeps running the turn server-side
      // and persists the transcript at the end, so the reply is NOT lost,
      // the browser just can't see the rest of the stream. Recover by
      // polling the thread until the reply lands (see below).
      transportLost = true;
      failure = (err as Error).message || "Network error.";
    } finally {
      pendingThreads.delete(turnThread ?? NEW_TURN_KEY);
      syncBusy();
      if (live()) input.focus();
      // A turn just consumed credits — refresh the remaining-credits readout.
      void refreshBalance();
      // A generation/import may have just landed — refresh the artifact strip
      // (thread-scoped, so only when this turn's thread is the one on screen).
      if (threadId === turnThread) void refreshArtifacts();
    }

    // Stale turn finished in the background (the user switched away while it
    // streamed). Nothing here may touch the visible view UNLESS the user has
    // switched BACK to this turn's thread — then reload the canonical
    // transcript (the reply is persisted server-side) and surface any pending
    // proposal cards (they are ephemeral, never persisted, so this is their
    // only way to reach the user). Otherwise leave everything for the thread
    // to show on next open; the History spinner has just cleared.
    // Transport died mid-stream but the api runs the turn to completion and
    // persists the transcript at the end — recover instead of giving up: keep
    // the thread marked "answering…" and poll until the reply lands (seen live
    // with QUIC drops through the edge; the reply arrived minutes later).
    if (transportLost && turnThread && opts.loadThread) {
      typing.remove();
      if (live()) showError(L("streamLostRecovering"));
      void recoverLostTurn(turnThread, isRegen ? null : content);
      return;
    }

    if (!live()) {
      typing.remove(); // detached or not — harmless either way
      if (turnThread && threadId === turnThread && opts.loadThread) {
        try {
          renderThreadItems(await opts.loadThread(turnThread), turnThread);
        } catch {
          /* the thread shows the reply on its next open */
        }
        for (const p of deferredProposals)
          renderProposal(
            p.name,
            p.args,
            p.agent,
            p.fields,
            p.accountId,
            p.artifactId
          );
        maybeDing();
        scrollDown();
        saveState();
      }
      return;
    }

    // Clear the typing indicator + render the FINAL text segment (with
    // directives). Earlier segments were already flushed around widgets/chips.
    typing.remove();
    const lastBubble = flushSegment(true);
    // The reply is on screen; NOW ask for the decisions, in the order the model
    // proposed them.
    for (const p of deferredProposals)
      renderProposal(
        p.name,
        p.args,
        p.agent,
        p.fields,
        p.accountId,
        p.artifactId
      );
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
        const cap = usageBadge(turnIn, turnOut);
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
    // A live, un-applied WRITE PROPOSAL card is ephemeral — it is NOT
    // persisted as a thread artifact, so a full renderThreadItems()
    // reload (which does `log.innerHTML = ""`) would silently WIPE it: the
    // agent proposes, the card flashes in, the end-of-turn reload deletes it,
    // and the admin never gets to click Apply. When a proposal card is on
    // screen, keep the streamed view instead. The only thing the reload adds is
    // the ‹n/m› branch switcher + persisted ids on this turn's messages, which
    // self-heal on the next send or when the thread is reopened — a fair trade
    // to avoid destroying a pending Apply card.
    const hasLiveProposal = !!log.querySelector(`.${PREFIX}-proposal-pending`);
    // Same wipe hazard for a FAILED turn: the error card (Retry/Report) is
    // ephemeral UI and the failed turn persisted nothing, so the canonical
    // reload would repaint an EMPTY thread — deleting the user's own message
    // AND the error they were meant to read (the "error flashes then the chat
    // goes blank" report). Keep the streamed view whenever an error card is on
    // screen; the next successful send reloads and self-heals the ids.
    const hasErrorCard = !!log.querySelector(`.${PREFIX}-error`);
    // Reload THIS TURN's thread (never whatever the view has become) — and only
    // while the user is still on it; the fence above already handled the
    // switched-away cases.
    if (
      turnThread &&
      opts.loadThread &&
      opts.setActiveLeaf &&
      !hasLiveProposal &&
      !hasErrorCard
    ) {
      try {
        const reloaded = await opts.loadThread(turnThread);
        if (live()) renderThreadItems(reloaded, turnThread);
      } catch {
        /* keep the streamed view if the reload fails */
      }
    } else if (liveMessageId && opts.vote && producedAny && live()) {
      // NO canonical reload happened, so nothing is going to paint the vote
      // control for us (#299).
      //
      // Hosts that wire `setActiveLeaf` (org, admin) reload the thread after
      // every turn, and that reload re-renders each message WITH its persisted
      // id — which is why thumbs already appear on a live turn there. The issue
      // read that as "votes only on replayed turns"; measured, it is narrower
      // and the gap is here:
      //
      //   • the visitor lane wires no setActiveLeaf at all, so it never reloads
      //   • a live proposal card or an error card SUPPRESSES the reload, to
      //     avoid wiping ephemeral UI — so those turns lose the control too
      //
      // In all three the id now arrives on the `done` frame, so the answer just
      // read is ratable without reopening the thread.
      const rowEl = el("div", `${PREFIX}-msgactions ${PREFIX}-assistant`);
      rowEl.appendChild(buildVoteButtons(liveMessageId, liveModel));
      log.appendChild(rowEl);
      scrollDown();
    }

    // ASK, when the turn gave us a reason to (#299). Every other part of this
    // signal waits to be volunteered, on controls that are easy to miss.
    const threadKey = turnThread ?? NEW_TURN_KEY;
    const turns = (threadTurns.get(threadKey) ?? 0) + 1;
    threadTurns.set(threadKey, turns);
    const elapsed = Date.now() - turnStartedAt;
    if (
      live() &&
      liveMessageId &&
      opts.vote &&
      // Never on a thread's FIRST turn — asking someone to rate a conversation
      // they have not had yet is noise.
      turns > 1 &&
      // At most once per thread per session.
      !qualityAsked.has(threadKey) &&
      (failure || elapsed >= QUALITY_SLOW_MS)
    ) {
      qualityAsked.add(threadKey);
      renderQualityPrompt(
        failure ? "failed" : "slow",
        liveMessageId,
        liveModel
      );
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

  // ── Composed UI cards — `[[ui:{…}]]` ────────────────────────────────────────
  //
  // The assistant composes a card out of primitives this widget knows how to
  // draw (see ui-spec.ts for the vocabulary and why it is a vocabulary rather
  // than markup). Nothing here knows what a storyboard is, or a shortlist, or a
  // room-type picker: it draws tiles with media, a state and buttons, and the
  // buttons go to the host by name through the SAME `dispatchAction` an
  // `[[action:…]]` uses — so a composed card can never do anything the host
  // doesn't already allow.

  /** The label for a tile's state: ours to translate for the four we know,
   *  the model's own words for anything else. */
  function uiStatusLabel(status: string): string {
    if (status === "pending") return L("uiStatusPending");
    if (status === "running") return L("uiStatusRunning");
    if (status === "ready") return L("uiStatusReady");
    if (status === "failed") return L("uiStatusFailed");
    return status;
  }

  /** One button on a card or tile. */
  function buildUiAction(a: UiAction, itemId?: string): HTMLElement {
    const wrap = el("span", `${PREFIX}-ui-act`);
    const variant =
      a.variant === "primary"
        ? ` ${PREFIX}-ui-btn-primary`
        : a.variant === "danger"
          ? ` ${PREFIX}-ui-btn-danger`
          : "";
    const btn = el("button", `${PREFIX}-ui-btn${variant}`) as HTMLButtonElement;
    btn.type = "button";
    const label = a.label || a.name;
    btn.textContent = label;
    // The tile's own id rides along, so a handler knows WHICH tile was acted on
    // without the model having to repeat it inside every button's data.
    const data = { ...(a.data ?? {}), ...(itemId ? { itemId } : {}) };
    const run = async (): Promise<void> => {
      btn.disabled = true;
      // `say` is answered here, not by the host: it puts its text into the
      // conversation as an ordinary user message (exactly as a chip does), so
      // the assistant's own tools carry it out and the transcript records the
      // click as the sentence it stood for.
      if (a.name === UI_SAY_ACTION) {
        void send((a.data?.text || label).trim());
        return;
      }
      try {
        const msg = await dispatchAction(a.name, data);
        btn.textContent =
          (typeof msg === "string" && msg) || L("actionDone", { label });
      } catch {
        btn.disabled = false;
        btn.textContent = `${label} — ${L("tryAgain")}`;
      }
    };
    btn.addEventListener("click", () => {
      if (!a.confirm) {
        void run();
        return;
      }
      // The confirm replaces THIS BUTTON, not the card. A single [[action:…]]
      // card can take itself over to ask, because it is the only thing there;
      // a composed card holds many actions, and hiding a whole storyboard
      // behind one question would lose the very thing being confirmed.
      wrap.textContent = "";
      const q = el("span", `${PREFIX}-ui-confirm-q`);
      q.textContent = a.confirm;
      const yes = el("button", `${PREFIX}-ui-btn`) as HTMLButtonElement;
      yes.type = "button";
      yes.textContent = L("confirm");
      const no = el("button", `${PREFIX}-ui-btn-ghost`) as HTMLButtonElement;
      no.type = "button";
      no.textContent = L("cancel");
      const restore = (): void => {
        wrap.textContent = "";
        wrap.appendChild(btn);
      };
      yes.addEventListener("click", () => {
        restore();
        void run();
      });
      no.addEventListener("click", restore);
      wrap.append(q, yes, no);
    });
    wrap.appendChild(btn);
    return wrap;
  }

  /** One tile. The media box is drawn EMPTY-BUT-SIZED and filled in later, so
   *  the card doesn't reflow (and scroll out from under a reading user) when
   *  the pictures land. */
  /** The badge class for a status — the known four are coloured, anything the
   *  model invented gets the neutral one. */
  function uiBadgeClass(status: string): string {
    const known =
      status === "pending" ||
      status === "running" ||
      status === "ready" ||
      status === "failed";
    return `${PREFIX}-ui-badge ${PREFIX}-ui-badge-${known ? status : "other"}`;
  }

  /**
   * A job's coarse lifecycle as the tile vocabulary's own status.
   *
   * `cancelled` deliberately lands on `failed` rather than on its own badge:
   * from the tile's point of view — "is there a clip here?" — a cancelled
   * render and a failed one are the same answer, and the card-level job view
   * is where the difference is spelled out.
   */
  function uiStatusForJob(status: WidgetJobView["status"]): UiStatus {
    if (status === "done") return "ready";
    if (status === "failed" || status === "cancelled") return "failed";
    if (status === "queued") return "pending";
    return "running";
  }

  /**
   * Repaint one tile from a job poll — the thing that stops a composed card
   * being a snapshot of the moment it was written.
   *
   * Only ever ADDS what it learns: media it did not have, and a status it can
   * now state. It never clears a media id the model already gave, because a
   * tile can legitimately show a reference still while the render it names is
   * still running.
   */
  function paintUiTileLive(tile: HTMLElement, view: WidgetJobView): void {
    const box = tile.querySelector<HTMLElement>(`.${PREFIX}-ui-media`);
    if (!box) return;
    const badge = tile.querySelector<HTMLElement>(`.${PREFIX}-ui-badge`);
    if (badge) {
      const s = uiStatusForJob(view.status);
      badge.className = uiBadgeClass(s);
      badge.textContent = uiStatusLabel(s);
    }
    const produced = view.resultMediaId;
    if (!produced || box.dataset.mid === produced) return;
    box.dataset.mid = produced;
    // The clip has landed, so the box stops being a placeholder — one more
    // batched resolve, scoped to this tile, and `fillUiMedia` does the rest
    // (it queries `.…-ui-media` inside whatever element it is handed).
    void fillUiMedia([produced], tile);
  }

  function buildUiTile(it: UiItem): HTMLElement {
    const tile = el("div", `${PREFIX}-ui-tile`);
    const box = el("div", `${PREFIX}-ui-media`);
    if (it.mediaId) {
      box.dataset.mid = it.mediaId;
      if (it.posterMediaId) box.dataset.poster = it.posterMediaId;
      if (it.media) box.dataset.kind = it.media;
    }
    const ph = el("span", `${PREFIX}-ui-media-ph`);
    ph.textContent = it.mediaId ? "" : L("uiMediaPending");
    box.appendChild(ph);
    // A tile watching a job always gets a badge, even when the model named no
    // status: the badge is where the job's progress is going to be written, and
    // one added later would make the tile jump as it filled in.
    const initialStatus =
      it.status ?? (it.jobId ? ("running" as UiStatus) : undefined);
    if (initialStatus) {
      const badge = el("span", uiBadgeClass(initialStatus));
      badge.textContent = uiStatusLabel(initialStatus);
      box.appendChild(badge);
    }
    tile.appendChild(box);
    if (it.jobId) {
      subscribeJob({ kind: "job", id: it.jobId }, tile, (view) =>
        paintUiTileLive(tile, view)
      );
    }
    if (it.title) {
      const t = el("div", `${PREFIX}-ui-tile-title`);
      t.textContent = it.title;
      tile.appendChild(t);
    }
    if (it.caption) {
      const c = el("div", `${PREFIX}-ui-tile-cap`);
      c.textContent = it.caption;
      tile.appendChild(c);
    }
    if (it.actions?.length) {
      const row = el("div", `${PREFIX}-ui-tile-actions`);
      for (const a of it.actions) row.appendChild(buildUiAction(a, it.id));
      tile.appendChild(row);
    }
    return tile;
  }

  /** Does this URL point at something to PLAY rather than show? The id alone
   *  can't say, so the model's own `media` hint wins and the extension is the
   *  fallback — a clip drawn as an <img> is a broken tile, which is worse than
   *  a still drawn in a <video> (that still shows the frame). */
  function looksLikeVideo(url: string): boolean {
    return /\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(url);
  }

  /** Resolve a card's media ids and paint them in. One batched call for the
   *  whole card — a request per tile would be a burst of round-trips for what
   *  is conceptually one picture set. */
  async function fillUiMedia(ids: string[], card: HTMLElement): Promise<void> {
    let urls: Record<string, string> = {};
    if (ids.length && opts.resolveMediaUrls) {
      try {
        urls = (await opts.resolveMediaUrls(ids)) ?? {};
      } catch {
        urls = {}; // every tile then says "Unavailable" — never a blank box
      }
    }
    const boxes = card.querySelectorAll<HTMLElement>(`.${PREFIX}-ui-media`);
    for (const box of Array.from(boxes)) {
      const mid = box.dataset.mid;
      if (!mid) continue;
      const url = urls[mid];
      const ph = box.querySelector<HTMLElement>(`.${PREFIX}-ui-media-ph`);
      if (!url) {
        if (ph) ph.textContent = L("uiMediaMissing");
        continue;
      }
      // AUDIO must be declared, never guessed: our URLs are signed and carry no
      // extension, so an mp3 left to inference is drawn as an <img> and reads as
      // a broken tile.
      const kind = box.dataset.kind
        ? box.dataset.kind
        : looksLikeVideo(url)
          ? "video"
          : "image";
      const isVideo = kind === "video";
      const isAudio = kind === "audio";
      const node = el(
        isAudio ? "audio" : isVideo ? "video" : "img",
        `${PREFIX}-ui-media-el`
      ) as HTMLImageElement & HTMLVideoElement & HTMLAudioElement;
      node.src = url;
      if (isVideo || isAudio) {
        node.controls = true;
        node.preload = "metadata";
        if (isVideo) {
          node.playsInline = true;
          const poster = box.dataset.poster ? urls[box.dataset.poster] : "";
          if (poster) node.poster = poster;
        }
      } else {
        node.loading = "lazy";
        node.alt = "";
      }
      // A media id that resolves to a URL the browser then refuses (expired
      // signature, deleted object) must still read as a state, not a blank.
      node.addEventListener("error", () => {
        node.remove();
        const p = el("span", `${PREFIX}-ui-media-ph`);
        p.textContent = L("uiMediaMissing");
        box.appendChild(p);
      });
      ph?.remove();
      box.insertBefore(node, box.firstChild);
    }
  }

  /**
   * Wrap a tile row in paging: one visible at a time, arrows and dots overlaid.
   *
   * Overlaid rather than stacked beneath — controls that are flex siblings
   * steal height from the media, so a square tile renders visibly smaller
   * than the space it was given and reads as a lesser thing than it is.
   */
  function buildUiCarousel(items: HTMLElement, count: number): HTMLElement {
    const wrap = el("div", `${PREFIX}-ui-carousel`);
    const stage = el("div", `${PREFIX}-ui-carousel-stage`);
    stage.appendChild(items);
    wrap.appendChild(stage);

    let index = 0;
    const dots: HTMLElement[] = [];
    const paint = (): void => {
      items.style.transform = `translateX(-${index * 100}%)`;
      dots.forEach((d, i) =>
        d.classList.toggle(`${PREFIX}-ui-dot-on`, i === index)
      );
      counter.textContent = `${index + 1}/${count}`;
    };
    const go = (delta: number): void => {
      index = (index + delta + count) % count;
      paint();
    };

    const arrow = (side: "left" | "right"): HTMLElement => {
      const b = el(
        "button",
        `${PREFIX}-ui-arrow ${PREFIX}-ui-arrow-${side}`
      ) as HTMLButtonElement;
      b.type = "button";
      b.setAttribute("aria-label", side === "left" ? L("prev") : L("next"));
      b.textContent = side === "left" ? "‹" : "›";
      b.addEventListener("click", (e) => {
        // The card sits inside a scrollable log and may sit inside other
        // clickable chrome; paging must never reach either.
        e.preventDefault();
        e.stopPropagation();
        go(side === "left" ? -1 : 1);
      });
      return b;
    };
    stage.append(arrow("left"), arrow("right"));

    const counter = el("span", `${PREFIX}-ui-counter`);
    stage.appendChild(counter);

    const dotRow = el("div", `${PREFIX}-ui-dots`);
    for (let i = 0; i < count; i++) {
      const d = el("button", `${PREFIX}-ui-dot`) as HTMLButtonElement;
      d.type = "button";
      d.setAttribute("aria-label", `${i + 1}`);
      d.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        index = i;
        paint();
      });
      dots.push(d);
      dotRow.appendChild(d);
    }
    stage.appendChild(dotRow);
    paint();
    return wrap;
  }

  /** Draw a composed UI card in the log. */
  function renderUiCard(raw: unknown): void {
    const spec = normalizeUiSpec(raw);
    if (!spec) return; // nothing worth drawing — the reply's text stands alone
    const card = el("div", `${PREFIX}-ui`);
    if (spec.title) {
      const t = el("div", `${PREFIX}-ui-title`);
      t.textContent = spec.title;
      card.appendChild(t);
    }
    if (spec.caption) {
      const c = el("div", `${PREFIX}-ui-cap`);
      c.textContent = spec.caption;
      card.appendChild(c);
    }
    if (spec.items.length) {
      const items = el(
        "div",
        `${PREFIX}-ui-items ${PREFIX}-ui-${spec.layout} ${PREFIX}-ui-a-${spec.aspect}`
      );
      for (const it of spec.items) items.appendChild(buildUiTile(it));
      // A CAROUSEL shows one item at a time, because the client is judging each
      // one rather than scanning a set: six thumbnails in a row invites
      // approving what was never really looked at. Paging is added around the
      // same tiles, so nothing about how a tile is built changes.
      if (spec.layout === "carousel" && spec.items.length > 1) {
        card.appendChild(buildUiCarousel(items, spec.items.length));
      } else {
        card.appendChild(items);
      }
    }
    if (spec.actions.length) {
      const row = el("div", `${PREFIX}-ui-actions`);
      for (const a of spec.actions) row.appendChild(buildUiAction(a));
      card.appendChild(row);
    }
    log.appendChild(card);
    scrollDown(true);
    void fillUiMedia(uiSpecMediaIds(spec), card);
  }

  /** Map an analytics render_chart frame (spec + StatsQueryRow[]) to an inline
   *  widget. kpi → a stat; everything else → a table of the returned rows. */
  function renderServerWidget(
    spec: { title?: string; chartType?: string } | undefined,
    rows: unknown,
    comparisonRows?: unknown
  ): void {
    // ADVANCED VIEW: the big surface is the right place for a chart.
    //
    // A computed widget used to land in the 368px chat column while half the
    // screen next to it showed a page nobody was reading. Same principle as
    // the report narration collapsing when the pane shows the run: whichever
    // surface can render it properly gets it, and the chat says where it went
    // rather than drawing a second, smaller copy.
    //
    // Falls through to the log when the pane cannot take it (no host renderer,
    // or the renderer threw), so a failure here costs nothing.
    if (showPaneWidget(spec, rows, comparisonRows)) {
      const note = el("div", `${PREFIX}-job-mirrored`);
      note.textContent = L("jobWatchingInPane");
      log.appendChild(note);
      scrollDown(true);
      return;
    }
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
   *  immediately (showing a "Opening …" chip); OFF it offers a confirm button.
   *  ADVANCED mode always auto-follows: navigation there only retargets the
   *  embedded iframe (the user is WATCHING the assistant drive the app — a
   *  confirm button per page defeats the mode), while the browser-local toggle
   *  keeps governing normal widget mode, where navigation moves the real app. */
  function renderNavigate(spec: NavigateSpec, replay = false): void {
    const wrap = el("div", `${PREFIX}-nav`);
    const label = spec.label || "Open page";
    // On replay (history / post-turn thread restore) always render the button,
    // never auto-follow — re-opening a conversation must not navigate the app.
    if ((autoNav || advanced) && !replay) {
      const chip = el("div", `${PREFIX}-autonav`);
      chip.innerHTML = `${ICON_COMPASS}<span>${escapeHtml(L("actionOpening", { label }))}</span>`;
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
            (typeof msg === "string" && msg) || L("actionDone", { label });
        },
        () => {
          chip.querySelector("span")!.textContent = L("actionOpenFailed", {
            label,
          });
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
          (typeof msg === "string" && msg) || L("actionDone", { label })
        )}</span>`;
      } catch {
        // Re-enabling in silence left the user to guess. Refusing an off-app
        // path is a decision worth stating.
        btn.disabled = false;
        btn.innerHTML = `<span>${escapeHtml(L("actionRetry", { label }))}</span>`;
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

  /** Render an AI-authored HTML preview in a sandboxed iframe. Scripts stay
   *  OFF (static HTML, can't execute), but allow-same-origin is granted so the
   *  parent page's blob: URLs (resolved private media) can paint — an
   *  opaque-origin frame refuses them and every resolved image breaks. */
  function renderPreview(spec: PreviewSpec): void {
    const wrap = el("div", `${PREFIX}-preview`);
    const bar = el("div", `${PREFIX}-preview-bar`);
    const dots = el("span", `${PREFIX}-preview-dots`);
    dots.innerHTML = `<i></i><i></i><i></i>`;
    const title = el("span", `${PREFIX}-preview-title`);
    title.textContent = spec.title || L("preview");
    bar.append(dots, title);
    const frame = el("iframe", `${PREFIX}-preview-frame`) as HTMLIFrameElement;
    frame.setAttribute("sandbox", "allow-same-origin");
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
    // Reflect the acting capability in the status badge (e.g. open-dashboards
    // → Analytics); plain navigation stays Talk.
    if (ACTION_ROLE[spec.name]) setRole(ACTION_ROLE[spec.name]);
    const wrap = el("div", `${PREFIX}-nav`);
    // State-changing UI control (fill / click) is ALWAYS confirm-gated: force a
    // confirm prompt even if the model forgot one, and never auto-run it — the
    // user must approve typing/clicking on their behalf. Read-only nudges
    // (highlight/scroll/focus) never reach renderAction (they carry no button).
    if (isOperateAction(spec.name) && !spec.confirm) {
      spec = { ...spec, confirm: operateConfirmText(spec) };
    }
    // Auto-navigate: a confirm-LESS action is pure navigation
    // (open-dashboards, …) — run it immediately. Anything with `confirm` (changes
    // state / costs credits) ALWAYS asks, even in auto mode. Advanced mode
    // auto-runs pure navigation unconditionally (it only moves the iframe).
    if (
      (autoNav || advanced) &&
      isNavigationAction(spec.name) &&
      !spec.confirm
    ) {
      const label = spec.label || "Opening…";
      const chip = el("div", `${PREFIX}-autonav`);
      chip.innerHTML = `${ICON_COMPASS}<span>${escapeHtml(L("actionOpening", { label }))}</span>`;
      wrap.appendChild(chip);
      log.appendChild(wrap);
      scrollDown(true);
      void Promise.resolve(dispatchAction(spec.name, spec.data ?? {})).then(
        (msg) => {
          chip.querySelector("span")!.textContent =
            (typeof msg === "string" && msg) || L("actionDone", { label });
        },
        () => {
          chip.querySelector("span")!.textContent = L("actionRunFailed", {
            label,
          });
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
          (typeof msg === "string" && msg) || L("actionDone", { label })
        )}</span>`;
      } catch {
        btn.disabled = false;
        btn.innerHTML = `<span>${escapeHtml(L("actionRetry", { label }))}</span>`;
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
   * `generate_report` and friends return immediately and run for minutes, then
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

  // Every `let` in this scope is now initialized, so the opening view can be
  // painted against real state rather than a temporal dead zone. Keep this the
  // LAST thing setup does.
  paintOpeningView();

  /**
   * `offline` from the browser, not from a failed request (#305).
   *
   * A launcher that says so up front is better than one that looks ready and
   * fails on click — which is what the widget did, since every turn's failure
   * arrived only after the reader had committed to asking. `navigator.onLine`
   * is a floor, not a guarantee (it can be true behind a captive portal), so it
   * is used to say "definitely not" and never to promise the opposite.
   */
  const syncOnline = (): void => {
    if (typeof navigator === "undefined") return;
    if (!navigator.onLine) setLauncher({ state: "offline" });
    else if (launcher.state === "offline") setLauncher({ state: "resting" });
  };
  window.addEventListener("online", syncOnline);
  window.addEventListener("offline", syncOnline);
  syncOnline();

  /**
   * The ground under a fixed launcher CHANGES as the page scrolls — a dark hero
   * gives way to a light body — so "auto" has to be re-read, not resolved once
   * at mount. Debounced to one rAF and applied only when the answer actually
   * flips, so scrolling costs one elementsFromPoint per frame at most and the
   * mark never strobes between two fills.
   */
  let groundTimer = 0;
  let lastGround: "light" | "ink" | null = null;
  const watchGround = (): void => {
    // TRAILING, not leading, and not one rAF. A single rAF sampled while the
    // scroll was still in flight and read the OLD stack — measured: the class
    // stayed `on-ink` over a light section until a scroll event was dispatched
    // by hand, which proved the logic right and the timing wrong. Same shape as
    // the router-vs-fragment race in #303. The ground does not need to update
    // mid-scroll; it needs to be correct when the reader stops.
    window.clearTimeout(groundTimer);
    groundTimer = window.setTimeout(() => {
      if (launcher.ground !== "auto") return;
      const now = resolveGround();
      if (now === lastGround) return;
      lastGround = now;
      applyLauncher();
    }, 140);
  };
  window.addEventListener("scroll", watchGround, { passive: true });
  window.addEventListener("resize", watchGround, { passive: true });

  applyLauncher();

  return {
    open,
    close,
    toggle,
    registerRenderer,
    setLauncher,
    destroy() {
      // FIRST: cut the in-flight turn loose. Everything below tears down the
      // DOM it would otherwise keep writing to.
      alive.abort();
      offAiChange();
      if (opts.openEventName) {
        window.removeEventListener(opts.openEventName, onOpenEvent);
      }
      window.removeEventListener("resize", onResize);
      window.removeEventListener("online", syncOnline);
      window.removeEventListener("offline", syncOnline);
      window.removeEventListener("scroll", watchGround);
      window.removeEventListener("resize", watchGround);
      window.clearTimeout(groundTimer);
      unbindKeyboard();
      clearRich();
      teardownFrame();
      bubble.remove();
      panel.remove();
    },
  };
}
