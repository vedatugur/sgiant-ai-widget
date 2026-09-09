import test from "node:test";
import assert from "node:assert/strict";
import { createHostActions } from "../dist/host-actions.js";
import { STANDARD_ACTION_PATHS } from "../dist/host-actions.js";

/**
 * A SURFACE WITHOUT AN ACCOUNT PLANE MUST NOT INHERIT ITS ACTIONS.
 *
 * `createHostActions` always registered the four named actions, and their paths
 * are account-relative: with an `accountId` "open-dashboards" goes to
 * `/accounts/<id>/dashboards`, and WITHOUT one the base is empty and it goes to
 * `/dashboards`. On a surface that has no such page — the hub, whose whole
 * navigation is four hash anchors — that is a confident navigation to nothing,
 * which reads to the user as the assistant breaking the app.
 *
 * That hazard is why the hub had no action handler at all, and having no
 * handler is what left its assistant able to describe controls it could never
 * touch (sgiant-platform#372). The fix is not to pass the account plane and
 * hope; it is to be able to say the surface does not have one.
 *
 * Default stays TRUE, so every existing caller is untouched.
 */
const dispatcher = (standardActions?: boolean) => {
  const navigated: string[] = [];
  const act = createHostActions({
    navigate: (p: string) => navigated.push(p),
    ...(standardActions === undefined ? {} : { standardActions }),
  });
  return { act, navigated };
};

test("by default the named account actions still work", async () => {
  const { act, navigated } = dispatcher();
  await act("open-dashboards", {});
  assert.deepEqual(navigated, ["/dashboards"]);
});

test("standardActions:false refuses them instead of navigating nowhere", async () => {
  const { act, navigated } = dispatcher(false);
  for (const name of Object.keys(STANDARD_ACTION_PATHS)) {
    await assert.rejects(
      () => act(name, {}),
      /unsupported action/,
      `${name} still ran on a surface with no account plane`,
    );
  }
  assert.deepEqual(navigated, [], "a refused action navigated anyway");
});

test("the UI-control half is untouched by the opt-out — that is the point", async () => {
  const { act } = dispatcher(false);
  // No `document` here, so the DOM layer is what refuses. Reaching ITS message
  // proves the control path is still wired: the opt-out removed the account
  // actions and nothing else.
  await assert.rejects(
    () => act("highlight", { target: "some-page-control" }),
    /no such control on this page/,
  );
});
