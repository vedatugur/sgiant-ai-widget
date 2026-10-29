/**
 * SITE FORMS (sgiant-platform#550): a form the business built in the app,
 * drawn inside the chat on its own website when its assistant opens one.
 *
 * The assistant says WHICH form, and may suggest values it heard in the
 * conversation: `[[site-form:{"id":"…","prefill":{"<field id>":…}}]]`.
 * Everything drawn comes from the business's own definition, read from the
 * api when the form opens (GET /public/ai/site-forms), never from the model:
 * no field, label or option the model wrote reaches the visitor. A prefilled
 * value is only ever put into a field the form already has, and shown as
 * such ("filled in from your chat").
 *
 * The api checks every answer again; this file's own checks are there so a
 * visitor is told at once, in the window's words, which field to fix.
 */
import { parseJsonDirective } from "./directive";
import { el } from "./dom";
import { PREFIX } from "./prefix";

export const SITE_FORM_TAG = "site-form";

export type SiteFormFieldType =
  | "text"
  | "textarea"
  | "email"
  | "phone"
  | "number"
  | "date"
  | "dateRange"
  | "time"
  | "select"
  | "radio"
  | "multi"
  | "checkbox";

export interface SiteFormField {
  id: string;
  type: SiteFormFieldType;
  label: string;
  help?: string;
  required: boolean;
  options?: string[];
  min?: number;
  max?: number;
}

export interface SiteFormDef {
  id: string;
  name: string;
  fields: SiteFormField[];
  thanks: string | null;
}

export interface SiteForms {
  privacyUrl: string;
  consent: { tr: string; en: string };
  forms: SiteFormDef[];
}

export type SiteFormValue = string | string[] | { from: string; to: string };

export interface SiteFormDirective {
  id: string;
  prefill: Record<string, unknown>;
}

const TYPES: readonly string[] = [
  "text",
  "textarea",
  "email",
  "phone",
  "number",
  "date",
  "dateRange",
  "time",
  "select",
  "radio",
  "multi",
  "checkbox",
];

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** The first `[[site-form:…]]` in a reply, and the text without it. */
export function parseSiteFormDirective(
  text: string
): { spec: SiteFormDirective; stripped: string } | null {
  const r = parseJsonDirective<Record<string, unknown>>(text, SITE_FORM_TAG);
  if (!r) return null;
  const id = typeof r.spec?.id === "string" ? r.spec.id : "";
  return {
    spec: { id, prefill: isObj(r.spec?.prefill) ? r.spec.prefill : {} },
    stripped: r.stripped,
  };
}

/** The api's answer, read defensively: what does not fit is left out. */
export function readSiteForms(body: unknown): SiteForms | null {
  if (!isObj(body) || !Array.isArray(body.forms)) return null;
  const consent = isObj(body.consent) ? body.consent : {};
  if (
    typeof body.privacyUrl !== "string" ||
    !/^https:\/\//.test(body.privacyUrl) ||
    typeof consent.tr !== "string" ||
    typeof consent.en !== "string"
  )
    return null;
  const forms: SiteFormDef[] = [];
  for (const f of body.forms) {
    if (!isObj(f) || typeof f.id !== "string" || typeof f.name !== "string")
      continue;
    const fields: SiteFormField[] = [];
    for (const x of Array.isArray(f.fields) ? f.fields : []) {
      if (
        !isObj(x) ||
        typeof x.id !== "string" ||
        typeof x.label !== "string" ||
        typeof x.type !== "string" ||
        !TYPES.includes(x.type)
      )
        continue;
      const field: SiteFormField = {
        id: x.id,
        type: x.type as SiteFormFieldType,
        label: x.label,
        required: x.required === true,
      };
      if (typeof x.help === "string" && x.help) field.help = x.help;
      if (Array.isArray(x.options))
        field.options = x.options.filter(
          (o): o is string => typeof o === "string"
        );
      if (typeof x.min === "number") field.min = x.min;
      if (typeof x.max === "number") field.max = x.max;
      fields.push(field);
    }
    forms.push({
      id: f.id,
      name: f.name,
      fields,
      thanks: typeof f.thanks === "string" && f.thanks ? f.thanks : null,
    });
  }
  return {
    privacyUrl: body.privacyUrl,
    consent: { tr: consent.tr, en: consent.en },
    forms,
  };
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** A suggested value, kept only when it fits the field it names. */
export function prefillFor(
  field: SiteFormField,
  raw: unknown
): SiteFormValue | undefined {
  if (raw === undefined || raw === null) return undefined;
  switch (field.type) {
    case "dateRange":
      return isObj(raw) &&
        typeof raw.from === "string" &&
        typeof raw.to === "string" &&
        DATE.test(raw.from) &&
        DATE.test(raw.to)
        ? { from: raw.from, to: raw.to }
        : undefined;
    case "multi": {
      const list = (Array.isArray(raw) ? raw : [raw]).filter(
        (x): x is string =>
          typeof x === "string" && (field.options ?? []).includes(x)
      );
      return list.length ? list : undefined;
    }
    case "select":
    case "radio":
      return typeof raw === "string" && (field.options ?? []).includes(raw)
        ? raw
        : undefined;
    case "checkbox":
      return raw === true || raw === "true" ? "true" : undefined;
    case "date":
      return typeof raw === "string" && DATE.test(raw) ? raw : undefined;
    case "time":
      return typeof raw === "string" && TIME.test(raw) ? raw : undefined;
    case "number":
      return (typeof raw === "number" && Number.isFinite(raw)) ||
        (typeof raw === "string" && raw.trim() && Number.isFinite(Number(raw)))
        ? String(raw).trim()
        : undefined;
    default:
      return typeof raw === "string" && raw.trim()
        ? raw.trim().slice(0, field.type === "textarea" ? 2000 : 200)
        : undefined;
  }
}

/** Why one answer is held back, in the window's own words (40–43). */
export type SiteFormProblem = "required" | "phone" | "email" | "dateOrder";

/** The window's own check of one answer; the api checks it again. */
export function checkValue(
  field: SiteFormField,
  v: SiteFormValue | undefined
): SiteFormProblem | null {
  const empty =
    v === undefined ||
    v === "" ||
    v === "false" ||
    (Array.isArray(v) && v.length === 0) ||
    (isObj(v) && !v.from && !v.to);
  if (empty) return field.required ? "required" : null;
  if (field.type === "dateRange" && isObj(v)) {
    if (!v.from || !v.to) return "required";
    return v.to <= v.from ? "dateOrder" : null;
  }
  if (typeof v !== "string") return null;
  if (field.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v))
    return "email";
  if (field.type === "phone") {
    const digits = v.replace(/\D/g, "").length;
    if (!/^[+\d\s().-]+$/.test(v) || digits < 7 || digits > 15) return "phone";
  }
  if (field.type === "number") {
    const n = Number(v.replace(",", "."));
    if (
      !Number.isFinite(n) ||
      (field.min !== undefined && n < field.min) ||
      (field.max !== undefined && n > field.max)
    )
      return "required";
  }
  return null;
}

/** An api refusal of one field, as one of the window's sentences. */
export function problemFromServer(code: unknown): SiteFormProblem {
  return code === "phone" || code === "email" || code === "dateOrder"
    ? code
    : "required";
}

export interface SiteFormWords {
  optional: string;
  prefilled: string;
  send: string;
  notNow: string;
  privacy: string;
  required: string;
  phone: string;
  email: string;
  dateOrder: string;
  consent: string;
  failed: string;
  checkIn: string;
  checkOut: string;
  sending: string;
  thanks: string;
}

export interface SiteFormSend {
  answers: Record<string, SiteFormValue>;
  consentText: string;
  website: string;
}

export type SiteFormOutcome =
  | { ok: true; thanks?: string | null }
  | { ok: false; problems?: Record<string, unknown>; consent?: boolean };

interface Control {
  field: SiteFormField;
  node: HTMLElement;
  err: HTMLElement;
  read: () => SiteFormValue | undefined;
}

let seq = 0;

/**
 * Draw one form. `send` posts it and says what became of it; the node then
 * shows the thanks sentence in the form's place, or the failure line with
 * everything still filled in.
 */
export function buildSiteForm(input: {
  def: SiteFormDef;
  prefill: Record<string, unknown>;
  consentText: string;
  privacyUrl: string;
  words: SiteFormWords;
  send: (s: SiteFormSend) => Promise<SiteFormOutcome>;
  onClose: () => void;
}): HTMLElement {
  const { def, words: w } = input;
  const n = ++seq;
  const wrap = el("div", `${PREFIX}-lead ${PREFIX}-site-form`);
  wrap.setAttribute("data-site-form", def.id);
  const title = el("div", `${PREFIX}-form-title`);
  title.textContent = def.name;
  wrap.appendChild(title);
  const form = el("form", `${PREFIX}-lead-form`) as HTMLFormElement;
  form.noValidate = true;
  wrap.appendChild(form);

  const controls: Control[] = [];
  let anyPrefilled = false;

  const caption = (f: SiteFormField, forId?: string): HTMLElement => {
    const lab = el(forId ? "label" : "span", `${PREFIX}-site-form-label`);
    if (forId) lab.setAttribute("for", forId);
    lab.textContent = f.required ? f.label : `${f.label} ${w.optional}`;
    return lab;
  };
  const mkInput = (type: string, id: string): HTMLInputElement => {
    const i = el("input", `${PREFIX}-field`) as HTMLInputElement;
    i.type = type;
    i.id = id;
    return i;
  };

  for (const f of def.fields) {
    const id = `${PREFIX}-sf${n}-${f.id}`;
    const box = el("div", `${PREFIX}-site-form-field`);
    const err = el("div", `${PREFIX}-form-err`);
    err.setAttribute("role", "alert");
    err.hidden = true;
    const pre = prefillFor(f, input_prefill(input.prefill, f.id));
    if (pre !== undefined) anyPrefilled = true;
    let read: () => SiteFormValue | undefined;

    if (f.type === "checkbox") {
      const row = el("label", `${PREFIX}-field-check`);
      const c = mkInput("checkbox", id);
      c.className = `${PREFIX}-check`;
      c.checked = pre === "true";
      row.appendChild(c);
      const cap = el("span", `${PREFIX}-field-check-label`);
      cap.textContent = f.required ? f.label : `${f.label} ${w.optional}`;
      row.appendChild(cap);
      box.appendChild(row);
      read = () => (c.checked ? "true" : "false");
    } else if ((f.type === "radio" || f.type === "multi") && f.options) {
      box.appendChild(caption(f));
      const group = el("div", `${PREFIX}-field-group`);
      group.setAttribute("role", f.type === "radio" ? "radiogroup" : "group");
      const chosen = new Set(
        Array.isArray(pre) ? pre : typeof pre === "string" ? [pre] : []
      );
      for (const [k, o] of f.options.entries()) {
        const row = el("label", `${PREFIX}-field-check`);
        const c = mkInput(f.type === "radio" ? "radio" : "checkbox", `${id}-${k}`);
        c.className = `${PREFIX}-check`;
        c.name = id;
        c.value = o;
        c.checked = chosen.has(o);
        row.appendChild(c);
        const cap = el("span", `${PREFIX}-field-check-label`);
        cap.textContent = o;
        row.appendChild(cap);
        group.appendChild(row);
      }
      box.appendChild(group);
      read = () => {
        const on = [
          ...group.querySelectorAll<HTMLInputElement>("input:checked"),
        ].map((x) => x.value);
        return f.type === "radio" ? (on[0] ?? "") : on;
      };
    } else if (f.type === "dateRange") {
      box.appendChild(caption(f));
      const pair = el("div", `${PREFIX}-site-form-pair`);
      const half = (word: string, suffix: string, value?: string) => {
        const cell = el("div", `${PREFIX}-site-form-half`);
        const lab = el("label", `${PREFIX}-site-form-sub`);
        lab.setAttribute("for", `${id}-${suffix}`);
        lab.textContent = word;
        const i = mkInput("date", `${id}-${suffix}`);
        if (value) i.value = value;
        cell.appendChild(lab);
        cell.appendChild(i);
        pair.appendChild(cell);
        return i;
      };
      const range = isObj(pre) && !Array.isArray(pre) ? pre : undefined;
      const from = half(w.checkIn, "from", range?.from);
      const to = half(w.checkOut, "to", range?.to);
      box.appendChild(pair);
      read = () => ({ from: from.value, to: to.value });
    } else {
      box.appendChild(caption(f, id));
      let c: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
      if (f.type === "textarea") {
        c = el("textarea", `${PREFIX}-field`) as HTMLTextAreaElement;
        c.id = id;
      } else if (f.type === "select") {
        const s = el("select", `${PREFIX}-field`) as HTMLSelectElement;
        s.id = id;
        // An empty first choice, so nothing is chosen for the visitor.
        s.appendChild(document.createElement("option"));
        for (const o of f.options ?? []) {
          const opt = document.createElement("option");
          opt.value = o;
          opt.textContent = o;
          s.appendChild(opt);
        }
        c = s;
      } else {
        const t =
          f.type === "phone"
            ? "tel"
            : f.type === "text"
              ? "text"
              : f.type === "email" ||
                  f.type === "number" ||
                  f.type === "date" ||
                  f.type === "time"
                ? f.type
                : "text";
        const i = mkInput(t, id);
        if (f.type === "phone") i.autocomplete = "tel";
        if (f.type === "email") i.autocomplete = "email";
        if (f.type === "number") {
          if (f.min !== undefined) i.min = String(f.min);
          if (f.max !== undefined) i.max = String(f.max);
        }
        c = i;
      }
      if (typeof pre === "string") c.value = pre;
      box.appendChild(c);
      const ctl = c;
      read = () => ctl.value.trim();
    }
    if (f.help) {
      const h = el("div", `${PREFIX}-site-form-help`);
      h.textContent = f.help;
      box.appendChild(h);
    }
    box.appendChild(err);
    form.appendChild(box);
    controls.push({ field: f, node: box, err, read });
  }

  if (anyPrefilled) {
    const note = el("div", `${PREFIX}-site-form-prefilled`);
    note.textContent = w.prefilled;
    form.insertBefore(note, form.firstChild);
  }

  // The field no person sees: a script that fills every box fills it.
  const trap = el("input", `${PREFIX}-site-form-trap`) as HTMLInputElement;
  trap.type = "text";
  trap.name = "website";
  trap.tabIndex = -1;
  trap.autocomplete = "off";
  trap.setAttribute("aria-hidden", "true");
  form.appendChild(trap);

  const consentRow = el("label", `${PREFIX}-field-check ${PREFIX}-site-form-consent`);
  const consentBox = el("input", `${PREFIX}-check`) as HTMLInputElement;
  consentBox.type = "checkbox";
  consentRow.appendChild(consentBox);
  const consentCap = el("span", `${PREFIX}-field-check-label`);
  consentCap.textContent = `${input.consentText} `;
  const link = el("a", `${PREFIX}-site-form-privacy`) as HTMLAnchorElement;
  link.href = input.privacyUrl;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = w.privacy;
  consentCap.appendChild(link);
  consentRow.appendChild(consentCap);
  form.appendChild(consentRow);
  const consentErr = el("div", `${PREFIX}-form-err`);
  consentErr.setAttribute("role", "alert");
  consentErr.hidden = true;
  consentErr.textContent = w.consent;
  form.appendChild(consentErr);

  const failed = el("div", `${PREFIX}-form-err`);
  failed.setAttribute("role", "alert");
  failed.hidden = true;
  failed.textContent = w.failed;
  form.appendChild(failed);

  const row = el("div", `${PREFIX}-site-form-actions`);
  const submit = el("button", `${PREFIX}-lead-btn`) as HTMLButtonElement;
  submit.type = "submit";
  submit.textContent = w.send;
  const later = el("button", `${PREFIX}-site-form-later`) as HTMLButtonElement;
  later.type = "button";
  later.textContent = w.notNow;
  row.appendChild(submit);
  row.appendChild(later);
  form.appendChild(row);

  later.addEventListener("click", () => {
    wrap.remove();
    input.onClose();
  });

  const say = (c: Control, p: SiteFormProblem | null) => {
    c.err.hidden = p === null;
    c.err.textContent = p ? w[p] : "";
    c.node.classList.toggle(`${PREFIX}-field-invalid`, p !== null);
  };
  const focusFirst = () => {
    const bad =
      controls.find((c) => !c.err.hidden)?.node ??
      (consentErr.hidden ? null : consentRow);
    bad?.querySelector<HTMLElement>("input,select,textarea")?.focus();
  };

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    failed.hidden = true;
    let held = false;
    const answers: Record<string, SiteFormValue> = {};
    for (const c of controls) {
      const v = c.read();
      const p = checkValue(c.field, v);
      say(c, p);
      if (p) held = true;
      if (v !== undefined) answers[c.field.id] = v;
    }
    consentErr.hidden = consentBox.checked;
    if (!consentBox.checked) held = true;
    if (held) {
      focusFirst();
      return;
    }
    submit.disabled = true;
    later.disabled = true;
    submit.textContent = w.sending;
    let out: SiteFormOutcome;
    try {
      out = await input.send({
        answers,
        consentText: input.consentText,
        website: trap.value,
      });
    } catch {
      out = { ok: false };
    }
    if (out.ok) {
      wrap.innerHTML = "";
      const done = el("div", `${PREFIX}-lead-ok`);
      done.setAttribute("role", "status");
      done.textContent = out.thanks || def.thanks || w.thanks;
      wrap.appendChild(done);
      return;
    }
    submit.disabled = false;
    later.disabled = false;
    submit.textContent = w.send;
    if (out.consent) consentErr.hidden = false;
    const problems = out.problems ?? {};
    let named = false;
    for (const c of controls)
      if (c.field.id in problems) {
        say(c, problemFromServer(problems[c.field.id]));
        named = true;
      }
    if (!named && !out.consent) failed.hidden = false;
    focusFirst();
  });

  return wrap;
}

function input_prefill(
  prefill: Record<string, unknown>,
  id: string
): unknown {
  return Object.prototype.hasOwnProperty.call(prefill, id)
    ? prefill[id]
    : undefined;
}

/** Where the window reads forms and sends one, next to the settings route. */
export function siteFormAddresses(settingsUrl: string): {
  forms: string;
  submit: string;
} {
  const base = settingsUrl.replace(/\/site-settings\/?(\?.*)?$/, "");
  return {
    forms: `${base}/site-forms`,
    submit: `${base}/site-forms/submit`,
  };
}
