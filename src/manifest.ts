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
 * WHAT IS HERE. The widget's OWN surface: the panel's manifest, the ids it
 * stamps, the check of that manifest against the live panel, and the split
 * that keeps the panel's ids apart from the page's in a scan.
 *
 * The generator and the contract (`generateManifest`, `verifySurface`,
 * `canAct`, `hashManifest`, …) are the bridge's, and since 2.0.0 (audit F137)
 * a host imports them from `sgiant-ai-agent-bridge/manifest` directly: this
 * entry used to re-export them, a second door to the same functions that
 * nobody used.
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
