/**
 * DOM construction and the small formatters around it.
 *
 * These nine helpers sat at the bottom of index.ts, below the 6,143-line
 * `createAiChatWidget` closure and outside it — module-level all along, and
 * used from inside it 240+ times (`el` alone has 215 call sites). Being outside
 * the closure is what makes them the one seam in #320 that separates without a
 * design decision: they capture nothing, so moving them is a move and not a
 * refactor.
 *
 * Nothing here may reach back into the widget. If one of these ever needs
 * widget state, it belongs in the closure or behind an explicit parameter — a
 * helper that quietly grows a dependency on its caller is how the file got to
 * 7,000 lines in the first place.
 */
import { PREFIX } from "./prefix";

/** One decoded SSE frame. Lives here because `parseLine` produces it and
 *  nothing upstream of the parser has an opinion about its shape. */
export interface StreamFrame {
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
  /** tool_proposal frame — the AiArtifact the runner persisted for a
   *  dashboard/template write, which is the ONLY handle its REST apply takes.
   *  The runner has always emitted this; nothing here read it, so
   *  `apply_dashboard` and `save_template` rendered a confirm card whose Apply
   *  could only reach `throw new Error("Unsupported action")`. */
  artifactId?: string;
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
  /** done frame — the persisted id of the turn's final assistant message, and
   *  the model that wrote it. Absent when the turn persisted nothing. */
  messageId?: string;
  model?: string;
}

/** Parse one stream line — tolerates `data: ` SSE prefix and bare NDJSON. */
export function parseLine(line: string): StreamFrame | null {
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

/** Chip glyph per attachment kind — a clip showing the document icon would read
 *  as "we did not understand your file". */
export function attIcon(kind: string): string {
  if (kind === "image") return "🖼";
  if (kind === "video") return "🎬";
  if (kind === "audio") return "🎵";
  return "📄";
}

export function el(tag: string, cls: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = cls;
  // Every button gets the focus base HERE rather than at its 40 call sites
  // (#308). Enumerating the call sites is the wrong shape — the list falls
  // behind the code the first time someone adds a control, which is exactly how
  // the widget ended up with forty buttons and no designed focus state. A
  // button created after this change is covered without anyone remembering.
  if (tag === "button") node.classList.add(`${PREFIX}-btn`);
  return node;
}

/** Coarse "when" bucket for grouping past conversations (Today / Yesterday / …). */
/** Relative-time group for a timestamp — returns a WIDGET_LABELS key so the
 *  caller resolves the localized separator text via L(). */
export function relBucket(
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
export function relTime(iso: string): string {
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
export function maskMarkdown(s: string): string {
  return s
    .replace(/`+/g, "") // code ticks
    .replace(/[*~]/g, "") // bold / italic / strike markers
    .replace(/^#{1,6}\s*/gm, "") // heading hashes
    .replace(/^\s{0,3}>\s?/gm, "") // blockquote
    .replace(/\|/g, " "); // table pipes
}

/** Escape text for the few places we build innerHTML (nav button label). */
export function escapeHtml(s: string): string {
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
 *  sanely; a full document is used as-is. */
export function wrapPreviewHtml(html: string): string {
  const s = (html ?? "").trim();
  if (/<!doctype|<html[\s>]/i.test(s)) return s;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>*{box-sizing:border-box}body{margin:0;padding:16px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#0f172a}</style></head><body>${s}</body></html>`;
}

export function addMsg(
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
      chip.textContent = `${attIcon(a.kind)} ${a.filename}`;
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
