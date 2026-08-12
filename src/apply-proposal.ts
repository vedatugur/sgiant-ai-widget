/**
 * THE single tool-name → API-endpoint mapping for applying a confirm-gated AI
 * write proposal ("Apply" on a proposal card). The AI only PROPOSED the write;
 * the user clicked Apply; the actual mutation is the host's Clerk-authed call
 * made here.
 *
 * This used to be copy-pasted three times (org widget, admin widget, org
 * full-page panel client) and the copies drifted — the panel's ingest_site
 * dropped the job id (no live job card) and it hand-rolled its own stale query
 * invalidation list. Every host now calls THIS function and then runs the
 * shared `applyAiChange(qc, accountId, name)` itself (invalidation is the
 * host's react-query concern, not this module's).
 *
 * Host-specific success copy is preserved via i18n: this module passes the
 * i18n KEY (plus a generic English default), and each app's locale files carry
 * that host's exact wording (e.g. admin's reportStarted says "the account's
 * assets", org's says "your assets").
 */
import {
  applyAssetOrganize,
  applyFolderManage,
  applyAssetEdit,
  applyAssetCreate,
  applyAssetSave,
  applyAssetShare,
  applyBrandProfile,
  applyEditBrand,
} from "@sgiant/assets";

/** Paid Higgsfield ops on an existing asset. The tool name IS the `op` the
 *  media-op endpoint dispatches on, so this list is the only thing to touch
 *  when a new one is added. */
export const MEDIA_OP_TOOLS: readonly string[] = [
  "upscale_image",
  "remove_background",
  "outpaint_image",
  "reframe_video",
  "upscale_video",
  "animate_image",
  "restyle_video",
  // The audio lane. Both operate ON a clip and return a clip, so they are
  // ordinary media ops on this path — nothing about the apply changes.
  "dub_video",
  "voice_change",
];

export interface ApplyProposalCtx {
  /** The host's Clerk-authed JSON fetcher (already based at the right API origin). */
  api: <T>(path: string, init?: RequestInit) => Promise<T>;
  /** The account this write is FOR — the proposal's own target when the worker
   *  named one, else the host page's ambient account. Empty string means NONE
   *  (a staff platform page): every account-scoped apply is refused honestly
   *  instead of firing at `/accounts//…`. */
  accountId: string;
  /** The host's translator (react-i18next `t` wrapped to a plain signature). */
  t: (key: string, defOrOpts?: unknown) => string;
  /** Staff-plane only: allow the generic `mcp__sgiant__api_request` write (the
   *  admin's own session replays the exact method+path+body the agent proposed
   *  — and it needs no account, so it bypasses the no-target-account guard). */
  allowRawApiRequest?: boolean;
}

/**
 * Apply one confirm-gated proposal. Returns the user-visible success message,
 * or `{ message, jobId }` for enqueue-and-return tools (ingest_site,
 * generate_report, generate_video) so the chat can show a LIVE job card and
 * resolve its process chip on real completion.
 */
export async function applyProposal(
  ctx: ApplyProposalCtx,
  name: string,
  args: Record<string, unknown>
): Promise<string | { message?: string; jobId?: string }> {
  const { api, accountId, t } = ctx;
  // On the staff plane a platform page has NO ambient account. Every
  // account-scoped apply below needs one — refuse honestly instead of firing
  // at /accounts//… (the api_request card carries its own path and is exempt).
  if (!accountId && name !== "mcp__sgiant__api_request") {
    throw new Error(
      t(
        "aiAssistant.apply.noTargetAccount",
        "No target account — ask the assistant to target an account (or open the account page) and try again."
      )
    );
  }
  // The staff assistant's generic platform write (#72/#32): the agent PROPOSED
  // a method + path + body via api_request; the gateway never executed it.
  // Applying = making that call now with the admin's OWN Clerk session (so it
  // carries exactly their authority, and the deny list was already enforced
  // before the card was ever shown). Staff hosts opt in via allowRawApiRequest.
  if (name === "mcp__sgiant__api_request") {
    if (!ctx.allowRawApiRequest) throw new Error(`Unsupported action: ${name}`);
    const method = String(args.method ?? "POST").toUpperCase();
    const path = String(args.path ?? "");
    if (!path.startsWith("/")) throw new Error("invalid write path");
    await api(path, {
      method,
      ...(args.body !== undefined ? { body: JSON.stringify(args.body) } : {}),
    });
    return t("aiAssistant.apply.writeApplied", "Applied ✓");
  }
  if (name === "update_creation") {
    const id = String(args.id ?? "");
    if (!id) throw new Error("missing creation id");
    await api(`/accounts/${accountId}/studio/creations/${id}`, {
      method: "PUT",
      body: JSON.stringify({
        ...(typeof args.title === "string" ? { title: args.title } : {}),
        ...(typeof args.status === "string" ? { status: args.status } : {}),
      }),
    });
    return t("aiAssistant.apply.creationUpdated", "Creation updated ✓");
  }
  if (name === "render_creation") {
    // Close the authoring loop: the AI assembled a complete media manifest; the
    // server validates it (format, sanitiser, every mediaId must resolve) and
    // saves it as a creation. When the AI passes an `id`, the same endpoint
    // UPDATES that existing creation in place (refine, not dupe).
    const targetId = typeof args.id === "string" ? args.id : undefined;
    await api(`/accounts/${accountId}/studio/creations/import`, {
      method: "POST",
      body: JSON.stringify({
        creation: {
          ...(targetId ? { id: targetId } : {}),
          name: typeof args.name === "string" ? args.name : undefined,
          format: args.format,
          payload: args.payload,
        },
        // The conversation that authored it. Without this the creation lands
        // with no thread, and a later turn cannot find its storyboard.
        ...(typeof args.threadId === "string"
          ? { threadId: args.threadId }
          : {}),
      }),
    });
    return targetId
      ? t("aiAssistant.apply.creationUpdated", "Creation updated ✓")
      : t("aiAssistant.apply.creationAdded", "Creation added to your studio ✓");
  }
  if (name === "save_storyboard") {
    // The scene PLAN. The server matches on each scene's key, so applying a
    // revised plan edits the scenes that changed and leaves rendered clips
    // attached to the ones that did not.
    const creationId =
      typeof args.creationId === "string" ? args.creationId : "";
    if (!creationId) throw new Error("missing creation id");
    await api(`/accounts/${accountId}/studio/creations/${creationId}/scenes`, {
      method: "PUT",
      // The thread rides along so the server can claim this creation for the
      // conversation — the next turn finds a storyboard BY thread.
      body: JSON.stringify({
        scenes: args.scenes,
        ...(typeof args.threadId === "string"
          ? { threadId: args.threadId }
          : {}),
      }),
    });
    return t("aiAssistant.apply.storyboardSaved", "Scene plan saved ✓");
  }
  if (name === "update_scene") {
    const creationId =
      typeof args.creationId === "string" ? args.creationId : "";
    const key = typeof args.sceneKey === "string" ? args.sceneKey : "";
    if (!creationId || !key) throw new Error("missing scene");
    await api(
      `/accounts/${accountId}/studio/creations/${creationId}/scenes/${encodeURIComponent(
        key
      )}`,
      { method: "PATCH", body: JSON.stringify({ state: args.state }) }
    );
    return args.state === "rejected"
      ? t("aiAssistant.apply.sceneRejected", "Scene dropped ✓")
      : t("aiAssistant.apply.sceneApproved", "Scene approved ✓");
  }
  if (name === "add_scraped_media") {
    // threadId + auto-save intent ride at the body root, the rest of the args
    // are the item itself.
    const { threadId, saveToLibrary, ...item } = args;
    await api(`/accounts/${accountId}/assets/scraped-media/import`, {
      method: "POST",
      body: JSON.stringify({ item, threadId, saveToLibrary }),
    });
    // Honest copy: a session-scoped import is NOT in the library yet.
    return threadId && !saveToLibrary
      ? t(
          "aiAssistant.apply.sessionArtifact",
          "In this chat's files — hit Save to keep it in your library ✓"
        )
      : t("aiAssistant.apply.addedToAssets", "Added to your asset library ✓");
  }
  if (name === "run_browser_flow") {
    // Running the flow IS the apply — the AI only proposed the plan, and the
    // human just approved every step of it on the card.
    const res = await api<{
      ok: boolean;
      data: Record<string, unknown>;
      error?: string;
      steps: { index: number; kind: string; ok: boolean }[];
    }>(`/accounts/${accountId}/browser-flow`, {
      method: "POST",
      body: JSON.stringify(args),
    });
    const done = res.steps.filter((s) => s.ok).length;
    const keys = Object.keys(res.data ?? {});
    if (!res.ok)
      return t("aiAssistant.apply.browserFlowPartial", {
        done,
        total: res.steps.length,
        defaultValue: `Browser flow stopped after ${done}/${res.steps.length} steps — I can see what failed ✓`,
      });
    return t("aiAssistant.apply.browserFlowDone", {
      count: keys.length,
      defaultValue: `Browser flow finished — extracted ${keys.length} result${keys.length === 1 ? "" : "s"} ✓`,
    });
  }
  if (name === "set_account_settings") {
    // MERGE-PATCH: send only what the model proposed (and whatever the user
    // corrected on the card), so applying "set the website" can never blank a
    // setting the model never mentioned.
    await api(`/accounts/${accountId}/settings`, {
      method: "PUT",
      body: JSON.stringify(args),
    });
    return t("aiAssistant.apply.settingsSaved", "Account settings updated ✓");
  }
  if (name === "ingest_website") {
    const res = await api<{ importedCount?: number } | undefined>(
      `/accounts/${accountId}/assets/ingest-website`,
      { method: "POST", body: JSON.stringify(args) }
    );
    const n = res?.importedCount ?? 0;
    return t("aiAssistant.apply.websiteSaved", {
      count: n,
      defaultValue: `Saved ${n} file${n === 1 ? "" : "s"} + notes into your assets ✓`,
    });
  }
  if (name === "ingest_site") {
    // Enqueues and returns; the crawl runs for minutes. The card must NOT
    // claim the import is finished — the job id below buys a LIVE card in the
    // chat, and the notification still reports the result. The enqueue hands
    // back the GENERIC job id, which is what the live card polls.
    const started = await api<{ job?: { jobId?: string | null } }>(
      `/accounts/${accountId}/assets/ingest-site`,
      { method: "POST", body: JSON.stringify(args) }
    );
    return {
      message: t("aiAssistant.apply.siteImportStarted", {
        defaultValue:
          "Importing the site — I'll notify you when the folder is ready ✓",
      }),
      ...(started?.job?.jobId ? { jobId: started.job.jobId } : {}),
    };
  }
  if (name === "generate_report") {
    // Same enqueue-and-return shape as ingest_site: minutes of work (plan →
    // queries → author → document), a live job card via the generic job id,
    // and the notification reports the finished document. The message names
    // the ACTUAL output format — a PPTX ask confirmed with "the PDF will
    // land…" read as the wrong job being started.
    const started = await api<{ job?: { jobId?: string | null } }>(
      `/accounts/${accountId}/reports/generate`,
      { method: "POST", body: JSON.stringify(args) }
    );
    const isPptx =
      String((args as { format?: unknown }).format ?? "").toLowerCase() ===
      "pptx";
    return {
      message: isPptx
        ? t("aiAssistant.apply.reportStartedPptx", {
            defaultValue:
              "Building the presentation — the PPTX will land in your assets ✓",
          })
        : t("aiAssistant.apply.reportStarted", {
            defaultValue:
              "Generating the report — the PDF will land in your assets ✓",
          }),
      ...(started?.job?.jobId ? { jobId: started.job.jobId } : {}),
    };
  }
  // Paid vendor ops on an existing asset (upscale / cut-out / expand /
  // reframe). One endpoint for all of them — the tool name is the op — so a
  // new op needs no change here.
  if (MEDIA_OP_TOOLS.includes(name)) {
    const res = await api<{
      job?: { id?: string };
      message?: string;
    }>(`/accounts/${accountId}/assets/media-op`, {
      method: "POST",
      body: JSON.stringify({ ...args, op: name }),
    });
    // A LONG op (restyle, animate, video upscale) answers 202 with a job: it is
    // running, not finished. Saying "Done ✓" there would be a plain untruth —
    // and it is the difference between a live card the user can watch and a
    // silence they have to guess about. Short ops still answer with the asset.
    if (res?.job?.id)
      return {
        message:
          res.message ??
          t("aiAssistant.apply.mediaOpQueued", {
            defaultValue:
              "Running now — it lands in your library when it's done",
          }),
        jobId: res.job.id,
      };
    return args.threadId && !args.saveToLibrary
      ? t(
          "aiAssistant.apply.mediaOpSessionArtifact",
          "Done — in this chat's files (Save to keep it) ✓"
        )
      : t("aiAssistant.apply.mediaOpDone", "Done — added to your assets ✓");
  }
  if (name === "generate_image") {
    await api(`/accounts/${accountId}/assets/generate-image`, {
      method: "POST",
      body: JSON.stringify(args),
    });
    // Honest copy: a session-scoped generation is NOT in the library.
    return args.threadId && !args.saveToLibrary
      ? t(
          "aiAssistant.apply.imageSessionArtifact",
          "Image generated — in this chat's files (Save to keep it) ✓"
        )
      : t(
          "aiAssistant.apply.imageGenerated",
          "Image generated and added to your assets ✓"
        );
  }
  if (name === "generate_video") {
    // Async: enqueues a render job. Return the job id so the chat can poll it
    // and resolve the "Rendering video…" chip on real completion.
    const res = await api<{ job?: { id?: string } } | undefined>(
      `/accounts/${accountId}/assets/generate-video`,
      { method: "POST", body: JSON.stringify(args) }
    );
    return {
      message: t(
        "aiAssistant.apply.videoRendering",
        "Your video is rendering — it'll appear in your assets shortly ✓"
      ),
      jobId: res?.job?.id,
    };
  }
  if (name === "organize_assets")
    return applyAssetOrganize(api, accountId, args);
  if (name === "manage_folders") return applyFolderManage(api, accountId, args);
  if (name === "share_asset") return applyAssetShare(api, accountId, args);
  if (name === "save_artifact_to_assets")
    return applyAssetSave(api, accountId, args);
  if (name === "edit_asset") return applyAssetEdit(api, accountId, args);
  if (name === "create_asset") return applyAssetCreate(api, accountId, args);
  if (name === "update_brand_profile")
    return applyBrandProfile(api, accountId, args);
  if (name === "edit_brand") return applyEditBrand(api, accountId, args);
  throw new Error(`Unsupported action: ${name}`);
}
