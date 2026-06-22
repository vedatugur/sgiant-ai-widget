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
  type PageContext,
  type PageManifestEntry,
  type NavTarget,
  type AppSurface,
  type HostActionsConfig,
  type HostActionHandler,
} from "./host-actions";
import type { PageContext } from "./host-actions";
import { renderMarkdown } from "./markdown";

/** One item replayed from a past thread: a chat message, or an inline data
 *  widget (so reopening restores the conversation's charts/tables, not just
 *  text). The render hooks / fallback handle the actual drawing. */
export type LoadedThreadItem =
  | { role: "user" | "assistant"; content: string }
  | { kind: "widget"; spec: unknown; rows: unknown; comparisonRows?: unknown }
  | { kind: "activity"; label: string; status: string };

/**
 * Map a thread's messages + artifacts (the `/ai/threads/:id/messages` response)
 * into an ordered replay list — text messages interleaved with their data
 * widgets by `createdAt`, exactly like the full-page assistant. Pure; hosts pass
 * it the fetched payload so the widget reopens a conversation WITH its charts.
 */
export function buildThreadReplay(payload: {
  messages?: Array<{ role: string; content: string; createdAt?: string }>;
  artifacts?: Array<{ kind: string; payload?: unknown; createdAt?: string }>;
}): LoadedThreadItem[] {
  const items: Array<{ t: string; item: LoadedThreadItem }> = [];
  for (const m of payload.messages ?? []) {
    if ((m.role === "user" || m.role === "assistant") && m.content.trim())
      items.push({
        t: m.createdAt ?? "",
        item: { role: m.role, content: m.content },
      });
  }
  for (const a of payload.artifacts ?? []) {
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
      // A persisted process step — replays the timeline on reopen.
      const p = (a.payload ?? {}) as { label?: string; status?: string };
      if (!p.label) continue;
      items.push({
        t: a.createdAt ?? "",
        item: { kind: "activity", label: p.label, status: p.status ?? "ok" },
      });
    }
  }
  items.sort((x, y) => x.t.localeCompare(y.t));
  return items.map((s) => s.item);
}

export interface AiChatWidgetOptions {
  /** Streaming chat endpoint (POST). e.g. https://api.sgiant.io/accounts/:id/ai/chat */
  endpoint: string;
  /** Account the chat is scoped to. Omit for the public/anonymous endpoint. */
  accountId?: string;
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
   * Called when the user clicks "Report issue" on an error state — wire it to
   * your Backoffice/contact endpoint so the admin team gets the failed turn.
   */
  onReportIssue?: (details: {
    error: string;
    lastUserMessage: string;
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
   * Past-conversation history. When provided, a history control appears in the
   * header; opening it lists the user's prior threads. Picking one calls
   * `loadThread` and replays its messages. Wire these to the authed endpoints
   * (e.g. GET /accounts/:id/ai/threads and …/threads/:threadId/messages). Omit
   * to disable history (the widget still restores the last thread via persistKey).
   */
  listThreads?: () => Promise<
    Array<{ id: string; title?: string | null; updatedAt?: string }>
  >;
  /** Load one past thread (oldest→newest) for replay in the log. Items are
   *  messages OR inline data widgets, so reopening a conversation restores its
   *  charts/tables — not just text (matching the full-page assistant). */
  loadThread?: (threadId: string) => Promise<LoadedThreadItem[]>;
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
   * Apply a confirm-gated WRITE-tool proposal (e.g. `update_creation`). The AI
   * never mutates directly — it proposes; the widget shows a card and THIS runs
   * only when the user clicks Apply (a Clerk-authed action in the host). Map the
   * tool name → a real, access-checked API call. Return a string to show as the
   * success note; throw to let the user retry. Omit to hide write proposals.
   */
  onApplyProposal?: (
    name: string,
    args: Record<string, unknown>
  ) => Promise<string | void>;
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

/** Sentinel the assistant emits to ask the widget to render an email form. */
const LEAD_TOKEN = "[[collect-email]]";

/** One field in an AI-rendered form directive. */
interface FormField {
  name: string;
  label?: string;
  type?: "text" | "email" | "number" | "textarea" | "select";
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
} {
  let t = text;
  const notes: string[] = [];
  for (let i = 0; i < 8; i++) {
    const w = parseJsonDirective<NavigateSpec>(t, "navigate");
    if (!w) break;
    t = w.stripped;
    notes.push(`↗ ${w.spec.label || w.spec.path || "Open page"}`);
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
  const f = parseFormDirective(t);
  if (f) {
    t = f.stripped;
    notes.push(`📝 ${f.spec.title || "Form"} — submitted`);
  }
  if (t.includes(LEAD_TOKEN)) {
    t = t.replace(LEAD_TOKEN, "").trim();
    notes.push("📝 Form — submitted");
  }
  return { clean: t, notes };
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

export interface AiChatWidgetHandle {
  open(): void;
  close(): void;
  toggle(): void;
  destroy(): void;
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
// Download — export the current conversation as a .txt transcript.
const ICON_DOWNLOAD = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;
// Bell — toggle a soft chime when a reply arrives.
const ICON_BELL = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>`;
const ICON_BELL_OFF = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13.73 21a2 2 0 0 1-3.46 0"/><path d="M18.63 13A17.9 17.9 0 0 1 18 8"/><path d="M6.26 6.26A6 6 0 0 0 6 8c0 7-3 9-3 9h14"/><path d="M18 8a6 6 0 0 0-9.33-5"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;

export function createAiChatWidget(
  opts: AiChatWidgetOptions
): AiChatWidgetHandle {
  const accent = opts.accent ?? "#6d28d9";
  const gradient =
    opts.gradient ?? `linear-gradient(135deg,${accent},${accent})`;
  const side = opts.position === "bottom-left" ? "left" : "right";
  const root = opts.container ?? document.body;
  const name = opts.title ?? "Copilot";
  // Avatar markup: the brand logo mark (img) when given, else a crescent glyph.
  const avatarInner = opts.avatarUrl
    ? `<img src="${opts.avatarUrl}" alt="${name}" class="${PREFIX}-av-img"/>`
    : AVATAR_SVG;
  let threadId: string | undefined;
  let busy = false;
  let lastUserContent = "";

  // Conversation memory across page reloads (opt-in via persistKey). Kept in
  // localStorage so a refresh restores the thread + messages.
  type StoredMsg = { role: "user" | "assistant"; content: string };
  const storeKey = opts.persistKey ? `ayca:v1:${opts.persistKey}` : null;
  // Remember whether the panel was left open, so a page refresh restores it
  // (in-app surfaces only — external embeds shouldn't auto-pop for visitors).
  const openStateKey = opts.persistKey ? `ayca:open:${opts.persistKey}` : null;
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
  function loadState(): void {
    if (!storeKey) return;
    try {
      const raw = localStorage.getItem(storeKey);
      if (!raw) return;
      const s = JSON.parse(raw) as {
        threadId?: string;
        messages?: StoredMsg[];
      };
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
        JSON.stringify({ threadId, messages: history.slice(-40) })
      );
    } catch {
      /* storage full/blocked — non-fatal */
    }
  }
  loadState();

  injectStyles(accent, side, gradient);

  const bubble = el("button", `${PREFIX}-bubble`);
  bubble.setAttribute("aria-label", `Open ${name}`);
  bubble.innerHTML = `<span class="${PREFIX}-bubble-av">${avatarInner}</span>`;
  const panel = el("div", `${PREFIX}-panel`);
  panel.style.display = "none";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", `${name} chat`);

  const header = el("div", `${PREFIX}-header`);
  const avatar = el("div", `${PREFIX}-avatar`);
  avatar.innerHTML = avatarInner;
  const hName = el("div", `${PREFIX}-hname`);
  const titleEl = el("span", `${PREFIX}-title`);
  titleEl.textContent = name;
  const subEl = el("span", `${PREFIX}-sub`);
  subEl.textContent = opts.subtitle ?? "Growth assistant";
  hName.append(titleEl, subEl);
  const hActions = el("div", `${PREFIX}-hactions`);
  // New chat — start a fresh conversation (keeps the prior one in history).
  const newChatBtn = el("button", `${PREFIX}-icon`);
  newChatBtn.setAttribute("aria-label", "New chat");
  newChatBtn.title = "New chat";
  newChatBtn.innerHTML =
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>';
  hActions.appendChild(newChatBtn);
  // History (past conversations) — only when the host wired a thread lister.
  let historyBtn: HTMLElement | null = null;
  if (opts.listThreads) {
    historyBtn = el("button", `${PREFIX}-icon`);
    historyBtn.setAttribute("aria-label", "Past conversations");
    historyBtn.title = "History";
    historyBtn.innerHTML = ICON_HISTORY;
    hActions.appendChild(historyBtn);
  }
  // Download — export the current conversation as a plain-text transcript.
  const downloadBtn = el("button", `${PREFIX}-icon`);
  downloadBtn.setAttribute("aria-label", "Download conversation");
  downloadBtn.title = "Download chat (.txt)";
  downloadBtn.innerHTML = ICON_DOWNLOAD;
  downloadBtn.addEventListener("click", () => exportConversation());
  hActions.appendChild(downloadBtn);
  // Notification sound — a soft chime when a reply arrives (browser-local toggle).
  const SOUND_KEY = "sg_ayca_sound";
  let soundOn = false;
  try {
    soundOn = window.localStorage.getItem(SOUND_KEY) === "1";
  } catch {
    /* storage blocked */
  }
  const soundBtn = el("button", `${PREFIX}-icon`) as HTMLButtonElement;
  const syncSound = (): void => {
    soundBtn.innerHTML = soundOn ? ICON_BELL : ICON_BELL_OFF;
    soundBtn.classList.toggle(`${PREFIX}-icon-on`, soundOn);
    soundBtn.title = soundOn ? "Sound on — click to mute" : "Sound off";
    soundBtn.setAttribute("aria-label", soundOn ? "Sound on" : "Sound off");
    soundBtn.setAttribute("aria-pressed", soundOn ? "true" : "false");
  };
  syncSound();
  soundBtn.addEventListener("click", () => {
    soundOn = !soundOn;
    try {
      window.localStorage.setItem(SOUND_KEY, soundOn ? "1" : "0");
    } catch {
      /* storage blocked */
    }
    syncSound();
    if (soundOn) maybeDing(true); // preview on enable
  });
  hActions.appendChild(soundBtn);
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
  let autoNavBtn: HTMLButtonElement | null = null;
  if (opts.autoNavOption) {
    autoNavBtn = el(`button`, `${PREFIX}-icon`) as HTMLButtonElement;
    autoNavBtn.innerHTML = ICON_COMPASS;
    const syncAutoNav = (): void => {
      autoNavBtn!.classList.toggle(`${PREFIX}-icon-on`, autoNav);
      autoNavBtn!.title = autoNav
        ? "Auto-navigate is ON — Copilot opens pages for you. Click to turn off."
        : "Auto-navigate is OFF — Copilot asks before opening pages. Click to turn on.";
      autoNavBtn!.setAttribute(
        "aria-label",
        autoNav ? "Auto-navigate on" : "Auto-navigate off"
      );
      autoNavBtn!.setAttribute("aria-pressed", autoNav ? "true" : "false");
    };
    syncAutoNav();
    autoNavBtn.addEventListener("click", () => {
      autoNav = !autoNav;
      try {
        window.localStorage.setItem(AUTONAV_KEY, autoNav ? "1" : "0");
      } catch {
        /* storage blocked */
      }
      syncAutoNav();
    });
    hActions.appendChild(autoNavBtn);
  }
  // Expand / restore — grows the panel for easier reading (default on).
  let expandBtn: HTMLElement | null = null;
  const expandable = opts.expandable !== false;
  if (expandable) {
    expandBtn = el("button", `${PREFIX}-icon ${PREFIX}-expand`);
    expandBtn.setAttribute("aria-label", "Expand chat");
    expandBtn.title = "Expand";
    expandBtn.innerHTML = ICON_EXPAND;
    hActions.appendChild(expandBtn);
  }
  const closeBtn = el("button", `${PREFIX}-close`);
  closeBtn.innerHTML = "&times;";
  closeBtn.setAttribute("aria-label", "Close chat");
  hActions.appendChild(closeBtn);
  header.append(avatar, hName, hActions);

  const log = el("div", `${PREFIX}-log`);
  // Accessible, scrollable conversation region. role=log + aria-live announces
  // streamed replies to screen readers; tabindex makes it keyboard-scrollable.
  log.setAttribute("role", "log");
  log.setAttribute("aria-live", "polite");
  log.setAttribute("aria-label", "Conversation");
  log.setAttribute("tabindex", "0");
  // Rich-content lifecycle. Host-mounted React roots (markdown / data widgets)
  // hand back a disposer; we keep them so they can be unmounted when the log is
  // cleared (new chat / history switch / destroy), avoiding leaked roots.
  const richDisposers: Array<() => void> = [];
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
  function paintActivity(
    chip: HTMLElement,
    label: string,
    status: string
  ): void {
    const icon =
      status === "running"
        ? `<span class="${PREFIX}-act-spin" aria-hidden="true"></span>`
        : status === "error"
          ? `<span class="${PREFIX}-act-x" aria-hidden="true">✕</span>`
          : `<span class="${PREFIX}-act-ok" aria-hidden="true">✓</span>`;
    chip.className =
      `${PREFIX}-activity` +
      (status !== "running" ? ` ${PREFIX}-activity-done` : "");
    chip.innerHTML = `${icon}<span class="${PREFIX}-act-label">${escapeHtml(label)}</span>`;
  }
  function addActivityChip(label: string, status: string): HTMLElement {
    const chip = el("div", `${PREFIX}-activity`);
    paintActivity(chip, label, status);
    log.appendChild(chip);
    return chip;
  }
  // Live frame: create the chip on `running`, update the same one on ok/error.
  function liveActivityFrame(
    callId: string,
    label: string,
    status: string
  ): void {
    const existing = liveActivity.get(callId);
    if (existing) {
      paintActivity(existing, label, status);
      return;
    }
    const chip = addActivityChip(label, status);
    liveActivity.set(callId, chip);
    scrollDown();
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
    const { clean, notes } = stripDirectivesForReplay(text);
    const bubble = addMsg(log, "assistant", "");
    applyAssistantRich(bubble, clean);
    for (const n of notes) {
      const note = el("div", `${PREFIX}-replay-note`);
      note.textContent = n;
      log.appendChild(note);
    }
    return bubble;
  }
  // Re-render a full thread (messages + inline DATA WIDGETS) into the log,
  // replacing whatever is shown. Shared by history-reopen + refresh-restore.
  function renderThreadItems(items: LoadedThreadItem[]): void {
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
        // Replay a persisted process step (static, already finished).
        addActivityChip(it.label, it.status);
      } else if ("role" in it) {
        if (it.role === "assistant") addAssistantMessage(it.content);
        else addMsg(log, it.role, it.content);
        history.push({ role: it.role, content: it.content });
      }
    }
    scrollDown(true);
  }

  if (history.length) {
    // Restore a prior conversation (survives refresh) — text only at first.
    for (const m of history)
      if (m.role === "assistant") addAssistantMessage(m.content);
      else addMsg(log, m.role, m.content);
  } else if (opts.greeting) {
    addAssistantMessage(opts.greeting);
  }
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
  let pinned = true;
  let scrollQueued = false;
  log.addEventListener("scroll", () => {
    pinned = log.scrollHeight - log.scrollTop - log.clientHeight < 90;
  });
  // Defensive wheel scrolling. The widget lives in the host's light DOM, so a
  // host that installs a global wheel handler — scroll-lock from an open
  // drawer/dialog (react-remove-scroll/Radix), or a smooth-scroll library —
  // can preventDefault our wheel events and the conversation won't scroll. We
  // drive the scroll ourselves and only claim the gesture when the log actually
  // moves, so page overscroll still hands off cleanly at the top/bottom edge.
  log.addEventListener(
    "wheel",
    (e) => {
      const step =
        e.deltaMode === 1
          ? e.deltaY * 16 // lines → px
          : e.deltaMode === 2
            ? e.deltaY * log.clientHeight // pages → px
            : e.deltaY;
      const before = log.scrollTop;
      log.scrollTop = before + step;
      if (log.scrollTop !== before) {
        e.preventDefault();
        e.stopPropagation();
      }
    },
    { passive: false }
  );
  const scrollDown = (force?: boolean): void => {
    if (force) pinned = true;
    if (!pinned || scrollQueued) return;
    scrollQueued = true;
    requestAnimationFrame(() => {
      scrollQueued = false;
      log.scrollTop = log.scrollHeight;
    });
  };

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
    talk: "Talk",
    analytics: "Analytics",
    creation: "Creation",
    automation: "Automation",
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
    document.createTextNode(" credits")
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
  input.placeholder = `Ask ${name} anything…`;
  input.setAttribute("aria-label", `Message ${name}`);
  input.autocomplete = "off";
  // Restore an unsent draft from a prior session; keep it in sync as they type.
  input.value = loadDraft();
  input.addEventListener("input", () => saveDraft(input.value));
  const sendBtn = el("button", `${PREFIX}-send`) as HTMLButtonElement;
  sendBtn.type = "submit";
  sendBtn.textContent = "Send";
  form.append(input, sendBtn);

  panel.append(header, log, meterEl, statusEl, suggestionsEl, form);
  renderStatus();
  // Shared avatar gradient/filter defs (once) — see AVATAR_DEFS.
  if (!document.getElementById(`${PREFIX}-av-g`)) {
    const defs = document.createElement("div");
    defs.style.cssText = "position:absolute;width:0;height:0;overflow:hidden";
    defs.innerHTML = AVATAR_DEFS;
    root.append(defs);
  }
  root.append(bubble, panel);

  const open = (): void => {
    panel.style.display = "flex";
    panel.style.transform = ""; // clear any leftover drag offset
    bubble.style.display = "none";
    // Show the latest message + focus the composer (always-ready assistant feel).
    pinned = true;
    log.scrollTop = log.scrollHeight;
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
    panel.style.top = "";
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
        panel.style.top = "";
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
  let expanded = false;
  if (expandBtn) {
    expandBtn.addEventListener("click", () => {
      expanded = !expanded;
      panel.classList.toggle(`${PREFIX}-expanded`, expanded);
      expandBtn!.innerHTML = expanded ? ICON_COLLAPSE : ICON_EXPAND;
      expandBtn!.setAttribute(
        "aria-label",
        expanded ? "Restore chat size" : "Expand chat"
      );
      expandBtn!.title = expanded ? "Restore" : "Expand";
      scrollDown(true);
    });
  }

  // History (past conversations) — fetch the thread list, show a picker, and on
  // select replay that thread's messages into the log (sets it as the active
  // thread so the next turn continues it).
  if (historyBtn && opts.listThreads) {
    historyBtn.addEventListener("click", () => void openHistory());
  }

  // New chat — drop the active thread + transcript (the old one stays in
  // history) and start fresh with the greeting.
  newChatBtn.addEventListener("click", () => {
    threadId = undefined;
    history.length = 0;
    saveState();
    clearRich();
    log.innerHTML = "";
    if (opts.greeting) addAssistantMessage(opts.greeting);
    void renderSuggestions();
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
    a.textContent = "Sign up — it's free to start";
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
    head.textContent = "Past conversations";
    const back = el("button", `${PREFIX}-history-back`);
    back.textContent = "Close";
    back.addEventListener("click", () => overlay.remove());
    head.appendChild(back);
    const listEl = el("div", `${PREFIX}-history-list`);
    listEl.textContent = "Loading…";
    overlay.append(head, listEl);
    panel.appendChild(overlay);
    try {
      const threads = await opts.listThreads();
      listEl.innerHTML = "";
      if (!threads.length) {
        listEl.textContent = "No past conversations yet.";
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
            sep.textContent = bucket;
            listEl.appendChild(sep);
          }
        }
        const item = el("button", `${PREFIX}-history-item`);
        const ti = el("span", `${PREFIX}-history-title`);
        ti.textContent = th.title || "Untitled conversation";
        item.appendChild(ti);
        if (th.updatedAt) {
          const dt = el("span", `${PREFIX}-history-date`);
          dt.textContent = relTime(th.updatedAt);
          item.appendChild(dt);
        }
        item.addEventListener(
          "click",
          () => void loadPastThread(th.id, overlay)
        );
        listEl.appendChild(item);
      }
    } catch {
      listEl.textContent = "Couldn't load history — try again.";
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
      renderThreadItems(items);
      threadId = id;
      saveState();
      overlay.remove();
    } catch {
      overlay.querySelector(`.${PREFIX}-history-list`)!.textContent =
        "Couldn't open that conversation.";
    }
  }

  // Let a nav/sidebar link anywhere in the host app open the panel.
  const onOpenEvent = (): void => open();
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
    if (!content || busy) return;
    input.value = "";
    saveDraft(""); // sent — drop the persisted draft
    void send(content);
  });

  /** Parse + render any inline directives in a finished reply, returning the
   *  text with them stripped. [[widget]]/[[navigate]]/[[action]]/[[form]]/lead. */
  function renderDirectives(text: string): string {
    let t = text;
    for (let i = 0; i < 6; i++) {
      const w = parseJsonDirective<WidgetSpec>(t, "widget");
      if (!w) break;
      t = w.stripped;
      renderWidget(w.spec);
    }
    const nav = parseJsonDirective<NavigateSpec>(t, "navigate");
    if (nav && opts.onWidgetAction && nav.spec.path) {
      t = nav.stripped;
      renderNavigate(nav.spec);
    }
    for (let i = 0; i < 4; i++) {
      const act = parseJsonDirective<ActionSpec>(t, "action");
      if (!act || !opts.onWidgetAction || !act.spec.name) break;
      t = act.stripped;
      renderAction(act.spec);
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
        submit: "Send",
      });
    }
    return t;
  }

  // Confirm cards for write-tool proposals (the AI proposes; the USER applies).
  const PROPOSAL_LABELS: Record<string, string> = {
    update_creation: "Apply this update to the creation?",
  };
  function proposalSummary(
    name: string,
    args: Record<string, unknown>
  ): string {
    if (name === "update_creation") {
      const parts: string[] = [];
      if (typeof args.title === "string") parts.push(`Title → “${args.title}”`);
      if (typeof args.status === "string")
        parts.push(`Status → ${args.status}`);
      return parts.join("\n");
    }
    return Object.entries(args)
      .filter(([k]) => k !== "id")
      .map(([k, v]) => `${k}: ${String(v)}`)
      .join("\n");
  }
  function renderProposal(name: string, args: Record<string, unknown>): void {
    const wrap = el("div", `${PREFIX}-proposal`);
    const title = el("div", `${PREFIX}-proposal-title`);
    title.textContent = PROPOSAL_LABELS[name] ?? "Apply this change?";
    wrap.appendChild(title);
    const summary = proposalSummary(name, args);
    if (summary) {
      const s = el("div", `${PREFIX}-proposal-summary`);
      s.textContent = summary;
      wrap.appendChild(s);
    }
    const row = el("div", `${PREFIX}-confirm-row`);
    const apply = el("button", `${PREFIX}-nav-btn`) as HTMLButtonElement;
    apply.type = "button";
    apply.textContent = "Apply";
    const cancel = el("button", `${PREFIX}-confirm-no`) as HTMLButtonElement;
    cancel.type = "button";
    cancel.textContent = "Dismiss";
    cancel.addEventListener("click", () => wrap.remove());
    apply.addEventListener("click", async () => {
      apply.disabled = true;
      apply.textContent = "Applying…";
      try {
        const msg = await opts.onApplyProposal!(name, args);
        wrap.innerHTML = "";
        const ok = el("div", `${PREFIX}-proposal-ok`);
        ok.innerHTML =
          `<span class="${PREFIX}-act-ok" aria-hidden="true">✓</span>` +
          `<span>${escapeHtml((typeof msg === "string" && msg) || "Applied")}</span>`;
        wrap.appendChild(ok);
      } catch {
        apply.disabled = false;
        apply.textContent = "Try again";
      }
    });
    row.append(apply, cancel);
    wrap.appendChild(row);
    log.appendChild(wrap);
    scrollDown(true);
  }

  async function send(content: string): Promise<void> {
    busy = true;
    lastUserContent = content;
    // The conversation is starting — page shortcuts give way to the thread.
    suggestionsEl.style.display = "none";
    suggestionsEl.innerHTML = "";
    sendBtn.disabled = true;
    setRole("talk"); // each turn starts as the conversational copilot
    addMsg(log, "user", content);
    history.push({ role: "user", content });
    saveState();
    // Animated typing indicator until the first token lands.
    const typing = el("div", `${PREFIX}-typing`);
    typing.innerHTML = "<span></span><span></span><span></span>";
    log.appendChild(typing);
    scrollDown(true);
    let assistant: HTMLElement | null = null;
    let assistantRaw = "";
    let producedAny = false;
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
      const pageContext = opts.getContext ? await opts.getContext() : undefined;
      const res = await fetch(opts.endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        credentials: opts.withCredentials ? "include" : "same-origin",
        body: JSON.stringify({
          ...(opts.extraBody ?? {}),
          ...(pageContext ? { pageContext } : {}),
          accountId: opts.accountId ?? "",
          threadId,
          content,
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
                frame.status
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
              typing.remove();
              flushSegment(false);
              renderProposal(
                frame.name,
                (frame.args ?? {}) as Record<string, unknown>
              );
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
    }

    // Clear the typing indicator + render the FINAL text segment (with
    // directives). Earlier segments were already flushed around widgets/chips.
    typing.remove();
    const lastBubble = flushSegment(true);
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
    const controls: { name: string; get: () => string }[] = [];
    for (const field of spec.fields.slice(0, 8)) {
      let input: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
      if (field.type === "textarea") {
        input = el("textarea", `${PREFIX}-lead-input`) as HTMLTextAreaElement;
      } else if (field.type === "select") {
        const sel = el("select", `${PREFIX}-lead-input`) as HTMLSelectElement;
        for (const o of field.options ?? []) {
          const opt = document.createElement("option");
          opt.value = o;
          opt.textContent = o;
          sel.appendChild(opt);
        }
        input = sel;
      } else {
        const i = el("input", `${PREFIX}-lead-input`) as HTMLInputElement;
        i.type = field.type === "number" ? "number" : (field.type ?? "text");
        input = i;
      }
      if ("placeholder" in input && field.placeholder)
        (input as HTMLInputElement).placeholder = field.label
          ? `${field.label} — ${field.placeholder}`
          : field.placeholder;
      else if ("placeholder" in input && field.label)
        (input as HTMLInputElement).placeholder = field.label;
      if (field.required) (input as HTMLInputElement).required = true;
      f.appendChild(input);
      controls.push({ name: field.name, get: () => input.value.trim() });
    }
    const submit = el("button", `${PREFIX}-lead-btn`) as HTMLButtonElement;
    submit.type = "submit";
    submit.textContent = spec.submit ?? "Submit";
    f.appendChild(submit);
    wrap.appendChild(f);
    log.appendChild(wrap);
    scrollDown(true);
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const data: Record<string, string> = {};
      for (const c of controls) data[c.name] = c.get();
      if (
        controls.some((c) => !data[c.name]) &&
        spec.fields.some((x) => x.required)
      )
        return;
      submit.disabled = true;
      submit.textContent = "Sending…";
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
        ok.textContent = (typeof msg === "string" && msg) || "Done ✓";
        wrap.appendChild(ok);
      } catch {
        submit.disabled = false;
        submit.textContent = "Try again";
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
  function renderNavigate(spec: NavigateSpec): void {
    const wrap = el("div", `${PREFIX}-nav`);
    const label = spec.label || "Open page";
    if (autoNav) {
      const chip = el("div", `${PREFIX}-autonav`);
      chip.innerHTML = `${ICON_COMPASS}<span>${escapeHtml(`Opening ${label}…`)}</span>`;
      wrap.appendChild(chip);
      log.appendChild(wrap);
      scrollDown(true);
      void Promise.resolve(
        opts.onWidgetAction!("navigate", { path: spec.path })
      ).catch(() => {
        chip.querySelector("span")!.textContent = `Couldn't open ${label}`;
      });
      return;
    }
    const btn = el("button", `${PREFIX}-nav-btn`) as HTMLButtonElement;
    btn.type = "button";
    btn.innerHTML = `<span>${escapeHtml(label)}</span> <span aria-hidden="true">→</span>`;
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      try {
        await opts.onWidgetAction!("navigate", { path: spec.path });
        btn.innerHTML = `<span>${escapeHtml(label)} ✓</span>`;
      } catch {
        btn.disabled = false;
      }
    });
    wrap.appendChild(btn);
    log.appendChild(wrap);
    scrollDown(true);
  }

  /** Render an AI-proposed in-app action as a button (with optional confirm
   *  step), dispatched to the host via onWidgetAction(name, data). */
  function renderAction(spec: ActionSpec): void {
    // Reflect the acting capability in the status badge (e.g. research-brand →
    // Analytics, open-studio → Creation); plain navigation stays Talk.
    if (ACTION_ROLE[spec.name]) setRole(ACTION_ROLE[spec.name]);
    const wrap = el("div", `${PREFIX}-nav`);
    // Auto-navigate: a confirm-LESS action is pure navigation (open-studio,
    // open-dashboards, …) — run it immediately. Anything with `confirm` (changes
    // state / costs credits) ALWAYS asks, even in auto mode.
    if (autoNav && !spec.confirm) {
      const label = spec.label || "Opening…";
      const chip = el("div", `${PREFIX}-autonav`);
      chip.innerHTML = `${ICON_COMPASS}<span>${escapeHtml(`Opening ${label}…`)}</span>`;
      wrap.appendChild(chip);
      log.appendChild(wrap);
      scrollDown(true);
      void Promise.resolve(
        opts.onWidgetAction!(spec.name, spec.data ?? {})
      ).then(
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
        const msg = await opts.onWidgetAction!(spec.name, spec.data ?? {});
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
        yes.textContent = "Confirm";
        const no = el("button", `${PREFIX}-confirm-no`) as HTMLButtonElement;
        no.type = "button";
        no.textContent = "Cancel";
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
    txt.textContent = `${name} hit a snag and couldn't answer. Please try again.`;
    const detail = el("div", `${PREFIX}-error-detail`);
    detail.textContent = raw;
    const actions = el("div", `${PREFIX}-error-actions`);

    const retry = el("button", `${PREFIX}-error-btn ${PREFIX}-error-retry`);
    retry.setAttribute("type", "button");
    retry.textContent = "Try again";
    retry.addEventListener("click", () => {
      wrap.remove();
      if (lastUserContent) void send(lastUserContent);
    });
    actions.appendChild(retry);

    if (opts.onReportIssue) {
      const report = el("button", `${PREFIX}-error-btn`);
      report.setAttribute("type", "button");
      report.textContent = "Report issue";
      report.addEventListener("click", async () => {
        (report as HTMLButtonElement).disabled = true;
        report.textContent = "Reporting…";
        try {
          await opts.onReportIssue!({
            error: raw,
            lastUserMessage: lastUserContent,
            threadId,
          });
          report.textContent = "Reported ✓ — our team will look into it";
        } catch {
          report.textContent = "Couldn't report — try later";
          (report as HTMLButtonElement).disabled = false;
        }
      });
      actions.appendChild(report);
    }

    wrap.append(txt, detail, actions);
    log.appendChild(wrap);
    scrollDown(true);
  }

  return {
    open,
    close,
    toggle,
    destroy() {
      if (opts.openEventName) {
        window.removeEventListener(opts.openEventName, onOpenEvent);
      }
      unbindKeyboard();
      clearRich();
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
function relBucket(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "Older";
  const now = new Date();
  const startToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  ).getTime();
  const day = 86_400_000;
  const t = d.getTime();
  if (t >= startToday) return "Today";
  if (t >= startToday - day) return "Yesterday";
  if (t >= startToday - 6 * day) return "Earlier this week";
  if (t >= startToday - 29 * day) return "This month";
  return "Older";
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

function addMsg(
  log: HTMLElement,
  role: "user" | "assistant",
  text: string
): HTMLElement {
  const msg = el("div", `${PREFIX}-msg ${PREFIX}-${role}`);
  msg.textContent = text;
  log.appendChild(msg);
  return msg;
}

let stylesInjected = false;
function injectStyles(
  accent: string,
  side: "left" | "right",
  gradient: string
): void {
  if (stylesInjected) return;
  stylesInjected = true;
  const css = `
@keyframes ${PREFIX}-spin{to{transform:rotate(360deg)}}
@keyframes ${PREFIX}-rise{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
@keyframes ${PREFIX}-blink{0%,80%,100%{opacity:.25;transform:translateY(0)}40%{opacity:1;transform:translateY(-3px)}}
@keyframes ${PREFIX}-richin{from{opacity:.15;transform:translateY(3px)}to{opacity:1;transform:none}}
.${PREFIX}-rich-in{animation:${PREFIX}-richin .28s cubic-bezier(.22,1,.36,1)}
@keyframes ${PREFIX}-tokin{from{opacity:0;filter:blur(5px)}to{opacity:1;filter:blur(0)}}
.${PREFIX}-tok{animation:${PREFIX}-tokin .34s ease forwards}
.${PREFIX}-activity{align-self:flex-start;display:inline-flex;align-items:center;gap:7px;max-width:92%;border:1px solid ${accent}26;background:${accent}0d;border-radius:10px;padding:5px 10px;font-size:12px;font-weight:500;animation:${PREFIX}-rise .2s ease}
.${PREFIX}-activity-done{opacity:.72}
.${PREFIX}-act-label{color:#333}
.${PREFIX}-act-spin{width:11px;height:11px;flex:0 0 auto;border-radius:50%;border:2px solid ${accent}44;border-top-color:${accent};animation:${PREFIX}-spin .7s linear infinite}
.${PREFIX}-act-ok{color:#10b981;font-weight:700}
.${PREFIX}-act-x{color:#ef4444;font-weight:700}
.${PREFIX}-replay-note{align-self:flex-start;display:inline-flex;align-items:center;border:1px dashed #d8d8d8;border-radius:9px;padding:4px 10px;font-size:12px;color:#888;background:#fafafa}
.${PREFIX}-usage{align-self:flex-start;display:inline-flex;align-items:center;gap:6px;margin-top:-4px;padding:0 2px;font-size:10.5px;color:#9aa0a6;font-variant-numeric:tabular-nums}
.${PREFIX}-usage-pill{display:inline-flex;align-items:center;border:1px solid #e6e6e6;border-radius:6px;padding:0 5px;line-height:16px}
.${PREFIX}-usage-sep{opacity:.5}
@keyframes ${PREFIX}-pulse{0%{box-shadow:0 0 0 0 rgba(96,199,200,.5)}70%{box-shadow:0 0 0 12px rgba(96,199,200,0)}100%{box-shadow:0 0 0 0 rgba(96,199,200,0)}}
@keyframes ${PREFIX}-float{0%,100%{transform:translateY(0)}50%{transform:translateY(-2.5px)}}
@keyframes ${PREFIX}-blink2{0%,90%,100%{transform:scaleY(1)}95%{transform:scaleY(.12)}}
.${PREFIX}-ayca{display:block;width:100%;height:100%;overflow:visible;animation:${PREFIX}-float 4s ease-in-out infinite;filter:drop-shadow(0 5px 14px rgba(250,113,45,.5))}
.${PREFIX}-eyes{transform-origin:24px 23px;animation:${PREFIX}-blink2 5.5s ease-in-out infinite}
.${PREFIX}-bubble{position:fixed;bottom:18px;${side}:18px;z-index:2147483000;width:66px;height:66px;border:none;background:transparent;color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;transition:transform .2s ease}
.${PREFIX}-bubble:hover{transform:translateY(-2px) scale(1.06)}
.${PREFIX}-bubble-av{position:relative;width:100%;height:100%;display:flex;align-items:center;justify-content:center}
.${PREFIX}-bubble .${PREFIX}-ayca{width:54px;height:54px}
.${PREFIX}-av-img{width:100%;height:100%;object-fit:cover;border-radius:50%}
.${PREFIX}-bubble svg{width:26px;height:26px}
.${PREFIX}-panel{position:fixed;bottom:20px;${side}:20px;z-index:2147483000;width:368px;max-width:calc(100vw - 32px);height:540px;max-height:calc(100vh - 40px);background:#fff;color:#111;border-radius:18px;box-shadow:0 18px 52px rgba(0,0,0,.32);display:flex;flex-direction:column;overflow:hidden;font-family:system-ui,-apple-system,sans-serif;animation:${PREFIX}-rise .22s ease}
.${PREFIX}-header{background:${gradient};color:#fff;padding:12px 14px;display:flex;align-items:center;gap:10px}
.${PREFIX}-avatar{position:relative;width:38px;height:38px;flex:0 0 auto;display:flex;align-items:center;justify-content:center;border-radius:50%;background:rgba(12,17,30,.55)}
.${PREFIX}-avatar .${PREFIX}-ayca{width:34px;height:34px}
.${PREFIX}-hname{display:flex;flex-direction:column;line-height:1.15;min-width:0;flex:1 1 auto}
.${PREFIX}-title{font-weight:700;font-size:15px;letter-spacing:.04em}
.${PREFIX}-sub{font-size:11px;opacity:.85}
.${PREFIX}-close{background:rgba(255,255,255,.15);border:none;color:#fff;font-size:18px;line-height:1;width:26px;height:26px;border-radius:8px;cursor:pointer;flex:0 0 auto}
.${PREFIX}-log{flex:1 1 auto;min-height:0;overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;padding:14px;display:flex;flex-direction:column;gap:10px;background:#fafafa;scrollbar-width:thin}
.${PREFIX}-log:focus-visible{outline:none}
.${PREFIX}-log::-webkit-scrollbar{width:8px}
.${PREFIX}-log::-webkit-scrollbar-thumb{background:rgba(0,0,0,.18);border-radius:8px}
@keyframes ${PREFIX}-caret{0%,55%{opacity:.85}55.01%,100%{opacity:0}}
.${PREFIX}-streaming::after{content:"";display:inline-block;width:2px;height:1.05em;margin-left:1px;border-radius:1px;background:${accent};vertical-align:-2px;animation:${PREFIX}-caret 1.1s steps(1) infinite}
.${PREFIX}-msg{max-width:85%;padding:9px 12px;border-radius:14px;font-size:14px;line-height:1.45;white-space:pre-wrap;word-break:break-word;animation:${PREFIX}-rise .2s ease}
.${PREFIX}-user{align-self:flex-end;background:${accent};color:#fff;border-bottom-right-radius:4px}
.${PREFIX}-assistant{align-self:flex-start;background:#fff;color:#111;border:1px solid #ececec;border-bottom-left-radius:4px}
.${PREFIX}-assistant p{margin:0 0 8px}.${PREFIX}-assistant>:last-child{margin-bottom:0}
.${PREFIX}-assistant h1,.${PREFIX}-assistant h2,.${PREFIX}-assistant h3,.${PREFIX}-assistant h4{margin:10px 0 6px;font-weight:700;line-height:1.25}
.${PREFIX}-assistant h1{font-size:17px}.${PREFIX}-assistant h2{font-size:16px}.${PREFIX}-assistant h3{font-size:14.5px}.${PREFIX}-assistant h4{font-size:13.5px}
.${PREFIX}-assistant ul,.${PREFIX}-assistant ol{margin:6px 0;padding-left:20px}
.${PREFIX}-assistant li{line-height:1.45;margin:2px 0}
.${PREFIX}-assistant a{color:${accent};text-decoration:underline;text-underline-offset:2px}
.${PREFIX}-assistant code{background:rgba(0,0,0,.06);border-radius:5px;padding:1px 5px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px}
.${PREFIX}-assistant pre.md-pre{background:#0d1117;color:#e6edf3;border-radius:10px;padding:10px 12px;overflow:auto;margin:8px 0}
.${PREFIX}-assistant pre.md-pre code{background:none;padding:0;color:inherit;font-size:12px;white-space:pre}
.${PREFIX}-assistant blockquote{margin:8px 0;padding:2px 12px;border-left:3px solid ${accent}66;color:#555}
.${PREFIX}-assistant hr{border:none;border-top:1px solid #e6e6e6;margin:10px 0}
.${PREFIX}-assistant table.md-table{width:100%;border-collapse:collapse;font-size:12.5px;margin:8px 0}
.${PREFIX}-assistant table.md-table th{text-align:left;font-weight:700;color:#666;border-bottom:1px solid #e6e6e6;padding:5px 8px}
.${PREFIX}-assistant table.md-table td{border-bottom:1px solid #f2f2f2;padding:5px 8px}
.${PREFIX}-assistant strong{font-weight:700}.${PREFIX}-assistant del{opacity:.7}
.${PREFIX}-widget-host{padding:8px}
.${PREFIX}-typing{align-self:flex-start;display:flex;gap:4px;padding:10px 12px}
.${PREFIX}-typing span{width:7px;height:7px;border-radius:50%;background:${accent};animation:${PREFIX}-blink 1.2s infinite}
.${PREFIX}-typing span:nth-child(2){animation-delay:.2s}
.${PREFIX}-typing span:nth-child(3){animation-delay:.4s}
.${PREFIX}-error{align-self:stretch;border:1px solid #f3c5b6;background:#fff6f2;border-radius:14px;padding:11px 12px;animation:${PREFIX}-rise .2s ease}
.${PREFIX}-error-text{font-size:13px;font-weight:600;color:#b23b18}
.${PREFIX}-error-detail{font-size:11px;color:#9a6b5c;margin-top:3px;word-break:break-word}
.${PREFIX}-error-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:9px}
.${PREFIX}-error-btn{border:1px solid #e3b9a8;background:#fff;color:#a33;border-radius:9px;padding:6px 12px;font-size:12px;font-weight:600;cursor:pointer}
.${PREFIX}-error-retry{background:${accent};border-color:${accent};color:#fff}
.${PREFIX}-error-btn:disabled{opacity:.6;cursor:default}
.${PREFIX}-suggestions{display:flex;flex-wrap:wrap;gap:6px;padding:8px 10px 0;background:#fff}
.${PREFIX}-suggestion{border:1px solid ${accent}33;background:${accent}0d;color:${accent};border-radius:999px;padding:6px 11px;font-size:12.5px;font-weight:500;line-height:1.2;cursor:pointer;transition:background .15s ease,border-color .15s ease;text-align:left}
.${PREFIX}-suggestion:hover{background:${accent}1a;border-color:${accent}66}
.${PREFIX}-form{display:flex;gap:8px;padding:10px;border-top:1px solid #eee;background:#fff}
.${PREFIX}-input{flex:1;border:1px solid #ddd;border-radius:11px;padding:10px 12px;font-size:14px;outline:none}
.${PREFIX}-meter{padding:7px 12px 0;background:#fff}
.${PREFIX}-meter-bar{height:4px;border-radius:999px;background:#eee;overflow:hidden}
.${PREFIX}-meter-bar>span{display:block;height:100%;border-radius:999px;background:linear-gradient(90deg,${accent},#FBAA34);transition:width .3s ease}
.${PREFIX}-meter-row{display:flex;justify-content:space-between;gap:8px;margin-top:3px;font-size:10.5px;color:#888}
.${PREFIX}-status{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:7px 12px;font-size:11px;background:#fff;border-top:1px solid #f0f0f0}
.${PREFIX}-status-role{display:inline-flex;align-items:center;padding:2px 8px;border-radius:999px;font-weight:600;color:${accent};background:${accent}1a}
.${PREFIX}-status-credits{font-weight:600;color:#555;font-variant-numeric:tabular-nums}
.${PREFIX}-status-credits-val{display:inline-block;transition:color .2s ease}
.${PREFIX}-credits-live{color:${accent}}
.${PREFIX}-cta{display:flex;justify-content:center;padding:6px 0 2px}
.${PREFIX}-cta-btn{display:inline-flex;align-items:center;justify-content:center;border-radius:999px;padding:9px 18px;font-size:13px;font-weight:600;color:#fff;text-decoration:none;background:linear-gradient(90deg,${accent},#FBAA34);box-shadow:0 4px 14px ${accent}40}
.${PREFIX}-lead{align-self:stretch;border:1px solid #eee;border-radius:14px;padding:11px 12px;background:#fff;animation:${PREFIX}-rise .2s ease}
.${PREFIX}-form-title{font-size:13px;font-weight:600;margin-bottom:8px}
.${PREFIX}-lead-form{display:flex;flex-direction:column;gap:8px}
.${PREFIX}-lead-input{width:100%;border:1px solid ${accent};border-radius:11px;padding:9px 12px;font-size:14px;outline:none;box-sizing:border-box;font-family:inherit}
.${PREFIX}-lead-btn{border:none;background:${accent};color:#fff;border-radius:11px;padding:10px 16px;font-size:14px;font-weight:600;cursor:pointer}
.${PREFIX}-lead-btn:disabled{opacity:.6;cursor:default}
.${PREFIX}-lead-ok{font-size:13px;font-weight:600;color:${accent}}
.${PREFIX}-input:focus{border-color:${accent};box-shadow:0 0 0 3px ${accent}22}
.${PREFIX}-send{border:none;background:${accent};color:#fff;border-radius:11px;padding:0 16px;font-size:14px;font-weight:600;cursor:pointer}
.${PREFIX}-send:disabled{opacity:.5;cursor:default}
.${PREFIX}-hactions{display:flex;align-items:center;gap:4px;flex:0 0 auto}
.${PREFIX}-icon{background:rgba(255,255,255,.15);border:none;color:#fff;width:26px;height:26px;border-radius:8px;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0}
.${PREFIX}-icon:hover{background:rgba(255,255,255,.28)}
.${PREFIX}-icon-on{background:#fff;color:${accent}}
.${PREFIX}-icon-on:hover{background:#fff}
.${PREFIX}-autonav{align-self:flex-start;display:inline-flex;align-items:center;gap:7px;border:1px solid ${accent}33;background:${accent}0f;color:${accent};border-radius:11px;padding:8px 12px;font-size:13px;font-weight:600;animation:${PREFIX}-rise .2s ease}
.${PREFIX}-expanded{width:min(760px,calc(100vw - 32px));height:calc(100vh - 40px)}
.${PREFIX}-expanded .${PREFIX}-msg{max-width:75%}
.${PREFIX}-history{position:absolute;inset:0;background:#fff;display:flex;flex-direction:column;z-index:5;animation:${PREFIX}-rise .18s ease}
.${PREFIX}-history-head{display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-bottom:1px solid #eee;font-weight:600;font-size:14px}
.${PREFIX}-history-back{border:1px solid #ddd;background:#fff;border-radius:9px;padding:5px 11px;font-size:12px;font-weight:600;cursor:pointer;color:#333}
.${PREFIX}-history-list{flex:1 1 auto;min-height:0;overflow-y:auto;padding:8px;display:flex;flex-direction:column;gap:4px;font-size:13px;color:#555}
.${PREFIX}-history-sep{padding:8px 4px 2px;font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#9aa0a6}
.${PREFIX}-history-item{display:flex;align-items:center;justify-content:space-between;gap:8px;text-align:left;border:1px solid #eee;background:#fff;border-radius:10px;padding:10px 12px;cursor:pointer;width:100%}
.${PREFIX}-history-item:hover{border-color:${accent};background:${accent}0a}
.${PREFIX}-history-title{font-weight:600;color:#111;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.${PREFIX}-history-date{font-size:11px;color:#999;flex:0 0 auto}
.${PREFIX}-widget{align-self:stretch;border:1px solid #ececec;border-radius:14px;padding:12px;background:#fff;animation:${PREFIX}-rise .2s ease}
.${PREFIX}-widget-title{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#888;margin-bottom:8px}
.${PREFIX}-widget-stat{font-size:30px;font-weight:800;line-height:1.1;color:#111}
.${PREFIX}-widget-cap{font-size:13px;color:#666;margin-top:2px}
.${PREFIX}-widget-delta{font-size:12px;font-weight:600;color:${accent};margin-top:4px}
.${PREFIX}-widget-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(90px,1fr));gap:8px}
.${PREFIX}-kpi{border:1px solid #f0f0f0;border-radius:10px;padding:8px 10px;background:#fafafa}
.${PREFIX}-kpi-v{font-size:18px;font-weight:700;color:#111}
.${PREFIX}-kpi-l{font-size:11px;color:#888;margin-top:1px}
.${PREFIX}-kpi-d{font-size:11px;font-weight:600;color:${accent};margin-top:2px}
.${PREFIX}-widget-table{width:100%;border-collapse:collapse;font-size:12.5px}
.${PREFIX}-widget-table th{text-align:left;font-weight:700;color:#666;border-bottom:1px solid #e6e6e6;padding:6px 8px}
.${PREFIX}-widget-table td{border-bottom:1px solid #f2f2f2;padding:6px 8px;color:#222}
.${PREFIX}-widget-list{margin:0;padding-left:18px;font-size:13.5px;color:#222;display:flex;flex-direction:column;gap:3px}
.${PREFIX}-nav{align-self:flex-start;animation:${PREFIX}-rise .2s ease}
.${PREFIX}-nav-btn{display:inline-flex;align-items:center;gap:8px;border:1px solid ${accent};background:${accent}0f;color:${accent};border-radius:11px;padding:9px 14px;font-size:13.5px;font-weight:600;cursor:pointer}
.${PREFIX}-nav-btn:hover{background:${accent}1c}
.${PREFIX}-nav-btn:disabled{opacity:.7;cursor:default}
.${PREFIX}-proposal{align-self:stretch;border:1px solid ${accent}33;background:${accent}0a;border-radius:14px;padding:12px;display:flex;flex-direction:column;gap:8px;animation:${PREFIX}-rise .2s ease}
.${PREFIX}-proposal-title{font-size:13px;font-weight:700}
.${PREFIX}-proposal-summary{font-size:12.5px;color:#555;white-space:pre-wrap;line-height:1.45}
.${PREFIX}-proposal-ok{font-size:13px;font-weight:600;color:#10b981;display:inline-flex;align-items:center;gap:6px}
.${PREFIX}-confirm-q{font-size:13px;color:#333;margin-bottom:8px}
.${PREFIX}-confirm-row{display:flex;gap:8px}
.${PREFIX}-confirm-no{border:1px solid #ddd;background:#fff;color:#555;border-radius:11px;padding:9px 14px;font-size:13px;font-weight:600;cursor:pointer}
@media (prefers-color-scheme:dark){.${PREFIX}-panel{background:#161616;color:#eee}.${PREFIX}-log{background:#101010}.${PREFIX}-assistant{background:#1d1d1d;color:#eee;border-color:#2a2a2a}.${PREFIX}-form{background:#161616;border-top-color:#262626}.${PREFIX}-input{background:#101010;color:#eee;border-color:#333}.${PREFIX}-error{background:#231613;border-color:#5a2c1d}.${PREFIX}-history{background:#161616}.${PREFIX}-history-head{border-bottom-color:#262626}.${PREFIX}-history-back{background:#1d1d1d;border-color:#333;color:#ddd}.${PREFIX}-history-item{background:#1d1d1d;border-color:#2a2a2a}.${PREFIX}-history-title{color:#eee}.${PREFIX}-widget{background:#1d1d1d;border-color:#2a2a2a}.${PREFIX}-widget-stat,.${PREFIX}-kpi-v,.${PREFIX}-widget-table td{color:#eee}.${PREFIX}-kpi{background:#161616;border-color:#2a2a2a}.${PREFIX}-confirm-q{color:#ddd}.${PREFIX}-confirm-no{background:#1d1d1d;border-color:#333;color:#ccc}.${PREFIX}-meter{background:#161616}.${PREFIX}-meter-bar{background:#2c2c2c}.${PREFIX}-meter-row{color:#9b9b9b}.${PREFIX}-suggestions{background:#161616}.${PREFIX}-status{background:#161616;border-top-color:#262626}.${PREFIX}-status-credits{color:#bbb}.${PREFIX}-act-label{color:#ddd}.${PREFIX}-usage-pill{border-color:#2a2a2a}.${PREFIX}-proposal-summary{color:#bbb}.${PREFIX}-lead{background:#1d1d1d;border-color:#2a2a2a}.${PREFIX}-form-title{color:#eee}.${PREFIX}-lead-input{background:#101010;color:#eee;border-color:#333}.${PREFIX}-lead-input::placeholder{color:#888}.${PREFIX}-lead-input option{background:#1d1d1d;color:#eee}.${PREFIX}-replay-note{border-color:#333;background:#161616;color:#999}}
@media (prefers-color-scheme:dark){.${PREFIX}-assistant code{background:rgba(255,255,255,.1)}.${PREFIX}-assistant blockquote{color:#aaa;border-left-color:${accent}88}.${PREFIX}-assistant table.md-table th{color:#aaa;border-bottom-color:#2a2a2a}.${PREFIX}-assistant table.md-table td{border-bottom-color:#222}.${PREFIX}-assistant hr{border-top-color:#2a2a2a}}
@keyframes ${PREFIX}-sheetup{from{transform:translateY(100%)}to{transform:translateY(0)}}
/* On phones the panel becomes a full-width bottom sheet (slides up from the
   bottom edge, ~90% of the dynamic viewport, rounded top, grab handle) so the
   chat is comfortably usable instead of a cramped corner card. */
@media (max-width:640px){
  .${PREFIX}-panel{inset:0;width:100%;max-width:100%;height:100vh;height:100dvh;max-height:none;border-radius:0;animation:${PREFIX}-sheetup .3s cubic-bezier(.22,1,.36,1)}
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
