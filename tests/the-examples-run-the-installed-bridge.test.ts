import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * The examples import ./bridge/*.js, a copy of sgiant-ai-agent-bridge's dist.
 * It was copied by hand and went stale: its index.js predated the manifest
 * exports. The build copies it now; this holds the copy to the installed one.
 */
const ROOT = join(import.meta.dirname, "..");
const DIST = join(ROOT, "node_modules", "sgiant-ai-agent-bridge", "dist");
const COPY = join(ROOT, "examples", "bridge");

test("examples/bridge is the installed bridge, file for file", () => {
  const built = readdirSync(DIST).filter((f) => f.endsWith(".js")).sort();
  assert.deepEqual(readdirSync(COPY).sort(), built);
  for (const f of built)
    assert.equal(
      readFileSync(join(COPY, f), "utf8"),
      readFileSync(join(DIST, f), "utf8"),
      `examples/bridge/${f} is not the installed bridge's`
    );
});
