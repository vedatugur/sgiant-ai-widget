/**
 * Every persisted value the widget owns, and the two rules that govern all of
 * them.
 *
 * Extracted from index.ts (#320). Storage was not one region of that file — it
 * was 33 `localStorage` touches spread across 8 key-scoped concerns, from the
 * draft textarea to the launcher position to the advanced-pane width. Each site
 * re-implemented the same two rules, which is how they drifted:
 *
 *   1. AN EMPTY KEY MEANS PERSISTENCE IS OFF. Most keys are derived from
 *      `opts.persistKey`, which is optional: no persistKey, no writing to a
 *      visitor's browser. That was eight separate `if (!key) return` guards.
 *   2. BLOCKED STORAGE IS NON-FATAL. Private windows, cleared site data and
 *      "block third-party cookies" all throw on access rather than returning
 *      null, so every read and every write needs a try/catch. That was ten
 *      of them, each with its own comment saying the same thing.
 *
 * THE ONE PLACE THOSE RULES ARE NOT UNIFORM is the point of collecting them.
 * `hasOpenedBefore` returns TRUE when storage is unreadable, while every other
 * flag defaults to false. That is deliberate — a returning reader should get
 * the quiet pebble, not the first-visit pill on every single page load — but in
 * index.ts it was one `return true` inside one of ten identical-looking catch
 * blocks, indistinguishable from a typo. Here it is an argument with a name.
 *
 * These helpers take the key rather than closing over it, so they are callable
 * from anywhere and testable without constructing a widget.
 */

/**
 * A key that names a real slot.
 *
 * "Persistence is off" is spelled TWO ways in the caller — `null` for the five
 * keys derived from `opts.persistKey`, `""` for the two derived from the
 * advanced pane. Neither spelling is wrong and unifying them in index.ts would
 * be a behaviour-free diff across a 5800-line file, so this is the one place
 * that has to know both, and the only place that should.
 */
type StorageKey = string | null | undefined;
const live = (key: StorageKey): key is string => Boolean(key);

/**
 * Read a string. Returns `fallback` when the key is off, absent, or storage is
 * unreadable — the three cases callers have never needed to tell apart.
 */
export function readItem(key: StorageKey, fallback = ""): string {
  if (!live(key)) return fallback;
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

/** Write a string, or REMOVE the key when given an empty value or null. */
export function writeItem(key: StorageKey, value: string | null): void {
  if (!live(key)) return;
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    /* storage full or blocked — the value just does not persist */
  }
}

/**
 * Read a `"1"`/`"0"` flag.
 *
 * ABSENT AND UNREADABLE ARE DIFFERENT STATES, and collapsing them is a bug this
 * function was written with and had to have removed. A key that is simply not
 * set means "false" — the flag has never been turned on. `whenUnavailable` is
 * only for the case where storage THREW, i.e. the answer is unknowable rather
 * than no.
 *
 * The distinction is invisible in four of the five callers, whose answer is
 * false either way. In the fifth it inverts the first-visit experience: a
 * first-ever visitor has no `sg_ayca_opened` key, and answering "unavailable"
 * there would greet them as a returning reader and suppress the pill they are
 * supposed to see.
 */
export function readFlag(key: StorageKey, whenUnavailable = false): boolean {
  if (!live(key)) return false;
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return whenUnavailable;
  }
}

/** Write a `"1"`/`"0"` flag. */
export function writeFlag(key: StorageKey, on: boolean): void {
  writeItem(key, on ? "1" : "0");
}

/**
 * Read JSON and hand it to a validator before returning it.
 *
 * The validator is required rather than optional on purpose: everything in
 * localStorage was written by a PREVIOUS BUILD of this widget and may not match
 * the current shape. Two of the callers here already learned that — the tracked
 * jobs list deliberately accepts entries with no `kind` because a build that
 * predates the field wrote them, and dropping those would lose the card for
 * work still running across a deploy.
 */
export function readJson<T>(
  key: StorageKey,
  isValid: (value: unknown) => value is T
): T | null {
  if (!live(key)) return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isValid(parsed) ? parsed : null;
  } catch {
    return null; // corrupt, or unreadable — either way, start fresh
  }
}

/** Write JSON, or REMOVE the key when given null. */
export function writeJson(key: StorageKey, value: unknown | null): void {
  if (!live(key)) return;
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or blocked — non-fatal */
  }
}
