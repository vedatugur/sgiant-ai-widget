import { el, escapeHtml } from "./dom";
import { PREFIX } from "./prefix";
import { genericProposalSummary } from "./proposal-summary";
import {
  type ProposalField,
  buildField,
  isPrimitiveArg,
  isTruthyValue,
} from "./specs";
import type { WidgetLabels } from "./labels";
import type { AiChatWidgetOptions } from "./index";

/**
 * THE TWO CARDS THAT ASK THE HUMAN TO DECIDE (#320).
 *
 * A `question` frame is the assistant asking someone to choose; a `proposal` is
 * it asking permission for an action it has already worked out. They are the
 * same shape of interaction — render, wait, collapse to what was decided — and
 * they were 414 lines in the middle of a 6348-line function.
 *
 * WHAT THIS MODULE IS NOT ALLOWED TO DO. It builds DOM and calls back. It owns
 * no state, reads no globals, and every value it needs arrives through
 * `DecisionCardContext` — which is why the extraction is reviewable at all: the
 * dependency list below IS the seam, and it is thirteen entries rather than a
 * whole closure.
 */
export interface DecisionCardContext {
  /** Label lookup, host-overridable. */
  L: (
    key: keyof WidgetLabels,
    params?: Record<string, string | number>
  ) => string;
  /** The transcript these cards append to. */
  log: HTMLElement;
  panel: HTMLElement;
  side: "left" | "right";
  scrollDown: (force?: boolean) => void;
  send: (
    content: string,
    fork?: { parentId?: string | null; regenerate?: boolean }
  ) => Promise<void>;
  toggle: () => void;
  stripTick: (s: string) => string;
  trackConfirmedJob: (ref: { kind: "job" | "report"; id: string }) => void;

  /**
   * THE THREE READ THROUGH A FUNCTION, AND THAT IS NOT STYLE.
   *
   * `threadId`, `autoApply` and `busy` are `let` in the widget and are
   * reassigned while a card is on screen — a thread switch, the auto-apply
   * toggle, a turn starting. Passed by VALUE they would freeze at the moment
   * the card was built, and a proposal applied ten seconds later would carry
   * the thread the user was reading when it appeared rather than the one they
   * are in now.
   */
  getThreadId: () => string | undefined;
  getAutoApply: () => boolean;
  isBusy: () => boolean;

  opts: Pick<
    AiChatWidgetOptions,
    | "autoApplyOption"
    | "onAnswer"
    | "onApplyProposal"
    | "proposalSummary"
    | "proposalTitles"
    | "reportHref"
  >;
}

export interface DecisionCards {
  renderQuestion: (q: {
    questionId: string;
    prompt: string;
    context?: string;
    options?: Array<{ id: string; label: string; description?: string }>;
    multi?: boolean;
    critical?: boolean;
  }) => void;
  renderProposal: (
    name: string,
    args: Record<string, unknown>,
    agent?: string,
    /** Inputs the ASSISTANT asked for on this card — see ProposalField. */
    fields?: ProposalField[],
    /** The account this write targets, per the worker. */
    proposalAccountId?: string,
    /** The persisted artifact a dashboard/template apply needs. */
    proposalArtifactId?: string
  ) => void;
}

export function createDecisionCards(ctx: DecisionCardContext): DecisionCards {
  // Host-supplied, with the generic renderer as the floor. `|| ` not `?? ` on
  // purpose: a host returning "" means "nothing worth saying", and an empty
  // card would be a confirm gate that confirms nothing.
  const PROPOSAL_LABELS: Record<string, string> = ctx.opts.proposalTitles ?? {};
  const proposalSummary = (
    name: string,
    args: Record<string, unknown>
  ): string =>
    ctx.opts.proposalSummary?.(name, args) || genericProposalSummary(args);
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
    undelivered.textContent = ctx.L("questionSendFailed");
    undelivered.style.display = "none";

    /**
     * Deliver the answer as an ordinary user message.
     *
     * The ask_user turn ENDED server-ctx.side the moment the question was emitted
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
      if (ctx.isBusy()) {
        undelivered.style.display = "";
        return;
      }
      ctx.opts.onAnswer?.({ questionId: q.questionId, optionIds, text });
      void ctx.send(answer);
      answered(answer);
    };

    if (q.options?.length) {
      const list = el("div", `${PREFIX}-question-opts`);
      const picked = new Set<string>();
      // Built before the options so toggling one can enable it. A multi-select
      // confirm with nothing picked has nothing to ctx.send: leaving it enabled made
      // the click a silent no-op (`deliver` bails on an empty answer), which
      // reads as a broken button. The React ctx.panel disables it; so does this.
      const confirm = q.multi
        ? (el("button", `${PREFIX}-question-ctx.send`) as HTMLButtonElement)
        : null;
      if (confirm) {
        confirm.type = "button";
        confirm.textContent = ctx.L("questionConfirm");
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
          // Multi-select: ctx.toggle, and confirm explicitly — otherwise the first
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
      input.placeholder = ctx.L("questionPlaceholder");
      const go = el("button", `${PREFIX}-question-ctx.send`) as HTMLButtonElement;
      go.type = "button";
      go.textContent = ctx.L("questionConfirm");
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
    ctx.log.appendChild(wrap);
    ctx.scrollDown(true);
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
     * and has to be able to point at the control it is refusing to ctx.send without.
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
      document.createTextNode(PROPOSAL_LABELS[name] ?? ctx.L("proposalGeneric"))
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
    editErr.textContent = ctx.L("requiredFields");
    editErr.style.display = "none";
    if (edits.length) wrap.appendChild(editErr);
    const row = el("div", `${PREFIX}-confirm-row`);
    const apply = el("button", `${PREFIX}-nav-btn`) as HTMLButtonElement;
    apply.type = "button";
    apply.textContent = ctx.L("apply");
    const cancel = el("button", `${PREFIX}-confirm-no`) as HTMLButtonElement;
    cancel.type = "button";
    cancel.textContent = ctx.L("dismiss");
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
        // and the string "false" is TRUTHY server-ctx.side (`withReadme !== false`
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
      apply.textContent = ctx.L("applying");
      try {
        // Carry the originating thread on EVERY apply — session-scoped asset
        // writes (scraped imports) use it to keep chat debris out of the
        // library until explicitly saved. Tools that don't care simply
        // ignore the extra key.
        const res = await ctx.opts.onApplyProposal!(
          name,
          (() => {
            const tid = ctx.getThreadId();
            return tid ? { ...edited, threadId: tid } : edited;
          })(),
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
          `<span>${escapeHtml(ctx.stripTick(msg || ctx.L("applied")))}</span>`;
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
        if (reportId) ctx.trackConfirmedJob({ kind: "report", id: reportId });
        else if (jobId) ctx.trackConfirmedJob({ kind: "job", id: jobId });
        const href = reportId ? ctx.opts.reportHref?.(reportId) : undefined;
        if (href) {
          const open = el("a", `${PREFIX}-proposal-link`) as HTMLAnchorElement;
          open.href = href;
          open.textContent = ctx.L("openReport");
          ok.appendChild(open);
        }
      } catch {
        apply.disabled = false;
        apply.textContent = ctx.L("tryAgain");
      }
    });
    row.append(apply, cancel);
    wrap.appendChild(row);
    ctx.log.appendChild(wrap);
    ctx.scrollDown(true);
    // AUTO-APPLY — three conditions, all required, and each one is a decision.
    //
    //  1. the user turned it on. Off by default, browser-local, theirs.
    //  2. the HOST says this particular write is safe to apply unasked. The
    //     widget cannot tell a draft from a publish — they arrive here as the
    //     same shape — so it never guesses; no predicate means nothing applies.
    //  3. the card asks the user for NOTHING. `fields` are inputs the assistant
    //     explicitly requested; applying past them would answer a question that
    //     was put to the person, using whatever the model guessed.
    //
    // The card is still rendered and still says what happened. Auto-apply
    // removes a click, not the record of the change.
    if (ctx.getAutoApply() && !fields.length && ctx.opts.autoApplyOption?.(name, args)) {
      apply.click();
    }
  }
  return { renderQuestion, renderProposal };
}
