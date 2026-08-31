/**
 * The directive vocabulary: what the model may emit inside `[[tag:{json}]]`,
 * and the parsing that turns it into something a renderer can draw.
 *
 * Extracted from index.ts (#320) at zero leakage. This is the half of the
 * widget's extension seam that #306 calls "a real extension point" — the model
 * emits a directive, the host registers a renderer, the widget hands over the
 * parsed JSON. A third party writing their own renderer needs these shapes,
 * and needs to find them without reading 7000 lines.
 *
 * `stripDirectivesForReplay` lives here rather than beside the replay code
 * because it is the same grammar read in the other direction: it removes
 * exactly what this file defines.
 */

import { parseJsonDirective } from "./directive";
import { el } from "./dom";
import { PREFIX } from "./prefix";

/** A data widget the assistant can render inline via `[[widget:{json}]]`. */
export interface WidgetSpec {
  /** "stat" | "kpis" | "list" | "table". Unknown kinds fall back to a list. */
  kind?: string;
  title?: string;
  /** stat: the big value + caption + optional delta. */
  value?: string | number;
  caption?: string;
  delta?: string;
  /** kpis: tiles of {label,value}. */
  items?: Array<{ label?: string; value?: string | number; delta?: string }>;
  /** list: plain bullet lines. */
  lines?: string[];
  /** table: header columns + row cells. */
  columns?: string[];
  rows?: Array<Array<string | number>>;
}

/** A navigation suggestion the assistant emits via `[[navigate:{json}]]`. */
export interface NavigateSpec {
  path: string;
  label?: string;
}

/** A dynamic HTML preview the assistant draws via `[[preview:{json}]]` — rendered
 *  in a fully sandboxed iframe (no scripts, no same-origin) so arbitrary HTML+CSS
 *  paints the real look but nothing can execute or reach out. */
export interface PreviewSpec {
  html: string;
  title?: string;
}

/** An in-app action the assistant proposes via `[[action:{json}]]`. The host
 *  maps `name` to a real operation; `confirm` (if set) requires user approval. */
export interface ActionSpec {
  name: string;
  label?: string;
  /** Confirmation prompt — when set, the user must approve before it runs. */
  confirm?: string;
  /** Opaque data passed to the host's onWidgetAction(name, data). */
  data?: Record<string, string>;
}

/** Quick-reply chips the assistant offers via `[[chips:{json}]]` — tappable
 *  answer options so the user picks instead of typing. Single-select sends on
 *  tap; multi-select toggles + a Send button; `other` adds a "type your own"
 *  chip. The chosen text is sent as a NORMAL message (history stays in order). */
export interface ChipsSpec {
  options: string[];
  multi?: boolean;
  other?: boolean;
}

/** Sentinel the assistant emits to ask the widget to render an email form. */
export const LEAD_TOKEN = "[[collect-email]]";

/** One field in an AI-rendered form directive. */
export interface FormField {
  name: string;
  label?: string;
  /** Kept in step with what `buildField` can actually draw — a spec allowed to
   *  ask for a control the builder cannot render is a promise to the model that
   *  the UI then breaks. */
  type?:
    | "text"
    | "email"
    | "number"
    | "textarea"
    | "select"
    | "checkbox"
    | "radio";
  placeholder?: string;
  required?: boolean;
  options?: string[];
}
export interface FormSpec {
  action: string;
  title?: string;
  fields: FormField[];
  submit?: string;
}

/**
 * A field the ASSISTANT asked the user to fill in on a proposal card.
 *
 * Declared by the proposal, never by the widget. A table of "which args are
 * editable for which tool" hardcoded in the UI would mean the chat can only
 * ever ask the questions the frontend was built to ask — a new tool, or a
 * decision the model wants confirmed, would need a UI release. The model knows
 * what it is unsure about; it says so, and the card renders it.
 *
 * Same shape as a `[[form:…]]` field, and built by the same `buildField`, so an
 * input looks identical wherever the chat draws one.
 */
export interface ProposalField {
  /** The proposal ARG this field overwrites on apply. */
  arg: string;
  label?: string;
  type?: string;
  placeholder?: string;
  options?: string[];
  required?: boolean;
}

/**
 * A control `buildField` produced, plus how to read its answer.
 *
 * The reader is part of the return value because "what the user chose" is not
 * `.value` for every control type — a checkbox is `.checked`, a radio group is
 * whichever of its inputs is checked — and every caller wants the same thing: a
 * string to put in the payload.
 */
export interface BuiltField {
  /** Append THIS — the control, or the wrapper a labelled/grouped one needs. */
  node: HTMLElement;
  read: () => string;
  /** The control draws its own caption; a caller adding one would double it. */
  selfLabelled?: boolean;
}

/** Truthiness for a prefilled checkbox — model output, so accept the obvious
 *  spellings rather than demanding exactly `"true"`. */
export function isTruthyValue(v: string | undefined): boolean {
  return ["true", "1", "yes", "on"].includes((v ?? "").trim().toLowerCase());
}

/** A proposal arg a field can be PREFILLED from: anything JSON-primitive, which
 *  is everything with one obvious rendering. Objects/arrays have none, and
 *  null/undefined mean the assistant proposed nothing for that arg. */
export function isPrimitiveArg(v: unknown): v is string | number | boolean {
  return (
    typeof v === "string" || typeof v === "number" || typeof v === "boolean"
  );
}

/** Read the fields off a proposal frame, defensively — this is model output. */
export function proposalFields(raw: unknown): ProposalField[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (f): f is ProposalField =>
        Boolean(f) &&
        typeof f === "object" &&
        typeof (f as ProposalField).arg === "string" &&
        Boolean((f as ProposalField).arg)
    )
    .slice(0, 6);
}

/** Pull a `[[form:{json}]]` directive out of assistant text, if present. Uses
 *  the shared brace-matching extractor, then validates the form shape. */
export function parseFormDirective(
  text: string
): { spec: FormSpec; stripped: string } | null {
  const r = parseJsonDirective<FormSpec>(text, "form");
  if (!r) return null;
  const { spec } = r;
  if (!spec || typeof spec.action !== "string" || !Array.isArray(spec.fields))
    return null;
  return r;
}

/**
 * REPLAY view of a stored message: strip every interactive directive (which the
 * live turn already rendered as buttons/forms) so a reopened conversation shows
 * clean prose instead of raw `[[navigate:…]]` / `[[form:…]]` code, with a short
 * INERT note per directive (no re-execution). Used by the history/thread
 * restore path; live turns still render the real interactive widgets.
 */
export function stripDirectivesForReplay(text: string): {
  clean: string;
  notes: string[];
  navs: NavigateSpec[];
  uis: unknown[];
} {
  let t = text;
  const notes: string[] = [];
  const uis: unknown[] = [];
  // Navigation is idempotent and side-effect-free, so on replay we hand it back
  // to be re-rendered as a REAL clickable chip rather than flattened to an inert
  // note — otherwise every "Open <page>" the assistant offered goes dead the
  // moment the thread reloads (which send() does after each turn for canonical
  // ids). This is the true cause of #111: the model DID emit [[navigate]], the
  // restore path is what killed it.
  const navs: NavigateSpec[] = [];
  for (let i = 0; i < 8; i++) {
    const w = parseJsonDirective<NavigateSpec>(t, "navigate");
    if (!w) break;
    t = w.stripped;
    if (w.spec.path) navs.push(w.spec);
    else notes.push(`↗ ${w.spec.label || "Open page"}`);
  }
  for (let i = 0; i < 8; i++) {
    const w = parseJsonDirective<ActionSpec>(t, "action");
    if (!w) break;
    t = w.stripped;
    notes.push(`• ${w.spec.label || w.spec.name}`);
  }
  for (let i = 0; i < 8; i++) {
    const w = parseJsonDirective<WidgetSpec>(t, "widget");
    if (!w) break;
    t = w.stripped;
    notes.push(`▦ ${w.spec.title || "widget"}`);
  }
  // Composed UI cards are handed BACK to be re-drawn, not flattened to a note.
  // A card is the substance of the turn, not a decoration on it: a client who
  // reopens the conversation tomorrow to look at the scenes they were approving
  // would otherwise find "▦ card" where the scenes had been. Re-drawing is safe
  // because every button on a card requires a click — nothing here can run by
  // itself on restore.
  for (let i = 0; i < 4; i++) {
    const u = parseJsonDirective<unknown>(t, "ui");
    if (!u) break;
    t = u.stripped;
    uis.push(u.spec);
  }
  for (let i = 0; i < 3; i++) {
    const p = parseJsonDirective<PreviewSpec>(t, "preview");
    if (!p) break;
    t = p.stripped;
    notes.push(`[preview] ${p.spec.title || "Preview"}`);
  }
  for (let i = 0; i < 4; i++) {
    const c = parseJsonDirective<ChipsSpec>(t, "chips");
    if (!c) break;
    t = c.stripped;
    notes.push("💬 options offered");
  }
  const f = parseFormDirective(t);
  if (f) {
    t = f.stripped;
    notes.push(`📝 ${f.spec.title || "Form"} — submitted`);
  }
  if (t.includes(LEAD_TOKEN)) {
    t = t.replace(LEAD_TOKEN, "").trim();
    notes.push("📝 Form — submitted");
  }
  return { clean: t, notes, navs, uis };
}

/**
 * Build one editable control for a proposal form, plus how to READ it back.
 *
 * Moved here from index.ts (#320) with ZERO closure dependencies — the whole
 * function reaches only `el`, `PREFIX`, and this file's own `BuiltField` and
 * `isTruthyValue`. It sat in the 6000-line closure purely because that is
 * where it was typed; nothing about it was ever widget state.
 *
 * `read` is the point of the return shape: every control answers as a STRING
 * whatever it was drawn as, because the submit path posts a flat
 * `Record<string, string>`. A checkbox that returned a boolean would be the
 * one field in the form with a different contract.
 */
export function buildField(field: {
  name: string;
  type?: string;
  label?: string;
  placeholder?: string;
  options?: string[];
  required?: boolean;
  value?: string;
}): BuiltField {
  const type = field.type ?? "text";
  // Boolean/choice controls carry their own caption — a bare 16px box with
  // the label somewhere above it reads as decoration, not as a question.
  if (type === "checkbox") {
    const row = el("label", `${PREFIX}-field-check`);
    const box = el("input", `${PREFIX}-check`) as HTMLInputElement;
    box.type = "checkbox";
    box.checked = isTruthyValue(field.value);
    if (field.required) box.required = true;
    row.appendChild(box);
    const cap = el("span", `${PREFIX}-field-check-label`);
    cap.textContent = field.label ?? field.placeholder ?? field.name;
    row.appendChild(cap);
    // Stringified so a field's answer is always a string, whatever it was
    // drawn as — the submit path posts a flat Record<string,string>.
    return {
      node: row,
      selfLabelled: true,
      read: () => (box.checked ? "true" : "false"),
    };
  }
  if (type === "radio" && field.options?.length) {
    const group = el("div", `${PREFIX}-field-group`);
    // The `name` attribute is what makes radios mutually exclusive, so it has
    // to be unique per rendered group — two proposal cards asking the same
    // question would otherwise fight over one selection.
    const groupName = `${PREFIX}-${field.name}-${Math.random().toString(36).slice(2, 9)}`;
    for (const o of field.options) {
      const row = el("label", `${PREFIX}-field-check`);
      const radio = el("input", `${PREFIX}-check`) as HTMLInputElement;
      radio.type = "radio";
      radio.name = groupName;
      radio.value = o;
      // Required propagates to the inputs (one required radio makes the whole
      // group required). It was dropped here, so a required choice reported
      // itself as answered while nothing was selected.
      if (field.required) radio.required = true;
      if (o === field.value) radio.checked = true;
      row.appendChild(radio);
      const cap = el("span", `${PREFIX}-field-check-label`);
      cap.textContent = o;
      row.appendChild(cap);
      group.appendChild(row);
    }
    return {
      node: group,
      read: () =>
        group.querySelector<HTMLInputElement>("input:checked")?.value ?? "",
    };
  }
  let input: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
  if (type === "textarea") {
    input = el("textarea", `${PREFIX}-field`) as HTMLTextAreaElement;
  } else if (type === "select") {
    const sel = el("select", `${PREFIX}-field`) as HTMLSelectElement;
    for (const o of field.options ?? []) {
      const opt = document.createElement("option");
      opt.value = o;
      opt.textContent = o;
      sel.appendChild(opt);
    }
    input = sel;
  } else {
    const i = el("input", `${PREFIX}-field`) as HTMLInputElement;
    i.type = type === "number" ? "number" : type;
    input = i;
  }
  if ("placeholder" in input && field.placeholder)
    (input as HTMLInputElement).placeholder = field.label
      ? `${field.label} — ${field.placeholder}`
      : field.placeholder;
  else if ("placeholder" in input && field.label)
    (input as HTMLInputElement).placeholder = field.label;
  if (field.required) (input as HTMLInputElement).required = true;
  // Prefilled: the card hands back a value the user can accept or rewrite.
  if (field.value !== undefined) input.value = field.value;
  return { node: input, read: () => input.value.trim() };
}
