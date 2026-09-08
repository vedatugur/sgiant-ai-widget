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

import {
  verifySurface,
  type SurfaceManifest,
  type ManifestDrift,
  type ManifestRoot,
} from "sgiant-ai-agent-bridge/manifest";

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

export type WidgetTargetId =
  (typeof WIDGET_TARGETS)[keyof typeof WIDGET_TARGETS];

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

/**
 * WHAT THE MANIFEST CLAIMS, AGAINST WHAT THE PANEL ACTUALLY HAS.
 *
 * The bridge has shipped `verifySurface` since the contract was written and
 * nothing called it — the manifest half was wired and the verification half was
 * not, which is the "declared but unwired" shape the estate has now been bitten
 * by four times (sgiant-platform#348, #365, #367 and this).
 *
 * A manifest describes; the panel IS. When they disagree the panel wins,
 * because the panel is what the user is looking at — and an assistant acting on
 * the manifest instead is #348 with a click attached.
 *
 * THE ANSWER IS THREE BUCKETS, not a boolean, because the three mean different
 * things to a person:
 *
 *   `expected`   a conditional control the host did not enable. "Not available
 *                here" is TRUE and useful; reporting it as a fault would cry
 *                wolf on a correctly configured widget.
 *   `stale`      a control this manifest declares unconditionally and the panel
 *                does not have. The manifest is wrong. Say so; never act.
 *   `other`      hidden or undeclared — worth reporting, never a reason to
 *                refuse: a hidden control may simply be behind a closed menu.
 */
export interface WidgetSurfaceCheck {
  /** Conditional controls the host did not wire — a true "not available here". */
  expected: ManifestDrift[];
  /** Declared unconditionally and absent: the manifest is out of date. */
  stale: ManifestDrift[];
  /** Hidden or undeclared. Reported, never fatal. */
  other: ManifestDrift[];
  /** Nothing declared is missing. `expected` may still be non-empty. */
  ok: boolean;
}

/**
 * Verify the widget's own surface against a live root.
 *
 * Takes the root rather than reaching for `document`, so it works on a detached
 * panel and can be tested without a browser — the same reason the bridge's own
 * `ManifestRoot` is a two-method interface.
 */
export function verifyWidgetSurface(root: ManifestRoot): WidgetSurfaceCheck {
  const conditional = new Set<string>(WIDGET_CONDITIONAL_TARGETS);
  const drift = verifySurface(WIDGET_MANIFEST, root);
  const expected: ManifestDrift[] = [];
  const stale: ManifestDrift[] = [];
  const other: ManifestDrift[] = [];
  for (const d of drift) {
    if (d.kind !== "missing") other.push(d);
    else if (conditional.has(d.id)) expected.push(d);
    else stale.push(d);
  }
  return { expected, stale, other, ok: stale.length === 0 };
}

/**
 * One sentence a person can read, or "" when there is nothing to say.
 *
 * Returned rather than logged: where this belongs — a console, a chip, an
 * answer to the user — is the caller's decision, and a helper that picks for
 * them is a helper that gets worked around.
 */
export function describeWidgetDrift(check: WidgetSurfaceCheck): string {
  const parts: string[] = [];
  if (check.stale.length)
    parts.push(
      `${check.stale.length} control(s) this widget declares are not on the panel (${check.stale
        .map((d) => d.id)
        .join(", ")}) — the manifest is out of date, do not act on them`,
    );
  if (check.expected.length)
    parts.push(
      `not available in this configuration: ${check.expected.map((d) => d.id).join(", ")}`,
    );
  if (check.other.length)
    parts.push(
      check.other.map((d) => `${d.id} ${d.kind}: ${d.detail}`).join("; "),
    );
  return parts.join(". ");
}

/** One scanned control, as `scanAiTargets` returns them. Declared here rather
 *  than imported so this file stays usable by a host that scans its own way. */
export interface ScannedTarget {
  id: string;
  label?: string;
}

/**
 * SPLIT A SCAN INTO THE HOST'S CONTROLS AND THE WIDGET'S OWN.
 *
 * `scanAiTargets` walks the whole document for `[data-ai-target]`, and the
 * widget stamps that same attribute on its own bubble, composer, history and
 * menu. So a host that passes the scan straight through as `uiTargets` sends
 * the assistant a list in which its own panel's buttons are indistinguishable
 * from the page's — and the model is asked to choose between them with nothing
 * to choose on.
 *
 * Two costs, and the second is the one that bites. The model cannot tell "a
 * button on the page" from "a button inside the assistant", so "click the close
 * button" is ambiguous in a way no amount of prompting fixes. And the scan is
 * CAPPED (40 by default): on a rich page the widget's eight controls can push
 * eight of the host's out of the list entirely, silently.
 *
 * This is the `surface` field of the contract doing its job — the manifest says
 * which thing it describes so a host's and the widget's can coexist
 * (sgiant-platform#356). `WIDGET_TARGETS` is the authority: an id the widget
 * stamps is the widget's, whatever the page around it looks like.
 */
export function splitSurfaceTargets(targets: readonly ScannedTarget[]): {
  host: ScannedTarget[];
  widget: ScannedTarget[];
} {
  const mine = new Set<string>(Object.values(WIDGET_TARGETS));
  const host: ScannedTarget[] = [];
  const widget: ScannedTarget[] = [];
  for (const t of targets) (mine.has(t.id) ? widget : host).push(t);
  return { host, widget };
}

/**
 * The host's controls only — what a page context should carry.
 *
 * Named separately from `splitSurfaceTargets` because this is the call a host
 * actually makes, and a host reading `splitSurfaceTargets(...).host` at the
 * call site is one refactor away from sending `.widget` by mistake.
 */
export function hostTargetsOnly(
  targets: readonly ScannedTarget[],
): ScannedTarget[] {
  return splitSurfaceTargets(targets).host;
}
