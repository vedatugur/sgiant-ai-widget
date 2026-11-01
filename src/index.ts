/**
 * `sgiant-ai-widget` — the public entry.
 *
 * Everything here is the package's promise to an embedder, and changing it is
 * a major. Since 2.0.0 (audit F137) that is the window itself, the site
 * window, the host-actions helpers a page wires its own actions with, and the
 * labels. The rest moved:
 *   - sgiant's own hosts read the pieces only they use from `./internal`,
 *     which carries no compatibility promise;
 *   - the widget's own surface manifest is in `./manifest`;
 *   - the agent bridge's API (scanAiTargets, generateManifest, …) is imported
 *     from `sgiant-ai-agent-bridge` itself, not re-exported here.
 */

export {
  createAiChatWidget,
  createSiteChat,
  type AiChatWidgetOptions,
  type AiChatWidgetHandle,
  type DirectiveRenderer,
  type LauncherState,
  type WidgetNotice,
  type WidgetJobView,
} from "./widget";
export type { SiteChatOptions } from "./site-chat";
export type { ModelOption } from "./model-picker";

// A saved conversation, replayed into the window: the server payload in,
// render items out.
export { buildThreadReplay, type LoadedThreadItem } from "./replay";

// The host protocol: the page context a host sends with a turn, its page
// manifest, and the handler for the actions the model names. The widget runs
// `navigate` and the on-page controls itself; a host adds its own actions
// through `handlers` and names the ones that only open a view in the window's
// `navigationActions`.
export {
  makePageContext,
  matchManifest,
  isKnownNavTarget,
  createHostActions,
  isNavigationAction,
  isCurrentLocation,
  type PageContext,
  type PageManifestEntry,
  type NavTarget,
  type AppSurface,
  type HostActionsConfig,
  type HostActionHandler,
} from "./host-actions";

// The window's words: the English defaults, and the helper a host passes only
// the labels it words differently through.
export {
  WIDGET_LABELS,
  widgetLabelOverrides,
  type WidgetLabels,
  type WidgetLabelI18n,
  type WidgetLabelSource,
  type WidgetLabelTranslate,
} from "./labels";
