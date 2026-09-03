/**
 * sgiant-ai-agent-bridge — make any web page AI-operable, and let an embedder
 * (our AI chat widget, or your own) see and drive it.
 *
 * Two halves of one generic, framework-agnostic contract:
 *   - `mountAiAgent()` runs INSIDE the page you want driven (same-origin or
 *     cross-origin). It publishes the page's `data-ai-target` controls and
 *     executes highlight / scroll / focus / fill / click on them, drawing a
 *     highlight so the user sees each action. No selectors ever cross the wire.
 *   - `createFrameTransport(iframe)` runs in the PARENT. It collects the catalog
 *     and sends actions, resolving each with the agent's result.
 *
 * The low-level DOM primitives are exported too, so a same-origin parent can
 * skip the postMessage hop and act on a frame's document directly if it wants.
 */
export * from "./dom-control.js";
export * from "./protocol.js";
export * from "./agent.js";
export * from "./transport.js";
//# sourceMappingURL=index.js.map