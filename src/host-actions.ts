/**
 * Shared host protocol for AYCA — the ONE definition of the page context the
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
}

/** Build a standard PageContext from a path (derives `page`, caps the trail). */
export function makePageContext(
  app: AppSurface,
  path: string,
  recentPages: string[] = []
): PageContext {
  const page = path.split("/").filter(Boolean).slice(-1)[0] || "home";
  return { app, path, page, recentPages: recentPages.slice(-8) };
}

/** Machine-readable catalog of the standard actions — feed (filtered by the
 *  account's navigationEnabled + role) into the model's turn context so AYCA
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
