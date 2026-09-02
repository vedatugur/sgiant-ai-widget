/**
 * The constants this widget used to import from `@sgiant/shared`, inlined.
 *
 * #306 requires the published core to have ZERO `@sgiant/*` runtime
 * dependencies — a stranger installing the widget from npm cannot resolve a
 * package that lives in our private registry, and three numbers are not a
 * reason to make them try.
 *
 * BUT inlining is the exact move that created the bug `@sgiant/shared`'s
 * `chat-attachment-limits.ts` was written to end: the client caps and the api's
 * turn-time caps were four independent literals, so a 10 MB PNG passed every
 * client check, uploaded fine, showed as a chip, and was silently dropped when
 * the turn resolved it.
 *
 * So the copy is gated instead of trusted: a drift test in the host repo
 * asserts every value here equals its `@sgiant/shared` original. The test is a
 * monorepo devDependency, so it costs the published package nothing and still
 * fails the build the moment the two drift.
 *
 * If you change a number here, change it in `@sgiant/shared` too — or rather,
 * change it there and let the test tell you about this file.
 */

/** Attachments per message (composer slots AND turn-time resolution). */
export const CHAT_ATTACHMENT_MAX_COUNT = 6;

/** Client-side transport cap per file. */
export const CHAT_ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;

/** Transport cap for an attached VIDEO or AUDIO file — much larger, because
 *  25 MB is a document number and a 30-second 1080p phone clip is already past
 *  it. A clip is stored as an asset and referenced BY ID, never sent as bytes. */
export const CHAT_ATTACHMENT_MAX_AV_BYTES = 100 * 1024 * 1024;

/** The locale tags the host may pass. Was `import type { Locale }` from
 *  `@sgiant/shared`; a type import erases at runtime but still puts the package
 *  in the manifest, which is what publishing reads. */
export type Locale = "en" | "tr";

/**
 * The six motion custom properties the stylesheet reads, previously
 * `motionCssVars()` from `@sgiant/tokens`.
 *
 * Kept as a function with the same shape so the call site is unchanged, and
 * gated by the same drift test.
 */
export function motionCssVars(): string {
  return [
    `--duration-fast: 150ms;`,
    `--duration-base: 300ms;`,
    `--duration-slow: 600ms;`,
    `--ease-out: cubic-bezier(0.22, 1, 0.36, 1);`,
    `--ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);`,
    `--ease-drawer: cubic-bezier(0.32, 0.72, 0, 1);`,
  ].join("\n");
}
