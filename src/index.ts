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
  /** Bearer token (Clerk session or embed token). Use getToken for refresh. */
  token?: string;
  /** Async token provider — called before each send (overrides `token`). */
  getToken?: () => string | Promise<string>;
  /** Send cookies (same-origin in-app embedding). Default false. */
  withCredentials?: boolean;
  title?: string;
  greeting?: string;
  accent?: string;
  position?: "bottom-right" | "bottom-left";
  /** Mount target; defaults to document.body. */
  container?: HTMLElement;
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

export function createAiChatWidget(
  opts: AiChatWidgetOptions
): AiChatWidgetHandle {
  const accent = opts.accent ?? "#6d28d9";
  const side = opts.position === "bottom-left" ? "left" : "right";
  const root = opts.container ?? document.body;
  let threadId: string | undefined;
  let busy = false;

  injectStyles(accent, side);

  const bubble = el("button", `${PREFIX}-bubble`);
  bubble.setAttribute("aria-label", "Open chat");
  bubble.innerHTML = "&#9728;"; // ✦-ish
  const panel = el("div", `${PREFIX}-panel`);
  panel.style.display = "none";

  const header = el("div", `${PREFIX}-header`);
  header.textContent = opts.title ?? "Assistant";
  const closeBtn = el("button", `${PREFIX}-close`);
  closeBtn.innerHTML = "&times;";
  closeBtn.setAttribute("aria-label", "Close chat");
  header.appendChild(closeBtn);

  const log = el("div", `${PREFIX}-log`);
  if (opts.greeting) addMsg(log, "assistant", opts.greeting);

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

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const content = input.value.trim();
    if (!content || busy) return;
    input.value = "";
    void send(content);
  });

  async function send(content: string): Promise<void> {
    busy = true;
    sendBtn.disabled = true;
    addMsg(log, "user", content);
    const assistant = addMsg(log, "assistant", "");
    try {
      const token = opts.getToken ? await opts.getToken() : opts.token;
      const res = await fetch(opts.endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        credentials: opts.withCredentials ? "include" : "same-origin",
        body: JSON.stringify({
          ...(opts.extraBody ?? {}),
          accountId: opts.accountId ?? "",
          threadId,
          content,
        }),
      });
      if (!res.ok || !res.body) {
        assistant.textContent = `Error: ${res.status}`;
        return;
      }
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
            assistant.textContent = (assistant.textContent ?? "") + piece;
            log.scrollTop = log.scrollHeight;
          }
          if (frame.type === "error" && frame.message) {
            assistant.textContent += `\n[${frame.message}]`;
          }
        }
      }
      if (!assistant.textContent) assistant.textContent = "(no response)";
    } catch (err) {
      assistant.textContent = `Error: ${(err as Error).message}`;
    } finally {
      busy = false;
      sendBtn.disabled = false;
      input.focus();
    }
  }

  return {
    open,
    close,
    toggle,
    destroy() {
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
function injectStyles(accent: string, side: "left" | "right"): void {
  if (stylesInjected) return;
  stylesInjected = true;
  const css = `
.${PREFIX}-bubble{position:fixed;bottom:20px;${side}:20px;z-index:2147483000;width:56px;height:56px;border-radius:50%;border:none;background:${accent};color:#fff;font-size:22px;cursor:pointer;box-shadow:0 8px 24px rgba(0,0,0,.25);display:flex;align-items:center;justify-content:center}
.${PREFIX}-panel{position:fixed;bottom:20px;${side}:20px;z-index:2147483000;width:360px;max-width:calc(100vw - 32px);height:520px;max-height:calc(100vh - 40px);background:#fff;color:#111;border-radius:16px;box-shadow:0 16px 48px rgba(0,0,0,.3);display:flex;flex-direction:column;overflow:hidden;font-family:system-ui,sans-serif}
.${PREFIX}-header{background:${accent};color:#fff;padding:12px 16px;font-weight:600;display:flex;align-items:center;justify-content:space-between}
.${PREFIX}-close{background:none;border:none;color:#fff;font-size:22px;line-height:1;cursor:pointer}
.${PREFIX}-log{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:10px;background:#fafafa}
.${PREFIX}-msg{max-width:85%;padding:8px 12px;border-radius:12px;font-size:14px;line-height:1.45;white-space:pre-wrap;word-break:break-word}
.${PREFIX}-user{align-self:flex-end;background:${accent};color:#fff;border-bottom-right-radius:4px}
.${PREFIX}-assistant{align-self:flex-start;background:#ececec;color:#111;border-bottom-left-radius:4px}
.${PREFIX}-form{display:flex;gap:8px;padding:10px;border-top:1px solid #eee;background:#fff}
.${PREFIX}-input{flex:1;border:1px solid #ddd;border-radius:10px;padding:9px 12px;font-size:14px;outline:none}
.${PREFIX}-input:focus{border-color:${accent}}
.${PREFIX}-send{border:none;background:${accent};color:#fff;border-radius:10px;padding:0 16px;font-size:14px;font-weight:600;cursor:pointer}
.${PREFIX}-send:disabled{opacity:.5;cursor:default}
@media (prefers-color-scheme:dark){.${PREFIX}-panel{background:#161616;color:#eee}.${PREFIX}-log{background:#101010}.${PREFIX}-assistant{background:#262626;color:#eee}.${PREFIX}-form{background:#161616;border-top-color:#262626}.${PREFIX}-input{background:#101010;color:#eee;border-color:#333}}
`;
  const style = document.createElement("style");
  style.setAttribute("data-sgiant-aiw", "");
  style.textContent = css;
  document.head.appendChild(style);
}
