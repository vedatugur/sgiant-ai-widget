import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

/**
 * `sgiant-ai-widget` is vanilla DOM, and has to stay that way to be embeddable.
 *
 * It declared `@sgiant/ui` as a dependency and used exactly one thing from it:
 * `motionCssVars`, through the `@sgiant/ui/tokens` subpath. That subpath is a
 * re-export left over from before the tokens moved into their own package — so
 * a widget with zero React imports was dragging a React component library, and
 * with it three.js, recharts and Clerk, to read one function.
 *
 * It matters more than tidiness: the point of this package is that someone can
 * drop the chat widget into a site that is not ours. Its dependency closure IS
 * the install.
 */
const manifest = (p: string) => JSON.parse(readFileSync(p, "utf8"));
const widget = manifest("package.json");

const srcFiles = readdirSync("src")
  .filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"))
  .map((f) => readFileSync(`src/${f}`, "utf8"));

describe("sgiant-ai-widget stays embeddable", () => {
  it("imports no framework", () => {
    for (const body of srcFiles) {
      assert.doesNotMatch(
        body,
        /^\s*import[^;]*\bfrom\s+["'](react|react-dom|vue|svelte)["']/m,
        "a framework import here ends the 'drop it into any site' story"
      );
    }
  });

  it("does not depend on the React component library", () => {
    assert.ok(
      !widget.dependencies["@sgiant/ui"],
      "@sgiant/ui carries React, three.js, recharts and Clerk — take tokens from @sgiant/tokens"
    );
  });

  it("takes tokens from neither React package", () => {
    // Match an IMPORT, not a mention: the reason for this change is written in
    // a comment in index.ts, and a substring check flagged its own explanation.
    for (const spec of ["@sgiant/ui/tokens", "@sgiant/tokens"]) {
      const imported = srcFiles.some((b) =>
        new RegExp(
          `^\\s*import[^;]*\\bfrom\\s+["']${spec.replace("/", "\\/")}["']`,
          "m"
        ).test(b)
      );
      assert.ok(!imported, `${spec}: the six motion vars are inlined (#306)`);
    }
    // `@sgiant/tokens` was the FIX for the `@sgiant/ui/tokens` mistake, and it
    // was the right fix while the widget only had to build in this monorepo.
    // Publishing changes the question: a stranger installing from a registry
    // cannot resolve any `@sgiant/*` name. So the vars are inlined in
    // `limits.ts`, bound to the originals by `ai-widget-limits.test.ts`.
    assert.ok(
      !widget.dependencies["@sgiant/tokens"],
      "drop the dependency too"
    );
  });

  it("has a dependency closure a stranger can install", () => {
    // THE criterion, and the one the three tests above only approximate.
    //
    // Each of them names a package that was, at some point, the wrong one to
    // depend on — and each time the fix held until the next import arrived by a
    // different door. `@sgiant/ui` was replaced by `@sgiant/tokens`; then
    // `@sgiant/assets/actions` walked a private React library back in through a
    // SUBPATH, which every check above was blind to because it is not
    // `@sgiant/ui` and it is not a framework import.
    //
    // So stop enumerating the wrong packages and assert the property: walk the
    // transitive workspace closure and let nothing `private: true` or carrying
    // React be in it. A subpath import cannot slip past this, because the
    // manifest is what npm reads.
    const closure = new Set<string>();
    const stack = ["sgiant-ai-widget"];
    while (stack.length) {
      const name = stack.pop() as string;
      if (closure.has(name)) continue;
      const dir = `packages/${name.slice("@sgiant/".length)}`;
      let m;
      try {
        m = manifest(`${dir}/package.json`);
      } catch {
        continue; // not a workspace package — a real npm dep, fine
      }
      closure.add(name);
      for (const block of ["dependencies", "peerDependencies"] as const)
        for (const d of Object.keys(m[block] ?? {}))
          if (d.startsWith("@sgiant/")) stack.push(d);
    }
    for (const name of closure) {
      if (name === "sgiant-ai-widget") continue; // the package itself
      const m = manifest(
        `packages/${name.slice("@sgiant/".length)}/package.json`
      );
      assert.notEqual(
        m.private,
        true,
        `${name} is in the widget's closure and is private:true — npm cannot install it`
      );
      assert.ok(
        !m.dependencies?.react && !m.peerDependencies?.react,
        `${name} is in the widget's closure and pulls React`
      );
    }
  });

  it("every dependency it declares is one it actually imports", () => {
    // The `@sgiant/ui` entry outlived its last use by a whole refactor. Nothing
    // fails when that happens — the package just gets heavier for consumers who
    // are not in this repo and cannot see why.
    const declared = Object.keys(widget.dependencies).filter((d) =>
      d.startsWith("@sgiant/")
    );
    const joined = srcFiles.join("\n");
    for (const dep of declared) {
      assert.ok(
        joined.includes(`"${dep}"`) || joined.includes(`"${dep}/`),
        `${dep} is declared but never imported`
      );
    }
  });
});
