import test from "node:test";
import assert from "node:assert/strict";
import {
  samePanePath,
  shouldAutoNavigate,
  shouldCollapseNarration,
} from "../dist/pane-follow.js";

/**
 * Advanced view's two pane decisions. Both fail POLITELY — get them wrong and
 * the pane either never follows a long operation (the feature silently does
 * nothing) or follows it too eagerly, yanking a reader off the page they chose,
 * on every poll. Neither shows up as an error, which is why they are pinned
 * here rather than left inside the widget's closure.
 */

const base = {
  advanced: true,
  canNavigate: true,
  userConfirmedThisSession: true,
  userDriven: false,
  alreadyFollowed: false,
  path: "/accounts/a1/reports/r1",
  currentPath: "/accounts/a1/dashboards",
};

test("a running report pulls the pane to its live page", () => {
  assert.equal(shouldAutoNavigate(base), true);
});

test("NOT in floating mode — there is no pane, and moving the page is a different feature", () => {
  assert.equal(shouldAutoNavigate({ ...base, advanced: false }), false);
});

test("NOT a job this session's user never asked for — the storage-restore case", () => {
  // A tracked job is written to localStorage so a running import survives a
  // refresh, and it is re-discovered from the server listing so work started on
  // another device shows up too. Either way a card appears for work nobody in
  // front of this screen just confirmed — and `openAdvanced` clears
  // `autoNavigated` for a fresh session, so without this condition the first
  // poll after opening the pane would send it to that job's page.
  assert.equal(
    shouldAutoNavigate({ ...base, userConfirmedThisSession: false }),
    false
  );
  // Not rescued by anything else being favourable, either.
  assert.equal(
    shouldAutoNavigate({
      ...base,
      userConfirmedThisSession: false,
      userDriven: false,
      alreadyFollowed: false,
      currentPath: null,
    }),
    false
  );
});

test("NOT once the user has driven the frame themselves", () => {
  // They chose that page. A job finishing is not permission to leave it.
  assert.equal(shouldAutoNavigate({ ...base, userDriven: true }), false);
});

test("NOT twice — this is the one that would make the page unreadable", () => {
  // The card polls every couple of seconds. Following again on each poll is a
  // full document load in a loop, which is the opposite of watching it build.
  assert.equal(shouldAutoNavigate({ ...base, alreadyFollowed: true }), false);
});

test("NOT if the pane is already there", () => {
  assert.equal(
    shouldAutoNavigate({ ...base, currentPath: "/accounts/a1/reports/r1" }),
    false
  );
  // …including with a query string, which is a filter within the page.
  assert.equal(
    shouldAutoNavigate({
      ...base,
      currentPath: "/accounts/a1/reports/r1?tab=blocks",
    }),
    false
  );
});

test("NOT to anything that is not an in-app root-relative path", () => {
  // `isSafeFrameUrl` is the real gate in front of the iframe; this refuses the
  // same shapes earlier so a model-authored path never reaches it.
  for (const path of [
    "//evil.example.com/x",
    "https://evil.example.com/x",
    "javascript:alert(1)",
    "reports/r1",
    "",
    null,
    undefined,
  ]) {
    assert.equal(
      shouldAutoNavigate({ ...base, path: path as string }),
      false,
      `${JSON.stringify(path)} must not be followed`
    );
  }
});

test("the chat collapses only while the pane shows the same run", () => {
  assert.equal(
    shouldCollapseNarration({
      advanced: true,
      livePath: "/accounts/a1/reports/r1",
      currentPath: "/accounts/a1/reports/r1",
    }),
    true
  );
  // Pane elsewhere → the chat is the ONLY account of what is happening.
  assert.equal(
    shouldCollapseNarration({
      advanced: true,
      livePath: "/accounts/a1/reports/r1",
      currentPath: "/accounts/a1/dashboards",
    }),
    false
  );
  // Floating mode has no pane at all, so it must never go quiet.
  assert.equal(
    shouldCollapseNarration({
      advanced: false,
      livePath: "/accounts/a1/reports/r1",
      currentPath: "/accounts/a1/reports/r1",
    }),
    false
  );
  // Nothing to compare against → narrate.
  assert.equal(
    shouldCollapseNarration({
      advanced: true,
      livePath: null,
      currentPath: "/accounts/a1/reports/r1",
    }),
    false
  );
});

test("path comparison ignores a query and a trailing slash, not a different page", () => {
  assert.equal(samePanePath("/a/b", "/a/b/"), true);
  assert.equal(samePanePath("/a/b?x=1", "/a/b"), true);
  assert.equal(samePanePath("/a/b", "/a/c"), false);
  assert.equal(samePanePath("/a/b", "/a/bc"), false);
  assert.equal(samePanePath(null, "/a/b"), false);
});
