import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * The widget's source, as one string.
 *
 * These tests assert facts about THE WIDGET — "every button carries a focus
 * base", "reduced motion is gated at the keyframes" — and after #320 those
 * facts straddle several files: the behaviour in `index.ts`, the stylesheet in
 * `styles.ts`, the marks in `icons.ts`. Reading them all keeps an assertion
 * about the widget from becoming an assertion about a file, which is what broke
 * every one of them the moment the stylesheet moved.
 *
 * That they ALL failed on that split is worth recording: it proved they were
 * reading real content rather than passing vacuously.
 *
 * THE DIRECTORY, NOT A LIST. This started as `["index.ts", "styles.ts",
 * "prefix.ts"]` and broke again on the very next split, when the SVG marks
 * moved to `icons.ts` and "the SMIL blob is gone" went from a real check to a
 * check of a file that no longer contained any SVG at all. A hand-kept list of
 * "where the widget is" is a list that goes stale on exactly the commits these
 * tests exist to watch — and it fails GREEN as easily as red, which is worse.
 * #320 will keep splitting this package; the directory is the only definition
 * that survives it.
 */
const root = join(import.meta.dirname, "..", "src");

export const widgetSrc = readdirSync(root)
  .filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"))
  .sort()
  .map((f) => readFileSync(join(root, f), "utf8"))
  .join("\n");

/** Just the stylesheet module, for assertions that are about CSS alone. */
export const widgetStyles = readFileSync(join(root, "styles.ts"), "utf8");
