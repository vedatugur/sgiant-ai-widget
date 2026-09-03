import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeUiSpec,
  uiSpecMediaIds,
} from "../dist/ui-spec.js";

test("media is named by id, never by URL", () => {
  // The failure this prevents: model output routinely carries text scraped from
  // third-party pages. A URL it chose would be fetched by the client's browser
  // the moment the card painted — a tracking pixel inside the product's chat.
  const spec = normalizeUiSpec({
    items: [
      { title: "ok", mediaId: "med_abc-123" },
      { title: "pixel", mediaId: "https://evil.example/px.gif" },
      { title: "data", mediaId: "data:image/gif;base64,AAAA" },
      { title: "traversal", mediaId: "../../etc/passwd" },
    ],
  });
  assert.ok(spec);
  assert.equal(spec.items.length, 4); // all kept — they still have titles
  assert.equal(spec.items[0].mediaId, "med_abc-123");
  for (const bad of spec.items.slice(1))
    assert.equal(bad.mediaId, undefined, `${bad.title} must not resolve`);
});

test("a button that dispatches nothing is dropped, not drawn inert", () => {
  // An inert button looks exactly like a working one: the user clicks, nothing
  // happens, and they cannot tell whether the product broke or the request was
  // refused.
  const spec = normalizeUiSpec({
    items: [{ title: "Scene 1", actions: [{ label: "Approve" }] }],
    actions: [{ name: "render-all", label: "Render all" }, { label: "?" }],
  });
  assert.ok(spec);
  assert.equal(spec.items[0].actions, undefined);
  assert.equal(spec.actions.length, 1);
  assert.equal(spec.actions[0].name, "render-all");
});

test("a `say` button with nothing to say is dropped too", () => {
  const spec = normalizeUiSpec({
    actions: [
      { name: "say", data: { text: "Redo scene 2, warmer" } },
      { name: "say", label: "Use the sunset one" }, // label is the fallback text
      { name: "say" }, // nothing to send — inert, so it must not be drawn
    ],
  });
  assert.ok(spec);
  assert.equal(spec.actions.length, 2);
});

test("an item with nothing to show is dropped", () => {
  const spec = normalizeUiSpec({
    items: [{}, { caption: "  " }, { title: "real" }],
  });
  assert.ok(spec);
  assert.equal(spec.items.length, 1);
  assert.equal(spec.items[0].title, "real");
});

test("nothing worth drawing yields null, so the reply text is left alone", () => {
  for (const bad of [null, "x", 42, {}, { items: [] }, { items: [{}] }])
    assert.equal(normalizeUiSpec(bad), null);
});

test("a tile that is nothing but a pending render survives", () => {
  // The has-anything-to-show check would drop this, and dropping it removes
  // exactly the case `jobId` exists for: "scene 3 is being made, watch this
  // space". The tile fills itself in when the render lands.
  const spec = normalizeUiSpec({ items: [{ jobId: "job_abc-123" }] });
  assert.ok(spec);
  assert.equal(spec.items.length, 1);
  assert.equal(spec.items[0].jobId, "job_abc-123");
});

test("a jobId is shape-checked like a media id — it goes into a polled URL", () => {
  const spec = normalizeUiSpec({
    items: [
      { title: "ok", jobId: "abc-123_X" },
      { title: "url", jobId: "https://evil.example/jobs/1" },
      { title: "traversal", jobId: "../../admin" },
      { title: "wrong type", jobId: 42 },
    ],
  });
  assert.ok(spec);
  assert.equal(spec.items[0].jobId, "abc-123_X");
  for (const bad of spec.items.slice(1))
    assert.equal(bad.jobId, undefined, `${bad.title} must not be polled`);
});

test("status is forgiving about wording but still colours the known four", () => {
  const spec = normalizeUiSpec({
    items: [
      { title: "a", status: "rendering" },
      { title: "b", status: "Done" },
      { title: "c", status: "error" },
      { title: "d", status: "awaiting client sign-off" },
      { title: "e", status: "In Progress" },
    ],
  });
  assert.ok(spec);
  assert.deepEqual(
    spec.items.map((i) => i.status),
    [
      "running",
      "ready",
      "failed",
      // Unknown: shown in the model's own words, not as a squashed key — a
      // badge reading "awaiting_client_sign_off" is what that would produce.
      "awaiting client sign-off",
      "running",
    ]
  );
});

test("model output is not a promise of reasonable size", () => {
  const spec = normalizeUiSpec({
    title: "t".repeat(500),
    items: Array.from({ length: 100 }, (_, i) => ({ title: `s${i}` })),
    actions: Array.from({ length: 20 }, (_, i) => ({ name: `a${i}` })),
  });
  assert.ok(spec);
  assert.equal(spec.items.length, 24);
  assert.equal(spec.actions.length, 4);
  assert.ok((spec.title ?? "").length <= 80);
});

test("action data is flattened to strings the host can pass on", () => {
  const spec = normalizeUiSpec({
    actions: [
      {
        name: "redo",
        data: { sceneId: 3, keep: true, note: "warmer", bad: { nested: 1 } },
      },
    ],
  });
  assert.ok(spec);
  assert.deepEqual(spec.actions[0].data, {
    sceneId: "3",
    keep: "true",
    note: "warmer",
  });
});

test("layout falls back rather than refusing the card", () => {
  const items = [{ title: "a" }];
  assert.equal(normalizeUiSpec({ items })?.layout, "strip");
  assert.equal(normalizeUiSpec({ items, layout: "grid" })?.layout, "grid");
  assert.equal(
    normalizeUiSpec({ items, layout: "carousel" })?.layout,
    "carousel"
  );
  assert.equal(
    normalizeUiSpec({ items, layout: "carousel3d" })?.layout,
    "strip"
  );
});

test("aspect falls back to square but keeps the platform's own keywords", () => {
  // A portrait reel previewed in square tiles shows the client a crop of what
  // they are approving — and they approve it anyway.
  const items = [{ mediaId: "a" }];
  assert.equal(normalizeUiSpec({ items })?.aspect, "square");
  assert.equal(normalizeUiSpec({ items, aspect: "story" })?.aspect, "story");
  assert.equal(normalizeUiSpec({ items, aspect: "9:16" })?.aspect, "square");
});

test("media ids are collected once each, for one batched resolve", () => {
  const spec = normalizeUiSpec({
    items: [
      { mediaId: "a", posterMediaId: "p" },
      { mediaId: "a" },
      { mediaId: "b" },
    ],
  });
  assert.ok(spec);
  assert.deepEqual(uiSpecMediaIds(spec).sort(), ["a", "b", "p"]);
});
