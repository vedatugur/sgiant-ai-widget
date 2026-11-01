/**
 * `sgiant-ai-widget/internal` — what sgiant's own hosts read, and nobody else
 * should (audit F137).
 *
 * These are real, used exports: the admin and org apps, `@sgiant/ai-apply`,
 * the site editor and the WordPress plugin import them. They are kept out of
 * the main entry because they are sgiant's wiring rather than an embedder's
 * API, so they carry NO compatibility promise: a minor may change them, and
 * the hosts move with the pin.
 */

// The window event that opens the assistant panel, and the AI-change channel
// a finished job or an applied proposal is announced on.
export { OPEN_ASSISTANT_EVENT, createSiteChatPreview } from "./widget";
export { broadcastAiChange, subscribeAiChange } from "./ai-invalidation";

// The floor every sgiant proposal sentence ends on (@sgiant/ai-apply).
export { genericProposalSummary } from "./proposal-summary";

// A WordPress admin page without a token is told so, not shown an error.
export { readTokenRefusal, type TokenRefusal } from "./token-refusal";

// The gate a model-written path passes before anything opens it.
export { gateNavigationTarget } from "./safe-url";

// The Turkish words built into the window, for the hosts' parity checks.
export { WIDGET_LABELS_TR, WIDGET_OPTION_WORDS_TR } from "./labels-tr";

// How long the site window waits for its settings before drawing nothing.
export { SITE_SETTINGS_TIMEOUT_MS } from "./site-chat";

/**
 * The assistant's character mark, for sgiant's OWN surfaces.
 *
 * Not the default, because the default is the sgiant brand crescent and that
 * is what an embedder on their own site should get. Pass this with
 * `markMotionMode: "stepped"` — it is a flat mark and the spring default is
 * built for a curved, glossy one.
 */
export { CHROME_MARK } from "./mark-chrome";

/**
 * The launcher tokens CHROME_MARK is drawn for — pass as `theme`. Separate from
 * the mark because artwork and host theming are different things: a host can
 * take the mark and keep its own launcher.
 */
export { CHROME_LAUNCHER } from "./mark-chrome-launcher";
