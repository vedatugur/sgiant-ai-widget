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
] as const;

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
        cfg.navigate(data.path);
        return "Opened";
      }
    },
    "open-dashboards": () => {
      cfg.navigate(`${base}/dashboards`);
      return "Opened dashboards";
    },
    "open-dashboard-builder": () => {
      cfg.navigate(`${base}/dashboards/new/edit`);
      return "Opened the dashboard builder";
    },
    "open-studio": () => {
      cfg.navigate(`${base}/studio`);
      return "Opened Studio";
    },
    "open-billing": () => {
      cfg.navigate(`${base}/billing`);
      return "Opened billing";
    },
  };
  const map: Record<string, HostActionHandler> = {
    ...standard,
    ...(cfg.handlers ?? {}),
  };
  return async (action, data) => {
    const fn = map[action];
    if (!fn) return;
    return await fn(data);
  };
}
