/**
 * The `<script src>` build: one file, no bundler, no import map.
 *
 * WHY THIS EXISTS AND THE ESM BUILD DOES NOT COVER IT (#306). `tsc` emits ESM
 * with bare specifiers — `from "sgiant-ai-agent-bridge"` — which a bundler
 * resolves and a browser cannot. A plain HTML page therefore could not load
 * this package at all, and that is not a hypothetical audience: it is how the
 * WordPress integration (#310) has to load the widget, since a WP admin page
 * has no build step.
 *
 * So this BUNDLES the dependency in rather than pointing at it. The tradeoff is
 * deliberate: the global build carries its own copy of the bridge (~9 kB), and
 * a page using both should use the ESM build instead.
 *
 * esbuild is the only build dependency in this repo, and it is a devDependency:
 * nothing a consumer installs pulls it.
 */
import { build } from "esbuild";
import { readFileSync, copyFileSync, existsSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url)));

/**
 * Two globals, not one.
 *
 * The chat widget is the whole point and stays lean — the chart renderer is an
 * opt-in subpath and is NOT in it. But a subpath is only reachable with a
 * bundler, and the audience for the fallback renderer is precisely the audience
 * with no bundler: a WordPress admin page, a plain embed. So it gets its own
 * global too, and a page that wants charts loads two script tags instead of
 * paying for charts it never draws.
 */
const TARGETS = [
  { entry: "src/index.ts", out: `dist/${pkg.name}.global.js`, global: "SgiantAiWidget" },
  {
    entry: "src/charts.ts",
    out: `dist/${pkg.name}-charts.global.js`,
    global: "SgiantAiWidgetCharts",
  },
];

for (const t of TARGETS) {
  const result = await build({
    entryPoints: [t.entry],
    outfile: t.out,
    bundle: true,
    // IIFE, not UMD: the audience is a plain <script> tag. A UMD wrapper also
    // answers to CommonJS loaders, which nothing in a browser is, and it makes
    // the file harder to read for the one case it is FOR.
    format: "iife",
    globalName: t.global,
    platform: "browser",
    target: ["es2020"],
    minify: true,
    sourcemap: true,
    legalComments: "none",
    banner: { js: `/*! ${pkg.name} ${pkg.version} — MIT — ${pkg.homepage} */` },
    metafile: true,
  });
  const out = result.metafile.outputs[t.out];
  console.log(
    `${pkg.name}: ${t.out.replace("dist/", "")} ${(out.bytes / 1024).toFixed(1)} kB ` +
      `(window.${t.global})`
  );

  // THE EXAMPLES LOAD A COPY, AND A COPY GOES STALE.
  //
  // examples/*.html point at ./sgiant-ai-widget.global.js — a sibling file, not
  // dist — because they open as plain files with no server and no build step.
  // That copy was updated by hand, so it lagged: on 2026-09-04 ui.html started
  // using a NEW export (CHROME_MARK) that the checked-in bundle predated. The
  // failure is silent, because `avatarSvg: undefined` falls back to the
  // crescent — so the demo shows the OLD mark while claiming to show the new
  // one, and whoever is looking concludes the feature does not work.
  //
  // The build owns the copy now. It cannot lag what it is copied from.
  const mirror = t.out.replace("dist/", "examples/");
  if (existsSync("examples")) {
    copyFileSync(t.out, mirror);
    console.log(`${pkg.name}: → ${mirror}`);
  }
}
