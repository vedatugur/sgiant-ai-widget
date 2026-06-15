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
    | Record<string, unknown>
    | undefined
    | Promise<Record<string, unknown> | undefined>;
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
  /** Assistant name shown in the header + bubble aria-label. Default "AYCA". */
  title?: string;
  /** Small line under the name. Default "Growth assistant". */
  subtitle?: string;
  /** Avatar image URL (the brand logo mark). Falls back to a crescent glyph. */
  avatarUrl?: string;
  /** CSS gradient for the chrome (header/bubble) for a premium look. */
  gradient?: string;
  greeting?: string;
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
   * Past-conversation history. When provided, a history control appears in the
   * header; opening it lists the user's prior threads. Picking one calls
   * `loadThread` and replays its messages. Wire these to the authed endpoints
   * (e.g. GET /accounts/:id/ai/threads and …/threads/:threadId/messages). Omit
   * to disable history (the widget still restores the last thread via persistKey).
   */
  listThreads?: () => Promise<
    Array<{ id: string; title?: string | null; updatedAt?: string }>
  >;
  /** Load one past thread's messages (oldest→newest) for replay in the log. */
  loadThread?: (
    threadId: string
  ) => Promise<Array<{ role: "user" | "assistant"; content: string }>>;
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

/** Pull a `[[form:{json}]]` directive out of assistant text, if present. */
function parseFormDirective(
  text: string
): { spec: FormSpec; stripped: string } | null {
  const start = text.indexOf("[[form:");
  if (start < 0) return null;
  const end = text.lastIndexOf("]]");
  if (end <= start) return null;
  const json = text.slice(start + "[[form:".length, end).trim();
  try {
    const spec = JSON.parse(json) as FormSpec;
    if (!spec || typeof spec.action !== "string" || !Array.isArray(spec.fields))
      return null;
    const stripped = (text.slice(0, start) + text.slice(end + 2)).trim();
    return { spec, stripped };
  } catch {
    return null;
  }
}

/** Generic `[[tag:{json}]]` directive extractor (first occurrence). */
function parseJsonDirective<T>(
  text: string,
  tag: string
): { spec: T; stripped: string } | null {
  const open = `[[${tag}:`;
  const start = text.indexOf(open);
  if (start < 0) return null;
  // Find the matching `]]` for THIS directive (not the last in the message, so
  // multiple directives in one reply each parse correctly).
  const end = text.indexOf("]]", start);
  if (end <= start) return null;
  const json = text.slice(start + open.length, end).trim();
  try {
    const spec = JSON.parse(json) as T;
    const stripped = (text.slice(0, start) + text.slice(end + 2)).trim();
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
}

const PREFIX = "sgiant-aiw";

// AYCA — "moonlight" (tr). A MINIMAL animated assistant: a soft moon-face (cream
// disc on the dark avatar = a moon in a night sky) with a moon-phase crescent,
// blinking eyes, a smile, blush, and a sparkle. Feminine + friendly without a
// literal portrait; reads cleanly at 24–36px. Animations (blink/float) in CSS.
const AVATAR_SVG = `<svg viewBox="0 0 48 48" class="${PREFIX}-ayca" aria-hidden="true">
<circle cx="24" cy="24" r="15" fill="#FCF7E3"/>
<path d="M24 9a15 15 0 0 1 0 30 18 18 0 0 0 0-30Z" fill="#FBD9A6" opacity=".5"/>
<g class="${PREFIX}-eyes" fill="#2B2236"><circle cx="19" cy="23" r="1.7"/><circle cx="29" cy="23" r="1.7"/></g>
<path d="M20.5 28.5q3.5 3 7 0" stroke="#2B2236" stroke-width="1.6" fill="none" stroke-linecap="round"/>
<circle cx="16.8" cy="27" r="1.6" fill="#FAB7A6" opacity=".7"/><circle cx="31.2" cy="27" r="1.6" fill="#FAB7A6" opacity=".7"/>
<path d="M37 12l.7 2.1 2.1.7-2.1.7-.7 2.1-.7-2.1-2.1-.7 2.1-.7Z" fill="#FBAA34"/>
</svg>`;

// Small line icons for the header controls (currentColor, 18px).
const ICON_HISTORY = `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3v5h5"/><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8"/><path d="M12 7v5l3 2"/></svg>`;
const ICON_EXPAND = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/></svg>`;
const ICON_COLLAPSE = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 14h6v6"/><path d="M20 10h-6V4"/><path d="M14 10l7-7"/><path d="M3 21l7-7"/></svg>`;

export function createAiChatWidget(
  opts: AiChatWidgetOptions
): AiChatWidgetHandle {
  const accent = opts.accent ?? "#6d28d9";
  const gradient =
    opts.gradient ?? `linear-gradient(135deg,${accent},${accent})`;
  const side = opts.position === "bottom-left" ? "left" : "right";
  const root = opts.container ?? document.body;
  const name = opts.title ?? "AYCA";
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
  const hLeft = el("div", `${PREFIX}-hleft`);
  const avatar = el("div", `${PREFIX}-avatar`);
  avatar.innerHTML = avatarInner;
  const hName = el("div", `${PREFIX}-hname`);
  const titleEl = el("span", `${PREFIX}-title`);
  titleEl.textContent = name;
  const subEl = el("span", `${PREFIX}-sub`);
  subEl.textContent = opts.subtitle ?? "Growth assistant";
  hName.append(titleEl, subEl);
  hLeft.append(avatar, hName);
  const hActions = el("div", `${PREFIX}-hactions`);
  // History (past conversations) — only when the host wired a thread lister.
  let historyBtn: HTMLElement | null = null;
  if (opts.listThreads) {
    historyBtn = el("button", `${PREFIX}-icon`);
    historyBtn.setAttribute("aria-label", "Past conversations");
    historyBtn.title = "History";
    historyBtn.innerHTML = ICON_HISTORY;
    hActions.appendChild(historyBtn);
  }
  // Expand / restore — grows the panel for easier reading (default on).
  let expandBtn: HTMLElement | null = null;
  const expandable = opts.expandable !== false;
  if (expandable) {
    expandBtn = el("button", `${PREFIX}-icon`);
    expandBtn.setAttribute("aria-label", "Expand chat");
    expandBtn.title = "Expand";
    expandBtn.innerHTML = ICON_EXPAND;
    hActions.appendChild(expandBtn);
  }
  const closeBtn = el("button", `${PREFIX}-close`);
  closeBtn.innerHTML = "&times;";
  closeBtn.setAttribute("aria-label", "Close chat");
  hActions.appendChild(closeBtn);
  header.append(hLeft, hActions);

  const log = el("div", `${PREFIX}-log`);
  // Accessible, scrollable conversation region. role=log + aria-live announces
  // streamed replies to screen readers; tabindex makes it keyboard-scrollable.
  log.setAttribute("role", "log");
  log.setAttribute("aria-live", "polite");
  log.setAttribute("aria-label", "Conversation");
  log.setAttribute("tabindex", "0");
  if (history.length) {
    // Restore a prior conversation (survives refresh).
    for (const m of history) addMsg(log, m.role, m.content);
  } else if (opts.greeting) {
    addMsg(log, "assistant", opts.greeting);
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
  const scrollDown = (force?: boolean): void => {
    if (force) pinned = true;
    if (!pinned || scrollQueued) return;
    scrollQueued = true;
    requestAnimationFrame(() => {
      scrollQueued = false;
      log.scrollTop = log.scrollHeight;
    });
  };

  const form = el("form", `${PREFIX}-form`) as HTMLFormElement;
  const input = el("input", `${PREFIX}-input`) as HTMLInputElement;
  // "Always ready" cue — an inviting prompt the assistant is waiting for input.
  input.placeholder = `Ask ${name} anything…`;
  input.setAttribute("aria-label", `Message ${name}`);
  input.autocomplete = "off";
  const sendBtn = el("button", `${PREFIX}-send`) as HTMLButtonElement;
  sendBtn.type = "submit";
  sendBtn.textContent = "Send";
  form.append(input, sendBtn);

  panel.append(header, log, form);
  root.append(bubble, panel);

  const open = (): void => {
    panel.style.display = "flex";
    bubble.style.display = "none";
    // Show the latest message + focus the composer (always-ready assistant feel).
    pinned = true;
    log.scrollTop = log.scrollHeight;
    input.focus();
  };
  const close = (): void => {
    panel.style.display = "none";
    bubble.style.display = "flex";
  };
  const toggle = (): void =>
    panel.style.display === "none" ? open() : close();

  bubble.addEventListener("click", open);
  closeBtn.addEventListener("click", close);

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
      for (const th of threads.slice(0, 50)) {
        const item = el("button", `${PREFIX}-history-item`);
        const ti = el("span", `${PREFIX}-history-title`);
        ti.textContent = th.title || "Untitled conversation";
        item.appendChild(ti);
        if (th.updatedAt) {
          const dt = el("span", `${PREFIX}-history-date`);
          dt.textContent = new Date(th.updatedAt).toLocaleDateString();
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
      const msgs = await opts.loadThread(id);
      // Replace the visible conversation with the chosen thread.
      log.querySelectorAll(`.${PREFIX}-msg`).forEach((n) => n.remove());
      history.length = 0;
      for (const m of msgs) {
        addMsg(log, m.role, m.content);
        history.push({ role: m.role, content: m.content });
      }
      threadId = id;
      saveState();
      overlay.remove();
      scrollDown(true);
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

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const content = input.value.trim();
    if (!content || busy) return;
    input.value = "";
    void send(content);
  });

  async function send(content: string): Promise<void> {
    busy = true;
    lastUserContent = content;
    sendBtn.disabled = true;
    addMsg(log, "user", content);
    history.push({ role: "user", content });
    saveState();
    // Animated typing indicator until the first token lands.
    const typing = el("div", `${PREFIX}-typing`);
    typing.innerHTML = "<span></span><span></span><span></span>";
    log.appendChild(typing);
    scrollDown(true);
    let assistant: HTMLElement | null = null;
    let failure: string | null = null;
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
                // Blinking caret while streaming → live "assistant is typing".
                assistant.classList.add(`${PREFIX}-streaming`);
              }
              assistant.textContent = (assistant.textContent ?? "") + piece;
              scrollDown();
            }
            // Inline data widget from the analytics lane (render_chart). Was
            // previously dropped — now rendered so widget responses are visible.
            if (frame.type === "widget") {
              typing.remove();
              renderServerWidget(frame.spec, frame.rows);
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
    }

    // Clear the typing indicator + the streaming caret now the reply is final.
    typing.remove();
    assistant?.classList.remove(`${PREFIX}-streaming`);
    if (!assistant || !assistant.textContent) {
      assistant?.remove();
      if (failure) showError(failure);
      else {
        addMsg(log, "assistant", "(no response)");
        scrollDown(true);
      }
    } else {
      // Render any directives the reply embedded, stripping them from the text.
      // Order: data widgets (can be several) → navigation → input form → lead.

      // [[widget:{...}]] — inline data widgets (stat/kpis/list/table). Rendered
      // on EVERY surface (incl. the public marketing bot), so "widget renderer"
      // responses are visible everywhere, not just text.
      for (let i = 0; i < 6; i++) {
        const w = parseJsonDirective<WidgetSpec>(
          assistant.textContent,
          "widget"
        );
        if (!w) break;
        assistant.textContent = w.stripped;
        renderWidget(w.spec);
      }

      // [[navigate:{path,label}]] — the assistant proposes a page. Rendered as a
      // button that, on click, calls the host's onWidgetAction("navigate",…) so
      // the host router does the move (user stays in control; host gates it).
      const nav = parseJsonDirective<NavigateSpec>(
        assistant.textContent,
        "navigate"
      );
      if (nav && opts.onWidgetAction && nav.spec.path) {
        assistant.textContent = nav.stripped;
        renderNavigate(nav.spec);
      }

      // [[form:{...}]] inline input form → host action; [[collect-email]] lead.
      const form = parseFormDirective(assistant.textContent);
      if (form && (opts.onWidgetAction || opts.onLead)) {
        assistant.textContent = form.stripped;
        renderForm(form.spec);
      } else if (
        (opts.onLead || opts.onWidgetAction) &&
        assistant.textContent.includes(LEAD_TOKEN)
      ) {
        assistant.textContent = assistant.textContent
          .replace(LEAD_TOKEN, "")
          .trim();
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
      // Persist the completed assistant turn (+ thread id) for refresh recovery.
      history.push({ role: "assistant", content: assistant.textContent });
      saveState();
    }
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
    rows: unknown
  ): void {
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

  /** Render a navigation suggestion as a button → host onWidgetAction("navigate"). */
  function renderNavigate(spec: NavigateSpec): void {
    const wrap = el("div", `${PREFIX}-nav`);
    const btn = el("button", `${PREFIX}-nav-btn`) as HTMLButtonElement;
    btn.type = "button";
    const label = spec.label || "Open page";
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
@keyframes ${PREFIX}-pulse{0%{box-shadow:0 0 0 0 rgba(96,199,200,.5)}70%{box-shadow:0 0 0 12px rgba(96,199,200,0)}100%{box-shadow:0 0 0 0 rgba(96,199,200,0)}}
@keyframes ${PREFIX}-float{0%,100%{transform:translateY(0)}50%{transform:translateY(-1.5px)}}
@keyframes ${PREFIX}-blink2{0%,90%,100%{transform:scaleY(1)}95%{transform:scaleY(.12)}}
.${PREFIX}-ayca{width:100%;height:100%;animation:${PREFIX}-float 4s ease-in-out infinite}
.${PREFIX}-eyes{transform-origin:24px 23px;animation:${PREFIX}-blink2 5.5s ease-in-out infinite}
.${PREFIX}-avatar .${PREFIX}-ayca{width:30px;height:30px}
.${PREFIX}-bubble{position:fixed;bottom:20px;${side}:20px;z-index:2147483000;width:60px;height:60px;border-radius:50%;border:none;background:${gradient};color:#fff;cursor:pointer;box-shadow:0 10px 28px rgba(0,0,0,.28);display:flex;align-items:center;justify-content:center;padding:3px;animation:${PREFIX}-pulse 3.2s infinite;transition:transform .18s ease}
.${PREFIX}-bubble:hover{transform:translateY(-2px) scale(1.04)}
.${PREFIX}-bubble-av{position:relative;width:100%;height:100%;border-radius:50%;background:#151D2F;display:flex;align-items:center;justify-content:center;overflow:hidden}
.${PREFIX}-bubble-av::before{content:"";position:absolute;inset:-3px;border-radius:50%;background:conic-gradient(from 0deg,${accent},#FBAA34,#FA712D,${accent});animation:${PREFIX}-spin 5s linear infinite;z-index:0}
.${PREFIX}-bubble-av>*{position:relative;z-index:1}
.${PREFIX}-av-img{width:100%;height:100%;object-fit:cover;border-radius:50%}
.${PREFIX}-bubble svg{width:26px;height:26px}
.${PREFIX}-panel{position:fixed;bottom:20px;${side}:20px;z-index:2147483000;width:368px;max-width:calc(100vw - 32px);height:540px;max-height:calc(100vh - 40px);background:#fff;color:#111;border-radius:18px;box-shadow:0 18px 52px rgba(0,0,0,.32);display:flex;flex-direction:column;overflow:hidden;font-family:system-ui,-apple-system,sans-serif;animation:${PREFIX}-rise .22s ease}
.${PREFIX}-header{background:${gradient};color:#fff;padding:12px 14px;display:flex;align-items:center;justify-content:space-between;gap:8px}
.${PREFIX}-hleft{display:flex;align-items:center;gap:10px;min-width:0}
.${PREFIX}-avatar{position:relative;width:36px;height:36px;border-radius:50%;background:#151D2F;flex:0 0 auto;display:flex;align-items:center;justify-content:center;box-shadow:0 0 0 2px rgba(255,255,255,.35)}
.${PREFIX}-avatar::after{content:"";position:absolute;bottom:0;right:0;width:9px;height:9px;border-radius:50%;background:#34D399;box-shadow:0 0 0 2px #fff}
.${PREFIX}-avatar svg{width:20px;height:20px}
.${PREFIX}-hname{display:flex;flex-direction:column;line-height:1.15;min-width:0}
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
.${PREFIX}-form{display:flex;gap:8px;padding:10px;border-top:1px solid #eee;background:#fff}
.${PREFIX}-input{flex:1;border:1px solid #ddd;border-radius:11px;padding:10px 12px;font-size:14px;outline:none}
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
.${PREFIX}-expanded{width:min(760px,calc(100vw - 32px));height:calc(100vh - 40px)}
.${PREFIX}-expanded .${PREFIX}-msg{max-width:75%}
.${PREFIX}-history{position:absolute;inset:0;background:#fff;display:flex;flex-direction:column;z-index:5;animation:${PREFIX}-rise .18s ease}
.${PREFIX}-history-head{display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-bottom:1px solid #eee;font-weight:600;font-size:14px}
.${PREFIX}-history-back{border:1px solid #ddd;background:#fff;border-radius:9px;padding:5px 11px;font-size:12px;font-weight:600;cursor:pointer;color:#333}
.${PREFIX}-history-list{flex:1 1 auto;min-height:0;overflow-y:auto;padding:8px;display:flex;flex-direction:column;gap:4px;font-size:13px;color:#555}
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
@media (prefers-color-scheme:dark){.${PREFIX}-panel{background:#161616;color:#eee}.${PREFIX}-log{background:#101010}.${PREFIX}-assistant{background:#1d1d1d;color:#eee;border-color:#2a2a2a}.${PREFIX}-form{background:#161616;border-top-color:#262626}.${PREFIX}-input{background:#101010;color:#eee;border-color:#333}.${PREFIX}-error{background:#231613;border-color:#5a2c1d}.${PREFIX}-history{background:#161616}.${PREFIX}-history-head{border-bottom-color:#262626}.${PREFIX}-history-back{background:#1d1d1d;border-color:#333;color:#ddd}.${PREFIX}-history-item{background:#1d1d1d;border-color:#2a2a2a}.${PREFIX}-history-title{color:#eee}.${PREFIX}-widget{background:#1d1d1d;border-color:#2a2a2a}.${PREFIX}-widget-stat,.${PREFIX}-kpi-v,.${PREFIX}-widget-table td{color:#eee}.${PREFIX}-kpi{background:#161616;border-color:#2a2a2a}}
@media (prefers-reduced-motion:reduce){.${PREFIX}-bubble,.${PREFIX}-bubble-av::before,.${PREFIX}-panel,.${PREFIX}-msg,.${PREFIX}-typing span,.${PREFIX}-ayca,.${PREFIX}-eyes,.${PREFIX}-streaming::after{animation:none}.${PREFIX}-log{scroll-behavior:auto}}
`;
  const style = document.createElement("style");
  style.setAttribute("data-sgiant-aiw", "");
  style.textContent = css;
  document.head.appendChild(style);
}
