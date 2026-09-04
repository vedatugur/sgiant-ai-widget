import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * #346 — the launcher's offline state only knew about the DEVICE.
 *
 * `navigator.onLine` answers "is this device on a network", which is not the
 * question the state is for. A reader whose wifi is fine but whose api is down,
 * rate-limited or mid-deploy saw a perfectly healthy launcher, asked, and got
 * an error — the exact sequence the state exists to prevent.
 *
 * It is also the one launcher state that can be wrong expensively. `dozing`,
 * `parked` and `unread` are cosmetic if wrong; `offline` is a promise about
 * whether asking will work at all.
 *
 * The decision function is lifted out and RUN, because the interesting content
 * is which statuses count — a 403 is a reachable api saying no, and greying the
 * launcher for it would claim the service is down when the next question would
 * be answered fine.
 */

const src = readFileSync("src/index.ts", "utf8");

/** Run the real `noteApiResult` verdict logic against a status. */
function verdict(result: "ok" | "unreachable" | number): boolean {
  const start = src.indexOf("  const noteApiResult = (");
  assert.notEqual(start, -1, "noteApiResult moved — update this test");
  const body = src.slice(start, src.indexOf("if (next === apiReachable)", start));
  const expr = body.slice(body.indexOf("const next ="));
  return new Function("result", `${expr}; return next;`)(result) as boolean;
}

test("a transport failure means unreachable", () => {
  assert.equal(verdict("unreachable"), false);
});

test("a success clears it — honestly, not just on reload", () => {
  // If a failed turn sets offline, a successful one MUST clear it, or one blip
  // leaves the launcher lying the other way for the rest of the session.
  assert.equal(verdict("ok"), true);
});

test("5xx and 429 mean asking again now will not work", () => {
  for (const status of [500, 502, 503, 504, 429]) {
    assert.equal(verdict(status), false, `status ${status}`);
  }
});

test("other 4xx are a REACHABLE api refusing THIS request", () => {
  // The distinction the issue does not spell out but the state depends on.
  // 401/403 is "not for you", 404 is "no such thing", 422 is "not like that" —
  // none of them mean the service is down, and greying the launcher for them
  // would be the same false promise in the other direction.
  for (const status of [400, 401, 403, 404, 409, 422]) {
    assert.equal(verdict(status), true, `status ${status}`);
  }
});

test("the device signal still wins on its own", () => {
  // navigator.onLine remains a floor: it can be true behind a captive portal,
  // so it says "definitely not" and never promises the opposite. The api signal
  // is added to it, not swapped for it.
  const start = src.indexOf("  const syncOnline = (): void => {");
  const body = src.slice(start, src.indexOf("};", start));
  assert.match(body, /navigator\.onLine/, "the device check must remain");
  assert.match(body, /!apiReachable/, "and the api check joins it");
  assert.match(body, /deviceOffline \|\| !apiReachable/, "either one is enough");
});

test("both ends of a turn report in", () => {
  // The signal is free on a real turn; missing either end is what made this a
  // bug rather than a gap.
  assert.match(
    src,
    /noteApiResult\(res\.ok \? "ok" : res\.status\)/,
    "the response path must report the status"
  );
  assert.match(
    src,
    /noteApiResult\("unreachable"\)/,
    "the transport catch must report the failure"
  );
});

test("no heartbeat was added", () => {
  // A poll on every embed is a request per site per interval for a state nobody
  // is looking at most of the time. The issue rules it out explicitly.
  const start = src.indexOf("  let apiReachable = true;");
  const end = src.indexOf("window.addEventListener(\"online\"", start);
  const region = src.slice(start, end);
  for (const poll of ["setInterval", "setTimeout"]) {
    assert.ok(!region.includes(poll), `no ${poll} in the reachability path`);
  }
});
