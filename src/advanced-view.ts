import { el } from "./dom";
import { PREFIX } from "./prefix";
import { ICON_CHEVRON_R } from "./icons";
import { readItem, writeFlag, writeItem } from "./storage";
import { isSafeFrameUrl, isSafeRelPath, gateNavigationTarget } from "./safe-url";
import { shouldAutoNavigate, shouldCollapseNarration } from "./pane-follow";
import { isOperateAction, isUiControlAction } from "./ui-control";
import {
  createFrameTransport,
  type FrameTransport,
  type BridgeAction,
} from "sgiant-ai-agent-bridge";
import type { AiChatWidgetOptions } from "./widget";
import type { WidgetLabels } from "./labels";
import type { WidgetOptionWords } from "./labels-tr";

/**
 * Advanced view (audit F133: moved out of `createAiChatWidget` unchanged).
 *
 * A full-screen split: chat on the left, the app in an <iframe> on the right
 * that AYCA drives via the agent bridge. Navigation moves the FRAME; on-page
 * actions (highlight/fill/click) run INSIDE the frame over postMessage, so they
 * hit the app the user is watching — not the parent shell behind the overlay.
 *
 * WHAT STAYS IN THE WIDGET, and why. `advanced` itself: the automation menu,
 * `send` and the action cards read it too, and they are built before this.
 * So it is read and written through `getAdvanced` / `setAdvanced`, the same
 * getter rule every factory here follows for state that changes after setup.
 * The same goes for the wide view (`getExpanded` / `setExpanded`) and the
 * allow-list of pages (`getKnownNavTargets`).
 */
export interface AdvancedViewContext {
  L: (
    key: keyof WidgetLabels,
    params?: Record<string, string | number>,
  ) => string;
  ownWords: WidgetOptionWords;
  panel: HTMLElement;
  pane: HTMLElement;
  /** The header's advanced-view toggle; null when the host gave no URL. */
  advancedBtn: HTMLElement | null;
  ns: string;
  scoped: (key: string) => string;
  scrollDown: (force?: boolean) => void;
  /** Drop the floating drag position (advanced view is a CSS layout). */
  toCorner: () => void;
  /** Put the floating drag position back on exit. */
  restoreFloatingPos: () => void;
  getAdvanced: () => boolean;
  setAdvanced: (v: boolean) => void;
  getExpanded: () => boolean;
  setExpanded: (v: boolean) => void;
  getKnownNavTargets: () => Array<{ path?: string }>;
  refreshNavTargets: () => Promise<void>;
  /** Whether the user confirmed this job in THIS session (job cards). */
  hasUserConfirmed: (key: string) => boolean;
  opts: AiChatWidgetOptions;
}

export function createAdvancedView(ctx: AdvancedViewContext) {
  const {
    L,
    ownWords,
    panel,
    pane,
    advancedBtn,
    ns,
    scoped,
    scrollDown,
    toCorner,
    getAdvanced,
    setAdvanced,
    getExpanded,
    setExpanded,
    getKnownNavTargets,
    refreshNavTargets,
    hasUserConfirmed,
    opts,
  } = ctx;
  let advancedFull = false;
  let paneCollapsed = false;
  let transport: FrameTransport | null = null;
  let advFrame: HTMLIFrameElement | null = null;
  let frameUrlLabel: HTMLElement | null = null;
  let collapseBtnEl: HTMLButtonElement | null = null;
  const advKey = opts.persistKey
    ? scoped(`${ns}:adv:${opts.persistKey}`)
    : "";
  const rememberAdvanced = (): void => {
    writeFlag(advKey, getAdvanced());
  };

  const setFrameUrlLabel = (url: string): void => {
    if (!frameUrlLabel) return;
    let text = url;
    try {
      const u = new URL(url, location.href);
      text = u.pathname + u.search;
    } catch {
      /* keep raw */
    }
    frameUrlLabel.textContent = text;
  };

  /**
   * THE PATH THE WIDGET LAST ASKED THE FRAME TO SHOW.
   *
   * Compared against where the frame ACTUALLY is on every load, which is how
   * "the user has driven the frame themselves" is detected: the pane hosts our
   * own app, so a click inside it navigates the iframe without going through
   * `navigateFrame` at all. Same-origin by construction (`isSafeFrameUrl`), so
   * the location is readable — but still guarded, because a frame mid-load has
   * no document to ask.
   */
  let frameRequestedPath: string | null = null;
  /** True once the frame has gone somewhere the widget did not send it. Blocks
   *  auto-navigation, so a report finishing never yanks a reader off the page
   *  they chose. */
  let frameUserDriven = false;

  const framePath = (): string | null => {
    try {
      return advFrame?.contentWindow?.location?.pathname ?? null;
    } catch {
      // Cross-origin should be impossible here, but a frame that has not
      // committed a document yet can also throw. Unknown, not "user drove it".
      return null;
    }
  };

  /** Point the frame at a full URL (a full document load — the embedded app boots
   *  at that route and re-mounts its agent). */
  const navigateFrame = (url: string): void => {
    if (!advFrame) return;
    // Untrusted target (cross-origin, protocol-relative or a `javascript:`
    // payload smuggled through a model-authored path) — refuse silently.
    if (!isSafeFrameUrl(url)) return;
    try {
      frameRequestedPath = new URL(url, location.origin).pathname;
    } catch {
      frameRequestedPath = null;
    }
    advFrame.src = url;
    setFrameUrlLabel(url);
  };

  /**
   * Follow a long operation into the pane — ONCE, and never over the user.
   *
   * A report tells the reader to "watch it build" and then leaves the frame
   * wherever it was, so watching it meant clicking. This does the click. Four
   * conditions, and each one is a way this could be obnoxious instead of
   * helpful:
   *
   *  - advanced view only. In floating mode there is no pane to move, and
   *    navigating the whole PAGE out from under someone because a background
   *    job started is not the same feature.
   *  - only work the user confirmed in THIS session (`userConfirmedWork`).
   *    Tracked jobs are restored from localStorage and re-discovered from the
   *    server listing, so a card can appear for an import another tab (or
   *    another device) started; `openAdvanced` clears `autoNavigated` for a
   *    fresh session, and without this condition the first poll after opening
   *    the pane would send it to that job's page.
   *  - not if the user has driven the frame since (`frameUserDriven`). They
   *    chose that page; a job finishing is not permission to leave it.
   *  - once per operation (`autoNavigated`). A poll runs every couple of
   *    seconds; re-navigating on each one would reload the page continuously
   *    and make it unreadable — which is the exact opposite of watching it
   *    build.
   */
  const autoNavigated = new Set<string>();
  const autoNavigateFrame = (key: string, path: string): void => {
    if (!advFrame || !opts.getAdvancedUrl) return;
    if (
      !shouldAutoNavigate({
        advanced: getAdvanced(),
        canNavigate: true,
        userConfirmedThisSession: hasUserConfirmed(key),
        userDriven: frameUserDriven,
        alreadyFollowed: autoNavigated.has(key),
        path,
        currentPath: framePath() ?? frameRequestedPath,
      })
    ) {
      return;
    }
    autoNavigated.add(key);
    navigateFrame(opts.getAdvancedUrl(path));
  };

  /** Is the pane already showing this path? Drives the narration collapse —
   *  see `renderJobCard`. Compared on pathname: a query string is a filter
   *  within the same page, not a different destination. */
  const frameShowing = (path: string | null | undefined): boolean =>
    shouldCollapseNarration({
      advanced: getAdvanced(),
      livePath: path,
      currentPath: framePath() ?? frameRequestedPath,
    });

  // Collapse the app pane to a thin strip (not display:none — the strip keeps the
  // toggle visible so it can be re-expanded). Also refreshes the toggle's label.
  const setPaneCollapsed = (v: boolean): void => {
    paneCollapsed = v;
    panel.classList.toggle(`${PREFIX}-pane-collapsed`, v);
    if (collapseBtnEl) {
      const label = v
        ? opts.expandPaneLabel || ownWords.showPane
        : opts.collapsePaneLabel || ownWords.hidePane;
      collapseBtnEl.setAttribute("aria-label", label);
      collapseBtnEl.title = label;
    }
  };

  const buildFrame = (): void => {
    pane.innerHTML = "";
    const bar = el("div", `${PREFIX}-pane-bar`);
    const collapseBtn = el(
      "button",
      `${PREFIX}-icon ${PREFIX}-pane-collapse`
    ) as HTMLButtonElement;
    collapseBtn.type = "button";
    collapseBtn.setAttribute(
      "aria-label",
      opts.collapsePaneLabel || ownWords.hidePane
    );
    collapseBtn.title = opts.collapsePaneLabel || ownWords.hidePane;
    collapseBtn.innerHTML = ICON_CHEVRON_R;
    collapseBtn.addEventListener("click", () =>
      setPaneCollapsed(!paneCollapsed)
    );
    collapseBtnEl = collapseBtn;
    frameUrlLabel = el("div", `${PREFIX}-pane-url`);
    bar.append(collapseBtn, frameUrlLabel);
    const frame = el("iframe", `${PREFIX}-pane-frame`) as HTMLIFrameElement;
    frame.setAttribute("title", opts.advancedLabel || ownWords.advanced);
    // No sandbox: the framed page is our OWN app and needs full capability
    // (same-origin session cookies, storage, popups). For untrusted third-party
    // targets an embedder would add a sandbox with explicit allows.
    // The frame sits in a padded body so the driven app reads as an inset,
    // rounded "screen" with breathing room rather than a flush edge-to-edge slab.
    // THE USER CAN DRIVE THIS FRAME WITHOUT US. It hosts our own app, so a
    // click inside it navigates the iframe directly — `navigateFrame` never
    // hears about it. Comparing where it LANDED against where we last asked it
    // to go is the only honest signal, and it is what stops a finishing job
    // from yanking someone off a page they chose to open.
    frame.addEventListener("load", () => {
      const here = framePath();
      if (!here) return;
      setFrameUrlLabel(here);
      if (frameRequestedPath === null) {
        // We never asked for anything and it moved: the user did.
        frameUserDriven = true;
        return;
      }
      if (here !== frameRequestedPath) frameUserDriven = true;
    });
    const body = el("div", `${PREFIX}-pane-body`);
    body.append(frame);
    pane.append(bar, body);
    advFrame = frame;
    transport = createFrameTransport(frame, {
      targetOrigin: opts.advancedOrigin || location.origin,
    });
  };

  const teardownFrame = (): void => {
    transport?.destroy();
    transport = null;
    advFrame = null;
    frameUrlLabel = null;
    collapseBtnEl = null;
    disposePaneWidget();
    pane.innerHTML = "";
  };

  /* ------------------------------------------------------------------ *
   * THE PANE IS A UNION: a ROUTE, or a WIDGET.
   *
   * It could only ever be `<iframe src>`, so anything the assistant computed —
   * a chart, a proposed dashboard, a preview — had to become a real route
   * before it could be shown at full size. The one that mattered most is the
   * ordinary case: "chart my revenue by channel" produced a picture squeezed
   * into a 368px chat column while a whole half-screen sat next to it showing
   * a page nobody was reading.
   *
   * EITHER/OR, not a layering. The frame is torn down when a widget takes the
   * pane and rebuilt when the route comes back — leaving a live iframe behind
   * an overlay would keep its app mounted, its polls running and its agent
   * bridge connected, invisibly.
   *
   * The widget half reuses `renderDataWidget` — the SAME host renderer the
   * chat log uses — so there is one rendering path, one validation story and no
   * second widget vocabulary. The host draws a real `<WidgetRender>` with its
   * actual data; the pane is not a picture of one.
   * ------------------------------------------------------------------ */
  let paneWidgetDispose: (() => void) | null = null;
  const disposePaneWidget = (): void => {
    const d = paneWidgetDispose;
    paneWidgetDispose = null;
    if (!d) return;
    try {
      d();
    } catch {
      /* a renderer that throws on unmount must not wedge the pane */
    }
  };

  /** True while the pane is showing a computed widget rather than a route. */
  let paneShowsWidget = false;

  const showPaneRoute = (): void => {
    if (!paneShowsWidget) return;
    paneShowsWidget = false;
    disposePaneWidget();
    buildFrame();
    if (opts.getAdvancedUrl) navigateFrame(opts.getAdvancedUrl());
  };

  /**
   * Put a computed widget in the pane. Returns false when the host wired no
   * renderer — the caller then keeps it in the chat log, which is where it went
   * before this existed.
   */
  const showPaneWidget = (
    spec: unknown,
    rows: unknown,
    comparisonRows?: unknown
  ): boolean => {
    if (!getAdvanced() || !opts.renderDataWidget) return false;
    teardownFrame();
    paneShowsWidget = true;
    const bar = el("div", `${PREFIX}-pane-bar`);
    const back = el("button", `${PREFIX}-icon`) as HTMLButtonElement;
    back.type = "button";
    // The way BACK to the page. Without it the pane is a dead end and the only
    // exit is leaving advanced view entirely.
    back.setAttribute("aria-label", L("paneBackToPage"));
    back.title = L("paneBackToPage");
    back.innerHTML = ICON_CHEVRON_R;
    back.addEventListener("click", () => showPaneRoute());
    const label = el("div", `${PREFIX}-pane-url`);
    label.textContent = L("paneShowingWidget");
    bar.append(back, label);
    const body = el("div", `${PREFIX}-pane-body`);
    const host = el("div", `${PREFIX}-pane-widget`);
    body.append(host);
    pane.append(bar, body);
    try {
      const dispose = opts.renderDataWidget(host, spec, rows, comparisonRows);
      if (dispose) paneWidgetDispose = dispose;
    } catch {
      // A renderer that throws must not leave an empty half-screen: fall back
      // to the route and let the caller put it in the log.
      showPaneRoute();
      return false;
    }
    return true;
  };

  const updateAdvancedBtn = (): void => {
    if (!advancedBtn) return;
    advancedBtn.classList.toggle(`${PREFIX}-advbtn-on`, getAdvanced());
    const label = getAdvanced()
      ? opts.exitAdvancedLabel || ownWords.exitAdvanced
      : opts.advancedLabel || ownWords.advanced;
    advancedBtn.setAttribute("aria-label", label);
    advancedBtn.title = label;
  };

  // Fullscreen — advanced view is edge-to-edge by default (the `-advanced-full`
  // class drops the max-width + margins + radius). openAdvanced sets it on;
  // closeAdvanced resets it. There is no user-facing toggle button.
  const setAdvancedFull = (v: boolean): void => {
    advancedFull = v;
    panel.classList.toggle(`${PREFIX}-advanced-full`, v);
  };

  // Draggable divider between the chat column and the app pane (advanced view).
  // Drag to resize; the width persists per host so it survives reloads; a
  // double-click resets to the default. Only active in advanced, non-collapsed.
  const advWidthKey = opts.persistKey
    ? scoped(`${ns}:advw:${opts.persistKey}`)
    : "";
  const resizer = el("div", `${PREFIX}-resizer`);
  resizer.setAttribute("role", "separator");
  resizer.setAttribute("aria-orientation", "vertical");
  const resizeLabel = opts.resizeLabel || ownWords.resize;
  resizer.setAttribute("aria-label", resizeLabel);
  resizer.title = resizeLabel;
  panel.insertBefore(resizer, pane);

  const clampChatWidth = (px: number): number => {
    const total = panel.getBoundingClientRect().width || 900;
    const max = Math.max(360, total - 360); // keep the app pane usable
    return Math.round(Math.min(Math.max(px, 320), max));
  };
  const setChatWidth = (px: number, persist: boolean): void => {
    const w = clampChatWidth(px);
    panel.style.setProperty("--aiw-chatw", `${w}px`);
    if (persist) writeItem(advWidthKey, String(w));
  };
  const restoreChatWidth = (): void => {
    const raw = readItem(advWidthKey);
    if (raw) setChatWidth(parseInt(raw, 10), false);
  };
  let resizing = false;
  const onResizeMove = (e: PointerEvent): void => {
    if (!resizing) return;
    setChatWidth(e.clientX - panel.getBoundingClientRect().left, true);
  };
  const stopResize = (): void => {
    if (!resizing) return;
    resizing = false;
    panel.classList.remove(`${PREFIX}-resizing`);
    window.removeEventListener("pointermove", onResizeMove);
    window.removeEventListener("pointerup", stopResize);
  };
  resizer.addEventListener("pointerdown", (e) => {
    if (!getAdvanced() || paneCollapsed) return;
    e.preventDefault();
    resizing = true;
    panel.classList.add(`${PREFIX}-resizing`);
    window.addEventListener("pointermove", onResizeMove);
    window.addEventListener("pointerup", stopResize);
  });
  // Double-click the divider → reset to the default width.
  resizer.addEventListener("dblclick", () => {
    panel.style.removeProperty("--aiw-chatw");
    writeItem(advWidthKey, null);
  });

  const openAdvanced = (): void => {
    if (getAdvanced() || !opts.getAdvancedUrl) return;
    setAdvanced(true);
    setPaneCollapsed(false);
    panel.classList.add(`${PREFIX}-advanced`);
    // Advanced view is a CSS-driven layout. A leftover inline drag position
    // (left/top/right:auto) would OVERRIDE that CSS, so drop the floating
    // position here; closeAdvanced restores it. Advanced always opens
    // edge-to-edge (there is no separate fullscreen toggle anymore).
    toCorner();
    setAdvancedFull(true);
    restoreChatWidth();
    // Advanced owns the full screen and IS the wide view, so the "wide" button
    // is redundant here (hidden via CSS). Drop the plain expanded size + reset
    // the button so it shows the right icon/label when advanced is exited.
    if (getExpanded()) setExpanded(false);
    buildFrame();
    // A fresh advanced session: the user has not driven anything yet, and any
    // operation that auto-navigated in a PREVIOUS session may do so again.
    frameUserDriven = false;
    autoNavigated.clear();
    navigateFrame(opts.getAdvancedUrl());
    updateAdvancedBtn();
    rememberAdvanced();
    scrollDown(true);
  };

  const closeAdvanced = (): void => {
    if (!getAdvanced()) return;
    setAdvanced(false);
    if (advancedFull) setAdvancedFull(false);
    panel.classList.remove(`${PREFIX}-advanced`, `${PREFIX}-pane-collapsed`);
    // Restore the floating drag position cleared on enter.
    ctx.restoreFloatingPos();
    teardownFrame();
    updateAdvancedBtn();
    rememberAdvanced();
    scrollDown(true);
  };

  if (advancedBtn) {
    advancedBtn.addEventListener("click", () =>
      getAdvanced() ? closeAdvanced() : openAdvanced()
    );
  }

  /**
   * The single funnel for every in-app action AYCA requests. In advanced view
   * it retargets: on-page control/operate → the iframe (via the bridge); a
   * navigation-class action → the iframe's URL. Otherwise (and for any
   * app-specific handlers) it falls back to the host's `onWidgetAction`.
   */
  const dispatchAction = async (
    name: string,
    data: Record<string, string>
  ): Promise<string | void> => {
    // Every navigation — frame or host router — goes through the one gate.
    // It THROWS on refusal, which is what makes the chip go red instead of
    // ticking green over a path we declined.
    if (name === "navigate")
      await gateNavigationTarget(
        data.path,
        getKnownNavTargets,
        refreshNavTargets
      );
    if (getAdvanced() && transport) {
      if (isUiControlAction(name) || isOperateAction(name)) {
        const r = await transport.act(name as BridgeAction, {
          target: data.target ?? "",
          ...(data.value !== undefined ? { value: data.value } : {}),
        });
        return r.ok
          ? L("actionShownOnPage")
          : r.message || L("actionPageFailed");
      }
      const candidate =
        name === "navigate"
          ? (data.path ?? null)
          : (opts.resolveActionPath?.(name, data) ?? null);
      // Only root-relative in-app routes may be handed to `getAdvancedUrl`.
      const relPath = isSafeRelPath(candidate) ? candidate : null;
      if (relPath != null && opts.getAdvancedUrl) {
        navigateFrame(opts.getAdvancedUrl(relPath));
        return L("actionOpened");
      }
    }
    return opts.onWidgetAction ? opts.onWidgetAction(name, data) : undefined;
  };

  return {
    advKey,
    openAdvanced,
    closeAdvanced,
    teardownFrame,
    frameShowing,
    autoNavigateFrame,
    showPaneWidget,
    dispatchAction,
    /** The frame's agent while advanced view is open, else null. */
    getTransport: (): FrameTransport | null => transport,
  };
}

export type AdvancedView = ReturnType<typeof createAdvancedView>;
