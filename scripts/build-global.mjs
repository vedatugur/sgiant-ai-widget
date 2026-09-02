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
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url)));

const result = await build({
  entryPoints: ["src/index.ts"],
  outfile: `dist/${pkg.name}.global.js`,
  bundle: true,
  // IIFE, not UMD: the audience is a plain <script> tag. A UMD wrapper also
  // answers to CommonJS loaders, which nothing in a browser is, and it makes
  // the file harder to read for the one case it is FOR.
  format: "iife",
  globalName: "SgiantAiWidget",
  platform: "browser",
  target: ["es2020"],
  minify: true,
  sourcemap: true,
  // Same floor as the ESM build's tsconfig target, so the two artefacts do not
  // silently support different browsers.
  legalComments: "none",
  banner: {
    js: `/*! ${pkg.name} ${pkg.version} — MIT — ${pkg.homepage} */`,
  },
  metafile: true,
});

const out = result.metafile.outputs[`dist/${pkg.name}.global.js`];
console.log(
  `${pkg.name}: global build ${(out.bytes / 1024).toFixed(1)} kB ` +
    `(window.SgiantAiWidget.createAiChatWidget)`
);
