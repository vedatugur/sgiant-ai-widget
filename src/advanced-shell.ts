import { el, relBucket } from "./dom";
import { PREFIX } from "./prefix";
import {
  ICON_BACK,
  ICON_CLOCK,
  ICON_MENU,
  ICON_PANE,
  ICON_PLUS,
  ICON_SEARCH,
  ICON_SIDEBAR,
  ICON_STAR,
} from "./icons";
import { readItem, readJson, writeItem, writeJson } from "./storage";
import type { AiChatWidgetOptions } from "./widget";
import type { WidgetLabels } from "./labels";
import type { WidgetOptionWords } from "./labels-tr";

/**
 * THE ADVANCED VIEW'S FRAME (sgiant-platform#702): the conversation list on
 * the left, a slim row over the chat, and how both change with the screen.
 *
 * The owner-approved picture is `examples/advanced-view-prototype.html`. What
 * this module does NOT do is the chat or the page on the right: the chat is
 * the window's own log and composer, moved into the middle by CSS, and the
 * page is `./advanced-view`. This is the list, the row, and the layout mode.
 *
 * THREE LAYOUTS, from the window's size (it is the whole screen here):
 *
 *  - desk (1200px and wider): the list is beside the chat, open or folded to
 *    a rail of icons; which one is remembered in this browser.
 *  - laptop (820 to 1199px): the rail, and the list opens OVER the chat when
 *    asked, closing on a press outside it or Escape.
 *  - phone (narrower than 820px, or lower than 500px): the chat is the
 *    screen; the list is a drawer from the left behind a dimmed backdrop, and
 *    the page on the right is a sheet with a way back.
 *
 * STAR AND "NEW ANSWER", AND WHERE THEY LIVE. A star is the host's when the
 * host wired `starThread` (the api's shared star); without it the star is
 * kept in this browser. The api says nothing about whether an answer has been
 * read, so the dot is this browser's own: the last time of each conversation
 * this browser has shown (`updatedAt` from the list), and the conversations
 * whose answer finished while another one was on screen. Both are read with
 * try/catch (./storage): a browser that refuses storage still draws the
 * list, with no stars of its own and no dots from before this page.
 */

type Labeler = (
  key: keyof WidgetLabels,
  params?: Record<string, string | number>,
) => string;

export interface ShellThread {
  id: string;
  title?: string | null;
  updatedAt?: string;
  starred?: boolean;
}

export type ShellMode = "desk" | "laptop" | "phone";

export interface AdvancedShellContext {
  L: Labeler;
  ownWords: WidgetOptionWords;
  opts: AiChatWidgetOptions;
  panel: HTMLElement;
  chatCol: HTMLElement;
  pane: HTMLElement;
  /** The More menu: in this view it sits in the row over the chat. */
  moreWrap: HTMLElement;
  name: string;
  /** The window's mark, for a host that gave no logo. */
  avatarHtml: string;
  ns: string;
  layoutScope: string | undefined;
  locale: string | undefined;
  getThreadId: () => string | undefined;
  /** The conversation's first question, for a title the list has not got. */
  firstQuestion: () => string | null;
  isPending: (id: string) => boolean;
  openThread: (id: string) => Promise<void>;
  newChat: () => void;
  exitAdvanced: () => void;
  /** The page on the right, as ./advanced-view keeps it. */
  isPaneOpen: () => boolean;
  setPaneOpen: (open: boolean) => void;
  hasPaneContent: () => boolean;
  /** The host's star changed one: the More menu's row follows. */
  onStarred: (id: string, on: boolean) => void;
}

/** The breakpoints of the three layouts, in CSS pixels. */
export const SHELL_PHONE_MAX_W = 820;
export const SHELL_PHONE_MAX_H = 500;
export const SHELL_DESK_MIN_W = 1200;

export function shellMode(w: number, h: number): ShellMode {
  if (w < SHELL_PHONE_MAX_W || h < SHELL_PHONE_MAX_H) return "phone";
  return w < SHELL_DESK_MIN_W ? "laptop" : "desk";
}

/**
 * Which conversations carry the "new answer" dot. Pure, so it is tested
 * without a browser.
 *
 * A conversation has one when this browser has shown it before (it has a
 * `seen` time) and it changed after that, or when its answer finished here
 * while another conversation was on screen (`fresh`). The one on screen
 * never does. A conversation this browser has never shown has none: the
 * first time a list is drawn is not a list of news.
 */
export function newAnswerIds(
  threads: readonly ShellThread[],
  seen: Readonly<Record<string, string>>,
  fresh: ReadonlySet<string>,
  current: string | undefined,
): Set<string> {
  const out = new Set<string>();
  for (const t of threads) {
    if (t.id === current) continue;
    if (fresh.has(t.id)) {
      out.add(t.id);
      continue;
    }
    const was = seen[t.id];
    if (!was || !t.updatedAt) continue;
    const a = Date.parse(t.updatedAt);
    const b = Date.parse(was);
    if (Number.isFinite(a) && Number.isFinite(b) && a > b) out.add(t.id);
  }
  return out;
}

/** The list as drawn: starred first, then by time, filtered by the search. */
export function shellGroups(
  threads: readonly ShellThread[],
  starred: (t: ShellThread) => boolean,
  query: string,
  locale: string | undefined,
  untitled: string,
): Array<{ bucket: "starred" | string; items: ShellThread[] }> {
  const q = query.trim().toLocaleLowerCase(locale);
  const shown = threads.filter(
    (t) =>
      !q ||
      (t.title || untitled).toLocaleLowerCase(locale).includes(q),
  );
  const groups: Array<{ bucket: string; items: ShellThread[] }> = [];
  const push = (bucket: string, t: ShellThread): void => {
    const last = groups[groups.length - 1];
    if (last && last.bucket === bucket) last.items.push(t);
    else groups.push({ bucket, items: [t] });
  };
  for (const t of shown) if (starred(t)) push("starred", t);
  for (const t of shown)
    if (!starred(t)) push(t.updatedAt ? relBucket(t.updatedAt) : "", t);
  return groups;
}

export function createAdvancedShell(ctx: AdvancedShellContext) {
  const { L, opts, panel, chatCol, pane, moreWrap, ns, layoutScope } = ctx;
  const scope = layoutScope ?? "default";
  const SIDE_KEY = `${ns}:side:${scope}`;
  const SEEN_KEY = `${ns}:seen:${scope}`;
  const STARS_KEY = `${ns}:stars:${scope}`;
  const localStars = !opts.starThread;

  let active = false;
  let mode: ShellMode = "desk";
  /** Desk: the list is open beside the chat (remembered). */
  let pinned = readItem(SIDE_KEY) !== "0";
  /** Laptop and phone: the list is open over the chat, for now. */
  let drawerOpen = false;
  let opener: HTMLElement | null = null;
  let threads: ShellThread[] = [];
  let listLoaded = false;
  let listToken = 0;
  const fresh = new Set<string>();
  let lastPending = new Set<string>();

  const isRecord = (v: unknown): v is Record<string, string> =>
    Boolean(v) &&
    typeof v === "object" &&
    !Array.isArray(v) &&
    Object.values(v as object).every((x) => typeof x === "string");
  const isIdList = (v: unknown): v is string[] =>
    Array.isArray(v) && v.every((x) => typeof x === "string");
  const seen: Record<string, string> = readJson(SEEN_KEY, isRecord) ?? {};
  const stars = new Set<string>(readJson(STARS_KEY, isIdList) ?? []);
  const saveSeen = (): void => {
    // The newest 200 are enough to tell what is new.
    const keep = Object.entries(seen)
      .sort((a, b) => Date.parse(b[1]) - Date.parse(a[1]))
      .slice(0, 200);
    writeJson(SEEN_KEY, Object.fromEntries(keep));
  };
  const isStarred = (t: ShellThread): boolean =>
    localStars ? stars.has(t.id) : Boolean(t.starred);

  const button = (cls: string, label: string, html: string): HTMLButtonElement => {
    const b = el("button", `${PREFIX}-ib ${cls}`) as HTMLButtonElement;
    b.type = "button";
    b.setAttribute("aria-label", label);
    b.title = label;
    b.innerHTML = html;
    return b;
  };

  // ── The host's logo, or the window's own mark and name ─────────────────
  const logo = (compact: boolean): HTMLElement => {
    const wrap = el("span", `${PREFIX}-side-logo`);
    const l = opts.advancedLogo;
    if (l?.src) {
      const src = compact && l.symbol ? l.symbol : l.src;
      const img = document.createElement("img");
      img.className = `${PREFIX}-logo-light`;
      img.src = src;
      img.alt = l.alt;
      wrap.append(img);
      if (l.srcDark && !(compact && l.symbol)) {
        const dark = document.createElement("img");
        dark.className = `${PREFIX}-logo-dark`;
        dark.src = l.srcDark;
        dark.alt = l.alt;
        wrap.append(dark);
      }
    } else {
      const mark = el("span", `${PREFIX}-side-mark`);
      mark.innerHTML = ctx.avatarHtml;
      wrap.append(mark);
      if (!compact) {
        const nm = el("b", `${PREFIX}-side-name`);
        nm.textContent = ctx.name;
        wrap.append(nm);
      }
    }
    return wrap;
  };

  // ── The list on the left ───────────────────────────────────────────────
  const side = el("nav", `${PREFIX}-side`);
  side.setAttribute("aria-label", L("sideLabel"));
  const full = el("div", `${PREFIX}-side-full`);
  const top = el("div", `${PREFIX}-side-top`);
  const row = el("div", `${PREFIX}-side-row`);
  const backBtn = button(`${PREFIX}-adv-back`, L("advBack"), ICON_BACK);
  backBtn.addEventListener("click", () => ctx.exitAdvanced());
  const logoBtn = el("button", `${PREFIX}-ib ${PREFIX}-side-logobtn`) as HTMLButtonElement;
  logoBtn.type = "button";
  logoBtn.append(logo(false));
  const foldBtn = button(`${PREFIX}-side-fold`, L("sideCollapse"), ICON_SIDEBAR);
  const grow = (): HTMLElement => el("span", `${PREFIX}-grow`);
  row.append(backBtn, logoBtn, grow(), foldBtn);
  const newBtn = el("button", `${PREFIX}-side-new`) as HTMLButtonElement;
  newBtn.type = "button";
  newBtn.innerHTML = ICON_PLUS;
  const newLabel = el("span", "");
  newLabel.textContent = L("newChat");
  newBtn.append(newLabel);
  const search = el("label", `${PREFIX}-side-search`);
  search.innerHTML = ICON_SEARCH;
  const searchInput = document.createElement("input");
  searchInput.type = "search";
  searchInput.className = `${PREFIX}-side-q`;
  searchInput.placeholder = L("searchConversations");
  searchInput.setAttribute("aria-label", L("searchConversations"));
  searchInput.autocomplete = "off";
  search.append(searchInput);
  top.append(row, newBtn);
  if (opts.listThreads) top.append(search);
  const list = el("div", `${PREFIX}-side-list`);
  const foot = el("div", `${PREFIX}-side-foot`);
  foot.hidden = true;
  full.append(top, list, foot);

  const rail = el("div", `${PREFIX}-side-rail`);
  const railLogo = el("button", `${PREFIX}-ib ${PREFIX}-rail-logo`) as HTMLButtonElement;
  railLogo.type = "button";
  railLogo.setAttribute("aria-label", L("sideOpen"));
  railLogo.title = L("sideOpen");
  railLogo.append(logo(true));
  const railBack = button(`${PREFIX}-adv-back`, L("advBack"), ICON_BACK);
  railBack.addEventListener("click", () => ctx.exitAdvanced());
  const railOpen = button("", L("sideOpen"), ICON_SIDEBAR);
  const railNew = button("", L("newChat"), ICON_PLUS);
  const railHist = button(
    `${PREFIX}-rail-hist`,
    L("pastConversations"),
    `${ICON_CLOCK}<span class="${PREFIX}-rail-dot" hidden></span>`,
  );
  const railFoot = el("div", `${PREFIX}-rail-foot`);
  rail.append(railLogo, railBack, railOpen, railNew);
  if (opts.listThreads) rail.append(railHist);
  rail.append(grow(), railFoot);
  side.append(full, rail);
  const scrim = el("div", `${PREFIX}-scrim`);

  // The host's own corner, bottom left (an account menu, a name). Drawn
  // once; it moves between the open list and the rail.
  const footHost = el("div", `${PREFIX}-slot`);
  let footDispose: (() => void) | void = undefined;
  if (opts.renderAdvancedFooter) {
    try {
      footDispose = opts.renderAdvancedFooter(footHost);
      foot.hidden = false;
      foot.append(footHost);
    } catch {
      /* a host renderer that throws leaves the corner empty */
    }
  }

  // ── The row over the chat ──────────────────────────────────────────────
  const ctop = el("div", `${PREFIX}-ctop`);
  const ctopBack = button(`${PREFIX}-adv-back ${PREFIX}-ctop-back`, L("advBack"), ICON_BACK);
  ctopBack.addEventListener("click", () => ctx.exitAdvanced());
  const ctopSide = button(`${PREFIX}-ctop-side`, L("sideLabel"), ICON_MENU);
  ctopSide.setAttribute("aria-expanded", "false");
  const ctopTitle = el("span", `${PREFIX}-ctop-title`);
  const moreSlot = el("span", `${PREFIX}-ctop-more`);
  const paneLabel = opts.expandPaneLabel || ctx.ownWords.showPane;
  const appBtn = button(`${PREFIX}-ctop-app`, paneLabel, ICON_PANE);
  const appText = el("span", `${PREFIX}-ctop-app-t`);
  appText.textContent = paneLabel;
  appBtn.append(appText);
  appBtn.addEventListener("click", () => ctx.setPaneOpen(!ctx.isPaneOpen()));
  ctop.append(ctopBack, ctopSide, ctopTitle, grow(), moreSlot, appBtn);
  let moreHome: { parent: Node; next: Node | null } | null = null;

  // ── Layout ─────────────────────────────────────────────────────────────
  const listOpen = (): boolean => (mode === "desk" ? pinned : drawerOpen);

  function layout(): void {
    if (!active) return;
    mode = shellMode(window.innerWidth, window.innerHeight);
    panel.dataset.aiwMode = mode;
    const open = listOpen();
    panel.classList.toggle(`${PREFIX}-side-open`, open);
    full.inert = !open;
    rail.inert = open || mode === "phone";
    side.inert = mode === "phone" && !open;
    scrim.classList.toggle(`${PREFIX}-scrim-on`, mode !== "desk" && open);
    ctopSide.setAttribute("aria-expanded", String(open));
    const foldLabel = mode === "desk" ? L("sideCollapse") : L("sideClose");
    foldBtn.setAttribute("aria-label", foldLabel);
    foldBtn.title = foldLabel;
    logoBtn.setAttribute("aria-label", foldLabel);
    logoBtn.title = foldLabel;
    // The host's corner goes where it can be seen.
    if (opts.renderAdvancedFooter) {
      const into = open ? foot : railFoot;
      if (footHost.parentElement !== into) into.append(footHost);
      // Folded, the corner is the rail's width: the host hides what does
      // not fit by this class.
      footHost.classList.toggle(`${PREFIX}-slot-compact`, !open);
    }
    syncPaneButton();
  }

  function syncPaneButton(): void {
    if (!active) return;
    const open = ctx.isPaneOpen();
    appBtn.hidden = !ctx.hasPaneContent() || (open && mode !== "phone");
    appBtn.setAttribute("aria-expanded", String(open));
    panel.classList.toggle(`${PREFIX}-pane-open`, open);
  }

  function setList(open: boolean, from?: HTMLElement | null): void {
    if (mode === "desk") {
      pinned = open;
      writeItem(SIDE_KEY, open ? "1" : "0");
    } else {
      drawerOpen = open;
      if (open) opener = from ?? (document.activeElement as HTMLElement | null);
    }
    layout();
    if (open) {
      if (opts.listThreads && !listLoaded) void refresh();
      // Into the list: its search on a laptop, its first button on a phone,
      // where focusing a field would raise the keyboard over it.
      if (mode === "laptop") searchInput.focus({ preventScroll: true });
      else if (mode === "phone") newBtn.focus({ preventScroll: true });
    } else if (mode !== "desk") {
      const back =
        opener && opener.isConnected && opener.offsetParent
          ? opener
          : mode === "phone"
            ? ctopSide
            : railOpen;
      opener = null;
      back.focus({ preventScroll: true });
    }
  }

  foldBtn.addEventListener("click", () => setList(false));
  logoBtn.addEventListener("click", () => setList(false));
  railLogo.addEventListener("click", (e) => setList(true, e.currentTarget as HTMLElement));
  railOpen.addEventListener("click", (e) => setList(true, e.currentTarget as HTMLElement));
  railHist.addEventListener("click", (e) => setList(true, e.currentTarget as HTMLElement));
  ctopSide.addEventListener("click", (e) => setList(!listOpen(), e.currentTarget as HTMLElement));
  scrim.addEventListener("click", () => setList(false));
  const startNew = (): void => {
    ctx.newChat();
    if (mode !== "desk" && drawerOpen) setList(false);
    paintList();
  };
  newBtn.addEventListener("click", startNew);
  railNew.addEventListener("click", startNew);
  searchInput.addEventListener("input", () => paintList());

  const onKey = (e: KeyboardEvent): void => {
    if (!active || e.key !== "Escape") return;
    if (mode !== "desk" && drawerOpen) {
      e.stopPropagation();
      setList(false);
    } else if (mode === "phone" && ctx.isPaneOpen()) {
      e.stopPropagation();
      ctx.setPaneOpen(false);
    }
  };
  const onPointer = (e: PointerEvent): void => {
    if (!active || mode !== "laptop" || !drawerOpen) return;
    if (!side.contains(e.target as Node)) setList(false);
  };
  const onResize = (): void => layout();

  // ── The list's rows ────────────────────────────────────────────────────
  const marks = (): Set<string> =>
    newAnswerIds(threads, seen, fresh, ctx.getThreadId());

  function paintList(): void {
    if (!active) return;
    paintTitle();
    if (!opts.listThreads) {
      list.textContent = "";
      return;
    }
    if (!listLoaded) return;
    list.innerHTML = "";
    if (!threads.length) {
      const empty = el("div", `${PREFIX}-side-empty`);
      empty.textContent = L("noConversations");
      list.append(empty);
      paintRailDot(new Set());
      return;
    }
    const news = marks();
    const current = ctx.getThreadId();
    const groups = shellGroups(
      threads,
      isStarred,
      searchInput.value,
      ctx.locale,
      L("untitledConversation"),
    );
    if (!groups.length) {
      const empty = el("div", `${PREFIX}-side-empty`);
      empty.textContent = L("searchNoMatch");
      list.append(empty);
    }
    for (const g of groups) {
      if (g.bucket) {
        const sep = el("div", `${PREFIX}-side-sep`);
        sep.textContent =
          g.bucket === "starred"
            ? L("starredBucket")
            : L(g.bucket as keyof WidgetLabels);
        list.append(sep);
      }
      for (const t of g.items) list.append(rowFor(t, t.id === current, news.has(t.id)));
    }
    paintRailDot(news);
  }

  function rowFor(t: ShellThread, current: boolean, news: boolean): HTMLElement {
    const item = el("div", `${PREFIX}-side-item`);
    const open = el("button", `${PREFIX}-side-link`) as HTMLButtonElement;
    open.type = "button";
    const title = t.title || L("untitledConversation");
    open.title = title;
    if (current) open.setAttribute("aria-current", "true");
    const ti = el("span", `${PREFIX}-side-title`);
    ti.textContent = title;
    open.append(ti);
    if (ctx.isPending(t.id)) {
      const spin = el("span", `${PREFIX}-act-spin`);
      spin.setAttribute("role", "img");
      spin.setAttribute("aria-label", L("threadAnswering"));
      spin.title = L("threadAnswering");
      open.append(spin);
    } else if (news) {
      const dot = el("span", `${PREFIX}-side-new-dot`);
      dot.setAttribute("role", "img");
      dot.setAttribute("aria-label", L("newAnswer"));
      dot.title = L("newAnswer");
      open.append(dot);
    }
    open.addEventListener("click", () => void pick(t.id));
    item.append(open);
    if (opts.starThread || localStars) {
      const on = isStarred(t);
      const star = el(
        "button",
        `${PREFIX}-side-star${on ? ` ${PREFIX}-side-star-on` : ""}`,
      ) as HTMLButtonElement;
      star.type = "button";
      star.innerHTML = ICON_STAR;
      star.setAttribute("aria-pressed", String(on));
      const label = on ? L("unstar") : L("star");
      star.setAttribute("aria-label", label);
      star.title = label;
      star.addEventListener("click", () => void toggleStar(t));
      item.append(star);
    }
    return item;
  }

  function paintRailDot(news: Set<string>): void {
    const dot = railHist.querySelector(`.${PREFIX}-rail-dot`) as HTMLElement | null;
    if (dot) dot.hidden = !(news.size || threads.some((t) => ctx.isPending(t.id)));
  }

  function paintTitle(): void {
    const id = ctx.getThreadId();
    const t = id ? threads.find((x) => x.id === id) : undefined;
    let text = t?.title || ctx.firstQuestion() || "";
    if (text.length > 80) text = `${text.slice(0, 79)}…`;
    ctopTitle.textContent = text;
  }

  async function toggleStar(t: ShellThread): Promise<void> {
    if (localStars) {
      if (stars.has(t.id)) stars.delete(t.id);
      else stars.add(t.id);
      writeJson(STARS_KEY, [...stars]);
      paintList();
      return;
    }
    const prev = Boolean(t.starred);
    t.starred = !prev; // optimistic
    paintList();
    try {
      const r = await opts.starThread!(t.id);
      t.starred = r.starred;
      ctx.onStarred(t.id, r.starred);
    } catch {
      t.starred = prev;
    }
    paintList();
  }

  function markSeen(id: string | undefined): void {
    if (!id) return;
    fresh.delete(id);
    const t = threads.find((x) => x.id === id);
    seen[id] = t?.updatedAt ?? new Date().toISOString();
    saveSeen();
  }

  async function pick(id: string): Promise<void> {
    await ctx.openThread(id);
    markSeen(id);
    if (mode !== "desk" && drawerOpen) setList(false);
    paintList();
  }

  async function refresh(): Promise<void> {
    if (!opts.listThreads || !active) return;
    const my = ++listToken;
    let got: ShellThread[];
    try {
      got = await opts.listThreads();
    } catch {
      if (my !== listToken) return;
      list.textContent = L("historyLoadFailed");
      return;
    }
    if (my !== listToken || !active) return;
    threads = Array.isArray(got) ? got.slice(0, 200) : [];
    listLoaded = true;
    // A conversation shown for the first time is its own baseline, and the
    // one on screen is read.
    let wrote = false;
    for (const t of threads)
      if (!seen[t.id] && t.updatedAt) {
        seen[t.id] = t.updatedAt;
        wrote = true;
      }
    const current = ctx.getThreadId();
    const now = current ? threads.find((t) => t.id === current) : undefined;
    if (now?.updatedAt && seen[now.id] !== now.updatedAt) {
      seen[now.id] = now.updatedAt;
      wrote = true;
    }
    if (wrote) saveSeen();
    if (!localStars) for (const t of threads) ctx.onStarred(t.id, Boolean(t.starred));
    paintList();
  }

  let refreshTimer = 0;
  /** A turn started or ended somewhere: the spinners, the dots, and (once
   *  it settles) the list again, for a new conversation's title. */
  function pendingChanged(pending: ReadonlySet<string>): void {
    const current = ctx.getThreadId();
    let ended = false;
    for (const id of lastPending)
      if (!pending.has(id)) {
        ended = true;
        if (id !== current && threads.some((t) => t.id === id)) fresh.add(id);
      }
    const started = [...pending].some((id) => !lastPending.has(id));
    lastPending = new Set(pending);
    if (!active) return;
    paintList();
    if (ended || started) {
      window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => void refresh(), ended ? 400 : 1500);
    }
  }

  return {
    side,
    scrim,
    ctop,
    mode: (): ShellMode => (active ? mode : "desk"),
    isPhone: (): boolean => active && mode === "phone",
    enter(): void {
      if (active) return;
      active = true;
      panel.insertBefore(side, chatCol);
      panel.insertBefore(scrim, chatCol);
      chatCol.insertBefore(ctop, chatCol.firstChild);
      if (moreWrap.parentNode)
        moreHome = { parent: moreWrap.parentNode, next: moreWrap.nextSibling };
      moreSlot.append(moreWrap);
      drawerOpen = false;
      window.addEventListener("resize", onResize);
      panel.addEventListener("keydown", onKey);
      document.addEventListener("pointerdown", onPointer, true);
      layout();
      paintList();
      void refresh();
    },
    exit(): void {
      if (!active) return;
      active = false;
      window.removeEventListener("resize", onResize);
      panel.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer, true);
      window.clearTimeout(refreshTimer);
      if (moreHome) moreHome.parent.insertBefore(moreWrap, moreHome.next);
      moreHome = null;
      side.remove();
      scrim.remove();
      ctop.remove();
      delete panel.dataset.aiwMode;
      panel.classList.remove(`${PREFIX}-side-open`, `${PREFIX}-pane-open`);
      pane.inert = false;
    },
    layout,
    syncPaneButton,
    refresh,
    paintList,
    markSeen,
    pendingChanged,
    destroy(): void {
      this.exit();
      try {
        if (typeof footDispose === "function") footDispose();
      } catch {
        /* host cleanup best-effort */
      }
    },
  };
}
