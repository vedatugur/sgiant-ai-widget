#!/usr/bin/env node
/**
 * COPY THE PARTS DICTIONARY FROM THE PLATFORM (sgiant-platform#701).
 *
 * What the assistant may draw beside text (a card, a button, a preview, one
 * of the app's own screens) is defined once, in the platform's
 * `@sgiant/ai-contract` (`parts.ts`). This package is public and cannot
 * install that one, so it keeps two of its files WORD FOR WORD:
 *
 *   src/parts/part-check.ts                  the checker; imports nothing
 *   src/parts/generated/parts-dictionary.ts  each part's schema, each
 *                                            component's params and page
 *
 * The window then judges a part with the same code and the same schema as
 * the api. Never edit them here: change the platform, then run
 *
 *   node scripts/sync-parts.mjs <path to a sgiant-platform checkout>
 *
 * tests/the-parts-are-the-platforms.test.ts holds what can be held from this
 * side (the files are the generated copy, the checker imports nothing).
 */
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const ROOT = path.resolve(url.fileURLToPath(new URL(".", import.meta.url)), "..");
const FILES = [
  ["packages/ai-contract/src/part-check.ts", "src/parts/part-check.ts"],
  [
    "packages/ai-contract/src/generated/parts-dictionary.ts",
    "src/parts/generated/parts-dictionary.ts",
  ],
];

const platform = process.argv[2];
if (!platform) {
  console.error("usage: node scripts/sync-parts.mjs <sgiant-platform checkout>");
  process.exit(1);
}
for (const [from, to] of FILES) {
  const src = path.resolve(platform, from);
  const dst = path.join(ROOT, to);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  console.log(`${from} → ${to}`);
}
