import test from "node:test";
import assert from "node:assert/strict";
// From the BUILD: src/ uses extensionless imports node cannot resolve.
import { renderMarkdown } from "../dist/markdown.js";

/**
 * A CHAT LINK GOES WHERE IT SAYS (sgiant-platform#503 follow-up).
 *
 * 2026-09-28, wp-admin on hotelhideaway: the assistant gave the WordPress
 * editor link `post.php?post=2061&action=edit&lang=tr`, which is what the site
 * itself returns as the post's `editUrl`. Clicking it landed on the Posts list.
 * The renderer escaped the already-escaped URL a second time, so the href said
 * `&amp;amp;action=edit`, and the browser requested `&amp;action=edit`.
 * WordPress read no `action` and redirected to `edit.php`. The assistant then
 * blamed the site and invented explanations. Any link with a second query
 * parameter broke this way.
 */

/** The href as the browser resolves it: attribute entities decoded once. */
function followed(html: string): string | null {
  const m = /href="([^"]*)"/.exec(html);
  if (!m) return null;
  return m[1]
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

test("THE INCIDENT: the WordPress edit link is followed exactly as written", () => {
  const url =
    "https://www.hotelhideaway.com/wp-admin/post.php?post=2061&action=edit&lang=tr";
  const html = renderMarkdown(`- [Evcil Hayvan Politikamız](${url})`);
  assert.equal(followed(html), url);
  assert.doesNotMatch(html, /&amp;amp;/, "escaped once, not twice");
});

test("links inside a paragraph, a heading and a table cell all go through the same path", () => {
  const url = "https://example.com/r?a=1&b=2";
  for (const md of [
    `Open [the report](${url}) now.`,
    `## See [it](${url})`,
    `| a | b |\n|---|---|\n| [x](${url}) | y |`,
  ]) {
    assert.equal(followed(renderMarkdown(md)), url, md);
  }
});

test("a relative link keeps its query too", () => {
  assert.equal(
    followed(renderMarkdown("[Pages](/wp-admin/edit.php?post_type=page&lang=tr)")),
    "/wp-admin/edit.php?post_type=page&lang=tr"
  );
});

test("the scheme check still reads the real URL: script and data links stay text", () => {
  for (const bad of ["javascript:alert(1)", "data:text/html,x", "vbscript:x"]) {
    const html = renderMarkdown(`[click](${bad})`);
    assert.doesNotMatch(html, /<a /, bad);
  }
});

test("a quote in a URL cannot close the attribute", () => {
  const html = renderMarkdown('[x](https://example.com/?q="onmouseover=alert(1))');
  assert.doesNotMatch(html, /href="[^"]*"onmouseover/);
});
