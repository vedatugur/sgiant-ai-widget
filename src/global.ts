/**
 * The `<script src>` build's entry: `window.SgiantAiWidget`.
 *
 * A page with no bundler has no subpaths, so the global carries the public
 * entry AND `./internal` — the WordPress plugin and sgiant's embed snippet
 * read CHROME_MARK and friends from it.
 */
export * from "./index";
export * from "./internal";
