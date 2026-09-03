/**
 * Pure-DOM UI control — the framework-agnostic primitives that let an AI point at
 * and operate on-page controls by their stable `data-ai-target` id. No React, no
 * framework, no build step: it runs in ANY document — the host page, a detached
 * widget root, or (via the agent bridge) inside a framed page.
 *
 * This is the single source of truth for scanning targets and running actions.
 * `sgiant-ai-widget` re-exports it (for the local/same-origin path) and the
 * agent bridge in this package calls it (for the framed/postMessage path).
 *
 * SECURITY: callers never pass a selector — only a `data-ai-target` id. The
 * resolver below owns id→element lookup, so a controlling parent can never reach
 * arbitrary DOM, only the ids a page opted in by tagging.
 */
/** The read-only control actions (safe, reversible — never need a confirm). */
export const UI_CONTROL_ACTIONS = [
    "highlight",
    "scroll-to",
    "focus-field",
];
/** True when `name` is one of the read-only UI-control actions. */
export function isUiControlAction(name) {
    return UI_CONTROL_ACTIONS.includes(name);
}
/** Escape a value for use inside a `[data-ai-target="…"]` attribute selector. */
function attrEscape(s) {
    return s.replace(/["\\]/g, "\\$&");
}
/** Resolve a target id to its live element (null when absent/detached). */
function resolveTarget(id) {
    if (typeof document === "undefined")
        return null;
    const el = document.querySelector(`[data-ai-target="${attrEscape(id)}"]`);
    return el && el.isConnected ? el : null;
}
/** Derive a short, human label for a target element. */
function labelFor(el) {
    const aria = el.getAttribute("aria-label");
    const placeholder = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
        ? el.placeholder
        : "";
    const raw = (aria || el.textContent || placeholder || "").trim();
    return raw.replace(/\s+/g, " ").slice(0, 60);
}
/**
 * Scan the current document for AI-targetable controls (elements carrying
 * `data-ai-target`). Returns `{id,label}[]`, deduped and capped, skipping
 * controls the user can't see. The controlling side passes this as the catalog
 * the model may point at — no selectors, just ids the page opted in.
 */
export function scanAiTargets(max = 40) {
    if (typeof document === "undefined")
        return [];
    const out = [];
    const seen = new Set();
    const els = document.querySelectorAll("[data-ai-target]");
    for (const el of Array.from(els)) {
        const id = el.getAttribute("data-ai-target");
        if (!id || seen.has(id))
            continue;
        // Skip things the user can't see (display:none / detached) — pointing at a
        // hidden control just confuses.
        if (!el.isConnected || el.offsetParent === null) {
            // offsetParent is null for position:fixed too; keep those if they have size.
            const r = el.getBoundingClientRect();
            if (r.width === 0 && r.height === 0)
                continue;
        }
        seen.add(id);
        out.push({ id, label: labelFor(el) });
        if (out.length >= max)
            break;
    }
    return out;
}
// Deliberately generic ids. The overlay is injected into a page this library
// does not own, so it must not plant a vendor name in someone else's DOM.
// These two elements are the ONLY ones this package ever creates — if they
// collide with something in your page, rendering is the reason.
const OVERLAY_ID = "ai-bridge-highlight";
const KEYFRAMES_ID = "ai-bridge-highlight-kf";
/** Inject the pulse keyframes once. */
function ensureKeyframes() {
    if (typeof document === "undefined")
        return;
    if (document.getElementById(KEYFRAMES_ID))
        return;
    const style = document.createElement("style");
    style.id = KEYFRAMES_ID;
    style.textContent = `@keyframes ai-bridge-pulse{
    0%,100%{box-shadow:0 0 0 2px rgba(250,113,45,.9),0 0 0 6px rgba(250,113,45,.22)}
    50%{box-shadow:0 0 0 2px rgba(250,113,45,1),0 0 0 10px rgba(250,113,45,.06)}
  }`;
    document.head.appendChild(style);
}
let clearTimer;
/** Pulse a ring around an element for a few seconds, tracking its position on
 *  scroll/resize, then auto-remove. Reversible and non-interactive. */
function highlightEl(el, ms = 3500) {
    if (typeof document === "undefined")
        return;
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
        animation: "ai-bridge-pulse 1.1s ease-in-out infinite",
    });
    const place = () => {
        const r = el.getBoundingClientRect();
        ring.style.top = `${r.top - pad}px`;
        ring.style.left = `${r.left - pad}px`;
        ring.style.width = `${r.width + pad * 2}px`;
        ring.style.height = `${r.height + pad * 2}px`;
    };
    place();
    document.body.appendChild(ring);
    const onMove = () => place();
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    const cleanup = () => {
        window.removeEventListener("scroll", onMove, true);
        window.removeEventListener("resize", onMove);
        ring.remove();
    };
    // Stash cleanup on the node so clearHighlight() can call it.
    ring._cleanup = cleanup;
    clearTimer = window.setTimeout(clearHighlight, ms);
}
/** Remove any active highlight ring. */
export function clearHighlight() {
    if (typeof document === "undefined")
        return;
    if (clearTimer) {
        window.clearTimeout(clearTimer);
        clearTimer = undefined;
    }
    const existing = document.getElementById(OVERLAY_ID);
    if (existing) {
        existing._cleanup?.();
        existing.remove();
    }
}
/**
 * Run one read-only UI-control action against a target id. Returns true when the
 * element was found and acted on.
 */
export function runUiControl(action, targetId) {
    const el = resolveTarget(targetId);
    if (!el)
        return false;
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
// --- Operate actions -----------------------------------------------------------
// fill / click CHANGE state, so the controlling UI ALWAYS confirm-gates them
// before dispatch (see the widget's renderAction). The id→element resolution
// still lives here; the caller only names an id from the catalog + a value.
/** State-changing UI actions the AI may request (always confirm-gated). */
export const OPERATE_ACTIONS = ["fill", "click"];
/** True when `name` is a state-changing (confirm-required) UI action. */
export function isOperateAction(name) {
    return OPERATE_ACTIONS.includes(name);
}
/** Set a React-controlled input's value so React's onChange still fires — React
 *  tracks the value via a native setter it patches; we call the real one. */
function setNativeValue(el, value) {
    const proto = el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter)
        setter.call(el, value);
    else
        el.value = value;
}
/**
 * Run one state-changing UI action against a target id. Returns true when the
 * element was found and acted on. Callers reach this only AFTER the user
 * confirms (the widget forces a Confirm step for operate actions). Highlights
 * the target as it acts, so the user sees exactly what changed.
 */
export function runOperateAction(action, targetId, value) {
    const el = resolveTarget(targetId);
    if (!el)
        return false;
    switch (action) {
        case "fill": {
            if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement))
                return false;
            el.scrollIntoView({ block: "center" });
            highlightEl(el, 2200);
            setNativeValue(el, value ?? "");
            el.dispatchEvent(new Event("input", { bubbles: true }));
            el.dispatchEvent(new Event("change", { bubbles: true }));
            return true;
        }
        case "click":
            el.scrollIntoView({ block: "center" });
            highlightEl(el, 2200);
            el.click();
            return true;
        default:
            return false;
    }
}
//# sourceMappingURL=dom-control.js.map