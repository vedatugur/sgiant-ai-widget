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
// Type-only: erased at build, so this stays a zero-runtime-dependency module.
import type { Locale } from "./limits";

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
   *  or an org suffix like "/assets"). */
  path: string;
  /** Human title shown to the user / used by the model. */
  title: string;
  /** One-line "what this page is for". */
  purpose: string;
  /** Key sections/areas on the page (so Copilot can describe its structure). */
  sections?: string[];
  /** Allow-listed action name(s) that open/operate this page, when the host
   *  prefers a named action over a raw path (e.g. org's "open-dashboards"). */
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

/**
 * The locale segments the site actually serves.
 *
 * "Any two lowercase letters" is NOT a locale test: `/ai` is a real marketing
 * page, and treating its first segment as a locale rewrote that entry to `/`,
 * which then matched every path with the same segment count. Mirrors
 * apps/marketing/src/i18n/config.ts; the platform `Locale` union types it, so
 * a locale that is renamed there fails to compile here.
 */
const LOCALE_SEGMENTS = ["en", "tr"] as const satisfies readonly Locale[];

function isLocaleSegment(seg: string): boolean {
  return (LOCALE_SEGMENTS as readonly string[]).includes(seg);
}

/** Normalize a path for manifest matching: drop a leading locale segment
 *  (marketing "/en/network" → "/network") and any trailing slash. */
function normalizePath(path: string): string {
  let p = path.replace(/\/+$/, "") || "/";
  const m = p.match(/^\/([a-z]{2})(\/|$)/);
  if (m && isLocaleSegment(m[1])) p = p.slice(m[1].length + 1) || "/";
  return p;
}

/** Manifest entries are ours and locale-neutral by contract (see
 *  `PageManifestEntry.path`), so they get a trailing-slash trim and nothing
 *  else — no locale strip, no decoding. */
function entrySegments(path: string): string[] {
  return path.replace(/\/+$/, "").split("/").filter(Boolean);
}

/**
 * Percent-decode until the result stops changing, so a doubly-encoded segment
 * (`%252e`) is judged by what it finally says rather than by its first layer.
 * Malformed encoding, and nesting past any plausible depth, are refusals —
 * there is no legitimate route we would be rejecting.
 */
function decodeFully(raw: string): string | null {
  let cur = raw;
  for (let i = 0; i < 6; i++) {
    if (!cur.includes("%")) return cur;
    let next: string;
    try {
      next = decodeURIComponent(cur);
    } catch {
      return null;
    }
    if (next === cur) return cur;
    cur = next;
  }
  return null;
}

/**
 * Decode ONE raw path segment into the thing a browser will finally resolve it
 * to, or null when it is not a plain segment at all.
 *
 * This is the half of the gate that has to come FIRST. Judging the raw spelling
 * is a blocklist — it refuses `..` and admits `%2e%2e`, `%2E%2E`, `.%2e` and
 * `%252e%252e`, every one of which the URL parser resolves as a double-dot
 * segment (or resolves after one more decode hop on the server).
 */
function decodeSegment(raw: string): string | null {
  const decoded = decodeFully(raw);
  if (decoded === null) return null;
  // Compatibility forms fold into ASCII: U+FF0E FULLWIDTH FULL STOP twice is
  // `..` after NFKC, and U+FF0F folds to a solidus.
  const seg = decoded.normalize("NFKC");
  // A segment that decodes into a SEPARATOR smuggled structure past the split:
  // `%2f` and `%5c` are both "/" once the URL is parsed.
  if (/[/\\]/.test(seg)) return null;
  // C0 controls and DEL. Tab/LF/CR matter most — the URL parser STRIPS them, so
  // `.%09.` arrives as `..`.
  if (/[\u0000-\u001f\u007f]/.test(seg)) return null;
  return seg;
}

/**
 * Decode an AI-supplied path into the segments the browser will actually
 * resolve, or null if it is not a root-relative in-app path at all.
 *
 * Decode first, then validate. The caller matches what comes back against the
 * manifest, which is an ALLOW-list; nothing downstream re-inspects spellings.
 */
function navPathSegments(path: unknown): string[] | null {
  if (typeof path !== "string") return null;
  // The URL parser strips leading/trailing C0-and-space before it parses.
  if (path !== path.trim()) return null;
  if (!path.startsWith("/")) return null;
  const bare = path.split(/[?#]/)[0] ?? "";
  // A backslash is a path separator to the URL parser, so `/\evil.example.com`
  // is protocol-relative. No route needs one.
  if (bare.includes("\\")) return null;
  // Protocol-relative (`//host`), or an empty interior segment.
  if (bare.includes("//")) return null;
  const out: string[] = [];
  for (const raw of bare.split("/")) {
    if (!raw) continue; // the leading "/" and one trailing "/"
    const seg = decodeSegment(raw);
    if (seg === null) return null;
    // Dot segments are relative MOVES, not names. The host prefixes the account
    // after this runs, so `/reports/../../accounts/<them>/x` climbs straight
    // back out of the account it was just given.
    if (seg === "." || seg === "..") return null;
    out.push(seg);
  }
  if (out.length && isLocaleSegment(out[0])) out.shift();
  return out;
}

/**
 * Find the manifest entry that best describes the current path — the entry
 * whose `path` is the longest suffix of the (normalized) current path.
 *
 * A segment written as `:name` matches ANY one segment, so a detail page can
 * be declared once ("/reports/:reportId") instead of being undescribable.
 * Without this a concrete `/reports/<uuid>` matched nothing at all — not even
 * the list page above it, since the uuid is a further segment and the
 * comparison was a plain suffix test — so the assistant silently lost all
 * knowledge of which page the user was standing on.
 *
 * Matching is done per SEGMENT rather than by string, because a suffix test
 * cannot tell a parameter from a literal. The longest match still wins, which
 * keeps a specific entry ahead of a general one.
 */
export function matchManifest(
  path: string,
  manifest: PageManifestEntry[]
): PageManifestEntry | undefined {
  const segs = (p: string): string[] => p.split("/").filter(Boolean);
  const pathSegs = segs(normalizePath(path));
  let best: PageManifestEntry | undefined;
  let bestLen = -1;
  for (const e of manifest) {
    const entrySegs = segs(e.path);
    // The root entry ("/") describes only the root.
    if (!entrySegs.length) {
      if (!pathSegs.length && bestLen < 0) {
        best = e;
        bestLen = 0;
      }
      continue;
    }
    if (entrySegs.length > pathSegs.length) continue;
    const off = pathSegs.length - entrySegs.length;
    const hit = entrySegs.every(
      (seg, i) => seg.startsWith(":") || seg === pathSegs[off + i]
    );
    if (hit && entrySegs.length > bestLen) {
      best = e;
      bestLen = entrySegs.length;
    }
  }
  return best;
}

/**
 * Is this AI-supplied path one of the pages the manifest actually DECLARES?
 *
 * The manifest is the whole security surface for navigation, and until now it
 * was only ever advice: it went into the prompt as "Pages you can open (use
 * ONLY these to navigate)" and nothing checked the answer. The only real gate
 * was a shape test — starts with one `/`, not `//` or `/\` — which every
 * cross-tenant path also passes. `/accounts/<someone-else>/settings` is a
 * root-relative in-app route by that definition, and `orgPath` returns an
 * already-`/accounts/`-prefixed path untouched, so a model that emitted one got
 * it loaded into the deliberately un-sandboxed, same-origin advanced frame.
 *
 * Matched from the START, per segment, unlike `matchManifest` — which matches a
 * SUFFIX because it is handed a full SPA route and has to find the entry that
 * describes it. Here the input is the account-relative path the model wrote, so
 * the manifest's namespace has to be its PREFIX or the check is no gate at all:
 * a suffix test admits `/accounts/<someone-else>/dashboards` on the strength of
 * the `/dashboards` entry. Extra trailing segments ARE allowed — that is how a
 * detail page under a declared list ("/reports/<uuid>") stays reachable — and
 * `:param` segments match any one segment, as in the manifest itself.
 *
 * DECODE FIRST, THEN VALIDATE. The first cut of this refused a literal `..`
 * segment by comparing the raw spelling, which is a blocklist — and a blocklist
 * of shapes is exactly what produced the hole above. `%2e%2e`, `%2E%2E`, `.%2e`
 * and `%252e%252e` all survive a literal comparison and all mean `..` by the
 * time the URL is parsed, so `/reports/%2e%2e/%2e%2e/%2e%2e/accounts/<them>/x`
 * walked straight through it and into the frame. `navPathSegments` resolves the
 * path to what the browser will actually see — percent-decoded to a fixed
 * point, NFKC-folded, backslashes and protocol-relative forms refused — and
 * only then is each segment matched against the manifest.
 *
 * A dot segment is refused rather than resolved: the host prefixes the account
 * AFTER this runs, so resolving here would judge a different path than the one
 * the browser resolves, and no real route contains one.
 *
 * NO MANIFEST MEANS NO NAVIGATION. A host that declares no pages has declared
 * nothing the model may open, and falling back to "any root-relative path" here
 * would restore exactly the hole this closes.
 */
export function isKnownNavTarget(
  path: unknown,
  targets: readonly { path?: string }[] | undefined | null
): path is string {
  const segs = navPathSegments(path);
  if (segs === null) return false;
  if (!targets?.length) return false;
  for (const t of targets) {
    if (!t.path) continue;
    const entry = entrySegments(t.path);
    // The root entry describes the root, never everything beneath it.
    if (!entry.length) {
      if (!segs.length) return true;
      continue;
    }
    if (entry.length > segs.length) continue;
    if (entry.every((s, i) => s.startsWith(":") || s === segs[i])) return true;
  }
  return false;
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

// NOTE: `formatPageContext` and `STANDARD_ACTIONS` lived here and were deleted
// 2026-08-05 with zero callers. Both were client-side twins of things that moved
// server-side: prompt assembly now runs in apps/api (formatPageContextHint in
// lib/page-context.ts) and the permitted action set is stated in
// packages/ai-core/src/prompt.ts. Don't rebuild a client catalogue — it drifted
// from the live one (12 actions vs 5) the whole time it sat unused.

/**
 * Account-relative path each named standard action opens. Single source of truth
 * shared by `createHostActions` (which navigates the parent app there) and the
 * widget's advanced view (which navigates the iframe there via `resolveActionPath`),
 * so the two can't drift.
 */
export const STANDARD_ACTION_PATHS: Record<string, string> = {
  "open-dashboards": "/dashboards",
  "open-dashboard-builder": "/dashboards/new/edit",
  "open-billing": "/billing",
  "open-assets": "/assets",
};

/** Human confirmation text for each named standard action (post-navigation). */
const STANDARD_ACTION_DONE: Record<string, string> = {
  "open-dashboards": "Opened dashboards",
  "open-dashboard-builder": "Opened the dashboard builder",
  "open-billing": "Opened billing",
  "open-assets": "Opened assets",
};

/**
 * Is this action PURE NAVIGATION — moving the user to a page and nothing else?
 *
 * The auto-navigate option promises exactly this and nothing more. It used to
 * decide by asking whether the model had attached a `confirm` to its own action,
 * which put the safety decision in the model's hands: an action it emitted
 * without one ran instantly and unattended — and a confirm-less action can
 * spend metered credit, so "auto-navigate" could buy things. Navigation is a
 * closed set — enumerate it, and let everything else wait for the user to
 * press the button.
 */
export function isNavigationAction(name: string): boolean {
  // `show-assets` is navigation too — it opens a folder/file and nothing else,
  // buys nothing and changes nothing. It is listed explicitly rather than via
  // STANDARD_ACTION_PATHS because it carries a target, so it has no fixed path.
  return (
    name === "navigate" ||
    name === "show-assets" ||
    name in STANDARD_ACTION_PATHS
  );
}

/** Said instead of "Opened …" when the user is ALREADY on that page. */
const STANDARD_ACTION_ALREADY: Record<string, string> = {
  "open-dashboards": "Already on dashboards",
  "open-dashboard-builder": "Already in the dashboard builder",
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
/** Where an account-relative path really lands, mirroring the hosts' own
 *  `orgPath`/`adminPath`: already absolute stays put, anything else is prefixed
 *  with the account. Kept in step with those two by construction — they are
 *  idempotent for a path that already carries the prefix. */
function resolveTarget(base: string, path: string): string {
  return path.startsWith("/accounts/") ? path : `${base}${path}`;
}

function alreadyThere(path: string): boolean {
  if (typeof window === "undefined") return false;
  const strip = (p: string): string =>
    p.length > 1 && p.endsWith("/") ? p.slice(0, -1) : p;
  // The QUERY has to count, not just the path (#134). "Open the Rooms folder"
  // is `/assets?folder=…`: judged on pathname alone that is "already there"
  // whenever the user happens to be on /assets, so the one navigation most
  // likely to be requested was the one guaranteed to be refused.
  const [targetPath = "", targetQuery = ""] = path.split("?");
  if (strip(window.location.pathname) !== strip(targetPath)) return false;
  const current = new URLSearchParams(window.location.search);
  const wanted = new URLSearchParams(targetQuery);
  for (const [k, v] of wanted) if (current.get(k) !== v) return false;
  return true;
}

export type HostActionHandler = (
  data: Record<string, string>
) => Promise<string | void> | string | void;

export interface HostActionsConfig {
  /** Account scope for the `/accounts/:id/...` standard routes (org/admin). */
  accountId?: string;
  /** The host's router push (in-app SPA navigation). */
  navigate: (path: string) => void;
  /** Point a MOUNTED asset library at a folder/asset. Supplied by the host as
   *  `showAssetsAt` from @sgiant/assets — the router push alone cannot reach a
   *  library that is already on screen. */
  showAssets?: (t: {
    folderId?: string | null;
    assetId?: string | null;
  }) => void;
  /** App-specific actions, merged over the standard set (can override). */
  handlers?: Record<string, HostActionHandler>;
  /**
   * The page manifest this host declares — the SAME catalogue the model is
   * offered as "Pages you can open". A model-authored `navigate` path is
   * checked against it (see `isKnownNavTarget`) before the router is touched,
   * so the list stops being advice and becomes the gate. A host that passes
   * none can navigate nowhere.
   */
  pages?: readonly { path?: string }[];
  /**
   * The host's translator, for the CHIP OUTCOMES below.
   *
   * Every visible string the widget itself renders goes through
   * `WIDGET_LABELS`, which is what lets a host translate the chrome. These
   * outcomes were plain English record literals returned straight into the chip
   * text, so a Turkish session read "Opened dashboards" and "Already there" in
   * the middle of a Turkish conversation. Optional so a host that passes none
   * keeps today's English.
   */
  t?: (key: string, defaultValue: string) => string;
}

/**
 * Build the `onWidgetAction(name, data)` handler from the standard allow-listed
 * actions + any app-specific handlers. Pass to `createAiChatWidget`.
 */
export function createHostActions(
  cfg: HostActionsConfig
): (action: string, data: Record<string, string>) => Promise<string | void> {
  const base = cfg.accountId ? `/accounts/${cfg.accountId}` : "";
  const tr = cfg.t ?? ((_k: string, d: string) => d);
  const standard: Record<string, HostActionHandler> = {
    // Deep-link INTO the library: a folder and/or one file's preview.
    //
    // Two steps on purpose. If the user is elsewhere, the host router has to
    // open /assets first; if they are already there, a same-route push fires no
    // popstate and does not remount, so the library would never hear it — hence
    // showAssetsAt, which writes the query AND announces it (#134).
    "show-assets": (data) => {
      const folderId = data.folderId || null;
      const assetId = data.assetId || null;
      if (!folderId && !assetId) return;
      const query = new URLSearchParams();
      if (folderId) query.set("folder", folderId);
      if (assetId) query.set("asset", assetId);
      const path = `${STANDARD_ACTION_PATHS["open-assets"]}?${query}`;
      if (!alreadyThere(resolveTarget(base, path))) cfg.navigate(path);
      cfg.showAssets?.({ folderId, assetId });
      return assetId
        ? tr("aiAssistant.action.actionOpenedFile", "Opened the file")
        : tr("aiAssistant.action.actionOpenedFolder", "Opened the folder");
    },
    navigate: (data) => {
      if (data.path) {
        // The manifest decides, not the path's shape. Floating mode hands the
        // path to the host's own router, which is the same session and the same
        // origin as the advanced frame — so it needs the same gate, refused out
        // loud rather than by returning undefined (an undefined return resolves
        // as success and the chip ticks green over a path we declined).
        if (!isKnownNavTarget(data.path, cfg.pages))
          return tr(
            "aiAssistant.action.actionNotAPage",
            "That is not a page I can open"
          );
        // Compare what the host will ACTUALLY open, not what the model wrote.
        // The AI emits account-relative paths ("/assets"); the host prefixes
        // the account before routing. Testing the bare path against the real
        // location never matched, so "you are already here" could not fire on
        // the one action most likely to be aimed at the current page.
        if (alreadyThere(resolveTarget(base, data.path)))
          return tr("aiAssistant.action.actionAlreadyThere", "Already there");
        cfg.navigate(data.path);
        return tr("aiAssistant.action.actionOpened", "Opened");
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
        return tr(
          `aiAssistant.action.actionAlready_${name.replace(/-/g, "_")}`,
          STANDARD_ACTION_ALREADY[name] ?? "Already there"
        );
      cfg.navigate(target);
      return tr(
        `aiAssistant.action.actionDone_${name.replace(/-/g, "_")}`,
        STANDARD_ACTION_DONE[name] ?? "Opened"
      );
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
      return tr("aiAssistant.action.actionShownOnPage", "Shown on the page");
    }
    // State-changing UI control (fill / click). The widget has already forced a
    // Confirm step before we get here (renderAction), so this runs post-approval.
    if (isOperateAction(action)) {
      const ok = runOperateAction(action, data.target ?? "", data.value);
      // Same as above, and worse here: the user APPROVED this one. Telling them
      // a fill or a click succeeded when the control was never found means they
      // walk away believing a value was entered.
      if (!ok) throw new Error(`no such control on this page: ${data.target}`);
      return tr("aiAssistant.action.actionDoneOnPage", "Done on the page");
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
