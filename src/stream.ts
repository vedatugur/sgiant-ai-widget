import { WIDGET_TARGET_DECLARATIONS as widgetTargets } from "./widget-manifest.js";
import { parseJsonDirective } from "./directive";
import { PREFIX } from "./prefix";
import { readTokenRefusal, type TokenRefusal } from "./token-refusal";
import { addMsg, el, maskMarkdown, parseLine } from "./dom";
import { SITE_FORM_TAG } from "./site-form";
import {
  LEAD_TOKEN,
  proposalFields,
  type PreviewSpec,
  type ProposalField,
  type WidgetSpec,
} from "./specs";
import type { LoadedThreadItem } from "./replay";
import type { WidgetLabels } from "./labels";
import type { WidgetAtt, Uploads } from "./uploads";
import type { ModelPicker } from "./model-picker";
import type { createUiRenderers } from "./ui-render";
import type { createDecisionCards } from "./decision-cards";
import type { FrameTransport } from "sgiant-ai-agent-bridge";
import type {
  AiChatWidgetOptions,
  DirectiveRenderer,
  LauncherState,
} from "./widget";

type DecisionCards = ReturnType<typeof createDecisionCards>;
type UiRenderers = ReturnType<typeof createUiRenderers>;

/**
 * A turn: send a message, read the reply as it streams, and look for an
 * answer the stream lost (audit F133: moved out of `createAiChatWidget`
 * unchanged, apart from how it reaches the widget's state).
 *
 * The widget's mutable state is read and written through `st`, one object of
 * getters and setters the widget builds over its own variables — the getter
 * rule every factory here follows, for values that change after setup
 * (`threadId` above all). Everything else is handed over as it is: the DOM
 * nodes, the collections (by reference, so a push lands in the widget's own
 * list), and the functions the turn calls back into.
 */

/**
 * Warn a host about a malformed frame — once per reason, per page.
 *
 * Once, because a stream can carry the same bad frame on every turn and a
 * console flooded with one message is a console nobody reads. Per reason, so a
 * second, different mistake is still surfaced.
 */
const warned = new Set<string>();
function warnOnce(reason: string, message: string): void {
  if (warned.has(reason)) return;
  warned.add(reason);
  try {
    console.warn(message);
  } catch {
    /* a host that has replaced console is not a reason to break the turn */
  }
}

/** One message as the widget keeps it across reloads. */
export type StoredMsg = {
  role: "user" | "assistant";
  content: string;
  attachments?: WidgetAtt[];
};

/** A question a token refusal is holding: its drawn nodes and its entry. */
export interface Waiting {
  nodes: Element[];
  entry: StoredMsg;
}

/** The turn a page load or a dropped stream may have cut off (#503). */
export type Inflight = {
  threadId: string;
  /** What was sent; null for a regenerate, which sends no new message. */
  content: string | null;
  at: number;
};

/** The widget's state a turn reads and writes, as live accessors. */
export interface TurnState {
  threadId: string | undefined;
  inflight: Inflight | null;
  waiting: Waiting | null;
  knownNavTargets: { path?: string; title?: string; action?: string }[];
  knownUiTargets: {
    id?: string;
    label?: string;
    purpose?: string;
    mutates?: boolean;
    severity?: "reversible" | "destructive";
    undeclared?: boolean;
  }[];
  lastUserContent: string;
  quotaGranted: number;
  quotaRemaining: number | null;
  sessionUsed: number;
  readonly advanced: boolean;
  readonly viewGen: number;
  readonly paintStarItem: () => void;
}

type Labeler = (
  key: keyof WidgetLabels,
  params?: Record<string, string | number>,
) => string;

export interface TurnStreamContext {
  st: TurnState;
  L: Labeler;
  opts: AiChatWidgetOptions;
  alive: AbortController;
  INFLIGHT_MAX_AGE_MS: number;
  LOST_TURN_POLL_MS: number;
  NEW_TURN_KEY: string;
  QUALITY_SLOW_MS: number;
  TOOL_ROLE: Record<string, string>;
  // The window's nodes.
  log: HTMLElement;
  panel: HTMLElement;
  input: HTMLTextAreaElement;
  sendBtn: HTMLButtonElement;
  suggestionsEl: HTMLElement;
  metaChip: HTMLElement;
  launcher: Required<LauncherState>;
  picker: ModelPicker | null;
  uploads: Uploads;
  getTransport: () => FrameTransport | null;
  // The widget's collections, by reference.
  history: StoredMsg[];
  pendingThreads: Set<string>;
  qualityAsked: Set<string>;
  threadTurns: Map<string, number>;
  richDisposers: (() => void)[];
  customRenderers: Record<string, DirectiveRenderer>;
  // What the turn calls back into.
  saveState: () => void;
  syncBusy: () => void;
  scrollDown: (force?: boolean) => void;
  setRole: (role: string) => void;
  setLauncher: (next: LauncherState) => void;
  applyAssistantRich: (bubble: HTMLElement, text: string, animate?: boolean) => void;
  renderDirectives: (text: string) => string;
  liveActivityFrame: (
    callId: string,
    label: string,
    status: string,
    agent?: string,
    model?: string,
  ) => void;
  renderMeter: () => void;
  showSignupCta: () => void;
  refreshBalance: () => Promise<void>;
  refreshNotice: () => Promise<void>;
  refreshArtifacts: () => Promise<void>;
  clearTokenNotice: () => void;
  showTokenNotice: (
    refusal: TokenRefusal,
    held: {
      content: string;
      fork?: { parentId?: string | null; regenerate?: boolean };
      atts: WidgetAtt[];
    },
  ) => void;
  unsay: (q: Waiting) => void;
  showError: (raw: string, show?: { retry?: boolean; alone?: boolean }) => void;
  noteApiResult: (result: "ok" | "unreachable" | number) => void;
  maybeDing: (force?: boolean) => void;
  usageBadge: (inTok: number, outTok: number) => HTMLElement;
  searchLine: (
    queries: readonly string[],
    credits: number | null,
  ) => HTMLElement | null;
  loadThreadItems: (tid: string) => Promise<LoadedThreadItem[]>;
  renderThreadItems: (items: LoadedThreadItem[], tid?: string) => void;
  renderQualityPrompt: (
    variant: "slow" | "failed",
    messageId: string,
    model?: string,
  ) => void;
  buildVoteButtons: (messageId: string, model?: string) => HTMLElement;
  renderQuestion: DecisionCards["renderQuestion"];
  renderProposal: DecisionCards["renderProposal"];
  renderWidget: UiRenderers["renderWidget"];
  renderUiCard: UiRenderers["renderUiCard"];
  renderPreview: UiRenderers["renderPreview"];
  renderServerWidget: UiRenderers["renderServerWidget"];
}

export function createTurnStream(ctx: TurnStreamContext) {
  const {
    st,
    L,
    opts,
    alive,
    INFLIGHT_MAX_AGE_MS,
    LOST_TURN_POLL_MS,
    NEW_TURN_KEY,
    QUALITY_SLOW_MS,
    TOOL_ROLE,
    log,
    panel,
    input,
    sendBtn,
    suggestionsEl,
    metaChip,
    launcher,
    picker,
    uploads,
    getTransport,
    history,
    pendingThreads,
    qualityAsked,
    threadTurns,
    richDisposers,
    customRenderers,
    saveState,
    syncBusy,
    scrollDown,
    setRole,
    setLauncher,
    applyAssistantRich,
    renderDirectives,
    liveActivityFrame,
    renderMeter,
    showSignupCta,
    refreshBalance,
    refreshNotice,
    refreshArtifacts,
    clearTokenNotice,
    showTokenNotice,
    unsay,
    showError,
    noteApiResult,
    maybeDing,
    usageBadge,
    searchLine,
    loadThreadItems,
    renderThreadItems,
    renderQualityPrompt,
    buildVoteButtons,
    renderQuestion,
    renderProposal,
    renderWidget,
    renderUiCard,
    renderPreview,
    renderServerWidget,
  } = ctx;

  /**
   * Stream-loss recovery. The api runs a turn to completion and persists the
   * transcript even when the browser's stream dies (QUIC/proxy drops — seen
   * live: the reply landed 8 minutes after the client lost the connection).
   * So a transport failure is NOT a failed turn: keep the thread marked
   * "answering…" (which also blocks double-sending into it) and poll until
   * THIS turn's exchange lands, then show it. The transcript is persisted at
   * turn END (the user message and the reply arrive together), so the signal
   * is "the last user message is the one we sent, followed by an assistant
   * reply" — merely seeing a trailing assistant message would false-positive
   * on the PREVIOUS exchange in an existing thread. `sentContent` is null for
   * a regenerate (no new user message; any trailing reply counts). Bounded at
   * 15 minutes; on timeout the thread simply unlocks and the reply — if any —
   * shows on its next open.
   */
  /**
   * LOOK FOR A LOST ANSWER WITHOUT HOLDING THE PERSON (#639).
   *
   * The stream broke, or a page load cut the turn. The answer may still land
   * on the server, so the conversation is asked for every ten seconds, for
   * fifteen minutes, and a reply that lands is drawn.
   *
   * It used to lock Send for those fifteen minutes and say the reply "will
   * appear here". After a release it never does: a turn cut by one leaves
   * nothing on the server, not even the question. The person was told to wait
   * for something that was not coming, in a conversation they could not write
   * in. So the looking is silent now: no lock, no "answering…" in the
   * history, and a sentence that promises nothing.
   *
   * A NEW MESSAGE IN THAT CONVERSATION ENDS THE LOOKING. From then on the
   * conversation is the person's again: a reply found later must not be drawn
   * over the turn they are in, and the marker it clears would be the new
   * turn's. `lostSearch` holds one token for each conversation being looked
   * in; `send` drops it.
   */
  const lostSearch = new Map<string, symbol>();
  async function recoverLostTurn(
    turnThread: string,
    sentContent: string | null
  ): Promise<void> {
    if (!opts.loadThread) return;
    const mine = Symbol("lost-turn");
    lostSearch.set(turnThread, mine);
    const stillMine = (): boolean => lostSearch.get(turnThread) === mine;
    try {
      for (let i = 0; i < 90 && !alive.signal.aborted; i++) {
        await new Promise((r) => setTimeout(r, LOST_TURN_POLL_MS));
        if (alive.signal.aborted || !stillMine()) return;
        let items: LoadedThreadItem[];
        try {
          items = await loadThreadItems(turnThread);
        } catch {
          continue; // transient — the same outage that killed the stream
        }
        if (!stillMine()) return;
        if (!turnLanded(items, sentContent)) continue;
        if (st.threadId === turnThread) {
          renderThreadItems(items, turnThread);
          maybeDing();
          scrollDown();
          saveState();
        }
        return;
      }
    } finally {
      // Landed or given up on: there is nothing left to resume. Ended by a
      // new message: the marker is that message's now, and is left alone.
      if (stillMine()) {
        lostSearch.delete(turnThread);
        if (st.inflight?.threadId === turnThread) {
          st.inflight = null;
          saveState();
        }
      }
    }
  }

  /** Has THIS turn's exchange landed in the transcript? The last message must
   *  be a reply, and — unless it was a regenerate, which sends none — the last
   *  user message must be the one sent, or it is the previous exchange. */
  function turnLanded(
    items: LoadedThreadItem[],
    sentContent: string | null
  ): boolean {
    const msgs = items.filter(
      (it): it is Extract<LoadedThreadItem, { role: string }> => "role" in it
    );
    const last = msgs[msgs.length - 1];
    if (!last || last.role !== "assistant") return false;
    if (sentContent === null) return true;
    const lastUser = [...msgs].reverse().find((m) => m.role === "user");
    return !!lastUser && lastUser.content.trim() === sentContent.trim();
  }

  /**
   * Wait for a turn a PAGE LOAD cut off (#503), exactly as for a dropped
   * connection: the note and the looking, with no lock (#639). Skipped when the
   * transcript this page just loaded already has the reply.
   */
  function resumeInflight(restored?: LoadedThreadItem[]): void {
    const f = st.inflight;
    if (!f) return;
    const landed =
      restored !== undefined &&
      st.threadId === f.threadId &&
      turnLanded(restored, f.content);
    if (
      landed ||
      !opts.loadThread ||
      Date.now() - f.at >= INFLIGHT_MAX_AGE_MS
    ) {
      st.inflight = null;
      saveState();
      return;
    }
    if (st.threadId === f.threadId)
      showError(L("streamLostRecovering"), { retry: false });
    void recoverLostTurn(f.threadId, f.content);
  }

  async function send(
    content: string,
    fork?: { parentId?: string | null; regenerate?: boolean },
    /** The question a token refusal was holding (#620): already on screen and
     *  in the history as the person's own, so it is sent without being drawn
     *  again, with the attachments it had. */
    held?: { atts: WidgetAtt[] }
  ): Promise<void> {
    // Nothing is sent from a preview: a suggested question pressed there is
    // only a picture of one (sgiant-platform#592).
    if (opts.preview) return;
    // A regenerate re-answers an existing user turn — it carries no new user
    // message, so it must NOT push a user bubble to the DOM / history.
    const isRegen = fork?.regenerate === true;
    // Turn fence: this turn renders only while the user is still on the view
    // it started from. `turnThread` is the thread the reply BELONGS to (fixed
    // once the server names it); `live()` gates every visible side effect.
    const myGen = st.viewGen;
    let turnThread: string | undefined = st.threadId;
    const live = (): boolean => st.viewGen === myGen && !alive.signal.aborted;
    pendingThreads.add(turnThread ?? NEW_TURN_KEY);
    syncBusy();
    // The person has written again in a conversation whose last answer was
    // being looked for: stop looking (#639, see `recoverLostTurn`).
    if (turnThread) lostSearch.delete(turnThread);
    if (!isRegen) st.lastUserContent = content;
    // Take + clear any staged attachments for THIS turn.
    const atts = held ? held.atts : uploads.takeStaged();
    uploads.renderStaged();
    // The conversation is starting — page shortcuts give way to the thread.
    suggestionsEl.style.display = "none";
    suggestionsEl.innerHTML = "";
    sendBtn.disabled = true;
    setRole("talk"); // each turn starts as the conversational copilot
    // What this send drew of the person's own, in case the token step says
    // "not now" and the question has to wait: see `waiting` below.
    let drew: Waiting | null = null;
    if (!isRegen && !held) {
      const before = log.lastElementChild;
      const bubble = addMsg(log, "user", content, atts.length ? atts : undefined);
      const entry: StoredMsg = {
        role: "user",
        content,
        ...(atts.length ? { attachments: atts } : {}),
      };
      history.push(entry);
      // The bubble, and the row of attachment chips drawn just above it.
      const nodes: Element[] = [];
      for (
        let n: Element | null = bubble;
        n && n !== before;
        n = n.previousElementSibling
      )
        nodes.push(n);
      drew = { nodes, entry };
    }
    // Remembered so a page load mid-turn can wait for the reply — see
    // `inflight`. A new conversation has no thread yet; its `threadId` frame
    // sets this below.
    if (turnThread)
      st.inflight = {
        threadId: turnThread,
        content: isRegen ? null : content,
        at: Date.now(),
      };
    saveState();
    // Animated typing indicator until the first token lands.
    const typing = el("div", `${PREFIX}-typing`);
    typing.innerHTML = "<span></span><span></span><span></span>";
    log.appendChild(typing);
    scrollDown(true);
    let assistant: HTMLElement | null = null;
    let assistantRaw = "";
    let producedAny = false;
    /**
     * Write proposals seen this turn, rendered only AFTER the reply text.
     *
     * The model almost always emits a tool call BEFORE it writes the sentence
     * explaining it, so rendering each card where it arrives put "Apply this
     * change?" above the reasoning for it — the user was asked to approve
     * something before being told what it was. Buffering and flushing at the
     * end of the turn makes the order match how a person reads: the
     * explanation, then the decision.
     */
    const deferredProposals: Array<{
      name: string;
      args: Record<string, unknown>;
      agent?: string;
      fields: ProposalField[];
      /** The account the worker said this write is for. */
      accountId?: string;
      /** The artifact a dashboard/template apply needs — the runner emits it,
       *  and until now nothing on this side carried it. */
      artifactId?: string;
      /** The server's id for this proposal (#503), when it persisted it. */
      proposalId?: string;
    }> = [];
    /** Draw the held cards, in the order the model proposed them. */
    const drawDeferred = (skip?: ReadonlySet<string>): void => {
      for (const p of deferredProposals) {
        if (p.proposalId && skip?.has(p.proposalId)) continue;
        renderProposal(p.name, p.args, {
          agent: p.agent,
          fields: p.fields,
          accountId: p.accountId,
          artifactId: p.artifactId,
          proposalId: p.proposalId,
        });
      }
    };
    let turnIn = 0;
    let turnOut = 0;
    // The web searches this reply ran, from the `searches` frame (#661).
    let turnSearches: { queries: string[]; credits: number | null } | null =
      null;
    let failure: string | null = null;
    // How the failure is to be drawn. A server's frame WITH A CODE is a
    // sentence it wrote for the reader, and is the card's whole text; see
    // `showError`. Anything else is the ordinary card.
    let failureIs: { alone?: boolean; retry?: boolean } = {};
    // The token step said "not now" (#620): nothing was sent, nothing failed.
    let refused: TokenRefusal | null = null;
    // Stamped by the turn's `done` frame — the handle for rating the answer
    // just streamed, on surfaces where no canonical reload paints one (#299).
    let liveMessageId: string | undefined;
    let liveModel: string | undefined;
    // Wall-clock for the quality prompt's 20s trigger — comfortably past a
    // normal tool-using answer and far short of the 300s ceiling.
    const turnStartedAt = Date.now();
    let transportLost = false;
    // Chars of assistantRaw already painted into the streaming bubble. The
    // display can lag behind assistantRaw: directive bytes ([[tag:{json}]])
    // are withheld from view while they stream (see processStreamDisplay).
    let shownLen = 0;
    // Close the current text bubble and render its markdown, so the NEXT thing
    // (a widget/activity, or more text) lands AFTER it — keeping the reply in
    // true order instead of dumping widgets below all the text. `final` also
    // parses inline directives. Returns the rendered bubble (for the token tag).
    const flushSegment = (final: boolean): HTMLElement | null => {
      const bubble = assistant;
      // On a NON-final flush, bake only what the user has SEEN and carry the
      // withheld tail (a directive still streaming) into the next segment —
      // baking half a [[widget:{…}]] would show raw JSON AND orphan its tail.
      let raw = final ? assistantRaw : assistantRaw.slice(0, shownLen);
      assistantRaw = final ? "" : assistantRaw.slice(shownLen);
      shownLen = 0;
      if (!bubble) return null;
      assistant = null;
      bubble.classList.remove(`${PREFIX}-streaming`);
      if (!raw.trim()) {
        bubble.remove();
        return null;
      }
      if (final) raw = renderDirectives(raw);
      history.push({ role: "assistant", content: raw });
      // A reply that arrived while the panel was CLOSED is the one thing the
      // launcher has ever needed to say and could not (#305). Counted here, at
      // the moment a reply is recorded, rather than from a transcript diff —
      // the diff would also count the replies the reader has already seen.
      if (panel.style.display === "none") {
        setLauncher({ state: "unread", count: launcher.count + 1 });
      }
      applyAssistantRich(bubble, raw, true);
      return bubble;
    };
    // ---- Directive-aware streaming display --------------------------------
    // Directives ([[tag:{json}]]) arrive INSIDE the text stream. They used to
    // scroll by as raw JSON and only become cards when the turn finished. Now
    // the stream painter WITHHOLDS directive bytes as they arrive, and purely
    // visual cards (widget / preview / custom tags) render the moment their
    // JSON completes — mid-reply, in true order. Side-effecting directives
    // (navigate / action / chips / form) stay hidden in assistantRaw for the
    // end-of-turn renderDirectives pass, unchanged.
    const streamDirectiveTag = (tag: string): "now" | "later" | null => {
      if (
        tag === "widget" ||
        tag === "ui" ||
        tag === "preview" ||
        customRenderers[tag]
      )
        return "now";
      if (
        tag === "navigate" ||
        tag === "action" ||
        tag === "chips" ||
        tag === "form" ||
        tag === SITE_FORM_TAG
      )
        return "later";
      return null;
    };
    const appendStreamText = (s: string): void => {
      if (!s) return;
      if (!assistant) {
        typing.remove();
        assistant = addMsg(log, "assistant", "");
        assistant.classList.add(`${PREFIX}-streaming`);
      }
      const masked = maskMarkdown(s);
      if (masked) {
        const tok = el("span", `${PREFIX}-tok`);
        tok.textContent = masked;
        assistant.appendChild(tok);
      }
    };
    const renderStreamDirective = (tag: string, spec: unknown): void => {
      const custom = customRenderers[tag];
      if (custom) {
        const host = el("div", `${PREFIX}-widget ${PREFIX}-custom`);
        log.appendChild(host);
        try {
          const dispose = custom(host, spec);
          if (dispose) richDisposers.push(dispose);
        } catch {
          host.remove();
        }
        scrollDown(true);
        return;
      }
      if (tag === "widget") {
        renderWidget(spec as WidgetSpec);
        return;
      }
      if (tag === "ui") {
        renderUiCard(spec);
        return;
      }
      const p = spec as PreviewSpec;
      if (typeof p.html === "string") renderPreview(p);
    };
    const processStreamDisplay = (): void => {
      for (;;) {
        const pending = assistantRaw.slice(shownLen);
        if (!pending) return;
        const open = pending.indexOf("[[");
        if (open < 0) {
          // Withhold a lone trailing "[" — it may grow into an opener.
          const cut = pending.endsWith("[")
            ? pending.length - 1
            : pending.length;
          appendStreamText(pending.slice(0, cut));
          shownLen += cut;
          return;
        }
        if (open > 0) {
          appendStreamText(pending.slice(0, open));
          shownLen += open;
          continue;
        }
        // pending starts with "[[" — read the tag.
        const m = /^\[\[([a-z-]{1,24})(:|\]\])?/i.exec(pending);
        if (!m) {
          if (pending.length <= 2) return; // bare "[[" — tag may follow
          appendStreamText("[["); // "[[" + a non-tag char — literal text
          shownLen += 2;
          continue;
        }
        if (!m[2] && pending.length === 2 + m[1].length) return; // tag typing
        if (m[2] === "]]") {
          if (`[[${m[1]}]]` === LEAD_TOKEN) {
            shownLen += m[0].length; // hide the token; final pass renders it
            continue;
          }
          appendStreamText("[[");
          shownLen += 2;
          continue;
        }
        if (!m[2]) {
          // Tag chars ended in something that is not ":" — literal text.
          appendStreamText("[[");
          shownLen += 2;
          continue;
        }
        const mode = streamDirectiveTag(m[1]);
        if (!mode) {
          appendStreamText("[[");
          shownLen += 2;
          continue;
        }
        const d = parseJsonDirective<unknown>(pending, m[1]);
        if (!d || d.start !== 0) {
          // Incomplete (still streaming) — hold. Give up on a pathological
          // never-closing directive so the rest of the reply isn't hostage.
          if (pending.length > 20000) {
            appendStreamText("[[");
            shownLen += 2;
            continue;
          }
          return;
        }
        if (mode === "later") {
          shownLen += d.end; // keep in raw (final pass acts on it), hide only
          continue;
        }
        // Renderable NOW: bake the text seen so far, paint the card, resume.
        const rest = pending.slice(d.end);
        assistantRaw = assistantRaw.slice(0, shownLen);
        flushSegment(false);
        renderStreamDirective(m[1], d.spec);
        assistantRaw = rest;
        shownLen = 0;
      }
    };
    try {
      let token: string | undefined;
      try {
        token = opts.getToken ? await opts.getToken() : opts.token;
      } catch (thrown) {
        // Only the token step's own rejection is read for a sentence. Anything
        // thrown later in the turn is a failure, whatever it carries.
        refused = readTokenRefusal(thrown);
        throw thrown;
      }
      // A token was given: whatever an earlier refusal said no longer holds.
      clearTokenNotice();
      // The question that was waiting is being sent now, if this send is the
      // notice's button sending it. If it is ANOTHER question (the person
      // connected somewhere else, in another tab or on the host's own page,
      // and then asked something new without pressing the button), the one
      // that waited will never be sent: it is taken back like any other
      // question that was replaced, not left on screen looking sent (found
      // by SG QA Executive).
      if (st.waiting && !held) unsay(st.waiting);
      st.waiting = null;
      // The held question is on its way: it is kept for a reload from here.
      saveState();
      const baseCtx = opts.getContext ? await opts.getContext() : undefined;
      // In advanced view the controllable page is the FRAME, not the parent
      // shell — so the on-page targets (and the current path) come from the
      // frame's agent, overriding whatever the host scanned locally.
      const transport = getTransport();
      const pageContext =
        st.advanced && transport && baseCtx && typeof baseCtx === "object"
          ? {
              ...(baseCtx as Record<string, unknown>),
              path: transport.getPath() ?? (baseCtx as { path?: string }).path,
              uiTargets: transport.getTargets(),
            }
          : baseCtx;
      // THE PANEL DECLARES ITSELF.
      //
      // Hosts send the PAGE's controls (`hostTargetsOnly`), because a raw
      // `scanAiTargets` mixes the panel's own buttons in with them: "close"
      // then means two things on two surfaces, and the scan's cap lets the
      // panel push the page's controls out of the list silently.
      //
      // But excluding them without offering them elsewhere would leave the
      // assistant unable to reach its own history, menu or composer at all —
      // and sgiant-platform#356 exists partly to make that reachable ("it can
      // open the assets page; it cannot show you your last three
      // conversations"). Measured before the change: zero calls at a
      // widget-stamped target in thirty days, so nothing regressed — the
      // capability never existed.
      //
      // So the panel sends its OWN manifest rather than relying on being
      // scraped off the page. Declared, not derived, which is what lets
      // `mutates` be true: opening history changes nothing, starting a new chat
      // abandons what is on screen, and a DOM walk cannot tell those apart.
      const ctxWithPanel =
        pageContext && typeof pageContext === "object"
          ? { ...(pageContext as Record<string, unknown>), widgetTargets }
          : pageContext;
      // Cache this turn's navigable pages for the #111 prose-nav fallback below.
      const ctxTargets = (pageContext as { navTargets?: unknown } | undefined)
        ?.navTargets;
      if (Array.isArray(ctxTargets)) st.knownNavTargets = ctxTargets;
      // Same for the controls, and from the SAME context object the turn was
      // built from — so the confirm card describes the page the model was
      // actually looking at, not whatever the page has become since.
      const ctxUi = (pageContext as { uiTargets?: unknown } | undefined)
        ?.uiTargets;
      if (Array.isArray(ctxUi)) st.knownUiTargets = ctxUi;
      const res = await fetch(opts.endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        credentials: opts.withCredentials ? "include" : "same-origin",
        // Tied to the widget's lifetime. Without this the reader loop outlived
        // `destroy()`: it kept appending to a detached log, kept fetching, and
        // kept calling saveState() — into the SAME storage key the replacement
        // widget was already writing. Admin re-keys the widget on account and
        // language change, so a mid-stream account switch could clobber the new
        // account's transcript with the old one's.
        signal: alive.signal,
        body: JSON.stringify({
          ...(opts.extraBody ?? {}),
          ...(picker ? { model: picker.value() } : {}),
          ...(ctxWithPanel ? { pageContext: ctxWithPanel } : {}),
          accountId: opts.getAccountScope?.() ?? opts.accountId ?? "",
          threadId: st.threadId,
          content,
          ...(atts.length ? { attachments: atts.map((a) => a.mediaId) } : {}),
          ...(fork?.parentId !== undefined ? { parentId: fork.parentId } : {}),
          ...(fork?.regenerate ? { regenerate: true } : {}),
        }),
      });
      // What this status proves about the api, for the launcher's offline state
      // (#346). A 5xx/429 means asking again now will not work either; any
      // other 4xx is a REACHABLE api refusing this particular request.
      noteApiResult(res.ok ? "ok" : res.status);
      if (opts.siteChat && (res.status === 403 || res.status === 404)) {
        // NOTHING FROM THE BODY, here or below. What a refused request
        // carries is the server's text for its own log, or a stranger's
        // page if the address is wrong; neither is for a guest.
        failure = L("siteUnavailable");
        failureIs = { alone: true, retry: false };
      } else if (!res.ok || !res.body) {
        failure = `Server error (${res.status}).`;
        failureIs = {};
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
            if (frame.threadId) {
              // The server named this turn's thread. Re-key the pending entry;
              // update the GLOBAL threadId only while the user is still here —
              // after a switch it must not clobber the view they moved to.
              const named = turnThread !== frame.threadId;
              if (named) {
                pendingThreads.delete(turnThread ?? NEW_TURN_KEY);
                turnThread = frame.threadId;
                pendingThreads.add(turnThread);
                st.inflight = {
                  threadId: turnThread,
                  content: isRegen ? null : content,
                  at: Date.now(),
                };
              }
              if (live()) {
                st.threadId = frame.threadId;
                // A brand-new conversation just got its id — the star row can
                // stop hiding itself.
                st.paintStarItem();
              }
              // After the view took the id, so a reload restores the thread
              // the marker points at.
              if (named) saveState();
            }
            const piece = frame.text ?? frame.d;
            if (piece && live()) {
              assistantRaw += piece;
              producedAny = true;
              // Stream MASKED plain text (markdown marks hidden) with a
              // per-token fade+blur reveal — directive bytes are withheld and
              // visual cards paint mid-stream (see processStreamDisplay). The
              // real markdown still renders once at the end of each segment.
              processStreamDisplay();
              scrollDown();
            }
            // Inline data widget (render_chart). Flush the current text first so
            // the chart lands AFTER it, in order — not below the whole reply.
            if (frame.type === "widget" && live()) {
              typing.remove();
              flushSegment(false);
              renderServerWidget(frame.spec, frame.rows, frame.comparisonRows);
              producedAny = true;
            }
            // Live agent-activity step — a process chip (running → ok/error). On
            // start, flush text so the chip sits AFTER it (true order) and flip
            // the role badge to match the tool (Talk → Analytics, etc.).
            if (
              frame.type === "activity" &&
              frame.label &&
              frame.status &&
              live()
            ) {
              typing.remove();
              if (frame.status === "running") {
                flushSegment(false);
                if (frame.name && TOOL_ROLE[frame.name])
                  setRole(TOOL_ROLE[frame.name]);
              }
              liveActivityFrame(
                frame.callId ?? frame.label,
                frame.label,
                frame.status,
                (frame as { agent?: string }).agent,
                (frame as { model?: string }).model
              );
              producedAny = true;
            }
            // The assistant is ASKING the human to decide something.
            //
            // A question frame missing `questionId` or `prompt` used to be
            // dropped in SILENCE — no render, no error, nothing in the console.
            // A backend author following BACKEND.md wrote a question, watched
            // the reply arrive without it, and had no way to tell whether the
            // widget did not support questions or their frame was wrong.
            // `questionId` is optional on StreamFrame and mandatory here, and
            // BACKEND.md did not mention it at all until 2026-09-03.
            //
            // Silence is the worst failure a protocol can have. Say what is
            // missing, once, and carry on with the rest of the turn.
            if (frame.type === "question" && !(frame.questionId && frame.prompt))
              warnOnce(
                "question-frame-incomplete",
                "sgiant-ai-widget: ignoring a `question` frame without " +
                  `${!frame.questionId ? "`questionId`" : "`prompt`"}. Both are ` +
                  "required — the id is echoed back with the user's answer so " +
                  "your backend knows which question was answered. See BACKEND.md."
              );
            if (
              frame.type === "question" &&
              frame.questionId &&
              frame.prompt &&
              live()
            ) {
              typing.remove();
              flushSegment(false);
              renderQuestion(
                frame as unknown as Parameters<typeof renderQuestion>[0]
              );
              producedAny = true;
            }
            // Confirm-gated WRITE tool — the AI PROPOSES; show a card the user
            // applies (the actual mutation is a host, Clerk-authed action).
            if (
              frame.type === "tool_proposal" &&
              frame.name &&
              opts.onApplyProposal
            ) {
              // Every write proposal shows a confirm card — the human applies it.
              // (Saving a generated image/video/PDF into the library is just this:
              // the AI proposes the save, the user clicks Apply, or asks for it.)
              // HELD until the turn's text has been rendered — see
              // deferredProposals. Do NOT flush the segment here: splitting the
              // bubble at the tool call is what let the card jump the queue.
              deferredProposals.push({
                name: frame.name,
                args: (frame.args ?? {}) as Record<string, unknown>,
                agent: (frame as { agent?: string }).agent,
                // Inputs the assistant wants filled in before this is applied.
                // Absent on every proposal that needs no decision, which is
                // most of them — the card stays a plain confirmation.
                fields: proposalFields((frame as { fields?: unknown }).fields),
                accountId: (frame as { accountId?: string }).accountId,
                artifactId: (frame as { artifactId?: string }).artifactId,
                proposalId: frame.proposalId,
              });
              producedAny = true;
            }
            // Free-allowance meter (visitor preview). `quota` is the server's
            // snapshot; `usage` is this turn's tokens (count toward the session).
            if (frame.type === "quota") {
              if (typeof frame.granted === "number")
                st.quotaGranted = frame.granted;
              if (typeof frame.remaining === "number")
                st.quotaRemaining = frame.remaining;
              renderMeter();
              if (frame.exhausted) showSignupCta();
            }
            if (frame.type === "usage") {
              turnIn += frame.inputTokens ?? 0;
              turnOut += frame.outputTokens ?? 0;
              const turn = (frame.inputTokens ?? 0) + (frame.outputTokens ?? 0);
              st.sessionUsed += turn;
              if (st.quotaRemaining !== null)
                st.quotaRemaining = Math.max(0, st.quotaRemaining - turn);
              renderMeter();
            }
            if (frame.type === "searches" && Array.isArray(frame.queries)) {
              turnSearches = {
                queries: frame.queries.filter(
                  (q): q is string => typeof q === "string"
                ),
                credits:
                  typeof frame.credits === "number" ? frame.credits : null,
              };
            }
            if (frame.type === "meta" && frame.isStaff && frame.modelLabel) {
              metaChip.textContent = frame.modelLabel;
              metaChip.hidden = false;
            }
            // The turn's own message id + model (#299). This is what lets the
            // LIVE turn be rated on a surface that has no id-bearing replay to
            // fall back on — the visitor lane, whose transcript read carried no
            // ids at all until this change.
            if (frame.type === "done") {
              if (frame.messageId) liveMessageId = frame.messageId;
              if (frame.model) liveModel = frame.model;
            }
            if (frame.type === "error" && frame.message) {
              failure = frame.message;
              // A CODE MEANS "THIS SENTENCE IS FOR THE PERSON READING". The
              // code itself is not shown and not branched on: it is the
              // server's own name for the refusal, for its logs. Without one
              // the message may be anything (a vendor's text, a stack's
              // first line) and keeps the card's own headline above it.
              const coded =
                typeof frame.code === "string" && frame.code.trim() !== "";
              failureIs = coded
                ? { alone: true, retry: frame.retry !== false }
                : {};
            }
          }
        }
      }
    } catch (err) {
      // A refusal is none of what follows: no request was made, so there is
      // no stream to have lost and nothing learned about whether the api can
      // be reached.
      if (!refused) {
        // TRANSPORT loss (QUIC/network drop, proxy hiccup) — distinct from a
        // server-sent error frame: the api keeps running the turn server-side
        // and persists the transcript at the end, so the reply is NOT lost,
        // the browser just can't see the rest of the stream. Recover by
        // polling the thread until the reply lands (see below).
        transportLost = true;
        // Nothing was heard back at all — the one case we can call unreachable
        // without guessing (#346).
        noteApiResult("unreachable");
        // Whatever a frame said before the stream broke, this is not it.
        failureIs = {};
        failure = (err as Error).message || "Network error.";
      }
    } finally {
      pendingThreads.delete(turnThread ?? NEW_TURN_KEY);
      syncBusy();
      if (live()) input.focus();
      // A turn just consumed credits — refresh the remaining-credits readout.
      void refreshBalance();
      void refreshNotice();
      // A generation/import may have just landed — refresh the artifact strip
      // (thread-scoped, so only when this turn's thread is the one on screen).
      if (st.threadId === turnThread) void refreshArtifacts();
      // The stream reached its end, so a page load has nothing left to wait
      // for. A LOST stream keeps the marker: its turn is still running.
      if (!transportLost && turnThread && st.inflight?.threadId === turnThread) {
        st.inflight = null;
        saveState();
      }
    }

    // "Not now" from the token step (#620). The question is on screen as the
    // person's own and was never sent; say why, and hold it for the button.
    if (refused) {
      typing.remove();
      if (live()) {
        // ONE QUESTION WAITS, AND IT IS THE ONE ON SCREEN. A person who is
        // not connected and presses Send three times was shown three
        // bubbles under one "Connect" button, which holds only the last.
        // Connecting sent that one; the other two stayed on screen looking
        // like sent messages and were never sent (seen on a customer's
        // wp-admin, sgiant-platform#639). A question that is replaced before
        // it could be sent is taken back: its bubble goes, and it leaves the
        // history it was never part of.
        if (drew) {
          if (st.waiting) unsay(st.waiting);
          st.waiting = drew;
          // Out of what a reload restores, now that it is known to wait.
          saveState();
        }
        showTokenNotice(refused, { content, fork, atts });
      } else if (drew) unsay(drew);
      return;
    }

    // Stale turn finished in the background (the user switched away while it
    // streamed). Nothing here may touch the visible view UNLESS the user has
    // switched BACK to this turn's thread — then reload the canonical
    // transcript (the reply is persisted server-side) and surface the held
    // proposal cards the transcript did not already draw. Otherwise leave
    // everything for the thread to show on next open; the History spinner has
    // just cleared.
    // Transport died mid-stream. The api may still run the turn to completion
    // and save the transcript at the end (seen live with QUIC drops through
    // the edge; the reply arrived minutes later), so look for it. It may also
    // never come (a release cuts the turn and nothing is saved), so say so
    // and leave Send free (#639).
    if (transportLost && turnThread && opts.loadThread) {
      typing.remove();
      if (live()) {
        // THE HELD CARDS FIRST (#503). They waited for the reply's text, and
        // that text is now minutes away at best. Returning here used to drop
        // them: the reply landed talking about approval cards that were never
        // drawn. The recovery's reload keeps each one in place by its id.
        drawDeferred();
        showError(L("streamLostRecovering"), { retry: false });
      }
      void recoverLostTurn(turnThread, isRegen ? null : content);
      return;
    }

    if (!live()) {
      typing.remove(); // detached or not — harmless either way
      if (turnThread && st.threadId === turnThread && opts.loadThread) {
        // Proposals the transcript already holds are drawn BY it, in place.
        let replayed: Set<string> | undefined;
        try {
          const items = await loadThreadItems(turnThread);
          renderThreadItems(items, turnThread);
          replayed = new Set(
            items.flatMap((it) =>
              "kind" in it && it.kind === "proposal" ? [it.id] : []
            )
          );
        } catch {
          /* the thread shows the reply on its next open */
        }
        drawDeferred(replayed);
        maybeDing();
        scrollDown();
        saveState();
      }
      return;
    }

    // Clear the typing indicator + render the FINAL text segment (with
    // directives). Earlier segments were already flushed around widgets/chips.
    typing.remove();
    const lastBubble = flushSegment(true);
    // The reply is on screen; NOW ask for the decisions, in the order the model
    // proposed them.
    drawDeferred();
    if (deferredProposals.length) scrollDown();
    if (!producedAny) {
      if (failure) showError(failure, failureIs);
      else {
        addMsg(log, "assistant", "(no response)");
        scrollDown(true);
      }
    } else {
      // A reply did stream; surface a late error inline (partial + error).
      if (failure) showError(failure, failureIs);
      // Per-message token badge under the reply (UI-friendly tokens caption).
      if (turnIn + turnOut > 0) {
        const cap = usageBadge(turnIn, turnOut);
        if (lastBubble) lastBubble.insertAdjacentElement("afterend", cap);
        else log.appendChild(cap);
      }
      // What the reply searched on the web, and what it cost (#661).
      const searched = turnSearches
        ? searchLine(turnSearches.queries, turnSearches.credits)
        : null;
      if (searched) {
        const next = lastBubble?.nextElementSibling;
        const after =
          next && next.classList.contains(`${PREFIX}-usage`) ? next : lastBubble;
        if (after) after.insertAdjacentElement("afterend", searched);
        else log.appendChild(searched);
      }
      maybeDing();
      scrollDown();
    }
    saveState();
    // Reload the canonical thread after the turn so every message (incl. the one
    // just sent) carries its persisted id + ‹n/m› switcher — that's what makes
    // the edit / regenerate / branch controls appear WITHOUT a manual reopen. A
    // fork turn (edit / regenerate) also needs this to land the rewritten tree.
    // Only when branching is wired (setActiveLeaf) — otherwise the streamed view
    // is already canonical and reloading would just cause a needless re-render.
    // A live, un-applied WRITE PROPOSAL card suppresses this reload. It was
    // once the only copy of the proposal, so the reload (which does
    // `log.innerHTML = ""`) wiped it: the agent proposed, the card flashed in,
    // and the admin never got to click Apply. Since #503 the server keeps each
    // proposal and renderThreadItems carries a card across the wipe by its id,
    // but a card the server did not persist still has only this copy, so the
    // guard stays. The only thing the reload adds is the ‹n/m› branch switcher
    // + persisted ids on this turn's messages, which self-heal on the next send
    // or when the thread is reopened — a fair trade.
    const hasLiveProposal = !!log.querySelector(`.${PREFIX}-proposal-pending`);
    // Same wipe hazard for a FAILED turn: the error card (Retry/Report) is
    // ephemeral UI and the failed turn persisted nothing, so the canonical
    // reload would repaint an EMPTY thread — deleting the user's own message
    // AND the error they were meant to read (the "error flashes then the chat
    // goes blank" report). Keep the streamed view whenever an error card is on
    // screen; the next successful send reloads and self-heals the ids.
    const hasErrorCard = !!log.querySelector(`.${PREFIX}-error`);
    // Reload THIS TURN's thread (never whatever the view has become) — and only
    // while the user is still on it; the fence above already handled the
    // switched-away cases.
    if (
      turnThread &&
      opts.loadThread &&
      opts.setActiveLeaf &&
      !hasLiveProposal &&
      !hasErrorCard
    ) {
      try {
        const reloaded = await loadThreadItems(turnThread);
        if (live()) renderThreadItems(reloaded, turnThread);
      } catch {
        /* keep the streamed view if the reload fails */
      }
    } else if (liveMessageId && opts.vote && producedAny && live()) {
      // NO canonical reload happened, so nothing is going to paint the vote
      // control for us (#299).
      //
      // Hosts that wire `setActiveLeaf` (org, admin) reload the thread after
      // every turn, and that reload re-renders each message WITH its persisted
      // id — which is why thumbs already appear on a live turn there. The issue
      // read that as "votes only on replayed turns"; measured, it is narrower
      // and the gap is here:
      //
      //   • the visitor lane wires no setActiveLeaf at all, so it never reloads
      //   • a live proposal card or an error card SUPPRESSES the reload, to
      //     avoid wiping ephemeral UI — so those turns lose the control too
      //
      // In all three the id now arrives on the `done` frame, so the answer just
      // read is ratable without reopening the thread.
      const rowEl = el("div", `${PREFIX}-msgactions ${PREFIX}-assistant`);
      rowEl.appendChild(buildVoteButtons(liveMessageId, liveModel));
      log.appendChild(rowEl);
      scrollDown();
    }

    // ASK, when the turn gave us a reason to (#299). Every other part of this
    // signal waits to be volunteered, on controls that are easy to miss.
    const threadKey = turnThread ?? NEW_TURN_KEY;
    const turns = (threadTurns.get(threadKey) ?? 0) + 1;
    threadTurns.set(threadKey, turns);
    const elapsed = Date.now() - turnStartedAt;
    if (
      live() &&
      liveMessageId &&
      opts.vote &&
      // Never on a thread's FIRST turn — asking someone to rate a conversation
      // they have not had yet is noise.
      turns > 1 &&
      // At most once per thread per session.
      !qualityAsked.has(threadKey) &&
      (failure || elapsed >= QUALITY_SLOW_MS)
    ) {
      qualityAsked.add(threadKey);
      renderQualityPrompt(
        failure ? "failed" : "slow",
        liveMessageId,
        liveModel
      );
    }
  }

  return { send, resumeInflight, turnLanded };
}
