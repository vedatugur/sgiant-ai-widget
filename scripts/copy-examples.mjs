/**
 * `npm run examples`: refresh the copies examples/ loads.
 *
 * examples/*.html open as plain files with no server and no build step, so
 * they load SIBLING copies: ./sgiant-ai-widget.global.js (and the charts
 * global) from this package's global build. (The ./bridge/*.js copies of
 * sgiant-ai-agent-bridge went with that dependency in 3.0.0,
 * sgiant-platform#703.) Copies go stale: on 2026-09-04 ui.html
 * used CHROME_MARK while the checked-in bundle predated it, and the demo
 * quietly showed the old mark.
 *
 * The build used to write these copies itself. That made the freshness tests
 * blind: `npm test` builds first, so the copy they compared was always the
 * one just written, never the one committed. Now the build leaves examples/
 * alone, this script writes it, and the tests compare the committed copies
 * with a fresh build (tests/aiw-chrome-mark.test.ts).
 */
import { copyFileSync, existsSync } from "node:fs";

const GLOBALS = ["sgiant-ai-widget.global.js", "sgiant-ai-widget-charts.global.js"];

for (const f of GLOBALS) {
  if (!existsSync(`dist/${f}`)) {
    console.error(`dist/${f} is missing — run npm run build first`);
    process.exit(1);
  }
  copyFileSync(`dist/${f}`, `examples/${f}`);
  console.log(`dist/${f} → examples/${f}`);
}

