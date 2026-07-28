/**
 * Shared host protocol for Copilot — the ONE definition of the page context the
 * assistant receives and the in-app actions it may take, reused by every
 * surface (org, admin, marketing, onboarding). Keeping this in one place means
 * adding a surface is a few lines, and the action allow-list can't drift between
 * apps.
 *
 * SECURITY: the AI only ever NAMES an action; the host owns the name→effect
 * mapping below. The model never receives a raw URL or endpoint.
 */

import {
  isUiControlAction,
  runUiControl,
  isOperateAction,
  runOperateAction,
} from "./ui-control";

/** Which product surface the user is on. */
export type AppSurface = "org" | "admin" | "marketing" | "onboarding";

/**
 * A structured descriptor of ONE page/route — the "page manifest". It lives next
 * to the app's routes (one source of truth) and teaches Copilot what a page IS:
 * its purpose, the sections on it, and the actions available there. Feeding
 * these into the turn context turns Copilot from "knows the route name" into a
 * page-structure-aware UI assistant.
 */
export interface PageManifestEntry {
  /** Language-/account-neutral path the model uses to navigate (e.g. "/network",
   *  or an org suffix like "/studio"). */
  path: string;
  /** Human title shown to the user / used by the model. */
  title: string;
  /** One-line "what this page is for". */
  purpose: string;
  /** Key sections/areas on the page (so Copilot can describe its structure). */
  sections?: string[];
  /** Allow-listed action name(s) that open/operate this page, when the host
   *  prefers a named action over a raw path (e.g. org's "open-studio"). */
  action?: string;
  /** A few page-aware shortcut questions surfaced as clickable chips in the
   *  assistant widget while the conversation is empty — the smart "where do I
   *  start on THIS page" prompts. Clicking one sends it to Copilot. */
  suggestions?: string[];
}

/** A compact navigable target the model is offered (derived from the manifest). */
export interface NavTarget {
  path: string;
  title: string;
  purpose: string;
  /** Named action to use instead of a raw path, when set. */
  action?: string;
}

/** Per-turn page context sent to the assistant (merged into the POST as
 *  `pageContext` by `getContext`). */
export interface PageContext {
  app: AppSurface;
  /** Current route/path. */
  path: string;
  /** Last path segment — a coarse "page" name the model can reason about. */
  page: string;
  /** Recent navigation breadcrumb (most-recent last, capped). */
  recentPages: string[];
  /** The current page's manifest descriptor (purpose + sections), when known. */
  pageInfo?: PageManifestEntry;
  /** The catalog of pages Copilot may open (from the manifest) — the single source
   *  of truth for navigation, so the prompt never hardcodes a path list. */
  navTargets?: NavTarget[];
  /** On-page controls the Copilot may point at (highlight/scroll-to/focus-field)
   *  — scanned from the live DOM via `scanAiTargets()`. Ids the host owns, never
   *  selectors. Fed into the turn so the model knows what's on THIS page. */
  uiTargets?: Array<{ id: string; label: string }>;
}

/** Normalize a path for manifest matching: drop a leading 2-letter locale
 *  segment (marketing "/en/network" → "/network") and any trailing slash. */
function normalizePath(path: string): string {
  let p = path.replace(/\/+$/, "") || "/";
  const m = p.match(/^\/([a-z]{2})(\/|$)/);
  if (m) p = p.slice(m[1].length + 1) || "/";
  return p;
}

/** Find the manifest entry that best describes the current path — the entry
 *  whose `path` is the longest suffix of the (normalized) current path. */
export function matchManifest(
  path: string,
  manifest: PageManifestEntry[]
): PageManifestEntry | undefined {
  const norm = normalizePath(path);
  let best: PageManifestEntry | undefined;
  for (const e of manifest) {
    if (norm === e.path || norm.endsWith(e.path)) {
      if (!best || e.path.length > best.path.length) best = e;
    }
  }
  return best;
}

/** Build a standard PageContext from a path (derives `page`, caps the trail).
 *  Pass the app's page `manifest` to also attach the current page's descriptor
 *  and the navigable-page catalog. */
export function makePageContext(
  app: AppSurface,
  path: string,
  recentPages: string[] = [],
  manifest?: PageManifestEntry[]
): PageContext {
  const page = path.split("/").filter(Boolean).slice(-1)[0] || "home";
  const ctx: PageContext = {
    app,
    path,
    page,
    recentPages: recentPages.slice(-8),
  };
  if (manifest?.length) {
    ctx.pageInfo = matchManifest(path, manifest);
    ctx.navTargets = manifest.map((e) => ({
      path: e.path,
      title: e.title,
      purpose: e.purpose,
      ...(e.action ? { action: e.action } : {}),
    }));
  }
  return ctx;
}

/** Render a PageContext into a compact, prompt-ready UI-context block (trusted
 *  framing is added by the caller). Shared by every surface so the wording the
 *  model sees is identical. Returns "" when there's nothing useful to say. */
export function formatPageContext(pc: PageContext): string {
  const lines: string[] = [];
  const where = pc.pageInfo?.title || pc.page || pc.path;
  lines.push(`The user is currently on: ${where} (${pc.path}).`);
  if (pc.pageInfo) {
    lines.push(`This page: ${pc.pageInfo.purpose}.`);
    if (pc.pageInfo.sections?.length)
      lines.push(`Sections here: ${pc.pageInfo.sections.join(", ")}.`);
  }
  if (pc.recentPages?.length)
    lines.push(`Recently visited: ${pc.recentPages.slice(-8).join(" → ")}.`);
  if (pc.navTargets?.length) {
    lines.push("Pages you can open (use ONLY these for navigation):");
    for (const t of pc.navTargets) {
      const how = t.action ? `action "${t.action}"` : `path "${t.path}"`;
      lines.push(`- ${t.title} — ${t.purpose} (${how}).`);
    }
  }
  if (pc.uiTargets?.length) {
    lines.push(
      "Controls on this page (point the user at ONE with a highlight/scroll-to/focus-field action, by its id):"
    );
    for (const t of pc.uiTargets.slice(0, 40)) {
      lines.push(`- id "${t.id}"${t.label ? ` — ${t.label}` : ""}.`);
    }
  }
  return lines.join("\n");
}

/** Machine-readable catalog of the standard actions — feed (filtered by the
 *  account's navigationEnabled + role) into the model's turn context so Copilot
 *  only proposes actions that exist and are permitted. */
export const STANDARD_ACTIONS = [
  {
    name: "navigate",
    description: "Go to an in-app page by its path (SPA route).",
    surfaces: ["org", "admin", "marketing", "onboarding"],
  },
  {
    name: "open-dashboards",
    description: "Open the account's dashboards list.",
    surfaces: ["org"],
  },
  {
    name: "open-dashboard-builder",
    description: "Open the dashboard builder to create a new dashboard.",
    surfaces: ["org"],
  },
  {
    name: "open-studio",
    description: "Open Creative Studio.",
    surfaces: ["org"],
  },
  {
    name: "open-billing",
    description: "Open billing & credits.",
    surfaces: ["org"],
  },
  {
    // Missing until now, while the assistant offered it anyway: the model has
    // every reason to think "open assets" exists (the asset library is a first
    // class surface it has fifteen tools for), so it emitted the action, the
    // widget announced "Opening Open Assets…", and dispatch found no handler.
    name: "open-assets",
    description: "Open the account's asset library.",
    surfaces: ["org", "admin"],
  },
  // Read-only UI control — point the user at a control ON the current page. Safe
  // and reversible (no state change), so no confirm. The `target` in `data` is a
  // `data-ai-target` id from the page's `uiTargets` catalog (see ui-control.ts).
  {
    name: "highlight",
    description:
      "Pulse a ring around an on-page control (by its data-ai-target id in data.target) and scroll it into view. Read-only.",
    surfaces: ["org", "admin", "marketing", "onboarding"],
  },
  {
    name: "scroll-to",
    description:
      "Scroll an on-page control (data.target) into view without highlighting. Read-only.",
    surfaces: ["org", "admin", "marketing", "onboarding"],
  },
  {
    name: "focus-field",
    description:
      "Focus an on-page input/field (data.target) so the user can type. Read-only.",
    surfaces: ["org", "admin", "marketing", "onboarding"],
  },
  // State-changing UI control — ALWAYS confirm-gated (the widget forces a Confirm
  // step before dispatch). `target` is a data-ai-target id; `fill` also needs
  // `value` in data.
  {
    name: "fill",
    description:
      "Type a value into an on-page field (data.target id + data.value). Changes state — ALWAYS include a confirm.",
    surfaces: ["org", "admin", "marketing", "onboarding"],
  },
  {
    name: "click",
    description:
      "Click an on-page button/control (data.target id). Changes state — ALWAYS include a confirm.",
    surfaces: ["org", "admin", "marketing", "onboarding"],
  },
] as const;

/**
 * Account-relative path each named standard action opens. Single source of truth
 * shared by `createHostActions` (which navigates the parent app there) and the
 * widget's advanced view (which navigates the iframe there via `resolveActionPath`),
 * so the two can't drift.
 */
export const STANDARD_ACTION_PATHS: Record<string, string> = {
  "open-dashboards": "/dashboards",
  "open-dashboard-builder": "/dashboards/new/edit",
  "open-studio": "/studio",
  "open-billing": "/billing",
  "open-assets": "/assets",
};

/** Human confirmation text for each named standard action (post-navigation). */
const STANDARD_ACTION_DONE: Record<string, string> = {
  "open-dashboards": "Opened dashboards",
  "open-dashboard-builder": "Opened the dashboard builder",
  "open-studio": "Opened Studio",
  "open-billing": "Opened billing",
  "open-assets": "Opened assets",
};

/**
 * Is this action PURE NAVIGATION — moving the user to a page and nothing else?
 *
 * The auto-navigate option promises exactly this and nothing more. It used to
 * decide by asking whether the model had attached a `confirm` to its own action,
 * which put the safety decision in the model's hands: an action it emitted
 * without one ran instantly and unattended. `research-brand` is confirm-less in
 * that sense and spends metered web-search credit, so "auto-navigate" could buy
 * things. Navigation is a closed set — enumerate it, and let everything else
 * wait for the user to press the button.
 */
export function isNavigationAction(name: string): boolean {
  return name === "navigate" || name in STANDARD_ACTION_PATHS;
}

/** Said instead of "Opened …" when the user is ALREADY on that page. */
const STANDARD_ACTION_ALREADY: Record<string, string> = {
  "open-dashboards": "Already on dashboards",
  "open-dashboard-builder": "Already in the dashboard builder",
  "open-studio": "Already in Studio",
  "open-billing": "Already on billing",
  "open-assets": "Already on assets",
};

/**
 * Are we already looking at this route?
 *
 * Navigating to the page you are standing on is not a helpful action, it is
 * noise — and worse, it reads as a broken one, because nothing visibly happens.
 * Compared on pathname only: a query string or hash is a filter or an anchor
 * within the same page, not a different destination.
 */
function alreadyThere(path: string): boolean {
  if (typeof window === "undefined") return false;
  const strip = (p: string): string =>
    p.length > 1 && p.endsWith("/") ? p.slice(0, -1) : p;
  return strip(window.location.pathname) === strip(path);
}

export type HostActionHandler = (
  data: Record<string, string>
) => Promise<string | void> | string | void;

export interface HostActionsConfig {
  /** Account scope for the `/accounts/:id/...` standard routes (org/admin). */
  accountId?: string;
  /** The host's router push (in-app SPA navigation). */
  navigate: (path: string) => void;
  /** App-specific actions, merged over the standard set (can override). */
  handlers?: Record<string, HostActionHandler>;
}

/**
 * Build the `onWidgetAction(name, data)` handler from the standard allow-listed
 * actions + any app-specific handlers. Pass to `createAiChatWidget`.
 */
export function createHostActions(
  cfg: HostActionsConfig
): (action: string, data: Record<string, string>) => Promise<string | void> {
  const base = cfg.accountId ? `/accounts/${cfg.accountId}` : "";
  const standard: Record<string, HostActionHandler> = {
    navigate: (data) => {
      if (data.path) {
        if (alreadyThere(data.path)) return "Already there";
        cfg.navigate(data.path);
        return "Opened";
      }
    },
  };
  // The named "open-*" actions all resolve to a fixed account-relative path (see
  // STANDARD_ACTION_PATHS) — generate their handlers so the paths live in ONE
  // place the advanced-view resolver also reads.
  for (const [name, path] of Object.entries(STANDARD_ACTION_PATHS)) {
    standard[name] = () => {
      const target = `${base}${path}`;
      if (alreadyThere(target))
        return STANDARD_ACTION_ALREADY[name] ?? "Already there";
      cfg.navigate(target);
      return STANDARD_ACTION_DONE[name] ?? "Opened";
    };
  }
  const map: Record<string, HostActionHandler> = {
    ...standard,
    ...(cfg.handlers ?? {}),
  };
  return async (action, data) => {
    // Read-only UI control (highlight / scroll-to / focus-field) works on EVERY
    // surface via the pure-DOM twin — no per-app wiring, no confirm (reversible).
    if (isUiControlAction(action)) {
      const ok = runUiControl(action, data.target ?? "");
      // A target that isn't on this page is a FAILURE. Returning undefined
      // resolved the widget's promise and rendered a tick, so "show me where"
      // ticked green while nothing was highlighted.
      if (!ok) throw new Error(`no such control on this page: ${data.target}`);
      return "Shown on the page";
    }
    // State-changing UI control (fill / click). The widget has already forced a
    // Confirm step before we get here (renderAction), so this runs post-approval.
    if (isOperateAction(action)) {
      const ok = runOperateAction(action, data.target ?? "", data.value);
      // Same as above, and worse here: the user APPROVED this one. Telling them
      // a fill or a click succeeded when the control was never found means they
      // walk away believing a value was entered.
      if (!ok) throw new Error(`no such control on this page: ${data.target}`);
      return "Done on the page";
    }
    const fn = map[action];
    // THROW, don't shrug. Returning undefined here resolved the widget's
    // promise, and a resolved promise is rendered as "<label> ✓" — so an action
    // this app cannot perform reported itself as done. That is how "Opening
    // Open Assets…" turned into a tick next to a page that never opened. An
    // action we do not have is a failure, and the chip must say so.
    if (!fn) throw new Error(`unsupported action: ${action}`);
    return await fn(data);
  };
}
