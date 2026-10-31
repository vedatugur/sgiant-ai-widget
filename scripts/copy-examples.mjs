/**
 * `npm run examples`: refresh the copies examples/ loads.
 *
 * examples/*.html open as plain files with no server and no build step, so
 * they load SIBLING copies: ./sgiant-ai-widget.global.js (and the charts
 * global) from this package's global build, and ./bridge/*.js from the
 * installed sgiant-ai-agent-bridge. Copies go stale: on 2026-09-04 ui.html
 * used CHROME_MARK while the checked-in bundle predated it, and the demo
 * quietly showed the old mark.
 *
 * The build used to write these copies itself. That made the freshness tests
 * blind: `npm test` builds first, so the copy they compared was always the
 * one just written, never the one committed. Now the build leaves examples/
 * alone, this script writes it, and the tests compare the committed copies
 * with a fresh build (tests/aiw-chrome-mark.test.ts,
 * tests/the-examples-run-the-installed-bridge.test.ts).
 */
import { copyFileSync, existsSync, readdirSync } from "node:fs";

const GLOBALS = ["sgiant-ai-widget.global.js", "sgiant-ai-widget-charts.global.js"];

for (const f of GLOBALS) {
  if (!existsSync(`dist/${f}`)) {
    console.error(`dist/${f} is missing — run npm run build first`);
    process.exit(1);
  }
  copyFileSync(`dist/${f}`, `examples/${f}`);
  console.log(`dist/${f} → examples/${f}`);
}

const bridgeDist = "node_modules/sgiant-ai-agent-bridge/dist";
for (const f of readdirSync(bridgeDist).filter((f) => f.endsWith(".js")))
  copyFileSync(`${bridgeDist}/${f}`, `examples/bridge/${f}`);
console.log("sgiant-ai-agent-bridge → examples/bridge/");
