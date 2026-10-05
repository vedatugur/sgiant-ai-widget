import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * A RELEASE TAG HAS TO BE ON MAIN.
 *
 * The release job checked that the tag's name equals the version in
 * package.json and nothing about where the tag was. A v* tag on a branch would
 * have published code main does not have, under a number that can never be
 * reused. Found by QA reading the 1.19.1 release; nothing had gone wrong yet.
 *
 * The step itself only runs on GitHub, on a tag. This pins that it is there,
 * that it can actually answer the question, and that it comes first.
 */
const WORKFLOW = readFileSync(
  join(import.meta.dirname, "..", ".github", "workflows", "release.yml"),
  "utf8"
);
/** The steps only, comments removed. */
const STEPS = WORKFLOW.slice(WORKFLOW.indexOf("    steps:")).replace(/^\s*#.*$/gm, "");

test("the job refuses a tag whose commit main does not contain", () => {
  assert.match(STEPS, /- name: tagged commit is on main/);
  // main as it is now, fetched by the step, not whatever the checkout left.
  assert.match(STEPS, /git fetch --no-tags origin \+refs\/heads\/main:refs\/remotes\/origin\/main/);
  assert.match(STEPS, /if ! git merge-base --is-ancestor HEAD origin\/main; then[\s\S]*?exit 1/);
});

test("it has the history to answer with", () => {
  // The default checkout is one commit deep, and "is this an ancestor of
  // main" asked of a single commit fails for every tag, misplaced or not.
  assert.match(STEPS, /- uses: actions\/checkout@v\d+\s+with:\s+fetch-depth: 0/);
});

test("it comes before anything is installed, built or published", () => {
  const at = (s: string): number => {
    const i = STEPS.indexOf(s);
    assert.notEqual(i, -1, `no "${s}" in the release job`);
    return i;
  };
  const check = at("- name: tagged commit is on main");
  assert.ok(check < at("- run: npm ci"));
  assert.ok(check < at("- run: npm publish"));
  // The other gate is still there, and still before the publish.
  assert.ok(at("- name: tag matches package version") < at("- run: npm publish"));
});
