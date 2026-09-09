/**
 * The surface-manifest toolkit, as an OPT-IN entry point.
 *
 * WHY A SEPARATE ENTRY. The widget core is one runtime dependency, zero peers
 * and no React — a property this package has already had broken twice, once by
 * an import that "made a vanilla-DOM widget declare a React library carrying
 * three.js, recharts and Clerk to read one function". A host that never
 * generates or verifies a manifest should pay nothing for the machinery, and
 * nothing in the main entry references this file. `./charts` proved the pattern.
 *
 * WHAT IS HERE, and where each piece comes from.
 *
 * The GENERATOR and the CONTRACT are the bridge's — `sgiant-ai-agent-bridge`
 * has shipped `generateManifest`, `verifySurface`, `canAct` and `hashManifest`
 * since the contract was written, documented down to why a dialog becomes a
 * nested view rather than more controls on the page. Nothing called any of them
 * (sgiant-platform#356). Re-exporting here is not a convenience: an
 * implementation nobody can reach from the artifact every surface already loads
 * is the fifth instance this week of a thing built and wired to nothing.
 *
 * The WIDGET's own pieces sit beside them because a host needs both halves in
 * one import: draft a manifest for its page, verify the panel's against the
 * live DOM, and keep the two surfaces apart when it sends a page context.
 *
 * NO NEW DEPENDENCY. The bridge is already a runtime dependency of the core
 * (`widget-manifest.ts` imports the contract types from it), so this entry adds
 * a file, not a package.
 *
 * ## The rule the whole thing rests on
 *
 * **The manifest declares; the DOM confirms.** A manifest describes; the page
 * IS. When they disagree the page wins, because the page is what the user is
 * looking at — and an assistant acting on the manifest instead is #348's
 * failure mode (narrating what it cannot observe) with a click attached. So a
 * generated draft is explicitly a DRAFT, and `verifySurface` is not an optional
 * extra: it is the half that makes the other half safe.
 */

export {
  // The generator: a DOM walk into a draft, with `notes` naming what a human
  // should look at before trusting it. An empty `notes` is meaningful.
  generateManifest,
  // The verifier, and the same walk that produced the draft.
  verifySurface,
  // "May the assistant act on this, right now, on this document" — one call
  // returning a REASON, so callers do not each invent their own explanation.
  canAct,
  effectiveMutates,
  // Identity and lookup.
  hashManifest,
  findControl,
  flattenControls,
  flattenViews,
  flattenMedia,
  isValidControlId,
  isControlFamily,
  matchesFamily,
  MANIFEST_VERSION,
} from "sgiant-ai-agent-bridge/manifest";

export type {
  SurfaceManifest,
  ManifestDrift,
  ManifestRoot,
  ManifestElement,
  ActDecision,
} from "sgiant-ai-agent-bridge/manifest";

export {
  // The panel's own manifest, and the ids it stamps.
  WIDGET_MANIFEST,
  WIDGET_SURFACE,
  WIDGET_TARGETS,
  WIDGET_CONDITIONAL_TARGETS,
  WIDGET_TARGET_DECLARATIONS,
  // Verify the panel against a live root, in three buckets: a conditional
  // control the host did not wire is "not available here" and TRUE; one
  // declared unconditionally and absent means the manifest is wrong.
  verifyWidgetSurface,
  describeWidgetDrift,
  checkWidgetTarget,
  // Keep the two surfaces apart in a scan: an id the widget stamps is the
  // widget's, whatever the page around it looks like.
  splitSurfaceTargets,
  hostTargetsOnly,
} from "./widget-manifest.js";

export type { WidgetSurfaceCheck, ScannedTarget } from "./widget-manifest.js";
