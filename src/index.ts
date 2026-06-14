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
  const closeBtn = el("button", `${PREFIX}-close`);
  closeBtn.innerHTML = "&times;";
  closeBtn.setAttribute("aria-label", "Close chat");
  header.append(hLeft, closeBtn);

  const log = el("div", `${PREFIX}-log`);
  if (history.length) {
    // Restore a prior conversation (survives refresh).
    for (const m of history) addMsg(log, m.role, m.content);
  } else if (opts.greeting) {
    addMsg(log, "assistant", opts.greeting);
  }

  const form = el("form", `${PREFIX}-form`) as HTMLFormElement;
  const input = el("input", `${PREFIX}-input`) as HTMLInputElement;
  input.placeholder = "Ask anything…";
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
    log.scrollTop = log.scrollHeight;
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
              }
              assistant.textContent = (assistant.textContent ?? "") + piece;
              log.scrollTop = log.scrollHeight;
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

    // Clear the typing indicator and, if nothing streamed, show an error card
    // (Try again / Report issue) or a graceful "no response".
    typing.remove();
    if (!assistant || !assistant.textContent) {
      assistant?.remove();
      if (failure) showError(failure);
      else addMsg(log, "assistant", "(no response)");
    } else {
      // AI-rendered input forms. A generic [[form:{...}]] directive renders an
      // inline form submitting to a host action; [[collect-email]] is the
      // built-in lead shortcut.
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
            { name: "email", type: "email", placeholder: "you@company.com", required: true },
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
        i.type = field.type === "number" ? "number" : field.type ?? "text";
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
    log.scrollTop = log.scrollHeight;
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const data: Record<string, string> = {};
      for (const c of controls) data[c.name] = c.get();
      if (controls.some((c) => !data[c.name]) && spec.fields.some((x) => x.required))
        return;
      submit.disabled = true;
      submit.textContent = "Sending…";
      try {
        let msg: string | void;
        if (opts.onWidgetAction) {
          msg = await opts.onWidgetAction(spec.action, data);
        } else if (opts.onLead && spec.action === "lead") {
          await opts.onLead({ email: data.email ?? "", context: lastUserContent });
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
    log.scrollTop = log.scrollHeight;
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

function addMsg(
  log: HTMLElement,
  role: "user" | "assistant",
  text: string
): HTMLElement {
  const msg = el("div", `${PREFIX}-msg ${PREFIX}-${role}`);
  msg.textContent = text;
  log.appendChild(msg);
  log.scrollTop = log.scrollHeight;
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
.${PREFIX}-log{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:10px;background:#fafafa}
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
@media (prefers-color-scheme:dark){.${PREFIX}-panel{background:#161616;color:#eee}.${PREFIX}-log{background:#101010}.${PREFIX}-assistant{background:#1d1d1d;color:#eee;border-color:#2a2a2a}.${PREFIX}-form{background:#161616;border-top-color:#262626}.${PREFIX}-input{background:#101010;color:#eee;border-color:#333}.${PREFIX}-error{background:#231613;border-color:#5a2c1d}}
@media (prefers-reduced-motion:reduce){.${PREFIX}-bubble,.${PREFIX}-bubble-av::before,.${PREFIX}-panel,.${PREFIX}-msg,.${PREFIX}-typing span,.${PREFIX}-ayca,.${PREFIX}-eyes{animation:none}}
`;
  const style = document.createElement("style");
  style.setAttribute("data-sgiant-aiw", "");
  style.textContent = css;
  document.head.appendChild(style);
}
