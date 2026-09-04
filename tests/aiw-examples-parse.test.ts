import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Every example page's script must PARSE.
 *
 * This exists because of one mistake made FIVE times in a single session: a
 * backtick inside a comment, in a file where the surrounding code is a template
 * literal. The backtick ends the string, and the error surfaces somewhere else
 * entirely — in `styles.ts` it broke the build, and in these pages it broke
 * nothing until the browser silently refused to run the script.
 *
 * Care was not the fix. Five times is not a lapse in attention, it is a missing
 * check.
 */
const dir = "examples";
const pages = readdirSync(dir).filter(
  (f) => f.endsWith(".html") && !f.startsWith("_")
);

test("every example page ships parseable script", () => {
  assert.ok(pages.length > 0, "no example pages found");
  const tmp = mkdtempSync(join(tmpdir(), "aiw-parse-"));
  const broken: string[] = [];
  for (const page of pages) {
    const html = readFileSync(join(dir, page), "utf8");
    const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    blocks.forEach((code, i) => {
      const file = join(tmp, `${page}.${i}.js`);
      writeFileSync(file, code);
      try {
        execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
      } catch (err) {
        broken.push(`${page} block ${i}: ${(err as Error).message.split("\n")[1] ?? ""}`);
      }
    });
  }
  assert.deepEqual(broken, [], `example scripts that do not parse:\n  ${broken.join("\n  ")}`);
});
