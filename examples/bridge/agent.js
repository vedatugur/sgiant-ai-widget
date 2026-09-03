/**
 * The AGENT — runs INSIDE a framed page and lets a controlling parent (the AI
 * chat widget) see and drive that page over `postMessage`. This is the piece a
 * page installs to become AI-operable; it works same-origin AND cross-origin
 * (the whole point — a cross-origin parent can't reach the DOM directly).
 *
 * It reuses the pure-DOM primitives (`scanAiTargets` / `runUiControl` /
 * `runOperateAction`), so what the AI can point at is exactly what the page
 * tagged with `data-ai-target` — no selectors cross the boundary. Every action
 * highlights its target as it runs, so the user watching the frame sees what the
 * AI touched.
 */
import { scanAiTargets, runUiControl, runOperateAction, clearHighlight, isUiControlAction, isOperateAction, } from "./dom-control.js";
import { BRIDGE_CHANNEL, BRIDGE_VERSION, isBridgeMessage, isBridgeAction, originAllowed, } from "./protocol.js";
const curPath = () => typeof location === "undefined" ? "" : location.pathname + location.search;
/**
 * Install the agent. No-op (returns an inert handle) when not framed — a page
 * can safely always call this; it only wakes up when embedded by a parent.
 */
export function mountAiAgent(opts = {}) {
    const inert = { publish: () => { }, destroy: () => { } };
    if (typeof window === "undefined" || window.parent === window)
        return inert;
    const allowed = opts.allowedOrigins ??
        (typeof location !== "undefined" ? [location.origin] : "*");
    const parent = window.parent;
    // Where we POST our messages. Same-origin embedding → our own origin. For a
    // cross-origin parent, derive it from the referrer (the embedder's URL).
    let targetOrigin = typeof location !== "undefined" ? location.origin : "*";
    try {
        if (document.referrer)
            targetOrigin = new URL(document.referrer).origin;
    }
    catch {
        /* keep default */
    }
    // If the caller allow-listed exactly one origin, trust it as the post target.
    if (Array.isArray(allowed) && allowed.length === 1)
        targetOrigin = allowed[0];
    const post = (msg) => {
        try {
            parent.postMessage(msg, targetOrigin);
        }
        catch {
            /* parent gone */
        }
    };
    const publish = () => {
        post({
            ch: BRIDGE_CHANNEL,
            v: BRIDGE_VERSION,
            type: "targets",
            targets: scanAiTargets(),
            path: curPath(),
        });
    };
    const onMessage = (ev) => {
        if (ev.source !== parent)
            return;
        if (!originAllowed(ev.origin, allowed))
            return;
        const data = ev.data;
        if (!isBridgeMessage(data))
            return;
        const msg = data;
        if (msg.type === "scan") {
            publish();
            return;
        }
        if (msg.type === "clear-highlight") {
            clearHighlight();
            return;
        }
        if (msg.type === "act") {
            if (!isBridgeAction(msg.action)) {
                post({
                    ch: BRIDGE_CHANNEL,
                    v: BRIDGE_VERSION,
                    type: "result",
                    id: msg.id,
                    ok: false,
                    message: "unknown action",
                });
                return;
            }
            let ok = false;
            if (isUiControlAction(msg.action))
                ok = runUiControl(msg.action, msg.target);
            else if (isOperateAction(msg.action))
                ok = runOperateAction(msg.action, msg.target, msg.value);
            post({
                ch: BRIDGE_CHANNEL,
                v: BRIDGE_VERSION,
                type: "result",
                id: msg.id,
                ok,
                message: ok ? "done" : "target not found on the page",
            });
            // The DOM likely changed (a click/fill) — re-publish the catalog so the
            // parent's next turn sees the new state.
            if (ok)
                scheduleRescan();
        }
    };
    // Re-publish the catalog when the page changes (route change, async content).
    let rescanTimer;
    const scheduleRescan = () => {
        if (rescanTimer)
            window.clearTimeout(rescanTimer);
        rescanTimer = window.setTimeout(publish, opts.rescanDebounceMs ?? 400);
    };
    const observer = typeof MutationObserver !== "undefined"
        ? new MutationObserver(scheduleRescan)
        : null;
    observer?.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["data-ai-target"],
    });
    window.addEventListener("message", onMessage);
    // Announce readiness + publish the first catalog once the DOM is up.
    const announce = () => {
        post({
            ch: BRIDGE_CHANNEL,
            v: BRIDGE_VERSION,
            type: "hello",
            path: curPath(),
        });
        publish();
    };
    if (document.readyState === "complete" ||
        document.readyState === "interactive")
        announce();
    else
        window.addEventListener("DOMContentLoaded", announce, { once: true });
    return {
        publish,
        destroy: () => {
            window.removeEventListener("message", onMessage);
            observer?.disconnect();
            if (rescanTimer)
                window.clearTimeout(rescanTimer);
            clearHighlight();
        },
    };
}
//# sourceMappingURL=agent.js.map