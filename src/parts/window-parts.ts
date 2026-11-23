/**
 * WHAT THE WINDOW DOES WITH A `part` FRAME (sgiant-platform#701).
 *
 * The assistant draws a card, a button, a preview or one of the app's own
 * screens by calling a tool; the api checks the call against the parts
 * dictionary and sends it here as `{type:"part", part, spec}`. This window
 * says it reads such frames (`partsVersion` on every turn); a window that
 * does not say so is sent the same part as a `[[tag:{…}]]` in the text.
 *
 * So a part arrives one of two ways, and both end in ONE drawing path: the
 * frame is checked against this window's copy of the dictionary
 * (`generated/parts-dictionary.ts`, with `part-check.ts`, both word for word
 * from the platform) and then written into the reply as the very tag an
 * older api would have sent. Everything that draws a tag (the stream painter,
 * the end-of-turn pass, a reopened conversation) draws it, and there is no
 * second renderer to drift from the first.
 */
import { checkAgainstSchema, fillPagePath, tagJson } from "./part-check";
import { WINDOW_PARTS } from "./generated/parts-dictionary";

/** The most of the app's screens one reply shows, live and on replay. */
export const COMPONENTS_PER_REPLY = 4;

/** The dictionary this window reads, sent with every turn. */
export const PARTS_VERSION: number = WINDOW_PARTS.version;

/** One of the app's own screens, as the assistant named it. */
export interface ComponentSpec {
  name: string;
  params?: Record<string, unknown>;
  /** The card's title as the assistant wrote it ("October report"). */
  label?: string;
}

/**
 * A `part` frame as the tag it stands for, or why it is not drawn. Each
 * problem is the dictionary's own sentence (`spec.items[0].title must be a
 * string`), for the console: the person sees nothing of a part that does not
 * fit, rather than half of one.
 */
export function partFrameAsTag(
  part: unknown,
  spec: unknown,
): { tag: string } | { problems: string[] } {
  const name = typeof part === "string" ? part : "";
  const schema = WINDOW_PARTS.parts[name];
  if (!schema) return { problems: [`"${name}" is not a part this window knows`] };
  const problems = checkAgainstSchema(spec, { ...schema, type: "object" });
  if (problems.length) return { problems };
  return { tag: `[[${name}:${tagJson(spec)}]]` };
}

/**
 * Whether a component spec names one this window knows, with what its
 * params need; and the page it is on (relative to the account), which the
 * card's button opens beside the chat.
 */
export function checkComponent(
  spec: unknown,
):
  | {
      ok: true;
      spec: ComponentSpec;
      path: string;
      /** The component's own name, for a card the assistant gave none. */
      title: { en: string; tr: string };
    }
  | { ok: false } {
  if (!spec || typeof spec !== "object") return { ok: false };
  const s = spec as ComponentSpec;
  const known =
    typeof s.name === "string" ? WINDOW_PARTS.components[s.name] : undefined;
  if (!known) return { ok: false };
  const params =
    s.params && typeof s.params === "object" && !Array.isArray(s.params)
      ? s.params
      : {};
  if (checkAgainstSchema(params, known.params, "spec.params").length)
    return { ok: false };
  const path = fillPagePath(known.path, params);
  if (!path) return { ok: false };
  const label =
    typeof s.label === "string" && s.label.trim()
      ? s.label.trim().slice(0, 80)
      : undefined;
  return {
    ok: true,
    spec: { name: s.name, params, ...(label ? { label } : {}) },
    path,
    title: known.title,
  };
}
