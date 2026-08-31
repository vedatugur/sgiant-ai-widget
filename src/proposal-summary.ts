import type { WidgetLabels } from "./labels";

/**
 * Human-readable summaries of the write-tool calls the assistant PROPOSES.
 *
 * The confirm gate exists so a person approves the real action rather than a
 * vague "apply", which means the sentence on the card is the security boundary,
 * not decoration. It is pure text: nothing here touches the DOM, the transport
 * or the widget's state, and it was inside a 6,882-line closure only because
 * that is where it was written (#320).
 *
 * Out here it is testable the way a formatter should be — call it with a tool
 * name and an args object and assert on the string. Inside the closure it could
 * only be reached by constructing a widget.
 *
 * The one thing it needs is the label lookup, so the labels stay host-
 * translatable. A factory takes it once rather than threading it through every
 * signature, which is also what lets the bodies move here byte for byte.
 */
export function createProposalSummary(
  L: (
    key: keyof WidgetLabels,
    params?: Record<string, string | number>
  ) => string
) {
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

  // PROPOSAL_LABELS is returned as well as used: the card title in index.ts
  // reads it directly. Exposing the map rather than wrapping it in a
  // `proposalTitle()` keeps that call site byte-identical, which is what makes
  // this commit a move and not a refactor. Wrapping it is worth doing later.
  return { proposalSummary, PROPOSAL_LABELS };
}
