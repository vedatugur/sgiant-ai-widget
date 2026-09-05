import { el, escapeHtml } from "./dom";
import { PREFIX } from "./prefix";
import { readJson, writeJson } from "./storage";
import { isSafeRelPath } from "./safe-url";
import { WIDGET_LABELS } from "./labels";
import type {
  AiChatWidgetOptions,
  WidgetJobView,
  WidgetLabels,
} from "./index";

/**
 * LIVE BACKGROUND JOBS — tracking them, and drawing the card (#320).
 *
 * Lifted whole out of `createAiChatWidget`, along the section banner that was
 * already in the file. 559 lines that own their own state: which work is being
 * watched, which polls are running, what the user confirmed this session.
 *
 * WHY THIS WAS A GOOD SEAM AND `send` IS NOT. Measured before moving anything:
 * this region touches 13 things outside itself and exposes 4 — a real module
 * boundary. `send`, at 665 lines, touches 55. A 55-member context is not an
 * abstraction, it is the closure with extra steps, so it stays where it is.
 *
 * Nothing here knows what a report is. It renders a status, a done-of-total, a
 * label and a terminal outcome — all `JobSummary` promises for a job of ANY
 * type, including one this build has never seen.
 */
export interface JobCardContext {
  L: (
    key: keyof WidgetLabels,
    params?: Record<string, string | number>
  ) => string;
  /** The transcript the cards are appended to. */
  log: HTMLElement;
  /** The launcher, for the unread nudge when a job lands unseen. */
  bubble: HTMLElement;
  side: "left" | "right";
  /** The assistant's display name, used in card copy. */
  name: string;
  /** Storage-key namespace, so two widgets on one origin cannot collide. */
  ns: string;
  scrollDown: (force?: boolean) => void;
  toggle: () => void;
  waitAlive: (ms: number) => Promise<boolean>;

  /**
   * DECLARED LATER THAN THIS MODULE'S ORIGINAL POSITION, so they arrive as
   * functions rather than values. `pane`, the frame helpers and the action
   * dispatcher are all defined below the job section in `index.ts`; passing
   * them by value at construction time would read them in their temporal dead
   * zone. Called only after mount, so a forwarding arrow is enough.
   */
  frameShowing: (path: string | null | undefined) => boolean;
  autoNavigateFrame: (key: string, path: string) => void;
  dispatchAction: (
    name: string,
    data: Record<string, string>
  ) => Promise<string | void>;

  /**
   * A GETTER, and not for tidiness. `threadId` is a `let` that changes when the
   * user switches thread, and a job outlives that: it is polled for minutes.
   * Captured by value, a job that finished after a thread switch would be
   * matched against the thread the user was in when it STARTED, and its card
   * would be drawn into the wrong conversation or silently dropped.
   */
  getThreadId: () => string | undefined;

  /** The host hooks this module reads a job through. Narrowed to the six it
   *  actually uses, so the seam is visible in the type rather than implied by
   *  the whole options object travelling in. */
  opts: Pick<
    AiChatWidgetOptions,
    | "cancelJob"
    | "cancelReport"
    | "getJob"
    | "getReport"
    | "listThreadJobs"
    | "persistKey"
  >;
}

export interface JobCards {
  /** Re-draw and re-poll the tracked jobs belonging to one thread. */
  reattachTrackedJobs: (tid: string | undefined) => void;
  /**
   * Watch one piece of work, painting into a node the CALLER owns.
   *
   * Returns nothing: the subscription's lifetime is the node's, and it stops
   * when the job goes terminal or the node leaves the document. An
   * unsubscribe would imply a second way to end it that does not exist.
   */
  subscribeJob: (
    ref: { kind: "job" | "report"; id: string },
    node: HTMLElement,
    paint: (view: WidgetJobView) => void
  ) => void;
  /** Remember that the USER confirmed this work, not the model. */
  trackConfirmedJob: (ref: { kind: "job" | "report"; id: string }) => void;
  /** Was this work confirmed by the user in THIS session? */
  hasUserConfirmed: (key: string) => boolean;
}

export function createJobCards(ctx: JobCardContext): JobCards {
  // ── Live background jobs ────────────────────────────────────────────────────
  //
  // An apply that ENQUEUES (a whole-site import, a render) answers in a second
  // and then works for minutes. The chat used to say "I'll notify you when it's
  // ready ✓" and then show nothing at all until the completion artifact appeared
  // on a reload — the one place the user was watching was the one place the work
  // was invisible. So the apply's job id is kept, a card is drawn in the ctx.log, and
  // the GENERIC job read is polled until the job is terminal.
  //
  // Nothing here knows what a report is. It renders a status, a
  // done-of-total, a label and a terminal outcome — which is all `JobSummary`
  // promises for a job of ANY type, including one this build has never seen.

  /** How often a live job is re-read. Slow enough not to be a poll storm, fast
   *  enough that "3 of 12" visibly moves while a job runs. */
  const JOB_POLL_MS = 3000;
  /** Stop babysitting a job that never lands — the card says so rather than
   *  spinning forever. */
  const JOB_POLL_MAX_MS = 30 * 60 * 1000;

  /**
   * WHICH SOURCE a piece of tracked work lives in.
   *
   * Everything below used to key on a bare id, which was correct while `job`
   * was the only source. It is not any more: a report is its own row in its own
   * table, so a report id and a job id are two namespaces, and one map keyed on
   * the raw string quietly assumes they cannot collide. They are both UUIDs, so
   * a collision is vanishingly unlikely and would be almost impossible to
   * diagnose — the cheap fix is to stop assuming.
   */
  type WorkKind = "job" | "report";
  interface WorkRef {
    kind: WorkKind;
    id: string;
  }
  /** The map key for one piece of tracked work. The ONLY place the two
   *  namespaces are joined, so they can never be conflated by accident. */
  const refKey = (ref: WorkRef): string => `${ref.kind}:${ref.id}`;
  /** A view carries its generic `type`; that is what tells re-attach which
   *  source a listed row came from. */
  const refOf = (view: { id?: string; type?: string }): WorkRef | null =>
    view.id
      ? { kind: view.type === "report" ? "report" : "job", id: view.id }
      : null;

  /** One piece of work this conversation is watching, as remembered across a
   *  refresh. */
  interface TrackedJob {
    jobId: string;
    /** Which source `jobId` belongs to. OPTIONAL on read: entries written
     *  before reports left the job model have no `kind`, and they are all
     *  generic jobs — so a missing value reads as "job" rather than dropping a
     *  card someone is watching. */
    kind?: WorkKind;
    /** The thread the job was started FROM — a job only re-attaches to its own
     *  conversation, never to whichever thread happens to be open. */
    threadId: string;
    /** When we started watching (ms). Old entries are pruned, so a job whose
     *  completion we never saw cannot haunt the chat forever. */
    at: number;
  }
  /** Tracked jobs outlive the page, so they live beside the conversation in
   *  localStorage (same opt-in: no persistKey → in-memory for this session only,
   *  which is exactly today's behaviour minus the refresh). */
  const jobsKey = ctx.opts.persistKey ? `${ctx.ns}:jobs:${ctx.opts.persistKey}` : null;
  const TRACKED_JOB_TTL_MS = 24 * 60 * 60 * 1000;
  /** The card currently drawn for a job id. Re-pointed (not re-created) whenever
   *  the transcript is re-rendered, so a poll always paints the LIVE node. */
  const jobCards = new Map<string, HTMLElement>();
  /** Job ids with a poll loop already running — a re-attach must never start a
   *  second one. */
  const jobPolling = new Set<string>();
  /**
   * Everything ELSE that wants to know how a job is going.
   *
   * The job card was the only watcher for a long time, so the poll painted it
   * directly. It is not any more: a `[[ui:…]]` tile can ctx.name a jobId and has to
   * repaint itself as that render finishes. Two pollers for one job would be
   * two answers to the same question, drifting apart and costing double, so
   * there is ONE loop per job id and it fans out to whoever is listening.
   *
   * Each subscriber carries the node it paints, because the transcript is wiped
   * and redrawn on every turn (`reattachTrackedJobs`): the node a subscriber
   * closed over is detached moments later, and a subscriber list that never
   * forgot them would grow without bound and paint into nothing.
   */
  const jobWatchers = new Map<
    string,
    Set<{
      node: HTMLElement;
      paint: (view: WidgetJobView) => void;
      /** Has this node ever actually been in the document? A tile subscribes
       *  while it is still being BUILT — the card it belongs to is appended a
       *  few statements later — so "not connected" only means "gone" once it
       *  has been seen connected at least once. Pruning on the first poll
       *  instead would silently unsubscribe every tile whose job answered
       *  faster than the card was assembled. */
      seen: boolean;
    }>
  >();

  /**
   * Hand one poll result to everyone watching that job: the card, and any tile
   * that named it. Subscribers whose node has left the document are dropped
   * here rather than on a timer — a detached node is the definition of a
   * subscriber with nothing left to paint.
   */
  function emitJob(ref: WorkRef, view: WidgetJobView): void {
    const key = refKey(ref);
    const card = jobCards.get(key);
    if (card) paintJob(card, view);
    const subs = jobWatchers.get(key);
    if (!subs) return;
    for (const sub of subs) {
      if (!sub.node.isConnected) {
        // Detached AFTER having been on screen — the transcript that held it
        // was wiped, so there is nothing left to paint.
        if (sub.seen) subs.delete(sub);
        continue;
      }
      sub.seen = true;
      try {
        sub.paint(view);
      } catch {
        // One bad subscriber must not stop the others (or the poll) — a tile
        // that throws is a drawing bug, not a reason to stall the job.
      }
    }
    if (!subs.size) jobWatchers.delete(key);
  }

  /**
   * Poll one job to a terminal state, fanning every result out through
   * `emitJob`. Idempotent per id: a second call while a loop is running simply
   * returns, which is what lets a tile and a card share one poll.
   *
   * Stops on: a terminal status, the safety ceiling, or `destroy()` (every wait
   * goes through `ctx.waitAlive`, so an aborted widget never wakes up again).
   */
  function watchJob(ref: WorkRef): void {
    // THE ONLY DISPATCH. A report reads from its own endpoint because it no
    // longer has a generic row; everything after this line is source-agnostic,
    // which is what keeps one loop serving both.
    const read = ref.kind === "report" ? ctx.opts.getReport : ctx.opts.getJob;
    if (!read || !ref.id) return;
    const key = refKey(ref);
    if (jobPolling.has(key)) return;
    jobPolling.add(key);
    void (async () => {
      const started = Date.now();
      try {
        for (;;) {
          if (Date.now() - started >= JOB_POLL_MAX_MS) {
            // Give up WATCHING, not on the job: it is still running server-ctx.side,
            // and saying so is more honest than a spinner that never resolves.
            const stalled = jobCards.get(key);
            if (stalled) {
              stalled.className = `${PREFIX}-job ${PREFIX}-job-done`;
              stalled.textContent = ctx.L("jobUnreachable");
            }
            forgetJob(ref);
            return;
          }
          let view: WidgetJobView | null;
          try {
            view = await read(ref.id);
          } catch {
            // A transient read failure is not a failed job — keep the spinner
            // and try again on the next tick.
            if (!(await ctx.waitAlive(JOB_POLL_MS))) return;
            continue;
          }
          // A job the account can no longer read (deleted, or never existed) is
          // not something to keep asking about.
          if (!view) {
            jobCards.get(key)?.remove();
            jobCards.delete(key);
            jobWatchers.delete(key);
            forgetJob(ref);
            return;
          }
          emitJob(ref, view);
          if (
            view.status === "done" ||
            view.status === "failed" ||
            view.status === "cancelled"
          ) {
            forgetJob(ref);
            jobWatchers.delete(key);
            ctx.scrollDown();
            return;
          }
          if (!(await ctx.waitAlive(JOB_POLL_MS))) return;
        }
      } finally {
        jobPolling.delete(key);
      }
    })();
  }

  /**
   * Subscribe a node to a job's progress and make sure the job is being polled.
   *
   * The node is what a tile passes so it can be dropped once the transcript
   * that held it is gone.
   */
  function subscribeJob(
    ref: WorkRef,
    node: HTMLElement,
    paint: (view: WidgetJobView) => void
  ): void {
    const read = ref.kind === "report" ? ctx.opts.getReport : ctx.opts.getJob;
    if (!read || !ref.id) return;
    const key = refKey(ref);
    let subs = jobWatchers.get(key);
    if (!subs) {
      subs = new Set();
      jobWatchers.set(key, subs);
    }
    subs.add({ node, paint, seen: false });
    watchJob(ref);
  }

  function loadTrackedJobs(): TrackedJob[] {
    const parsed = readJson<unknown[]>(jobsKey, (v): v is unknown[] =>
      Array.isArray(v)
    );
    if (!parsed) return [];
    const cutoff = Date.now() - TRACKED_JOB_TTL_MS;
    // NOTE the absent `kind` check: an entry written by the previous build has
    // none, and rejecting it would drop the card for work that is still running
    // across the deploy. `trackedRef` below defaults it.
    return parsed.filter(
      (j): j is TrackedJob =>
        Boolean(j) &&
        typeof j === "object" &&
        typeof (j as TrackedJob).jobId === "string" &&
        typeof (j as TrackedJob).threadId === "string" &&
        typeof (j as TrackedJob).at === "number" &&
        (j as TrackedJob).at > cutoff
    );
  }
  function saveTrackedJobs(jobs: TrackedJob[]): void {
    writeJson(jobsKey, jobs.length ? jobs : null);
  }
  /** The ref a stored entry refers to — `kind` defaults to "job" for entries
   *  written before reports had their own source. */
  function trackedRef(j: TrackedJob): WorkRef {
    return { kind: j.kind ?? "job", id: j.jobId };
  }
  function rememberJob(ref: WorkRef, tid: string): void {
    const jobs = loadTrackedJobs().filter(
      (j) => refKey(trackedRef(j)) !== refKey(ref)
    );
    jobs.push({ jobId: ref.id, kind: ref.kind, threadId: tid, at: Date.now() });
    saveTrackedJobs(jobs);
  }
  /** A finished job is not a live job: forgetting it here is what stops the card
   *  from being redrawn on the next refresh (the transcript's own completion
   *  artifact is the lasting record). */
  function forgetJob(ref: WorkRef): void {
    saveTrackedJobs(
      loadTrackedJobs().filter((j) => refKey(trackedRef(j)) !== refKey(ref))
    );
  }

  /** The card's title: the host's own wording, else the copy for a type we know,
   *  else a neutral one — an unknown type must still read as something. */
  function jobTitle(view: WidgetJobView): string {
    if (view.title) return view.title;
    if (view.type === "coder") return ctx.L("jobTitleCoder");
    if (view.type === "report") return ctx.L("jobTitleReport");
    return ctx.L("jobTitleFallback");
  }

  /** "3 of 12" / "3 so far" / nothing at all — `total` is null until the runner
   *  has planned its work, and "3 of 0" would be a lie. */
  function jobCounts(view: WidgetJobView): string {
    const done = view.progress?.done ?? 0;
    const total = view.progress?.total ?? null;
    if (total && total > 0) return ctx.L("jobProgress", { done, total });
    return done > 0 ? ctx.L("jobProgressOpen", { done }) : "";
  }

  /** (Re)paint a job card from the latest read. Same element throughout the
   *  job's life, so the card the user is looking at is the one that updates. */
  function paintJob(card: HTMLElement, view: WidgetJobView): void {
    const terminal =
      view.status === "done" ||
      view.status === "failed" ||
      view.status === "cancelled";
    const failed = view.status === "failed";
    card.className =
      `${PREFIX}-job` +
      (terminal ? ` ${PREFIX}-job-done` : "") +
      (failed ? ` ${PREFIX}-job-failed` : "");
    const icon = failed
      ? `<span class="${PREFIX}-act-x" aria-hidden="true">✕</span>`
      : view.status === "done"
        ? `<span class="${PREFIX}-act-ok" aria-hidden="true">✓</span>`
        : view.status === "cancelled"
          ? `<span class="${PREFIX}-act-x" aria-hidden="true">–</span>`
          : `<span class="${PREFIX}-act-spin" aria-hidden="true"></span>`;
    const state = failed
      ? ctx.L("jobFailed")
      : view.status === "done"
        ? ctx.L("jobDone")
        : view.status === "cancelled"
          ? ctx.L("jobCancelled")
          : view.status === "queued"
            ? ctx.L("jobQueued")
            : ctx.L("jobRunning");
    const counts = jobCounts(view);
    // The progress LABEL is server text (for a report, the section being
    // built) — escaped like every other untrusted string the widget draws.
    const detail = failed ? (view.error ?? "") : (view.progress?.label ?? "");
    const total = view.progress?.total ?? 0;
    const done = view.progress?.done ?? 0;
    // A bar only where there is a real ratio to show; otherwise the counts line
    // carries the progress on its own.
    const pct =
      total > 0
        ? Math.max(0, Math.min(100, Math.round((done / total) * 100)))
        : 0;
    // The FLOW: the last few narration lines while running (the live feel),
    // the whole story behind a ctx.toggle once it is long. All server text —
    // escaped per line.
    //
    // A step is shown in the READER'S language when the runner tagged it with a
    // code we have a label for, and in the runner's own English otherwise. That
    // fallback is the point: a new step can be emitted by the server without a
    // widget release, and it degrades to an English sentence rather than to a
    // blank line or a raw key.
    // FOLLOW IT INTO THE PANE, and stop narrating twice.
    //
    // Owner's decision (S4): once the app pane is showing the same run, the
    // chat column collapses to ONE line. The report page owns the detail — it
    // has the stage rail and it is the authority on stage — and two renderings
    // of one job competing on one screen is the divergence advanced view makes
    // absurdly visible. When the pane is NOT showing it, the chat narrates in
    // full, because then it is the only account of what is happening.
    //
    // `livePath` rather than `resultPath`: this has to work while the thing is
    // RUNNING, which is the whole point of a page you watch build.
    // Keyed through `refOf`/`refKey`, the same way `jobCards` and
    // `userConfirmedWork` are: `type` is free-form copy ("import", "render"),
    // so composing the key by hand here gave the follow decision a key that
    // could not match the one the confirmation was recorded under.
    const followRef = !terminal && view.livePath ? refOf(view) : null;
    if (followRef && view.livePath) {
      ctx.autoNavigateFrame(refKey(followRef), view.livePath);
    }
    const mirrored = ctx.frameShowing(view.livePath);
    const events = mirrored ? [] : (view.events ?? []);
    const eventText = (e: {
      message: string;
      data?: Record<string, unknown> | null;
    }): string => {
      const code = e.data?.code;
      if (typeof code !== "string" || !code) return e.message;
      const key = `jobEv${code.charAt(0).toUpperCase()}${code.slice(1)}`;
      // Membership is checked against the label BAG rather than by calling `L`
      // and testing its answer: `L` indexes a record typed as total, so an
      // unknown key yields `undefined` rather than anything recognisable, and a
      // step we have no wording for must fall through to the server's sentence.
      if (!(key in WIDGET_LABELS)) return e.message;
      return ctx.L(key as keyof WidgetLabels) || e.message;
    };
    const tailStart = terminal
      ? Math.max(0, events.length - 3)
      : Math.max(0, events.length - 5);
    const flowLine = (e: {
      kind?: string;
      message: string;
      data?: Record<string, unknown> | null;
    }) =>
      `<li class="${PREFIX}-job-ev${
        e.kind === "problem"
          ? ` ${PREFIX}-job-ev-problem`
          : e.kind === "decision"
            ? ` ${PREFIX}-job-ev-decision`
            : ""
      }">${escapeHtml(eventText(e))}</li>`;
    const flow = events.length
      ? `<ul class="${PREFIX}-job-flow">${events
          .slice(tailStart)
          .map(flowLine)
          .join("")}</ul>` +
        (tailStart > 0
          ? `<details class="${PREFIX}-job-flow-all"><summary>${escapeHtml(
              ctx.L("jobFlowAll", { count: events.length })
            )}</summary><ul class="${PREFIX}-job-flow">${events
              .map(flowLine)
              .join("")}</ul></details>`
          : "")
      : "";
    card.innerHTML =
      `<div class="${PREFIX}-job-head">${icon}` +
      `<span class="${PREFIX}-job-title">${escapeHtml(jobTitle(view))}</span>` +
      `<span class="${PREFIX}-job-state">${escapeHtml(state)}</span></div>` +
      (counts
        ? `<div class="${PREFIX}-job-counts">${escapeHtml(counts)}</div>`
        : "") +
      (total > 0 && !terminal
        ? `<div class="${PREFIX}-job-bar"><i style="transform:scaleX(${pct / 100})"></i></div>`
        : "") +
      (detail
        ? `<div class="${PREFIX}-job-detail">${escapeHtml(detail)}</div>`
        : "") +
      // The one line that replaces the narration when the pane is showing the
      // same run. Not silence: the card still has to say WHY it went quiet, or
      // it reads as the feed having stopped.
      (mirrored
        ? `<div class="${PREFIX}-job-mirrored">${escapeHtml(ctx.L("jobWatchingInPane"))}</div>`
        : "") +
      flow;
    // Finished WITH something to look at — the notification's "here's the
    // folder" without leaving the conversation.
    if (view.status === "done" && isSafeRelPath(view.resultPath)) {
      const path = view.resultPath;
      const btn = el("button", `${PREFIX}-nav-btn`) as HTMLButtonElement;
      btn.type = "button";
      btn.innerHTML = `<span>${escapeHtml(ctx.L("jobOpenResult"))}</span> <span aria-hidden="true">→</span>`;
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        try {
          await ctx.dispatchAction("navigate", { path });
        } catch {
          btn.disabled = false;
        }
      });
      card.appendChild(btn);
    }
    // Still in flight and the host can stop it → Cancel. The server cancel is
    // cooperative, so the button just asks: the card keeps polling and flips
    // to "Cancelled" when the runner actually stops at its next boundary.
    // The cancel goes to the route that OWNS the work: a report is cancelled
    // on its own row, and after the contract migration there is no generic job
    // to cancel it through.
    const cancelFor =
      view.type === "report" ? ctx.opts.cancelReport : ctx.opts.cancelJob;
    if (!terminal && view.id && cancelFor) {
      const jobId = view.id;
      const cancel = cancelFor;
      const btn = el("button", `${PREFIX}-nav-btn`) as HTMLButtonElement;
      btn.type = "button";
      btn.innerHTML = `<span>${escapeHtml(ctx.L("jobCancel"))}</span>`;
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        btn.textContent = ctx.L("jobCancelling");
        try {
          await cancel(jobId);
        } catch {
          // Couldn't reach the server — the button is usable again.
          btn.disabled = false;
          btn.innerHTML = `<span>${escapeHtml(ctx.L("jobCancel"))}</span>`;
        }
      });
      card.appendChild(btn);
    }
  }

  /** A placeholder card for a job we have not read yet (the moment after Apply,
   *  and the moment after a refresh) — the chat is never blank about it. */
  function pendingJobView(): WidgetJobView {
    return { status: "queued" };
  }

  /**
   * Give one job a CARD in the ctx.log, and make sure it is being watched.
   *
   * The polling itself lives in `watchJob` — this is the card half, kept apart
   * because a tile wants the second half without the first.
   */
  function trackJob(ref: WorkRef, tid: string | undefined): void {
    const read = ref.kind === "report" ? ctx.opts.getReport : ctx.opts.getJob;
    if (!read || !ref.id) return;
    if (tid) rememberJob(ref, tid);
    // The poll is started BEFORE the card guard below, deliberately: that guard
    // protects the CARD from being drawn twice, and a job whose card is already
    // up still needs its loop running (and its tiles fed) after a re-attach.
    watchJob(ref);
    // Idempotent per id, and it has to be: `reattachTrackedJobs` calls this
    // TWICE for the same job (once from browser storage, once when the server
    // listing resolves). The dedupe used to sit below the append, so the second
    // call drew a second card and overwrote the map entry — leaving the first
    // one orphaned in the ctx.log, repainted by nobody and frozen on "Queued"
    // forever. Bail before touching the DOM when the card is already on screen;
    // a stale entry left detached by a transcript wipe is rebuilt instead.
    const existing = jobCards.get(refKey(ref));
    if (existing?.isConnected) return;
    const card = el("div", `${PREFIX}-job`);
    paintJob(card, pendingJobView());
    ctx.log.appendChild(card);
    jobCards.set(refKey(ref), card);
    ctx.scrollDown(true);
  }

  /**
   * Work THIS session's user started by pressing a button, keyed like `jobCards`.
   *
   * The only thing that separates "the report you just asked me to write" from
   * "an import some other tab left running" — and the difference matters because
   * the first earns the app pane and the second must never take it. `trackJob`
   * cannot tell them apart on its own: it is called with a threadId from the
   * apply below AND from the server-listing re-attach, so the presence of a
   * thread proves nothing about who asked. The fact is recorded where the
   * confirmation actually happens instead.
   */
  const userConfirmedWork = new Set<string>();
  function trackConfirmedJob(ref: WorkRef): void {
    userConfirmedWork.add(refKey(ref));
    trackJob(ref, ctx.getThreadId());
  }

  /**
   * Re-attach the live cards for jobs started FROM this thread.
   *
   * This is what makes a running import survive a refresh — and also what
   * restores the card after any transcript re-render (the end-of-turn reload and
   * the completion broadcast both wipe the ctx.log). Cards are always rebuilt from
   * the tracked list rather than moved, so there is one path, not two.
   */
  function reattachTrackedJobs(tid: string | undefined): void {
    if (!(ctx.opts.getJob || ctx.opts.getReport) || !tid) return;
    jobCards.clear();
    // Browser storage FIRST so the card is back on the same tick as the
    // transcript — a job this device started is already known here, and waiting
    // on a round-trip would flash an empty conversation.
    for (const j of loadTrackedJobs()) {
      if (j.threadId === tid) trackJob(trackedRef(j), undefined);
    }
    // Then ask the SERVER what this thread actually has running. Storage only
    // knows what this browser started, so a job begun on a phone, or before
    // the cache was cleared, was invisible on every other device — the card
    // said nothing was happening while it ran. `trackJob` is idempotent
    // per id, so a job both sources know about is drawn once.
    const listRunning = ctx.opts.listThreadJobs;
    if (!listRunning) return;
    void listRunning(tid)
      .then((running) => {
        // The thread may have been switched while the request was in flight.
        if (ctx.getThreadId() !== tid) return;
        // The listing is MULTI-SOURCE: it carries reports as well as generic
        // jobs, and each row's `type` is what says which. Deriving the ref
        // here — rather than assuming "job" — is what makes a report started
        // on another device re-attach to the right poller.
        for (const j of running) {
          const ref = refOf(j);
          if (ref) trackJob(ref, tid);
        }
      })
      .catch(() => {
        /* offline or unauthorised — storage already covered this device */
      });
  }

  // Turn a FINAL assistant ctx.bubble's text into rich content: the host's real
  // <Markdown> when wired, else the built-in safe markdown→HTML, else plain.
  return {
    reattachTrackedJobs,
    subscribeJob,
    trackConfirmedJob,
    hasUserConfirmed: (key: string): boolean => userConfirmedWork.has(key),
  };
}
