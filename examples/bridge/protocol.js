/**
 * Channel tag on every message — filters out unrelated postMessage traffic.
 *
 * This is a WIRE value and part of this package's public contract. A parent and
 * a page-side that disagree about it never see each other AT ALL: every
 * listener filters on the channel before `BRIDGE_VERSION` is consulted, so a
 * mismatch is silence rather than an error anything can catch — the parent
 * simply lists no targets. Keep both halves of a deployment on versions that
 * agree, and treat any change to it as breaking.
 */
export const BRIDGE_CHANNEL = "ai-agent-bridge";
/** Protocol version — bump on any breaking shape change. */
export const BRIDGE_VERSION = 1;
/** The action verbs the parent may ask the agent to run. Navigation is handled
 *  by the parent itself (it owns the frame's URL), so it is NOT in this list. */
export const BRIDGE_ACTIONS = [
    "highlight",
    "scroll-to",
    "focus-field",
    "fill",
    "click",
];
export function isBridgeAction(name) {
    return BRIDGE_ACTIONS.includes(name);
}
/** Type-guard: is `data` a well-formed message on our channel+version? */
export function isBridgeMessage(data) {
    return (typeof data === "object" &&
        data !== null &&
        data.ch === BRIDGE_CHANNEL &&
        data.v === BRIDGE_VERSION &&
        typeof data.type === "string");
}
/** Decide whether an incoming message's origin is permitted. `"*"` allows any
 *  (only sensible same-origin); otherwise the origin must be in the list. */
export function originAllowed(origin, allowed) {
    if (allowed === "*")
        return true;
    return allowed.includes(origin);
}
//# sourceMappingURL=protocol.js.map