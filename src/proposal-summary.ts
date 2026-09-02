/**
 * The GENERIC half of a confirm card: describe a tool call nobody has taught us
 * about, well enough that a person can approve or refuse it.
 *
 * The sgiant-specific half — fifteen branches phrasing sgiant's own tools, and
 * the titles that go with them — moved to `@sgiant/ai-apply` on 2026-09-02.
 * This package is published for anyone to embed, and a table of one company's
 * tool names is not something a stranger's users should be reading.
 *
 * What is left is what makes the widget SAFE to publish rather than merely safe
 * for sgiant: every host's own tools land here, and a blank card is a confirm
 * gate that confirms nothing. `tests/unit/proposal-summary.test.ts` pins that.
 *
 * A host phrases its own tools by passing `proposalSummary` — return a string to
 * override, or null to fall through to this.
 */

/** Render an unknown tool call from its arguments alone. */
export function genericProposalSummary(args: Record<string, unknown>): string {
  return Object.entries(args)
    .filter(([k]) => k !== "id")
    .map(([k, v]) => `${k}: ${describeArg(v)}`)
    .join("\n");
}

/**
 * One argument value, as a person can actually read it.
 *
 * `String(v)` on anything structured yields "[object Object]" — and on a list
 * of them, "[object Object],[object Object],[object Object]". A confirm card
 * that says that is asking the client to approve something they cannot see,
 * which is the one thing a confirm card must never do. Seen for real on a
 * three-scene storyboard: the whole point of the card is that the client
 * agrees the PLAN, and the plan was invisible.
 *
 * Deliberately a SUMMARY, not a JSON dump — a raw blob is technically honest
 * and just as unreadable. Objects are described by whichever of the handful
 * of naming fields they carry, so a scene reads as its title.
 */
function describeArg(v: unknown, depth = 0): string {
  if (v === null || v === undefined) return "—";
  if (Array.isArray(v)) {
    if (!v.length) return "(none)";
    // Nested lists are summarised by count rather than expanded: a card is a
    // glance, not a document.
    if (depth > 0) return `${v.length} items`;
    return v.map((x) => `\n  • ${describeArg(x, depth + 1)}`).join("");
  }
  if (typeof v === "object") {
    const rec = v as Record<string, unknown>;
    // The fields something calls itself by, in the order a human would look.
    const named = ["title", "name", "label", "key", "id"]
      .map((k) => (typeof rec[k] === "string" ? (rec[k] as string) : ""))
      .find(Boolean);
    const detail =
      typeof rec.prompt === "string"
        ? rec.prompt
        : typeof rec.caption === "string"
          ? rec.caption
          : typeof rec.description === "string"
            ? rec.description
            : "";
    if (named || detail)
      return [named, detail && `— ${detail.slice(0, 90)}`]
        .filter(Boolean)
        .join(" ");
    // Nothing self-describing: name its shape rather than lie about it.
    const keys = Object.keys(rec);
    return keys.length ? `{${keys.slice(0, 4).join(", ")}}` : "{}";
  }
  return String(v);
}
