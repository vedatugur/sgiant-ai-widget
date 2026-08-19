/**
 * THE single tool-name → API-endpoint mapping for applying a confirm-gated AI
 * write proposal ("Apply" on a proposal card). The AI only PROPOSED the write;
 * the user clicked Apply; the actual mutation is the host's Clerk-authed call
 * made here.
 *
 * This used to be copy-pasted three times (org widget, admin widget, org
 * full-page panel client) and the copies drifted — the panel's enqueue-and-
 * return applies dropped the job id (no live job card) and it hand-rolled its
 * own stale query invalidation list. Every host now calls THIS function and
 * then runs the
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
} from "@sgiant/assets";

export interface ApplyProposalCtx {
  /** The host's Clerk-authed JSON fetcher (already based at the right API origin). */
  api: <T>(path: string, init?: RequestInit) => Promise<T>;
  /** The account this write is FOR — the proposal's own target when the worker
   *  named one, else the host page's ambient account. Empty string means NONE
   *  (a staff platform page): every account-scoped apply is refused honestly
   *  instead of firing at `/accounts//…`. */
  accountId: string;
  /**
   * The `AiArtifact` the runner persisted for a dashboard/template write.
   *
   * `apply_dashboard` and `save_template` cannot be rebuilt from `args`: their
   * apply is a REST call that takes the artifact's ID, because the artifact is
   * what the server validates and marks `applied`. The runner has always
   * emitted it on the `tool_proposal` frame and nothing on the client read it,
   * so both tools rendered a confirm card whose Apply fell through to
   * `throw new Error("Unsupported action")` — the model offered a dashboard,
   * the user pressed Apply, and got an error. `applyArtifact` was implemented
   * on the chat client for exactly this and had no caller at all.
   */
  artifactId?: string;
  /** The host's translator (react-i18next `t` wrapped to a plain signature). */
  t: (key: string, defOrOpts?: unknown) => string;
  /** Staff-plane only: allow the generic `mcp__sgiant__api_request` write (the
   *  admin's own session replays the exact method+path+body the agent proposed
   *  — and it needs no account, so it bypasses the no-target-account guard). */
  allowRawApiRequest?: boolean;
}

/**
 * Apply one confirm-gated proposal. Returns the user-visible success message,
 * or `{ message, jobId }` for an enqueue-and-return tool (generate_report) so
 * the chat can show a LIVE job card and resolve its process chip on real
 * completion.
 */
export async function applyProposal(
  ctx: ApplyProposalCtx,
  name: string,
  args: Record<string, unknown>
): Promise<string | { message?: string; jobId?: string }> {
  const { api, accountId, artifactId, t } = ctx;
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
  // NOTE: a `generate_audio` branch lived here until 2026-08-14 (D1). The tool,
  // the `/assets/generate-audio` route and the `higgsfield-audio` provider entry
  // were all removed together — its only provider refuses audio by design, so
  // every Apply created a billable job row for a render that could not run. The
  // branch was left unreachable rather than deleted, which is worse than either
  // state: it POSTed to a route that now 404s, so anything that DID reach it
  // would report a network failure instead of "that tool no longer exists".
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
  if (name === "generate_report") {
    // ENQUEUE AND RETURN: minutes of work (plan → queries → author →
    // document), watched on the report page itself.
    //
    // There is ONE outcome message now. It used to branch on `format` so a
    // deck ask was not confirmed with "the PDF will land…", which read as the
    // wrong job starting — but a report no longer produces a file at all, in
    // either format. It produces a page.
    const started = await api<{
      report?: { id?: string | null };
    }>(`/accounts/${accountId}/reports/generate`, {
      method: "POST",
      body: JSON.stringify(args),
    });
    return {
      // RENAMED, not reworded: a key whose MEANING changed keeps its old
      // translation, and `check:i18n` only compares key SETS — so the Turkish
      // sentence promising a PDF in Assets would have survived silently under
      // the old key.
      message: t("aiAssistant.apply.reportStartedLive", {
        defaultValue: "Writing the report — watch it build ✓",
      }),
      // The report's own id — the ONLY id a report has now. The generic job
      // id used to ride alongside it for the card's poller; the card tracks
      // reports directly, and the enqueue no longer creates a job row at all.
      ...(started?.report?.id ? { reportId: started.report.id } : {}),
    };
  }
  // Asset-library housekeeping tools — each maps straight onto its own
  // library endpoint.
  if (name === "organize_assets")
    return applyAssetOrganize(api, accountId, args, t);
  if (name === "manage_folders")
    return applyFolderManage(api, accountId, args, t);
  if (name === "share_asset") return applyAssetShare(api, accountId, args, t);
  if (name === "save_artifact_to_assets")
    return applyAssetSave(api, accountId, args, t);
  if (name === "edit_asset") return applyAssetEdit(api, accountId, args, t);
  if (name === "create_asset") return applyAssetCreate(api, accountId, args, t);
  // THE DASHBOARD / TEMPLATE WRITES. Both apply through the artifact the runner
  // saved, not through `args` — the server looks the artifact up by id, checks
  // it is not already applied, builds the dashboard from its payload and marks
  // it `applied`, which is also what makes a double-click idempotent.
  if (name === "apply_dashboard" || name === "save_template") {
    if (!artifactId)
      throw new Error(
        t(
          "aiAssistant.apply.noArtifact",
          "This proposal has no saved artifact to apply — ask the assistant to build it again."
        )
      );
    const res = await api<{ ok?: boolean; dashboardId?: string }>(
      `/accounts/${accountId}/ai/artifacts/${artifactId}/apply`,
      { method: "POST" }
    );
    return name === "save_template"
      ? t("aiAssistant.apply.templateSaved", "Template saved ✓")
      : t("aiAssistant.apply.dashboardApplied", {
          defaultValue: "Dashboard created ✓",
          dashboardId: res?.dashboardId ?? "",
        });
  }
  throw new Error(`Unsupported action: ${name}`);
}
