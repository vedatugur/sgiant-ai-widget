import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { relTime, usableLocale } from "../dist/dom.js";

/**
 * THE WIDGET WRITES ITS FIGURES IN THE PAGE'S LANGUAGE (sgiant-platform#573).
 *
 * The host hands the widget its words (`labels`). The figures between the
 * words were written with whatever language the BROWSER has, and the
 * conversation list's "3h ago" was built by hand in English. So a Turkish
 * page in an English browser read "24,000 kredi kaldı" and "3h ago": the
 * first is twenty-four to a Turkish reader, the second is not Turkish.
 *
 * The host passes `locale`; every figure goes through it.
 */
const SRC = join(import.meta.dirname, "..", "src");
const sources = readdirSync(SRC)
  .filter((f) => f.endsWith(".ts"))
  .map((f) => ({ file: f, text: readFileSync(join(SRC, f), "utf8") }));

test("the sources were read", () => {
  assert.ok(sources.length >= 20, `${sources.length} files`);
});

test("no figure or date asks the browser which language to use", () => {
  for (const { file, text } of sources)
    for (const m of text.matchAll(
      /\.toLocale(?:Date|Time)?String\(\s*\)|new Intl\.\w+\(\s*\)/g
    ))
      assert.fail(`${file}: ${m[0]} names no language`);
});

test("a relative time is not put together by hand", () => {
  for (const { file, text } of sources)
    assert.doesNotMatch(
      text,
      /\}\s*(m|h|d|w) ago`/,
      `${file} still builds an English "… ago"`
    );
});

const ago = (ms: number): string => new Date(Date.now() - ms).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

test("the conversation list says how long ago in the page's language", () => {
  assert.equal(relTime(ago(3 * MIN + 5_000), "tr"), "3 dk. önce");
  assert.equal(relTime(ago(2 * HOUR + MIN), "tr"), "2 sa. önce");
  assert.equal(relTime(ago(5 * DAY + HOUR), "tr"), "5 gün önce");
  assert.equal(relTime(ago(8 * DAY), "tr"), "1 hf. önce");
});

test("English reads as it did", () => {
  assert.equal(relTime(ago(3 * MIN + 5_000), "en"), "3m ago");
  assert.equal(relTime(ago(2 * HOUR + MIN), "en"), "2h ago");
  assert.equal(relTime(ago(5 * DAY + HOUR), "en"), "5d ago");
  assert.equal(relTime(ago(8 * DAY), "en"), "1w ago");
  // Under a minute is still "1", never "0".
  assert.equal(relTime(ago(5_000), "en"), "1m ago");
});

test("past a month it is a date, written the page's way", () => {
  const then = new Date(Date.now() - 45 * DAY);
  assert.equal(relTime(then.toISOString(), "tr"), then.toLocaleDateString("tr"));
  assert.match(relTime(then.toISOString(), "tr"), /^\d{2}\.\d{2}\.\d{4}$/);
  assert.equal(relTime(then.toISOString(), "en"), then.toLocaleDateString("en"));
});

test("a language tag the engine refuses falls back instead of throwing", () => {
  assert.equal(usableLocale("not a tag"), undefined);
  assert.equal(usableLocale(""), undefined);
  assert.equal(usableLocale(undefined), undefined);
  assert.equal(usableLocale("tr"), "tr");
  assert.doesNotThrow(() => relTime(ago(2 * HOUR), "not a tag"));
  assert.equal(relTime("not a date", "tr"), "");
});

test("the widget takes the page's language and sends every figure through it", () => {
  const index = sources.find((s) => s.file === "index.ts")!.text;
  assert.match(index, /\n  locale\?: string;/);
  assert.match(index, /const locale = usableLocale\(opts\.locale\);/);
  assert.match(index, /const num = \(n: number\): string => n\.toLocaleString\(locale\);/);
  assert.match(index, /relTime\(th\.updatedAt, locale\)/);
});
