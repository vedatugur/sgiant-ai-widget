/**
 * THE WIDGET'S OWN SURFACE — the first thing it can describe about itself.
 *
 * Until now the assistant could drive the page it is embedded in and not the
 * panel it lives in. It can open the assets page; it cannot show you your last
 * three conversations, or expand so you can actually read something. The
 * vocabulary simply did not exist: `dispatchAction` handles navigation, the
 * pure-DOM control actions, then falls through to the host, and none of those
 * branches has a name for "the history pane".
 *
 * THIS IS DECLARED, NOT GENERATED, AND THAT IS THE POINT. It is the one surface
 * where there is nothing to trust and nothing to infer: it ships in the same
 * package as the code it describes, it is versioned with it, and it is small
 * enough to be complete. If the contract cannot be made to work here, it cannot
 * be made to work on a customer's WordPress admin.
 *
 * `mutates` IS DECIDED PER CONTROL, by a person, which is what a generated
 * manifest cannot do. Opening history is not a change. Starting a new chat
 * abandons what is on screen, so it is. That distinction is invisible to a DOM
 * walk — both are buttons with an icon on them — and it is exactly the
 * distinction the old hardcoded `["fill","click"]` gate could not express.
 *
 * THE IDS MUST MATCH THE DOM. `WIDGET_TARGETS` below is the single place they
 * are written; the render code stamps `data-ai-target` from it, and a test
 * asserts the manifest and the stamps agree. A manifest that drifts from the
 * thing it describes is the failure this contract exists to prevent, so it is
 * not left to discipline.
 */

import type { SurfaceManifest } from "sgiant-ai-agent-bridge/manifest";

/** The surface name. Distinct from any host's, so both can be loaded at once
 *  and a control is never ambiguous about which one it belongs to. */
export const WIDGET_SURFACE = "assistant-widget" as const;

/**
 * Every id the widget stamps on itself, in one place.
 *
 * Written as a const object rather than inline strings so the render code and
 * the manifest cannot disagree by typo — the compiler catches that, and the
 * parity test catches the rest.
 */
export const WIDGET_TARGETS = {
  bubble: "widget-bubble",
  newChat: "widget-new-chat",
  history: "widget-history",
  more: "widget-more",
  expand: "widget-expand",
  close: "widget-close",
  composer: "widget-composer",
  attach: "widget-attach",
} as const;

export type WidgetTargetId = (typeof WIDGET_TARGETS)[keyof typeof WIDGET_TARGETS];

/**
 * The widget, described.
 *
 * The view tree is the part today's page-manifest shape cannot express. The
 * launcher, the open panel and the history pane are three different states with
 * three different sets of available controls, and NONE of them is a URL. A flat
 * list would offer "close the chat" while the chat is shut.
 */
export const WIDGET_MANIFEST: SurfaceManifest = {
  surface: WIDGET_SURFACE,
  version: "1",
  // Ours, shipped beside the code it describes. Nothing here was inferred.
  trust: "owned",
  views: [
    {
      id: "launcher",
      title: "Assistant launcher",
      purpose:
        "The closed state — a single bubble in the corner of the host page.",
      controls: [
        {
          id: WIDGET_TARGETS.bubble,
          label: "Open the assistant",
          purpose: "Opens the chat panel.",
          kind: "button",
          // Opening a panel changes nothing the user would have to undo.
          mutates: false,
        },
      ],
      views: [
        {
          id: "panel",
          title: "Assistant panel",
          purpose:
            "The open chat: a conversation log, a composer, and the header controls.",
          controls: [
            {
              id: WIDGET_TARGETS.composer,
              label: "Message box",
              purpose:
                "Where the user types. Focusing it is safe; filling it puts words in their mouth, so that is a change.",
              kind: "input",
              // FILLING someone's message box is not the same as focusing it.
              // The old gate could not tell those apart because it keyed on the
              // action name, not on the control.
              mutates: true,
            },
            {
              id: WIDGET_TARGETS.attach,
              label: "Attach a file",
              purpose: "Opens the host's file picker.",
              kind: "button",
              mutates: true,
            },
            {
              id: WIDGET_TARGETS.newChat,
              label: "New chat",
              purpose:
                "Starts a fresh conversation. The current one moves to history rather than being lost.",
              kind: "button",
              // Abandons what is on screen. Recoverable from history, which is
              // why it is reversible rather than destructive — a distinction
              // worth keeping, because it decides how the confirm is phrased.
              mutates: true,
              severity: "reversible",
            },
            {
              id: WIDGET_TARGETS.history,
              label: "Past conversations",
              purpose: "Opens the history pane.",
              kind: "button",
              mutates: false,
            },
            {
              id: WIDGET_TARGETS.more,
              label: "More options",
              purpose: "Opens the menu.",
              kind: "button",
              mutates: false,
            },
            {
              id: WIDGET_TARGETS.expand,
              label: "Expand",
              purpose:
                "Makes the panel larger so long answers are readable. Only present when the host allows expanding.",
              kind: "button",
              mutates: false,
            },
            {
              id: WIDGET_TARGETS.close,
              label: "Close",
              purpose: "Closes the panel. The conversation is kept.",
              kind: "button",
              mutates: false,
            },
          ],
          views: [
            {
              id: "history",
              title: "Past conversations",
              purpose:
                "The list of earlier threads. Reached from the panel, and not a URL — which is why the contract needed views that are not paths.",
              // Its controls are per-thread and built at render time from data,
              // so they are not declared here. Declaring ids that only exist
              // for some users is how a manifest starts describing fiction.
            },
            {
              id: "menu",
              title: "Assistant menu",
              purpose: "The options menu behind the header's more button.",
            },
          ],
        },
      ],
    },
  ],
};

/**
 * Controls that are only present in some configurations.
 *
 * `expand` exists only when the host passes `expandable`; `attach` only when
 * uploads are wired; `history` only when the host supplies `listThreads`. So a
 * drift report naming these is EXPECTED, not a fault, and a caller that treats
 * every `missing` as a bug would cry wolf on a correctly configured widget.
 *
 * The right reading of a missing conditional control is "not available here",
 * which is a true and useful thing to tell a user.
 */
export const WIDGET_CONDITIONAL_TARGETS: readonly string[] = [
  WIDGET_TARGETS.expand,
  WIDGET_TARGETS.attach,
  WIDGET_TARGETS.history,
];
