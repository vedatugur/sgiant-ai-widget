import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, normalize, relative } from "node:path";

/**
 * WHAT THE WIDGET CORE IS ALLOWED TO DEPEND ON (#306).
 *
 * `sgiant-ai-widget` is being made into something a third party can drop onto
 * their own site. The blocker is not the code — it is vanilla DOM, themeable,
 * and has a real extension seam — it is what its entry point DRAGS IN. Every
 * `@sgiant/*` package in the core's import graph is a package a stranger has to
 * install to render a chat bubble.
 *
 * This asserts the graph, not the manifest. `package.json` lists what npm
 * installs; it says nothing about what the ENTRY POINT actually reaches, and
 * those two drifted for the whole life of this package. A dependency that no
 * file imports is a packaging wart. A dependency reached from index.ts is a
 * dependency a consumer really carries.
 *
 * TYPE-ONLY IMPORTS ARE NOT COUNTED, deliberately: `import type` is erased at
 * build, so it costs a consumer nothing. That is also why the check cannot be a
 * grep for the package name — it has to know which import forms survive.
 *
 * THE ALLOWLIST IS NOT A PROGRESS BAR — it was described as one here until
 * 2026-09-02, and that framing was wrong in a way worth recording. The rule it
 * enforces is "a stranger can install this", and there are two ways to satisfy
 * it: remove the dependency, or make the dependency publicly installable.
 * Counting the list down to zero only ever admits the first, and for a package
 * that is GENERIC and SHARED the first means vendoring a copy. Adding a name
 * here should still feel like a decision — but the question is "can an outsider
 * install it?", not "is it @sgiant?".
 */

// `import.meta.dirname`, not `import.meta.dirname`: tests/run.cjs transpiles to CJS and
// requires each file, so an import.meta reference makes the module ESM and the
// runner fails to load it at all.
const ROOT = join(import.meta.dirname, "..");
const PKG = join(ROOT, ".");

/**
 * `@sgiant/*` packages the core entry may reach at runtime.
 *
 * `sgiant-ai-agent-bridge` — two sites, both real:
 *   - `createFrameTransport`, the advanced pane's iframe transport
 *   - the UI-control primitives (`runUiControl`, `runOperateAction`, …) that
 *     `host-actions.ts` calls, re-exported through the `ui-control.ts` shim
 *
 * It is allowed PERMANENTLY, not pending removal. Since 2026-09-02 it is public
 * MIT on GitHub and publishes to public npm, so a consumer who has never heard
 * of sgiant can install it — which is the whole of what this test protects.
 * Vendoring it instead would have forked 732 lines of a postMessage protocol
 * whose two halves must agree byte for byte, in order to satisfy a checkbox
 * whose purpose was already met.
 */
const CORE_ALLOWED = new Set(["sgiant-ai-agent-bridge"]);

/** Walk relative imports from an entry, collecting runtime @sgiant specifiers. */
function runtimeSgiantDeps(entry: string): Map<string, string> {
  const seen = new Set<string>();
  const found = new Map<string, string>();
  const stack = [entry];

  while (stack.length) {
    const file = stack.pop()!;
    if (seen.has(file) || !existsSync(file)) continue;
    seen.add(file);
    const src = readFileSync(file, "utf8");

    const re = /^[ \t]*(?:import|export)[\s\S]*?from\s+"([^"]+)"/gm;
    for (const m of src.matchAll(re)) {
      const spec = m[1];
      const statement = m[0];
      if (spec.startsWith(".")) {
        stack.push(normalize(join(dirname(file), spec)) + ".ts");
        continue;
      }
      if (!/^(@sgiant\/|sgiant-)/.test(spec)) continue;
      // `import type { … }` / `export type { … }` are erased at build.
      if (/^[ \t]*(?:import|export)\s+type\b/.test(statement)) continue;
      if (!found.has(spec)) found.set(spec, relative(ROOT, file));
    }
  }
  return found;
}

test("the widget core reaches no @sgiant package outside the allowlist (#306)", () => {
  const deps = runtimeSgiantDeps(join(PKG, "src/index.ts"));

  const unexpected = [...deps].filter(([spec]) => !CORE_ALLOWED.has(spec));
  assert.deepEqual(
    unexpected.map(([spec, via]) => `${spec} (via ${via})`),
    [],
    `the widget core grew a @sgiant runtime dependency. Every one of these is a ` +
      `package a third party must install to show a chat bubble — which is the ` +
      `whole of what #306 is removing. Move it behind an entry point of its own, ` +
      `the way applyProposal moved to "sgiant-ai-widget/sgiant".`
  );
});

test("the sgiant adapter has left the widget PACKAGE, not just its core (#306)", () => {
  // It was moved to @sgiant/ai-apply on 2026-09-02. It briefly lived at a
  // `./sgiant` subpath of this package, which got it out of the core's import
  // graph but NOT out of the published tarball — a distinction that only starts
  // to matter once the tarball is public, which is the whole point of #306.
  //
  // @sgiant/asset-actions is GitLab-restricted. A public package that ships a
  // file importing it produces an install nobody outside the group can
  // complete.
  assert.ok(
    !existsSync(join(PKG, "src/apply-proposal.ts")),
    `apply-proposal.ts is back inside the widget package. It maps sgiant tool ` +
      `names onto sgiant endpoints and pulls in the GitLab-restricted ` +
      `@sgiant/asset-actions — neither belongs in something a stranger installs.`
  );

  const pkg = JSON.parse(readFileSync(join(PKG, "package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
  };
  assert.ok(
    !(pkg.dependencies ?? {})["@sgiant/asset-actions"],
    `the widget declares @sgiant/asset-actions again. Nothing in it imports that ` +
      `package any more, and a restricted dependency in the manifest breaks the ` +
      `install for every consumer outside the GitLab group even if no file uses it.`
  );
});

test("every entry point in package.json has a source file behind it (#306)", () => {
  const pkg = JSON.parse(readFileSync(join(PKG, "package.json"), "utf8")) as {
    exports: Record<string, string | Record<string, string>>;
  };

  // IT CHECKS THE SOURCE, NOT dist/, and that distinction cost a red pipeline.
  //
  // The first version asserted the export targets existed on disk. They do —
  // after a build. `dist/` is gitignored and the unit-tests job does not build
  // the package, so this passed on a laptop where the build had been run and
  // failed in CI where it had not. A test whose result depends on whether
  // someone happened to run a build is not testing the repo.
  //
  // The defect worth catching is an exports map naming a module that does not
  // exist — `./dist/nope.js` with no `src/nope.ts` behind it. That is visible
  // in the source tree, needs no build, and is the same answer in both places.
  const targets: string[] = [];
  for (const value of Object.values(pkg.exports)) {
    if (typeof value === "string") targets.push(value);
    else targets.push(...Object.values(value));
  }

  assert.ok(
    targets.length >= 2,
    `only found ${targets.length} export target(s) — the matcher is broken, not the package`
  );

  // The global bundle is the one export with no same-named source: esbuild
  // rolls it up from src/index.ts (scripts/build-global.mjs). It is still
  // PRODUCED — which is what this test is about — so it is checked against its
  // real producer rather than against a file that will never exist.
  const GENERATED: Record<string, string> = {
    "./dist/sgiant-ai-widget.global.js": "scripts/build-global.mjs",
    // The chart renderer's own global. It is a SEPARATE bundle on purpose: the
    // widget core does not contain it, and the audience that needs it is the one
    // with no bundler to reach the `./charts` subpath with.
    "./dist/sgiant-ai-widget-charts.global.js": "scripts/build-global.mjs",
  };
  for (const [target, producer] of Object.entries(GENERATED))
    if (targets.includes(target))
      assert.ok(
        existsSync(join(PKG, producer)),
        `package.json exports ${target}, whose producer ${producer} is missing`
      );

  const orphans = [...new Set(targets)]
    .filter((t) => !(t in GENERATED))
    .map((target) => ({
      target,
      // ./dist/apply-proposal.js and .d.ts both come from src/apply-proposal.ts
      src: target
        .replace(/^\.\/dist\//, "src/")
        .replace(/\.(d\.ts|js)$/, ".ts"),
    }))
    .filter(({ src }) => !existsSync(join(PKG, src)))
    .map(({ target, src }) => `${target} (expected ${src})`);

  assert.deepEqual(
    orphans,
    [],
    `package.json exports name modules with no source behind them. The build will ` +
      `emit nothing for these, and a consumer finds out at THEIR build rather than here.`
  );
});
