// tsc emits ESM with the specifiers it found in the source, and this package's
// modules import each other WITHOUT extensions (`from "./storage"`). Bundlers
// resolve that; Node's ESM loader does not, and fails with ERR_MODULE_NOT_FOUND
// naming a path that looks correct.
//
// That gap is invisible while every consumer is a bundler, which is what the
// three SPAs are — their builds passed green against output Node cannot load.
// It stops being invisible the moment this package is `npm install`ed by a
// React or Next project (#306): Next renders on the SERVER, where there is no
// bundler between the import and Node's loader, and a plain
// `<script type="module">` has no bundler at all.
//
// So the same fix @sgiant/shared already carries, minus the parts this package
// does not need: it is ESM-only, so there is no CommonJS build to keep happy
// and no `{"type":"module"}` marker to drop beside the output — the package
// itself declares it. No JSON imports here either.
//
// The alternative was writing extensions in the SOURCE. That is 22 files of
// churn to satisfy a build step, and it makes every relative import in the repo
// look different from every other one.
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const DIST = new URL("../dist/", import.meta.url).pathname;

const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? walk(join(dir, e.name))
      : e.name.endsWith(".js")
        ? [join(dir, e.name)]
        : []
  );

// `from "..."`, `import("...")`, and bare side-effect `import "..."`.
const SPEC = /(\bfrom\s*|\bimport\s*\(?\s*)(["'])(\.[^"']*)\2/g;

let rewritten = 0;
for (const file of walk(DIST)) {
  const src = readFileSync(file, "utf8");
  const out = src.replace(SPEC, (whole, lead, q, spec) => {
    if (/\.(js|json|mjs|cjs)$/.test(spec)) return whole;
    const abs = join(file, "..", spec);
    // A directory import needs /index.js; everything else takes .js.
    const target = existsSync(`${abs}.js`)
      ? `${spec}.js`
      : existsSync(join(abs, "index.js"))
        ? `${spec}/index.js`
        : null;
    if (!target) return whole; // leave it alone rather than guess
    rewritten += 1;
    return `${lead}${q}${target}${q}`;
  });
  if (out !== src) writeFileSync(file, out);
}

console.log(`ai-widget: rewrote ${rewritten} relative specifier(s) in dist`);
