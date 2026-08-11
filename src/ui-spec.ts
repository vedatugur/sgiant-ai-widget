/**
 * The component vocabulary the assistant composes chat UI from — `[[ui:{…}]]`.
 *
 * WHY THIS EXISTS. Every rich thing the chat could draw used to need frontend
 * code: a card kind here, a host renderer there, a release before the model
 * could show it. So the chat could only ever show what the UI had been built to
 * show, and each new scenario (a storyboard, a shortlist, a room-type picker)
 * meant the same work again. This is the substrate that ends that: a small set
 * of primitives the widget knows how to draw, composed BY THE MODEL per
 * situation. A new scenario becomes a spec, not a release.
 *
 * It is deliberately a VOCABULARY and not a language. The model cannot send
 * markup or code — it names primitives (a tile, a status, a button) and the
 * widget draws them in its own styles. That keeps every card looking like the
 * product rather than like whatever the model imagined this time, and it keeps
 * model output out of the DOM.
 *
 * Everything here is PURE so it can be tested without a browser: the widget is
 * imperative DOM with no test harness, and the rules below (what is dropped,
 * what is capped, what a missing field means) are exactly the part worth
 * pinning down.
 */

/** How `items` are laid out. Unknown values fall back to a strip. */
export type UiLayout = "strip" | "grid" | "list";

/**
 * The one action name the WIDGET answers itself: send `data.text` (falling back
 * to the button's label) back into the conversation as if the user had typed
 * it. Everything else goes to the host by name.
 *
 * This is what makes the vocabulary self-sufficient. Without it, every button a
 * composed card wants — "Redo scene 2", "Make it warmer", "Use the sunset one"
 * — is a capability the HOST has to implement and name in advance, which is the
 * per-scenario frontend work this whole design exists to remove. With it, the
 * assistant's own tools are the implementation: the button says the thing, the
 * assistant does it, and a card can offer an action nobody wrote code for.
 *
 * Precedent, not novelty: `[[chips:…]]` already answers by sending the chosen
 * text as an ordinary message, which keeps the transcript in order and honest —
 * the click is visible in the conversation as the sentence it stood for.
 */
export const UI_SAY_ACTION = "say";

/**
 * A button on a card or tile. Dispatched through the host's existing
 * `onWidgetAction(name, data)` — the same path `[[action:…]]` already uses, so
 * a UI card can only ever do what the host already permits by name — except for
 * `say` (see UI_SAY_ACTION), which the widget answers itself.
 */
export interface UiAction {
  name: string;
  label?: string;
  /** When set, the user must approve before the host is called. */
  confirm?: string;
  data?: Record<string, string>;
  variant?: "primary" | "default" | "danger";
}

/** One thing in the card: a picture/clip with a caption, a state and buttons. */
export interface UiItem {
  /** Caller's own id for this item, echoed back in an action's `data.itemId`
   *  so a handler knows WHICH tile was acted on without the model having to
   *  repeat it in every button. */
  id?: string;
  title?: string;
  caption?: string;
  /** Library media to show. An ID, never a URL — see `sanitizeMediaId`. */
  mediaId?: string;
  /** Still to show for a video tile before it plays. */
  posterMediaId?: string;
  /** How to draw `mediaId`. Inferred by the widget when omitted. */
  media?: "image" | "video";
  /** Drawn as a badge; a known one is also coloured. */
  status?: UiStatus;
  actions?: UiAction[];
}

export interface UiSpec {
  title?: string;
  /** A sentence above the items — what the card is for. */
  caption?: string;
  layout: UiLayout;
  /** Shape of every tile's media box. */
  aspect: UiAspect;
  items: UiItem[];
  /** Card-level buttons, under the items. */
  actions: UiAction[];
}

/**
 * The shape tiles are drawn in — the SAME format keywords the rest of the
 * platform uses for generated media (`MediaGenInput.aspect`), so a card that
 * previews a 9:16 reel and the model that renders it are talking about one
 * thing.
 *
 * Card-level rather than per-tile: the scenes of a reel share a format, and a
 * strip whose tiles were each a different shape would read as a mistake. It
 * matters because a portrait reel previewed in square tiles shows the client a
 * crop of what they are approving, and they approve it anyway.
 */
export type UiAspect = "square" | "portrait" | "story" | "landscape" | "wide";

const ASPECTS: readonly string[] = [
  "square",
  "portrait",
  "story",
  "landscape",
  "wide",
];

/**
 * States a tile can be in. Kept OPEN — an unrecognised status is still shown,
 * just without semantic colour, because the alternative is that the model
 * cannot describe a state until the frontend ships a name for it, which is the
 * exact coupling this whole file exists to remove.
 */
export type UiStatus = string;

/** The four the widget colours. Everything else is drawn neutral. */
export const KNOWN_UI_STATUSES = [
  "pending",
  "running",
  "ready",
  "failed",
] as const;

/** Words the model reaches for that mean one of the four. Being forgiving here
 *  is cheaper than a badge that silently loses its colour because the model
 *  wrote "rendering" instead of "running". */
const STATUS_SYNONYMS: Record<string, string> = {
  queued: "pending",
  waiting: "pending",
  rendering: "running",
  generating: "running",
  processing: "running",
  in_progress: "running",
  done: "ready",
  complete: "ready",
  completed: "ready",
  ok: "ready",
  success: "ready",
  error: "failed",
  cancelled: "failed",
  canceled: "failed",
};

/**
 * Caps. A spec is model output, so it is not a promise of reasonable size: an
 * 800-item strip would lock the DOM, and a 4000-character caption would push
 * the composer off screen. Generous enough that no honest card hits them.
 */
const MAX_ITEMS = 24;
const MAX_ACTIONS = 4;
const MAX_TEXT = 240;
const MAX_DATA_KEYS = 12;

const clamp = (v: unknown, max = MAX_TEXT): string | undefined => {
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  if (!s) return undefined;
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
  Boolean(v) && typeof v === "object" && !Array.isArray(v);

/**
 * A media id, or nothing.
 *
 * The model may name library media only BY ID — never by URL. Model output is
 * untrusted (it routinely carries text scraped from third-party pages), and a
 * URL it chose would be fetched by the client's browser the moment the card
 * painted: a tracking pixel, or a request to an attacker's host carrying the
 * user's IP, drawn inside the product's own chat. An id can only ever be
 * resolved by the host against media the ACCOUNT owns, so the worst case is a
 * tile that resolves to nothing.
 *
 * Shape-checked rather than trusted: ids are opaque to the widget, so anything
 * that isn't a plain id-looking token is refused.
 */
function sanitizeMediaId(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  if (!s || s.length > 64) return undefined;
  return /^[A-Za-z0-9_-]+$/.test(s) ? s : undefined;
}

/**
 * Canonicalize a status we recognise; otherwise hand back the model's own
 * wording untouched.
 *
 * The match is done on a squashed key so "In Progress" and "in-progress" both
 * land on `running`, but an unrecognised status is DISPLAYED, and displaying
 * the squashed key would put `awaiting_client_sign_off` on a badge in front of
 * a client. The open half of this vocabulary is only useful if the words the
 * model chose survive it.
 */
function normalizeStatus(v: unknown): string | undefined {
  const s = clamp(v, 32);
  if (!s) return undefined;
  const key = s.toLowerCase().replace(/[\s-]+/g, "_");
  if (STATUS_SYNONYMS[key]) return STATUS_SYNONYMS[key];
  return (KNOWN_UI_STATUSES as readonly string[]).includes(key) ? key : s;
}

/** Action `data` is passed to the host verbatim, so it is flattened to plain
 *  strings — a nested object would reach a handler expecting a value and fail
 *  somewhere far from here. */
function normalizeData(v: unknown): Record<string, string> | undefined {
  if (!isRecord(v)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, raw] of Object.entries(v)) {
    if (Object.keys(out).length >= MAX_DATA_KEYS) break;
    if (
      typeof raw === "string" ||
      typeof raw === "number" ||
      typeof raw === "boolean"
    )
      out[k] = String(raw);
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * One button, or null.
 *
 * An action with no `name` is DROPPED rather than drawn inert: a button that
 * dispatches nothing is indistinguishable from one that works, so the user
 * clicks it, nothing happens, and they have no way to tell whether the product
 * is broken or their request was refused.
 */
function normalizeAction(v: unknown): UiAction | null {
  if (!isRecord(v)) return null;
  const name = clamp(v.name, 64);
  if (!name) return null;
  const label = clamp(v.label, 48);
  const confirm = clamp(v.confirm);
  const data = normalizeData(v.data);
  const variant =
    v.variant === "primary" || v.variant === "danger" ? v.variant : undefined;
  // A `say` button with nothing to say is inert for the same reason a nameless
  // one is: it looks exactly like a button that works.
  if (name === UI_SAY_ACTION && !data?.text && !label) return null;
  return {
    name,
    ...(label ? { label } : {}),
    ...(confirm ? { confirm } : {}),
    ...(data ? { data } : {}),
    ...(variant ? { variant } : {}),
  };
}

function normalizeActions(v: unknown): UiAction[] {
  if (!Array.isArray(v)) return [];
  const out: UiAction[] = [];
  for (const raw of v) {
    if (out.length >= MAX_ACTIONS) break;
    const a = normalizeAction(raw);
    if (a) out.push(a);
  }
  return out;
}

/**
 * One tile, or null when there is nothing to show.
 *
 * "Nothing to show" is deliberate: an item with no media, no text and no state
 * would paint as an empty box, which reads as a broken card rather than as an
 * item the model chose not to describe.
 */
function normalizeItem(v: unknown): UiItem | null {
  if (!isRecord(v)) return null;
  const id = clamp(v.id, 64);
  const title = clamp(v.title, 80);
  const caption = clamp(v.caption);
  const mediaId = sanitizeMediaId(v.mediaId);
  const posterMediaId = sanitizeMediaId(v.posterMediaId);
  const status = normalizeStatus(v.status);
  const media =
    v.media === "video" || v.media === "image" ? v.media : undefined;
  const actions = normalizeActions(v.actions);
  if (!mediaId && !title && !caption && !status && !actions.length) return null;
  return {
    ...(id ? { id } : {}),
    ...(title ? { title } : {}),
    ...(caption ? { caption } : {}),
    ...(mediaId ? { mediaId } : {}),
    ...(posterMediaId ? { posterMediaId } : {}),
    ...(media ? { media } : {}),
    ...(status ? { status } : {}),
    ...(actions.length ? { actions } : {}),
  };
}

/**
 * Turn whatever the model emitted into a spec the widget can draw, or null if
 * there is nothing worth drawing.
 *
 * Null rather than an empty card on purpose: the caller leaves the reply's text
 * alone, so a malformed directive costs the user nothing. A card that renders
 * as an empty box would instead look like the assistant tried to show something
 * and the product lost it.
 */
export function normalizeUiSpec(input: unknown): UiSpec | null {
  if (!isRecord(input)) return null;
  const items: UiItem[] = [];
  if (Array.isArray(input.items)) {
    for (const raw of input.items) {
      if (items.length >= MAX_ITEMS) break;
      const it = normalizeItem(raw);
      if (it) items.push(it);
    }
  }
  const actions = normalizeActions(input.actions);
  const title = clamp(input.title, 80);
  const caption = clamp(input.caption);
  if (!items.length && !actions.length) return null;
  const layout: UiLayout =
    input.layout === "grid" || input.layout === "list" ? input.layout : "strip";
  const aspect = (
    typeof input.aspect === "string" && ASPECTS.includes(input.aspect)
      ? input.aspect
      : "square"
  ) as UiAspect;
  return {
    ...(title ? { title } : {}),
    ...(caption ? { caption } : {}),
    layout,
    aspect,
    items,
    actions,
  };
}

/** Every media id a spec will need resolved, in one list — so the host makes
 *  ONE batched round-trip instead of a request per tile. */
export function uiSpecMediaIds(spec: UiSpec): string[] {
  const ids = new Set<string>();
  for (const it of spec.items) {
    if (it.mediaId) ids.add(it.mediaId);
    if (it.posterMediaId) ids.add(it.posterMediaId);
  }
  return [...ids];
}
