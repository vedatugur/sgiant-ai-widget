/**
 * Pure-DOM UI control for the floating Copilot widget. The widget renders in its
 * OWN detached React root (createRoot), so it can't reach the app's React
 * `AiControlProvider` context — this vanilla-DOM twin drives on-page controls the
 * same way, by their stable `data-ai-target` id.
 *
 * SCOPE: read-only, reversible NUDGES only — highlight (pulse a ring + scroll
 * into view), scroll-to, and focus-field. These change nothing, so they never
 * need a confirm. "Operate" actions (fill / click) are deliberately NOT here;
 * they change state and belong behind the widget's explicit auto mode with a
 * per-action confirm (see docs/ai-ui-control.md, phase 2).
 *
 * The AI never gets a selector — only the id catalog from `scanAiTargets()`, fed
 * into the turn's page context. The host owns the id→element resolution below.
 */

/** The read-only control actions the AI may request via `[[action:{…}]]`. */
export const UI_CONTROL_ACTIONS = [
  "highlight",
  "scroll-to",
  "focus-field",
] as const;
export type UiControlAction = (typeof UI_CONTROL_ACTIONS)[number];

/** True when `name` is one of the read-only UI-control actions. */
export function isUiControlAction(name: string): name is UiControlAction {
  return (UI_CONTROL_ACTIONS as readonly string[]).includes(name);
}

/** One on-page control the AI is allowed to point at. */
export interface AiTargetInfo {
  id: string;
  /** Human label (aria-label / text / placeholder) so the model picks the right one. */
  label: string;
}

/** Escape a value for use inside a `[data-ai-target="…"]` attribute selector. */
function attrEscape(s: string): string {
  return s.replace(/["\\]/g, "\\$&");
}

/** Resolve a target id to its live element (null when absent/detached). */
function resolveTarget(id: string): HTMLElement | null {
  if (typeof document === "undefined") return null;
  const el = document.querySelector<HTMLElement>(
    `[data-ai-target="${attrEscape(id)}"]`
  );
  return el && el.isConnected ? el : null;
}

/** Derive a short, human label for a target element. */
function labelFor(el: HTMLElement): string {
  const aria = el.getAttribute("aria-label");
  const placeholder =
    el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
      ? el.placeholder
      : "";
  const raw = (aria || el.textContent || placeholder || "").trim();
  return raw.replace(/\s+/g, " ").slice(0, 60);
}

/**
 * Scan the current page for AI-targetable controls (elements carrying
 * `data-ai-target`). Hosts call this in `getContext()` and pass the result as
 * `pageContext.uiTargets`, so each turn the model knows exactly what it can
 * point at — no selectors, just ids the host controls. Deduped, capped.
 */
export function scanAiTargets(max = 40): AiTargetInfo[] {
  if (typeof document === "undefined") return [];
  const out: AiTargetInfo[] = [];
  const seen = new Set<string>();
  const els = document.querySelectorAll<HTMLElement>("[data-ai-target]");
  for (const el of Array.from(els)) {
    const id = el.getAttribute("data-ai-target");
    if (!id || seen.has(id)) continue;
    // Skip things the user can't see (display:none / detached) — pointing at a
    // hidden control just confuses.
    if (!el.isConnected || el.offsetParent === null) {
      // offsetParent is null for position:fixed too; keep those if they have size.
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
    }
    seen.add(id);
    out.push({ id, label: labelFor(el) });
    if (out.length >= max) break;
  }
  return out;
}

const OVERLAY_ID = "sgiant-ai-ui-highlight";
const KEYFRAMES_ID = "sgiant-ai-ui-highlight-kf";

/** Inject the pulse keyframes once. */
function ensureKeyframes(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById(KEYFRAMES_ID)) return;
  const style = document.createElement("style");
  style.id = KEYFRAMES_ID;
  style.textContent = `@keyframes sgiant-ai-ui-pulse{
    0%,100%{box-shadow:0 0 0 2px rgba(250,113,45,.9),0 0 0 6px rgba(250,113,45,.22)}
    50%{box-shadow:0 0 0 2px rgba(250,113,45,1),0 0 0 10px rgba(250,113,45,.06)}
  }`;
  document.head.appendChild(style);
}

let clearTimer: number | undefined;

/** Pulse a ring around an element for a few seconds, tracking its position on
 *  scroll/resize, then auto-remove. Reversible and non-interactive. */
function highlightEl(el: HTMLElement, ms = 3500): void {
  if (typeof document === "undefined") return;
  ensureKeyframes();
  clearHighlight();
  const pad = 6;
  const ring = document.createElement("div");
  ring.id = OVERLAY_ID;
  ring.setAttribute("aria-hidden", "true");
  Object.assign(ring.style, {
    position: "fixed",
    borderRadius: "10px",
    pointerEvents: "none",
    zIndex: "2147483000",
    animation: "sgiant-ai-ui-pulse 1.1s ease-in-out infinite",
  } as CSSStyleDeclaration);
  const place = (): void => {
    const r = el.getBoundingClientRect();
    ring.style.top = `${r.top - pad}px`;
    ring.style.left = `${r.left - pad}px`;
    ring.style.width = `${r.width + pad * 2}px`;
    ring.style.height = `${r.height + pad * 2}px`;
  };
  place();
  document.body.appendChild(ring);
  const onMove = (): void => place();
  window.addEventListener("scroll", onMove, true);
  window.addEventListener("resize", onMove);
  const cleanup = (): void => {
    window.removeEventListener("scroll", onMove, true);
    window.removeEventListener("resize", onMove);
    ring.remove();
  };
  // Stash cleanup on the node so clearHighlight() can call it.
  (ring as unknown as { _cleanup: () => void })._cleanup = cleanup;
  clearTimer = window.setTimeout(clearHighlight, ms);
}

/** Remove any active highlight ring. */
export function clearHighlight(): void {
  if (typeof document === "undefined") return;
  if (clearTimer) {
    window.clearTimeout(clearTimer);
    clearTimer = undefined;
  }
  const existing = document.getElementById(OVERLAY_ID);
  if (existing) {
    (existing as unknown as { _cleanup?: () => void })._cleanup?.();
    existing.remove();
  }
}

/**
 * Run one read-only UI-control action against a target id. Returns true when the
 * element was found and acted on. Called by the host-action handlers when the AI
 * emits `[[action:{"name":"highlight","data":{"target":"<id>"}}]]`.
 */
export function runUiControl(
  action: UiControlAction,
  targetId: string
): boolean {
  const el = resolveTarget(targetId);
  if (!el) return false;
  switch (action) {
    case "highlight":
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      highlightEl(el);
      return true;
    case "scroll-to":
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      return true;
    case "focus-field":
      el.scrollIntoView({ block: "center" });
      el.focus?.();
      return true;
    default:
      return false;
  }
}

// --- Operate actions (phase 2) -------------------------------------------------
// fill / click CHANGE state, so — unlike the read-only nudges above — they are
// ALWAYS confirm-gated: the widget forces a Confirm/Cancel step before dispatch
// (see renderAction), even in auto-navigate mode. The host still owns id→element
// resolution; the model only names an id from the catalog + a value.

/** State-changing UI actions the AI may request (always confirm-gated). */
export const OPERATE_ACTIONS = ["fill", "click"] as const;
export type OperateAction = (typeof OPERATE_ACTIONS)[number];

/** True when `name` is a state-changing (confirm-required) UI action. */
export function isOperateAction(name: string): name is OperateAction {
  return (OPERATE_ACTIONS as readonly string[]).includes(name);
}

/** Set a React-controlled input's value so React's onChange still fires — React
 *  tracks the value via a native setter it patches; we call the real one. */
function setNativeValue(
  el: HTMLInputElement | HTMLTextAreaElement,
  value: string
): void {
  const proto =
    el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
}

/**
 * Run one state-changing UI action against a target id. Returns true when the
 * element was found and acted on. Only reached AFTER the user confirms in the
 * widget (renderAction forces a Confirm step for operate actions).
 */
export function runOperateAction(
  action: OperateAction,
  targetId: string,
  value?: string
): boolean {
  const el = resolveTarget(targetId);
  if (!el) return false;
  switch (action) {
    case "fill": {
      if (
        !(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)
      )
        return false;
      el.scrollIntoView({ block: "center" });
      setNativeValue(el, value ?? "");
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }
    case "click":
      el.scrollIntoView({ block: "center" });
      el.click();
      return true;
    default:
      return false;
  }
}
