/**
 * The manifest contract and its generator, on their own subpath.
 *
 * A page that only wants to DESCRIBE itself has no use for the agent transport
 * or the postMessage protocol, and a build that pulls those in to read a type
 * is how a dependency-light package stops being one.
 */
export * from "./manifest.js";
export * from "./manifest-generate.js";
//# sourceMappingURL=manifest-entry.js.map