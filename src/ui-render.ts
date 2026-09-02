import { el, wrapPreviewHtml } from "./dom";
import { PREFIX } from "./prefix";
import type { ActionSpec, ChipsSpec, PreviewSpec, WidgetSpec } from "./specs";
import {
  UI_SAY_ACTION,
  normalizeUiSpec,
  uiSpecMediaIds,
  type UiAction,
  type UiItem,
  type UiStatus,
} from "./ui-spec";
// Type-only, so it is erased and there is no runtime cycle with ./index. This
// interface belongs beside the other spec types in ./specs; moving it touches a
// dozen call sites, which does not belong in a commit whose whole point is that
// nothing changed.
import type { AiChatWidgetOptions, WidgetJobView } from "./index";
import type { WidgetLabels } from "./labels";

/**
 * Rendering for server-driven UI: the `ui` spec and the inline data widgets.
 *
 * `./ui-spec` owns the DATA — the types and `normalizeUiSpec`. This owns the
 * DOM built from it. They were one 6,882-line file with the spec parsed at one
 * end and painted at the other (#320).
 *
 * ## Why a factory rather than exported functions
 *
 * These fifteen functions read nine things from the widget's closure. Threading
 * those through as a `ctx` parameter would have meant editing every signature
 * and every call site — and one consumer compiles this source with
 * `noUnusedParameters`, so the handful that do not need `ctx` could not have
 * taken it for uniformity anyway.
 *
 * A factory destructures the context once and lets the bodies close over it, so
 * they moved out of `index.ts` BYTE FOR BYTE and not one of the eleven call
 * sites changed. A move you can verify by diffing is worth more here than the
 * marginally purer shape.
 *
 * ## Nine of the fifteen are private
 *
 * Only six are called from outside. The other nine were in `index.ts`'s scope
 * for no reason other than living in the same file, and are now unreachable
 * from it — which is most of what this split is for.
 */
export interface UiRenderCtx {
  /** Label lookup; `L("prev")`. Host translation falling back to English. */
  L: (
    key: keyof WidgetLabels,
    params?: Record<string, string | number>
  ) => string;
  /** The conversation log element every renderer appends into. */
  log: HTMLElement;
  /** Scroll the log to the bottom; `force` overrides the user's scroll-up pin. */
  scrollDown: (force?: boolean) => void;
  /** Send a turn, as the chip renderer does when a suggestion is clicked. */
  send: (
    content: string,
    fork?: { parentId?: string | null; regenerate?: boolean }
  ) => Promise<void>;
  /** Teardown callbacks for renderers holding subscriptions or timers. */
  richDisposers: Array<() => void>;
  /** Hand an action to the host app. */
  dispatchAction: (
    name: string,
    data: Record<string, string>
  ) => Promise<string | void>;
  /** Live job updates for a tile that is watching one. `kind` is the narrow
   *  union rather than `string`: a report id and a job id are two namespaces,
   *  and widening it here would let them be conflated at this boundary. */
  subscribeJob: (
    ref: { kind: "job" | "report"; id: string },
    node: HTMLElement,
    paint: (view: WidgetJobView) => void
  ) => void;
  /** Try to render into the host's pane; false when it cannot take it. */
  showPaneWidget: (
    spec: unknown,
    rows: unknown,
    comparisonRows?: unknown
  ) => boolean;
  /** The composer input, focused when a chip is dismissed. */
  input: HTMLInputElement;
  /** The host's options. Only three are read here — `renderDataWidget`,
   *  `renderChartFallback` and `resolveMediaUrls` — but the whole object is
   *  passed so the bodies keep saying `opts.x`, which is what makes this a move
   *  rather than a rewrite. */
  opts: AiChatWidgetOptions;
}

export type UiRenderers = ReturnType<typeof createUiRenderers>;

export function createUiRenderers(ctx: UiRenderCtx) {
  const {
    L,
    log,
    scrollDown,
    send,
    richDisposers,
    dispatchAction,
    subscribeJob,
    showPaneWidget,
    input,
    opts,
  } = ctx;

  /** Render an inline data widget (stat / kpis / list / table) in the log. */
  function renderWidget(spec: WidgetSpec): void {
    const card = el("div", `${PREFIX}-widget`);
    if (spec.title) {
      const t = el("div", `${PREFIX}-widget-title`);
      t.textContent = spec.title;
      card.appendChild(t);
    }
    const kind =
      spec.kind ?? (spec.rows ? "table" : spec.items ? "kpis" : "list");
    if (kind === "stat") {
      const v = el("div", `${PREFIX}-widget-stat`);
      v.textContent = String(spec.value ?? "");
      card.appendChild(v);
      if (spec.caption) {
        const c = el("div", `${PREFIX}-widget-cap`);
        c.textContent = spec.caption;
        card.appendChild(c);
      }
      if (spec.delta) {
        const d = el("div", `${PREFIX}-widget-delta`);
        d.textContent = spec.delta;
        card.appendChild(d);
      }
    } else if (kind === "kpis") {
      const grid = el("div", `${PREFIX}-widget-kpis`);
      for (const it of (spec.items ?? []).slice(0, 8)) {
        const tile = el("div", `${PREFIX}-kpi`);
        const kv = el("div", `${PREFIX}-kpi-v`);
        kv.textContent = String(it.value ?? "");
        const kl = el("div", `${PREFIX}-kpi-l`);
        kl.textContent = it.label ?? "";
        tile.append(kv, kl);
        if (it.delta) {
          const kd = el("div", `${PREFIX}-kpi-d`);
          kd.textContent = it.delta;
          tile.appendChild(kd);
        }
        grid.appendChild(tile);
      }
      card.appendChild(grid);
    } else if (kind === "table" && spec.rows) {
      const table = document.createElement("table");
      table.className = `${PREFIX}-widget-table`;
      if (spec.columns?.length) {
        const thead = table.createTHead().insertRow();
        for (const c of spec.columns) {
          const th = document.createElement("th");
          th.textContent = String(c);
          thead.appendChild(th);
        }
      }
      const tbody = table.createTBody();
      for (const row of spec.rows.slice(0, 30)) {
        const tr = tbody.insertRow();
        for (const cell of row) tr.insertCell().textContent = String(cell);
      }
      card.appendChild(table);
    } else {
      const ul = el("ul", `${PREFIX}-widget-list`);
      for (const line of (spec.lines ?? []).slice(0, 30)) {
        const li = document.createElement("li");
        li.textContent = line;
        ul.appendChild(li);
      }
      card.appendChild(ul);
    }
    log.appendChild(card);
    scrollDown(true);
  }

  // ── Composed UI cards — `[[ui:{…}]]` ────────────────────────────────────────
  //
  // The assistant composes a card out of primitives this widget knows how to
  // draw (see ui-spec.ts for the vocabulary and why it is a vocabulary rather
  // than markup). Nothing here knows what a storyboard is, or a shortlist, or a
  // room-type picker: it draws tiles with media, a state and buttons, and the
  // buttons go to the host by name through the SAME `dispatchAction` an
  // `[[action:…]]` uses — so a composed card can never do anything the host
  // doesn't already allow.

  /** The label for a tile's state: ours to translate for the four we know,
   *  the model's own words for anything else. */
  function uiStatusLabel(status: string): string {
    if (status === "pending") return L("uiStatusPending");
    if (status === "running") return L("uiStatusRunning");
    if (status === "ready") return L("uiStatusReady");
    if (status === "failed") return L("uiStatusFailed");
    return status;
  }

  /** One button on a card or tile. */
  function buildUiAction(a: UiAction, itemId?: string): HTMLElement {
    const wrap = el("span", `${PREFIX}-ui-act`);
    const variant =
      a.variant === "primary"
        ? ` ${PREFIX}-ui-btn-primary`
        : a.variant === "danger"
          ? ` ${PREFIX}-ui-btn-danger`
          : "";
    const btn = el("button", `${PREFIX}-ui-btn${variant}`) as HTMLButtonElement;
    btn.type = "button";
    const label = a.label || a.name;
    btn.textContent = label;
    // The tile's own id rides along, so a handler knows WHICH tile was acted on
    // without the model having to repeat it inside every button's data.
    const data = { ...(a.data ?? {}), ...(itemId ? { itemId } : {}) };
    const run = async (): Promise<void> => {
      btn.disabled = true;
      // `say` is answered here, not by the host: it puts its text into the
      // conversation as an ordinary user message (exactly as a chip does), so
      // the assistant's own tools carry it out and the transcript records the
      // click as the sentence it stood for.
      if (a.name === UI_SAY_ACTION) {
        void send((a.data?.text || label).trim());
        return;
      }
      try {
        const msg = await dispatchAction(a.name, data);
        btn.textContent =
          (typeof msg === "string" && msg) || L("actionDone", { label });
      } catch {
        btn.disabled = false;
        btn.textContent = `${label} — ${L("tryAgain")}`;
      }
    };
    btn.addEventListener("click", () => {
      if (!a.confirm) {
        void run();
        return;
      }
      // The confirm replaces THIS BUTTON, not the card. A single [[action:…]]
      // card can take itself over to ask, because it is the only thing there;
      // a composed card holds many actions, and hiding a whole storyboard
      // behind one question would lose the very thing being confirmed.
      wrap.textContent = "";
      const q = el("span", `${PREFIX}-ui-confirm-q`);
      q.textContent = a.confirm;
      const yes = el("button", `${PREFIX}-ui-btn`) as HTMLButtonElement;
      yes.type = "button";
      yes.textContent = L("confirm");
      const no = el("button", `${PREFIX}-ui-btn-ghost`) as HTMLButtonElement;
      no.type = "button";
      no.textContent = L("cancel");
      const restore = (): void => {
        wrap.textContent = "";
        wrap.appendChild(btn);
      };
      yes.addEventListener("click", () => {
        restore();
        void run();
      });
      no.addEventListener("click", restore);
      wrap.append(q, yes, no);
    });
    wrap.appendChild(btn);
    return wrap;
  }

  /** One tile. The media box is drawn EMPTY-BUT-SIZED and filled in later, so
   *  the card doesn't reflow (and scroll out from under a reading user) when
   *  the pictures land. */
  /** The badge class for a status — the known four are coloured, anything the
   *  model invented gets the neutral one. */
  function uiBadgeClass(status: string): string {
    const known =
      status === "pending" ||
      status === "running" ||
      status === "ready" ||
      status === "failed";
    return `${PREFIX}-ui-badge ${PREFIX}-ui-badge-${known ? status : "other"}`;
  }

  /**
   * A job's coarse lifecycle as the tile vocabulary's own status.
   *
   * `cancelled` deliberately lands on `failed` rather than on its own badge:
   * from the tile's point of view — "is there a clip here?" — a cancelled
   * render and a failed one are the same answer, and the card-level job view
   * is where the difference is spelled out.
   */
  function uiStatusForJob(status: WidgetJobView["status"]): UiStatus {
    if (status === "done") return "ready";
    if (status === "failed" || status === "cancelled") return "failed";
    if (status === "queued") return "pending";
    return "running";
  }

  /**
   * Repaint one tile from a job poll — the thing that stops a composed card
   * being a snapshot of the moment it was written.
   *
   * Only ever ADDS what it learns: media it did not have, and a status it can
   * now state. It never clears a media id the model already gave, because a
   * tile can legitimately show a reference still while the render it names is
   * still running.
   */
  function paintUiTileLive(tile: HTMLElement, view: WidgetJobView): void {
    const box = tile.querySelector<HTMLElement>(`.${PREFIX}-ui-media`);
    if (!box) return;
    const badge = tile.querySelector<HTMLElement>(`.${PREFIX}-ui-badge`);
    if (badge) {
      const s = uiStatusForJob(view.status);
      badge.className = uiBadgeClass(s);
      badge.textContent = uiStatusLabel(s);
    }
    const produced = view.resultMediaId;
    if (!produced || box.dataset.mid === produced) return;
    box.dataset.mid = produced;
    // The clip has landed, so the box stops being a placeholder — one more
    // batched resolve, scoped to this tile, and `fillUiMedia` does the rest
    // (it queries `.…-ui-media` inside whatever element it is handed).
    void fillUiMedia([produced], tile);
  }

  function buildUiTile(it: UiItem): HTMLElement {
    const tile = el("div", `${PREFIX}-ui-tile`);
    const box = el("div", `${PREFIX}-ui-media`);
    if (it.mediaId) {
      box.dataset.mid = it.mediaId;
      if (it.posterMediaId) box.dataset.poster = it.posterMediaId;
      if (it.media) box.dataset.kind = it.media;
    }
    const ph = el("span", `${PREFIX}-ui-media-ph`);
    ph.textContent = it.mediaId ? "" : L("uiMediaPending");
    box.appendChild(ph);
    // A tile watching a job always gets a badge, even when the model named no
    // status: the badge is where the job's progress is going to be written, and
    // one added later would make the tile jump as it filled in.
    const initialStatus =
      it.status ?? (it.jobId ? ("running" as UiStatus) : undefined);
    if (initialStatus) {
      const badge = el("span", uiBadgeClass(initialStatus));
      badge.textContent = uiStatusLabel(initialStatus);
      box.appendChild(badge);
    }
    tile.appendChild(box);
    if (it.jobId) {
      subscribeJob({ kind: "job", id: it.jobId }, tile, (view) =>
        paintUiTileLive(tile, view)
      );
    }
    if (it.title) {
      const t = el("div", `${PREFIX}-ui-tile-title`);
      t.textContent = it.title;
      tile.appendChild(t);
    }
    if (it.caption) {
      const c = el("div", `${PREFIX}-ui-tile-cap`);
      c.textContent = it.caption;
      tile.appendChild(c);
    }
    if (it.actions?.length) {
      const row = el("div", `${PREFIX}-ui-tile-actions`);
      for (const a of it.actions) row.appendChild(buildUiAction(a, it.id));
      tile.appendChild(row);
    }
    return tile;
  }

  /** Does this URL point at something to PLAY rather than show? The id alone
   *  can't say, so the model's own `media` hint wins and the extension is the
   *  fallback — a clip drawn as an <img> is a broken tile, which is worse than
   *  a still drawn in a <video> (that still shows the frame). */
  function looksLikeVideo(url: string): boolean {
    return /\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(url);
  }

  /** Resolve a card's media ids and paint them in. One batched call for the
   *  whole card — a request per tile would be a burst of round-trips for what
   *  is conceptually one picture set. */
  async function fillUiMedia(ids: string[], card: HTMLElement): Promise<void> {
    let urls: Record<string, string> = {};
    if (ids.length && opts.resolveMediaUrls) {
      try {
        urls = (await opts.resolveMediaUrls(ids)) ?? {};
      } catch {
        urls = {}; // every tile then says "Unavailable" — never a blank box
      }
    }
    const boxes = card.querySelectorAll<HTMLElement>(`.${PREFIX}-ui-media`);
    for (const box of Array.from(boxes)) {
      const mid = box.dataset.mid;
      if (!mid) continue;
      const url = urls[mid];
      const ph = box.querySelector<HTMLElement>(`.${PREFIX}-ui-media-ph`);
      if (!url) {
        if (ph) ph.textContent = L("uiMediaMissing");
        continue;
      }
      // AUDIO must be declared, never guessed: our URLs are signed and carry no
      // extension, so an mp3 left to inference is drawn as an <img> and reads as
      // a broken tile.
      const kind = box.dataset.kind
        ? box.dataset.kind
        : looksLikeVideo(url)
          ? "video"
          : "image";
      const isVideo = kind === "video";
      const isAudio = kind === "audio";
      const node = el(
        isAudio ? "audio" : isVideo ? "video" : "img",
        `${PREFIX}-ui-media-el`
      ) as HTMLImageElement & HTMLVideoElement & HTMLAudioElement;
      node.src = url;
      if (isVideo || isAudio) {
        node.controls = true;
        node.preload = "metadata";
        if (isVideo) {
          node.playsInline = true;
          const poster = box.dataset.poster ? urls[box.dataset.poster] : "";
          if (poster) node.poster = poster;
        }
      } else {
        node.loading = "lazy";
        node.alt = "";
      }
      // A media id that resolves to a URL the browser then refuses (expired
      // signature, deleted object) must still read as a state, not a blank.
      node.addEventListener("error", () => {
        node.remove();
        const p = el("span", `${PREFIX}-ui-media-ph`);
        p.textContent = L("uiMediaMissing");
        box.appendChild(p);
      });
      ph?.remove();
      box.insertBefore(node, box.firstChild);
    }
  }

  /**
   * Wrap a tile row in paging: one visible at a time, arrows and dots overlaid.
   *
   * Overlaid rather than stacked beneath — controls that are flex siblings
   * steal height from the media, so a square tile renders visibly smaller
   * than the space it was given and reads as a lesser thing than it is.
   */
  function buildUiCarousel(items: HTMLElement, count: number): HTMLElement {
    const wrap = el("div", `${PREFIX}-ui-carousel`);
    const stage = el("div", `${PREFIX}-ui-carousel-stage`);
    stage.appendChild(items);
    wrap.appendChild(stage);

    let index = 0;
    const dots: HTMLElement[] = [];
    const paint = (): void => {
      items.style.transform = `translateX(-${index * 100}%)`;
      dots.forEach((d, i) =>
        d.classList.toggle(`${PREFIX}-ui-dot-on`, i === index)
      );
      counter.textContent = `${index + 1}/${count}`;
    };
    const go = (delta: number): void => {
      index = (index + delta + count) % count;
      paint();
    };

    const arrow = (side: "left" | "right"): HTMLElement => {
      const b = el(
        "button",
        `${PREFIX}-ui-arrow ${PREFIX}-ui-arrow-${side}`
      ) as HTMLButtonElement;
      b.type = "button";
      b.setAttribute("aria-label", side === "left" ? L("prev") : L("next"));
      b.textContent = side === "left" ? "‹" : "›";
      b.addEventListener("click", (e) => {
        // The card sits inside a scrollable log and may sit inside other
        // clickable chrome; paging must never reach either.
        e.preventDefault();
        e.stopPropagation();
        go(side === "left" ? -1 : 1);
      });
      return b;
    };
    stage.append(arrow("left"), arrow("right"));

    const counter = el("span", `${PREFIX}-ui-counter`);
    stage.appendChild(counter);

    const dotRow = el("div", `${PREFIX}-ui-dots`);
    for (let i = 0; i < count; i++) {
      const d = el("button", `${PREFIX}-ui-dot`) as HTMLButtonElement;
      d.type = "button";
      d.setAttribute("aria-label", `${i + 1}`);
      d.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        index = i;
        paint();
      });
      dots.push(d);
      dotRow.appendChild(d);
    }
    stage.appendChild(dotRow);
    paint();
    return wrap;
  }

  /** Draw a composed UI card in the log. */
  function renderUiCard(raw: unknown): void {
    const spec = normalizeUiSpec(raw);
    if (!spec) return; // nothing worth drawing — the reply's text stands alone
    const card = el("div", `${PREFIX}-ui`);
    if (spec.title) {
      const t = el("div", `${PREFIX}-ui-title`);
      t.textContent = spec.title;
      card.appendChild(t);
    }
    if (spec.caption) {
      const c = el("div", `${PREFIX}-ui-cap`);
      c.textContent = spec.caption;
      card.appendChild(c);
    }
    if (spec.items.length) {
      const items = el(
        "div",
        `${PREFIX}-ui-items ${PREFIX}-ui-${spec.layout} ${PREFIX}-ui-a-${spec.aspect}`
      );
      for (const it of spec.items) items.appendChild(buildUiTile(it));
      // A CAROUSEL shows one item at a time, because the client is judging each
      // one rather than scanning a set: six thumbnails in a row invites
      // approving what was never really looked at. Paging is added around the
      // same tiles, so nothing about how a tile is built changes.
      if (spec.layout === "carousel" && spec.items.length > 1) {
        card.appendChild(buildUiCarousel(items, spec.items.length));
      } else {
        card.appendChild(items);
      }
    }
    if (spec.actions.length) {
      const row = el("div", `${PREFIX}-ui-actions`);
      for (const a of spec.actions) row.appendChild(buildUiAction(a));
      card.appendChild(row);
    }
    log.appendChild(card);
    scrollDown(true);
    void fillUiMedia(uiSpecMediaIds(spec), card);
  }

  /** Map an analytics render_chart frame (spec + StatsQueryRow[]) to an inline
   *  widget. kpi → a stat; everything else → a table of the returned rows. */
  function renderServerWidget(
    spec: { title?: string; chartType?: string } | undefined,
    rows: unknown,
    comparisonRows?: unknown
  ): void {
    // ADVANCED VIEW: the big surface is the right place for a chart.
    //
    // A computed widget used to land in the 368px chat column while half the
    // screen next to it showed a page nobody was reading. Same principle as
    // the report narration collapsing when the pane shows the run: whichever
    // surface can render it properly gets it, and the chat says where it went
    // rather than drawing a second, smaller copy.
    //
    // Falls through to the log when the pane cannot take it (no host renderer,
    // or the renderer threw), so a failure here costs nothing.
    if (showPaneWidget(spec, rows, comparisonRows)) {
      const note = el("div", `${PREFIX}-job-mirrored`);
      note.textContent = L("jobWatchingInPane");
      log.appendChild(note);
      scrollDown(true);
      return;
    }
    // In-app: hand the frame to the host's REAL dashboard renderer (charts).
    if (opts.renderDataWidget) {
      const host = el("div", `${PREFIX}-widget ${PREFIX}-widget-host`);
      log.appendChild(host);
      const dispose = opts.renderDataWidget(host, spec, rows, comparisonRows);
      if (dispose) richDisposers.push(dispose);
      scrollDown(true);
      return;
    }
    // Embedder-supplied chart fallback (no React host) — real charts in a
    // standalone embed via whatever lightweight lib the embedder plugs in.
    if (opts.renderChartFallback) {
      const host = el("div", `${PREFIX}-widget ${PREFIX}-widget-host`);
      log.appendChild(host);
      try {
        const dispose = opts.renderChartFallback(
          host,
          spec,
          rows,
          comparisonRows
        );
        if (dispose) richDisposers.push(dispose);
        scrollDown(true);
        return;
      } catch {
        host.remove(); // fall through to the built-in degrade
      }
    }
    // External embed: lightweight fallback (kpi → stat, else a table).
    const title = spec?.title;
    const data = Array.isArray(rows)
      ? (rows as Array<Record<string, unknown>>)
      : [];
    if (spec?.chartType === "kpi" && data[0]) {
      const first = data[0];
      const keys = Object.keys(first);
      const valueKey = keys[keys.length - 1];
      renderWidget({
        kind: "stat",
        title,
        value: String(first[valueKey] ?? ""),
        caption: valueKey,
      });
      return;
    }
    if (!data.length) {
      renderWidget({ kind: "list", title, lines: ["(no data)"] });
      return;
    }
    const columns = Object.keys(data[0]);
    const tableRows = data
      .slice(0, 30)
      .map((r) => columns.map((c) => (r[c] == null ? "" : String(r[c]))));
    renderWidget({ kind: "table", title, columns, rows: tableRows });
  }

  function renderChips(spec: ChipsSpec): void {
    const options = (Array.isArray(spec.options) ? spec.options : [])
      .map((o) => String(o).trim())
      .filter(Boolean)
      .slice(0, 8);
    if (!options.length) return;
    const multi = spec.multi === true;
    const wrap = el("div", `${PREFIX}-chips`);
    const chosen = new Set<string>();
    let answered = false;
    const answer = (text: string): void => {
      if (answered || !text.trim()) return;
      answered = true;
      wrap
        .querySelectorAll("button")
        .forEach((b) => ((b as HTMLButtonElement).disabled = true));
      void send(text.trim());
    };
    for (const opt of options) {
      const b = el("button", `${PREFIX}-chip`) as HTMLButtonElement;
      b.type = "button";
      b.textContent = opt;
      b.addEventListener("click", () => {
        if (answered) return;
        if (!multi) {
          answer(opt);
          return;
        }
        if (chosen.has(opt)) {
          chosen.delete(opt);
          b.classList.remove(`${PREFIX}-chip-on`);
        } else {
          chosen.add(opt);
          b.classList.add(`${PREFIX}-chip-on`);
        }
      });
      wrap.appendChild(b);
    }
    // "Other" — let the user type a free answer instead of picking.
    if (spec.other !== false) {
      const other = el(
        "button",
        `${PREFIX}-chip ${PREFIX}-chip-other`
      ) as HTMLButtonElement;
      other.type = "button";
      other.textContent = L("otherOption");
      other.addEventListener("click", () => input.focus());
      wrap.appendChild(other);
    }
    // Multi-select needs an explicit Send (collect the toggled options).
    if (multi) {
      const go = el(
        "button",
        `${PREFIX}-chip ${PREFIX}-chip-send`
      ) as HTMLButtonElement;
      go.type = "button";
      go.textContent = L("send");
      go.addEventListener("click", () => {
        const picks = options.filter((o) => chosen.has(o));
        if (picks.length) answer(picks.join(", "));
      });
      wrap.appendChild(go);
    }
    log.appendChild(wrap);
    scrollDown(true);
  }

  /** Render an AI-authored HTML preview in a sandboxed iframe. Scripts stay
   *  OFF (static HTML, can't execute), but allow-same-origin is granted so the
   *  parent page's blob: URLs (resolved private media) can paint — an
   *  opaque-origin frame refuses them and every resolved image breaks. */
  function renderPreview(spec: PreviewSpec): void {
    const wrap = el("div", `${PREFIX}-preview`);
    const bar = el("div", `${PREFIX}-preview-bar`);
    const dots = el("span", `${PREFIX}-preview-dots`);
    dots.innerHTML = `<i></i><i></i><i></i>`;
    const title = el("span", `${PREFIX}-preview-title`);
    title.textContent = spec.title || L("preview");
    bar.append(dots, title);
    const frame = el("iframe", `${PREFIX}-preview-frame`) as HTMLIFrameElement;
    frame.setAttribute("sandbox", "allow-same-origin");
    frame.setAttribute("title", spec.title || L("preview"));
    frame.srcdoc = wrapPreviewHtml(spec.html);
    wrap.append(bar, frame);
    log.appendChild(wrap);
    scrollDown(true);
  }

  // Default confirm copy for a state-changing UI action the model didn't caption.
  function operateConfirmText(spec: ActionSpec): string {
    const target = spec.data?.target ?? "this control";
    if (spec.name === "fill") {
      const v = spec.data?.value ?? "";
      const short = v.length > 40 ? `${v.slice(0, 40)}…` : v;
      return short
        ? `Type “${short}” into ${target}?`
        : `Fill ${target} for you?`;
    }
    return `Click ${target} for you?`;
  }

  return {
    renderWidget,
    renderUiCard,
    renderServerWidget,
    renderChips,
    renderPreview,
    operateConfirmText,
  };
}
