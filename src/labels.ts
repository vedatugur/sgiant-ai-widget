/**
 * Every string the widget's own chrome can show, and the host adapter that
 * translates them.
 *
 * Its own module (#320) because it is read by three hosts and a parity test,
 * and none of them wants the 5800-line widget closure to get at a string table.
 * `WidgetLabels` being derived from this object is what makes a missing
 * translation a TYPE error in each host rather than an English word appearing
 * in a Turkish UI.
 */
/**
 * SINGLE SOURCE for every user-facing string baked into the vanilla-DOM widget,
 * with its English default. The widget can't call i18next, so the host passes a
 * translated `labels` bag (built by `resolveWidgetLabels`); the widget falls back
 * to these English defaults for any missing key. A `{token}` in a value is filled
 * at runtime by the widget (single-brace so a host's i18next leaves it intact).
 */
export const WIDGET_LABELS = {
  // Question cards — the assistant asking the human to decide.
  questionConfirm: "Send",
  questionPlaceholder: "Type your answer…",
  questionSendFailed:
    "Couldn't send your answer — wait for the current reply to finish, then try again.",
  // Header / bubble
  openBubble: "Open {name}",
  openBubbleUnread: "Open {name} — {count} unread",
  panelAria: "{name} chat",
  newChat: "New chat",
  pastConversations: "Past conversations",
  /** History-row spinner tooltip: this conversation has a reply in flight. */
  threadAnswering: "Answering…",
  /** Shown when the live stream drops mid-reply: the server finishes the turn
   *  and the widget polls the thread until the reply lands. */
  streamLostRecovering:
    "Connection lost — still working on the reply; it will appear here when ready.",
  history: "History",
  moreOptions: "More options",
  more: "More",
  expandChat: "Expand chat",
  expand: "Expand",
  restore: "Restore",
  restoreChat: "Restore chat size",
  closeChat: "Close chat",
  conversation: "Conversation",
  // "More" overflow menu
  on: "On",
  off: "Off",
  downloadChat: "Download chat (.txt)",
  flagConversation: "Flag this conversation",
  flagConversationHint: "Flag this conversation for review",
  flagSendFirst: "Send a message first — then you can flag this chat.",
  flagPrompt: "Flag this conversation — why? (reason is logged for review)",
  flagged: "🚩 Conversation flagged for review ✓",
  flagFailed: "Couldn't flag: {msg}",
  flagFailedGeneric: "please try again",
  notificationSound: "Notification sound",
  soundOnHint: "Chime when a reply arrives — click to mute",
  soundOffHint: "Muted — click to enable the reply chime",
  autoNavigate: "Auto-navigate",
  autoNavOnHint: "Copilot opens pages for you — click to turn off",
  autoNavOffHint: "Copilot asks before opening pages — click to turn on",
  autoNavPinnedHint:
    "Advanced view always opens pages itself — this cannot be turned off here",
  autoApply: "Auto-apply",
  autoApplyOnHint:
    "Copilot applies safe changes for you — click to turn off",
  autoApplyOffHint:
    "Copilot asks before applying any change — click to turn on",
  automationHelp: "How automation works",
  automationHelpTitle: "What Copilot may do on its own",
  automationHelpNav:
    "Auto-navigate — Copilot opens pages by itself. Only pages: anything that changes something still asks.",
  automationHelpNavPinned:
    "In Advanced view Copilot always opens pages itself. That is what Advanced view is, so it cannot be switched off here.",
  automationHelpApply:
    "Auto-apply — Copilot applies changes this site has marked as safe to undo, such as saving a draft, without asking each time.",
  automationHelpNever:
    "Never done automatically, whatever these are set to: publishing, deleting, anything that costs credits, and anything that types or clicks on your behalf. Those always ask you first.",
  automationHelpLocal:
    "Both settings live in this browser only. They are yours, not the site's, and other people see their own.",
  automationHelpClose: "Close",
  // Status bar (Copilot role + credits)
  roleTalk: "Talk",
  roleAnalytics: "Analytics",
  creditsSuffix: " credits",
  // Composer
  askAnything: "Ask {name} anything…",
  messageAria: "Message {name}",
  send: "Send",
  removeAttachment: "Remove {file}",
  attachFile: "Attach a file",
  attachFileHint: "Attach images, PDFs or documents",
  // Live background-job card — a job the chat started and now watches. The
  // titles are per known TYPE, with a neutral fallback for a type this build
  // has never heard of (an AI-defined job type must still render).
  jobTitleCoder: "Working on a code task",
  jobTitleReport: "Generating the report",
  jobTitleFallback: "Background job",
  jobQueued: "Queued",
  jobRunning: "Running",
  jobDone: "Finished",
  jobFailed: "Failed",
  jobCancelled: "Cancelled",
  jobCancel: "Cancel",
  jobCancelling: "Cancelling…",
  jobProgress: "{done} of {total}",
  /** Used while the total is still unknown — a report learns it once planned. */
  jobProgressOpen: "{done} so far",
  jobOpenResult: "Open the result",
  /** Toggle under the flow tail that reveals the job's full activity feed. */
  jobFlowAll: "Show all {count} steps",
  /** Shown INSTEAD of the step feed when the app pane is already showing this
   *  run — see the collapse in renderJobCard. */
  jobWatchingInPane: "Following along in the panel →",
  /** Advanced view — the pane is showing a computed widget, not a route. */
  paneBackToPage: "Back to the page",
  paneShowingWidget: "Result",
  jobUnreachable: "Still running in the background — check back shortly",
  // Render STEPS. The runner writes its narration in English (it has no request
  // locale), but each event also carries a machine `code`, so a Turkish chat can
  // read the flow in Turkish instead of in the runner's English. An event whose
  // code we have no label for falls back to the server's own sentence — which is
  // why the set below can grow without the widget ever showing a blank line.
  jobEvCancelled: "Cancelled",
  jobEvCancelledBeforeStart: "Cancelled before it started",
  jobEvInterrupted: "Interrupted by a restart — not retried automatically",
  // Proposal confirm cards
  // The SEVEN write tools that used to hit the generic English fallback
  // ("Apply this change?") — including generate_report, the most expensive
  // confirm in the product. The widget's contract is that visible copy lives
  // here so a host can translate it; a `??` literal in the render path is
  // outside that contract and untranslatable by construction.
  /**
   * The card title for a write proposal the host has not named.
   *
   * The fifteen sgiant-specific titles that sat beside this — and the six
   * report-card labels — moved to @sgiant/ai-apply on 2026-09-02, along with
   * the branches that used them. A package a stranger installs should not ship
   * one company's tool vocabulary. Hosts pass their own via `proposalTitles`.
   */
  proposalGeneric: "Apply this change?",
  // The generate_report confirm card. These were four hardcoded English lines
  // in `proposalSummary` — on a card the user reads before spending minutes of
  // model time, in a widget whose whole contract is that visible copy lives
  // here so it can be translated.
  artifactsTitle: "This chat's files:",
  artifactSave: "Save",
  artifactSaving: "Saving…",
  apply: "Apply",
  dismiss: "Dismiss",
  applying: "Applying…",
  applied: "Applied",
  openReport: "Open the report",
  tryAgain: "Try again",
  // History panel
  close: "Close",
  loading: "Loading…",
  noConversations: "No past conversations yet.",
  untitledConversation: "Untitled conversation",
  star: "Star this conversation",
  unstar: "Unstar",
  historyLoadFailed: "Couldn't load history — try again.",
  bucketToday: "Today",
  bucketYesterday: "Yesterday",
  bucketWeek: "Earlier this week",
  bucketMonth: "This month",
  bucketOlder: "Older",
  // Lead form / preview / action chips
  submit: "Submit",
  sending: "Sending…",
  /** Why a form's Send, or a proposal card's Apply, refused to go through. */
  requiredFields: "Please fill in the highlighted fields first.",
  done: "Done ✓",
  preview: "Preview",
  otherOption: "+ Other…",
  confirm: "Confirm",
  cancel: "Cancel",
  // Error state
  errorSnag: "{name} hit a snag and couldn't answer. Please try again.",
  reportIssue: "Report issue",
  reporting: "Reporting…",
  reported: "Reported ✓ — our team will look into it",
  reportFailed: "Couldn't report — try later",
  // Quality prompt (#299) — the widget ASKING, because the whole signal was
  // passive on surfaces where the control was invisible or absent.
  //
  // The two triggers deliberately ask DIFFERENT questions. A slow answer that
  // was excellent, prompted with "was this helpful?", teaches us "slow = bad",
  // which we already knew. So a long wait asks about the WAIT, and a failed
  // turn asks about the GOAL.
  qualitySlowTitle: "That took a while — was the answer worth it?",
  qualityFailedTitle: "That didn't work — what were you trying to do?",
  qualityReasonPlaceholder: "Anything you'd add? (optional)",
  qualityFailedPlaceholder: "What were you trying to do?",
  qualitySend: "Send",
  qualityDismiss: "No thanks",
  qualityThanks: "Thanks — noted ✓",
  // Free-token meter. Shown ONLY when `signupUrl` is set, i.e. exactly on the
  // anonymous surfaces — the marketing visitor chat and the public demo — both
  // of which serve Turkish. These three were hardcoded English, so a Turkish
  // visitor read "60,000 free tokens left" under a Turkish conversation.
  meterTokensLeft: "{count} free tokens left",
  meterFreePreview: "Free preview",
  meterUsedThisSession: "{count} used this session",
  // Signup CTA (anonymous surfaces)
  signupCta: "Sign up — 14 days free",
  // Composed UI cards ([[ui:…]]) — the four states the widget colours. Any
  // OTHER status the model writes is shown in its own words, untranslated,
  // because only these four are ours to name.
  uiStatusPending: "Waiting",
  uiStatusRunning: "Working…",
  uiStatusReady: "Ready",
  uiStatusFailed: "Failed",
  /** A tile whose media hasn't been produced yet — the space is deliberately
   *  kept so the card doesn't reflow when the picture lands. */
  uiMediaPending: "Not made yet",
  /** A tile whose media id resolved to nothing (deleted, or not this account's).
   *  Said plainly, because a blank tile reads as a broken product. */
  uiMediaMissing: "Unavailable",
  /** Carousel paging controls on a composed card. */
  prev: "Previous",
  next: "Next",
  /** ACTION CHIPS — the in-chat "open this page / run this" affordances.
   *  These were template literals built inline, so they had no key at all and
   *  a host could not translate them however hard it tried: a fully Turkish
   *  session still read "Opening Billing…", "Billing ✓", "Couldn't open
   *  Billing". `{label}` is the action's own name, which the host localises. */
  actionOpening: "Opening {label}…",
  actionDone: "{label} ✓",
  actionOpenFailed: "Couldn't open {label}",
  actionRunFailed: "Couldn't run {label}",
  actionRetry: "{label} — try again",
  /** Outcomes of an action the HOST performed on the page behind the chat. */
  actionShownOnPage: "Shown on the page",
  actionDoneOnPage: "Done on the page",
  actionPageFailed: "Couldn't do that on the page",
  actionOpened: "Opened",
  /** A thread the transcript endpoint would not return. */
  threadOpenFailed: "Couldn't open that conversation.",
} as const;

/** The widget's label bag — same keys as WIDGET_LABELS, all resolved to strings. */
export type WidgetLabels = Record<keyof typeof WIDGET_LABELS, string>;

/**
 * Build the widget's `labels` bag from a host translator (react-i18next's `t`).
 * Each label resolves the `chatWidget.<key>` locale key, defaulting to the
 * English string in WIDGET_LABELS. Call once per (re-)mount so the widget picks
 * up the active language.
 */
export function resolveWidgetLabels(
  t: (key: string, defaultValue: string) => string
): WidgetLabels {
  const out = {} as WidgetLabels;
  for (const k of Object.keys(WIDGET_LABELS) as (keyof WidgetLabels)[]) {
    out[k] = t(`chatWidget.${k}`, WIDGET_LABELS[k]);
  }
  return out;
}
