/**
 * A CHAT ON A SITE THAT ASKS FIRST WHETHER IT MAY BE THERE.
 *
 * `createAiChatWidget` draws its launcher the moment it is called: right for
 * an app that has already decided the assistant belongs on the page. A
 * visitor's page is different. The script may sit in a cached copy of the
 * page long after the site's owner turned the assistant off, or before they
 * wrote anything for it to answer from; and a button that appears and then
 * vanishes is worse than no button.
 *
 * So the site entry reads the site's public settings FIRST and puts nothing
 * in the page until the server has said, in so many words, that this site's
 * assistant answers visitors now. No launcher, no frame, no stylesheet.
 *
 * CLOSED ON EVERY FAILURE. Nothing is drawn when the read fails, takes too
 * long, answers anything but a 200, answers something that is not an
 * object, or does not say `answersVisitors: true` with a real `true`. An
 * absent field means no: an older server and this window agree by default.
 *
 * The other fields are how the window looks, and are judged one by one: a
 * colour that is not a colour is ignored and the default is used. A wrong
 * colour is not a reason to take a site's assistant away.
 *
 * This file is the reading; `createSiteChat` in `./index` does the drawing.
 */

/** What a site's owner has set for its window. Null: the window's default. */
export interface SiteSettings {
  /** The window's title. */
  name: string | null;
  /** The first thing the assistant says. */
  greeting: string | null;
  /** The window's own words. Null: follow the page. */
  language: "tr" | "en" | null;
  /** One accent colour, `#rrggbb`, lower case. */
  color: string | null;
  /** Questions offered as buttons before the visitor types. At most four. */
  suggestions: string[];
}

export interface SiteChatOptions {
  /** Where a visitor's question is sent. */
  endpoint: string;
  /** The site's public key. In the page's own source; not a secret. */
  siteKey: string;
  /** Where the site's public settings are read from. */
  settingsUrl: string;
  /**
   * The language of the page the visitor is on, when the page's own
   * `<html lang>` cannot be relied on. The site's `language` setting, when it
   * has one, comes first.
   */
  locale?: string;
  /** How long the settings may take, in milliseconds. Default 4000. */
  timeoutMs?: number;
}

export const SITE_SETTINGS_TIMEOUT_MS = 4000;

const NAME_MAX = 80;
const GREETING_MAX = 500;
const SUGGESTION_MAX = 80;
const SUGGESTIONS_MAX = 4;

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

/**
 * The settings in a server's answer, or null when the answer does not say
 * that this site's assistant answers visitors.
 */
export function readSiteSettings(body: unknown): SiteSettings | null {
  if (typeof body !== "object" || body === null || Array.isArray(body))
    return null;
  const b = body as Record<string, unknown>;
  // A real `true`. Not "true", not 1, not a missing field.
  if (b.answersVisitors !== true) return null;
  const color =
    typeof b.color === "string" && /^#[0-9a-f]{6}$/i.test(b.color.trim())
      ? b.color.trim().toLowerCase()
      : null;
  const suggestions = Array.isArray(b.suggestions)
    ? b.suggestions
        .map((s) => text(s, SUGGESTION_MAX))
        .filter((s): s is string => s !== null)
        .slice(0, SUGGESTIONS_MAX)
    : [];
  return {
    name: text(b.name, NAME_MAX),
    greeting: text(b.greeting, GREETING_MAX),
    language: b.language === "tr" || b.language === "en" ? b.language : null,
    color,
    suggestions,
  };
}

/** The settings address with the site's key on it. */
export function siteSettingsAddress(settingsUrl: string, siteKey: string): string {
  const join = settingsUrl.includes("?") ? "&" : "?";
  return `${settingsUrl}${join}siteKey=${encodeURIComponent(siteKey)}`;
}

/**
 * What the server said about this site, in the three ways that matter.
 *
 * `no` is the SERVER saying so: a 200 without a real `true`, or a 404 (no
 * such site). `unknown` is everything in which nobody answered the question:
 * a failed request, no answer in time, the server's own trouble, too many
 * requests, a body that is not the shape. Both draw nothing. They differ in
 * what happens to a conversation kept in the visitor's tab: a `no` removes
 * it, an `unknown` leaves it, because one bad connection must not erase what
 * a guest wrote in the middle of their visit.
 */
export type SiteAnswer =
  | { answer: "yes"; settings: SiteSettings }
  | { answer: "no" }
  | { answer: "unknown" };

/**
 * Ask the server. Never throws.
 * No cookies are sent: the key is the whole of what the server needs.
 */
export async function askSite(
  opts: Pick<SiteChatOptions, "settingsUrl" | "siteKey" | "timeoutMs">
): Promise<SiteAnswer> {
  if (
    typeof opts.settingsUrl !== "string" ||
    !opts.settingsUrl.trim() ||
    typeof opts.siteKey !== "string" ||
    !opts.siteKey.trim()
  )
    return { answer: "unknown" };
  const limit =
    typeof opts.timeoutMs === "number" && opts.timeoutMs > 0
      ? opts.timeoutMs
      : SITE_SETTINGS_TIMEOUT_MS;
  const stop = new AbortController();
  const timer = setTimeout(() => stop.abort(), limit);
  try {
    const res = await fetch(siteSettingsAddress(opts.settingsUrl, opts.siteKey), {
      method: "GET",
      credentials: "omit",
      signal: stop.signal,
    });
    if (res.status === 404) return { answer: "no" };
    if (res.status !== 200) return { answer: "unknown" };
    // The body is read inside the limit too: headers that arrive in time
    // and a body that never ends is still "took too long".
    const body: unknown = await res.json();
    if (typeof body !== "object" || body === null || Array.isArray(body))
      return { answer: "unknown" };
    const settings = readSiteSettings(body);
    return settings ? { answer: "yes", settings } : { answer: "no" };
  } catch {
    return { answer: "unknown" };
  } finally {
    clearTimeout(timer);
  }
}

/** The settings when the answer is yes, else null. */
export async function fetchSiteSettings(
  opts: Pick<SiteChatOptions, "settingsUrl" | "siteKey" | "timeoutMs">
): Promise<SiteSettings | null> {
  const said = await askSite(opts);
  return said.answer === "yes" ? said.settings : null;
}

/** The name a site's conversation is kept under: one per site key. */
export function siteChatKey(siteKey: string): string {
  return `site:${siteKey}`;
}

/**
 * Remove what a site chat kept in this tab: the conversation, its id, the
 * text typed and not yet sent, where the window was. All of it, or all but
 * what belongs to `keep`.
 *
 * With no `keep`: the server said this site's assistant does not answer
 * visitors. With one: the window is about to be drawn for that key, and
 * anything kept under ANOTHER key is from before the site's key changed; it
 * could never be shown again and must not stay behind.
 *
 * Only the tab's storage is touched, and only names this window writes.
 */
export function forgetSiteChats(keep?: string): void {
  try {
    const mine = /^[^:]+:(?:v1|draft|open|pos|model|jobs|adv|advw):site:(.*)$/;
    for (const name of Object.keys(sessionStorage)) {
      const found = mine.exec(name);
      if (found && found[1] !== keep) sessionStorage.removeItem(name);
    }
  } catch {
    /* storage refused: there is nothing kept to remove */
  }
}
