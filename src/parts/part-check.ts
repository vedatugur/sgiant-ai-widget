/**
 * CHECKING A PART AGAINST ITS SCHEMA (#701), WITH NOTHING ELSE.
 *
 * This file imports nothing and nothing here names a part. That is the
 * point: the chat window (sgiant-ai-widget, public, on npm) cannot install
 * this package, so it keeps a word-for-word copy of this file and of
 * `generated/parts-dictionary.ts`, and the api and the window then judge a
 * part by the same code and the same schema. A rule written in only one of
 * them is the drift #701 was opened about (the window's `specs.ts` held its
 * own idea of every tag).
 *
 * The schemas are the small part of JSON Schema the parts use: `type` (one
 * name or several), `enum`, `properties`, `required`, `items`, `minItems`,
 * `maxItems`, `maxLength`, `pattern` and `additionalProperties` (a schema
 * every other key must meet, or `false` for none). Anything else in a schema
 * is a description for
 * the model and is not checked. A key a schema does not name is allowed, as
 * the window has always allowed it, unless `additionalProperties` is a schema.
 */

export interface PartSchema {
  type?: string | readonly string[];
  description?: string;
  enum?: readonly (string | number | boolean)[];
  properties?: Readonly<Record<string, PartSchema>>;
  required?: readonly string[];
  items?: PartSchema;
  minItems?: number;
  maxItems?: number;
  maxLength?: number;
  pattern?: string;
  /** A schema every other key must meet, or `false`: no other key. */
  additionalProperties?: PartSchema | false;
}

function typeOf(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  if (typeof v === "number") return Number.isInteger(v) ? "integer" : "number";
  return typeof v;
}

function fits(actual: string, want: string): boolean {
  return actual === want || (want === "number" && actual === "integer");
}

const A_OR_AN = (t: string): string =>
  /^[aeiou]/.test(t) ? `an ${t}` : `a ${t}`;

/**
 * Every way `value` misses `schema`, one sentence each, naming where
 * (`spec.items[2].title`). Empty when it fits. Stops looking inside a value
 * whose type is already wrong, so one mistake is one sentence.
 */
export function checkAgainstSchema(
  value: unknown,
  schema: PartSchema,
  at = "spec"
): string[] {
  const out: string[] = [];
  const actual = typeOf(value);
  if (schema.type !== undefined) {
    const wants = typeof schema.type === "string" ? [schema.type] : schema.type;
    if (!wants.some((w) => fits(actual, w))) {
      out.push(
        `${at} must be ${wants.map(A_OR_AN).join(" or ")}, not ${A_OR_AN(actual)}`
      );
      return out;
    }
  }
  if (schema.enum && !schema.enum.includes(value as string | number | boolean))
    out.push(
      `${at} must be one of ${schema.enum.map((e) => JSON.stringify(e)).join(", ")}`
    );
  if (typeof value === "string") {
    if (schema.maxLength !== undefined && value.length > schema.maxLength)
      out.push(`${at} is longer than ${schema.maxLength} characters`);
    if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(value))
      out.push(`${at} does not have the form ${schema.pattern}`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems)
      out.push(`${at} needs at least ${schema.minItems} item(s)`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems)
      out.push(`${at} holds more than ${schema.maxItems} item(s)`);
    if (schema.items)
      value.forEach((v, i) =>
        out.push(
          ...checkAgainstSchema(v, schema.items as PartSchema, `${at}[${i}]`)
        )
      );
  }
  if (actual === "object") {
    const obj = value as Record<string, unknown>;
    for (const key of schema.required ?? [])
      if (obj[key] === undefined) out.push(`${at}.${key} is required`);
    for (const [key, v] of Object.entries(obj)) {
      if (v === undefined) continue;
      const own = schema.properties?.[key];
      if (own) out.push(...checkAgainstSchema(v, own, `${at}.${key}`));
      else if (schema.additionalProperties === false)
        out.push(`${at}.${key} is not a field of this part`);
      else if (schema.additionalProperties)
        out.push(
          ...checkAgainstSchema(v, schema.additionalProperties, `${at}.${key}`)
        );
    }
  }
  return out;
}

// ── Tags and pages ──────────────────────────────────────────────────────────

/** The characters escaped inside a tag's strings: both square brackets,
 *  `<`, `>`, `&` and the two Unicode line and paragraph separators. Built
 *  from code points so this file holds none of them raw. */
const ESCAPED = new RegExp(
  `[${["[", "]", "<", ">", "&", " ", " "]
    .map((c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`)
    .join("")}]`,
  "g"
);

/**
 * JSON THAT CANNOT BREAK OUT OF ITS TAG. A window finds a tag by the text
 * `[[navigate:` anywhere in a message, before or after the tag that holds
 * it, so a campaign named `[[navigate:{…}]]` inside a table's JSON would be a
 * second tag. Inside every string those characters are written as `\u`
 * escapes: the JSON parses to the same text, and the message holds no
 * bracket, no markup and no line break that is not ours.
 */
export function tagJson(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "string")
    return JSON.stringify(value).replace(
      ESCAPED,
      (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`
    );
  if (typeof value === "number")
    return Number.isFinite(value) ? String(value) : "null";
  if (typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `[${value.map(tagJson).join(",")}]`;
  if (typeof value === "object")
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${tagJson(k)}:${tagJson(v)}`)
      .join(",")}}`;
  return "null";
}

/**
 * A component's page, its `{name}` places filled from `params`: each value
 * URL-encoded, except where the whole template is one place (a `page`
 * component's own path). Null when a value it needs is missing or empty.
 */
export function fillPagePath(
  template: string,
  params: Record<string, unknown> | undefined
): string | null {
  const whole = /^\{[A-Za-z]+\}$/.test(template);
  let missing = false;
  const path = template.replace(/\{([A-Za-z]+)\}/g, (_m, key: string) => {
    const v = params?.[key];
    if (typeof v !== "string" || !v) {
      missing = true;
      return "";
    }
    return whole ? v : encodeURIComponent(v);
  });
  return missing ? null : path;
}

/**
 * A PATH A PART MAY OPEN (#703, QA M2): an app page relative to the person's
 * own account, written as plain segments. No `/accounts/…` (the host puts
 * the person's own account in front), no `..`, no `//`, no `\`, no query or
 * fragment. The window still checks it against the host's page list before
 * it opens anything.
 */
export const APP_PATH_PATTERN =
  "^/(?!accounts(?:/|$))(?:[A-Za-z0-9_-]+(?:/[A-Za-z0-9_-]+)*)?$";
