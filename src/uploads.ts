import { attIcon, el } from "./dom";
import { PREFIX } from "./prefix";
import { ICON_ATTACH } from "./icons";
import {
  CHAT_ATTACHMENT_MAX_AV_BYTES,
  CHAT_ATTACHMENT_MAX_BYTES,
  CHAT_ATTACHMENT_MAX_COUNT,
} from "./limits";
import { WIDGET_TARGETS } from "./widget-manifest.js";
import type { AiChatWidgetOptions } from "./widget";
import type { WidgetLabels } from "./labels";

/**
 * Attachments (authed surfaces only): a paperclip that opens a file picker,
 * uploads session-scoped (never into the asset library), and stages refs for
 * the next turn. A screenshot pasted into the composer takes the same path.
 *
 * Moved out of `createAiChatWidget` (audit F133) unchanged: the closure owned
 * the staged list, the bar and the two controls, and `send` reached in for the
 * list. Now `send` asks: `takeStaged()` hands the list over and empties it,
 * `hasStaged()` answers the empty-submit guard. The thread id is read through
 * a getter for the reason every factory here gives — it changes after setup.
 */

/** One staged attachment, as a turn sends it. */
export type WidgetAtt = {
  mediaId: string;
  kind: string;
  filename: string;
  contentType: string;
};

export interface UploadsContext {
  L: (
    key: keyof WidgetLabels,
    params?: Record<string, string | number>,
  ) => string;
  /** The composer, for paste-to-attach. */
  input: HTMLTextAreaElement;
  getThreadId: () => string | undefined;
  opts: Pick<
    AiChatWidgetOptions,
    | "uploadEndpoint"
    | "getUploadEndpoint"
    | "getToken"
    | "token"
    | "withCredentials"
  >;
}

export interface Uploads {
  /** The row of staged chips, placed above the composer. */
  attBar: HTMLElement;
  /** The paperclip and its hidden picker; null when the host gave no upload
   *  endpoint, and then there is nothing to attach with. */
  attachBtn: HTMLButtonElement | null;
  fileInput: HTMLInputElement | null;
  /** Hands the staged attachments to a turn and empties the bar's list. */
  takeStaged: () => WidgetAtt[];
  hasStaged: () => boolean;
  renderStaged: () => void;
}

export function createUploads(ctx: UploadsContext): Uploads {
  const { L, input, opts } = ctx;
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
        const threadId = ctx.getThreadId();
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
    attachBtn.setAttribute("data-ai-target", WIDGET_TARGETS.attach);
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
  }
  return {
    attBar,
    attachBtn,
    fileInput,
    takeStaged: () => stagedAtts.splice(0),
    hasStaged: () => stagedAtts.length > 0,
    renderStaged,
  };
}
