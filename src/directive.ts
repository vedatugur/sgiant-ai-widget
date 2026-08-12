/**
 * The `[[tag:{json}]]` directive extractor the chat widget runs over every
 * assistant reply.
 *
 * Lives in its own module because it is pure and because getting it wrong is
 * VISIBLE: whatever this function fails to consume is shown to the user as raw
 * text in the middle of a sentence. That makes it worth pinning down with
 * tests, which the widget itself (imperative DOM, no harness) cannot be.
 */

export interface ParsedDirective<T> {
  spec: T;
  /** The message with this directive removed. */
  stripped: string;
  start: number;
  /** Index just past everything consumed — the directive leaves no residue. */
  end: number;
}

/**
 * Pull the FIRST `[[tag:{json}]]` out of `text`.
 *
 * Forgiving by design, because the delimiters are the part a model gets wrong
 * most often and every slip is shown to the user as raw punctuation:
 *
 *  - the JSON object is BRACE-MATCHED, string- and escape-aware, so a `}` or
 *    `]]` inside a quoted caption cannot end it early;
 *  - 0–2 trailing `]` are consumed, so `…}]]`, `…}]` and `…}` all parse;
 *  - a surplus `}` before the brackets is consumed too. A model that closes one
 *    brace too many is common, and it used to leave `}]]` sitting in the reply:
 *    the matcher stopped at the REAL closing brace (correctly), then looked for
 *    `]`, found `}`, and gave up — so the card rendered perfectly and the user
 *    still saw `}]]` printed above it.
 *
 * Only ADJACENT residue is swallowed. Once a character is neither `}` nor `]`,
 * consumption stops, so nothing the assistant actually wrote is eaten.
 */
export function parseJsonDirective<T>(
  text: string,
  tag: string
): ParsedDirective<T> | null {
  const open = `[[${tag}:`;
  const start = text.indexOf(open);
  if (start < 0) return null;
  const braceStart = text.indexOf("{", start + open.length);
  if (braceStart < 0) return null;
  // Walk the JSON object, tracking string state, to find its true closing brace.
  let depth = 0;
  let inStr = false;
  let esc = false;
  let end = -1;
  for (let i = braceStart; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end < 0) return null;
  try {
    const spec = JSON.parse(text.slice(braceStart, end + 1)) as T;
    let after = end + 1;
    // Surplus closing braces the model added past the object's real end.
    // Bounded so a genuine `}` in following prose is never swallowed wholesale.
    let extraBraces = 0;
    while (text[after] === "}" && extraBraces < 3) {
      after++;
      extraBraces++;
    }
    // Then the closing brackets — 0, 1 or 2.
    if (text[after] === "]") after++;
    if (text[after] === "]") after++;
    const stripped = (text.slice(0, start) + text.slice(after)).trim();
    return { spec, stripped, start, end: after };
  } catch {
    return null;
  }
}
