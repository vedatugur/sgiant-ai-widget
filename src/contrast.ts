/**
 * Accent/foreground contrast, WCAG 2.1 relative luminance (#307).
 *
 * WHY THIS EXISTS: the widget shipped `--aiw-accent-contrast: #fff`, correct
 * against its own violet default (7.10:1) and never overridden by a single
 * host. All three of ours pass a brand accent and none passes a contrast
 * colour, so every accent-filled control rendered white on teal `#60C7C8` —
 * **2.00:1**, against a 4.5:1 floor. Seventeen declarations, thirteen controls,
 * four surfaces.
 *
 * A default cannot fix that, because the failing value IS the default. The
 * pairing has to be DERIVED from whatever accent arrives — which also makes the
 * widget safe to publish (#306), where we will not control the accent at all.
 *
 * No dependency on @sgiant/tokens on purpose: this file has to survive being
 * extracted into a public package.
 */

/** The two foregrounds we choose between. Both are brand values, and both are
 *  near enough to black/white to behave sensibly for an arbitrary accent a
 *  third-party host passes. */
export const CONTRAST_DARK = "#151D2F"; // brand navy
export const CONTRAST_LIGHT = "#FCF7E3"; // brand cream

/** #rgb, #rrggbb, or #rrggbbaa → [r,g,b] 0-255. Null when unparseable — a
 *  caller must then keep whatever it already had rather than guess. */
function parseHex(hex: string): [number, number, number] | null {
  const h = hex.trim().replace(/^#/, "");
  if (h.length === 3) {
    const [r, g, b] = h.split("");
    if (!/^[0-9a-f]{3}$/i.test(h)) return null;
    return [parseInt(r + r, 16), parseInt(g + g, 16), parseInt(b + b, 16)];
  }
  if ((h.length === 6 || h.length === 8) && /^[0-9a-f]+$/i.test(h)) {
    return [
      parseInt(h.slice(0, 2), 16),
      parseInt(h.slice(2, 4), 16),
      parseInt(h.slice(4, 6), 16),
    ];
  }
  return null;
}

/** WCAG 2.1 relative luminance. */
export function relativeLuminance(hex: string): number | null {
  const rgb = parseHex(hex);
  if (!rgb) return null;
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio, 1–21. Null when either colour is unparseable. */
export function contrastRatio(a: string, b: string): number | null {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  if (la === null || lb === null) return null;
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * The foreground to use on a given accent: whichever of dark/light contrasts
 * more. Returns null for anything it cannot parse — `color-mix()`, a CSS
 * variable, `rebeccapurple` — so the caller leaves the host's own value alone
 * instead of overwriting it with a guess.
 *
 * Measured on the accents this repo actually ships: teal → navy 8.41, amber →
 * navy 8.73, orange → navy 5.98, and the violet default → cream 6.62. All four
 * clear 4.5:1, which the host repo's contrast test asserts, so the
 * next brand-colour change cannot quietly undo it.
 */
export function resolveAccentContrast(accent: string): string | null {
  const dark = contrastRatio(accent, CONTRAST_DARK);
  const light = contrastRatio(accent, CONTRAST_LIGHT);
  if (dark === null || light === null) return null;
  return dark >= light ? CONTRAST_DARK : CONTRAST_LIGHT;
}

/**
 * Mix two hex colours in sRGB, the same way CSS `color-mix(in srgb, …)` does.
 *
 * Exists because the user's message bubble is not painted with the accent — it
 * is painted with the accent mixed 76% into a near-black navy, and a foreground
 * derived from the RAW accent is derived against the wrong background. Over the
 * teal all three hosts pass, that bubble resolves to `#4a9d9e` and the sheet's
 * literal `#fff` measures **3.18:1** on it: #307's defect, still live in the
 * most-used element in the widget, because the fix was applied to the token and
 * the bubble never read the token.
 *
 * The mix is computed HERE and handed to CSS as a resolved value, rather than
 * computed here AND written as a `color-mix()` next door. Two implementations of
 * one blend is how the foreground and the background drift apart, which is the
 * whole bug again one level down.
 *
 * Null when either colour is unparseable — the caller must then leave whatever
 * was there alone rather than guess, exactly as `resolveAccentContrast` does.
 */
export function mixSrgb(a: string, b: string, ratioA: number): string | null {
  const pa = parseHex(a);
  const pb = parseHex(b);
  if (!pa || !pb) return null;
  const p = Math.min(1, Math.max(0, ratioA));
  const chan = (i: number): string =>
    Math.round(pa[i] * p + pb[i] * (1 - p))
      .toString(16)
      .padStart(2, "0");
  return `#${chan(0)}${chan(1)}${chan(2)}`;
}

/**
 * The accent, adjusted until it is legible as TEXT on a given surface.
 *
 * `--aiw-accent` is a FILL colour. Twenty rules also use it as ink — links,
 * hover states, the focused input, chips, KPI deltas, the menu icons, the
 * active vote — and a fill is not an ink. Measured against the surfaces this
 * sheet actually paints:
 *
 *   teal   #60C7C8 (what all three hosts pass)   2.00:1 on white,  9.05 on dark
 *   violet #6d28d9 (the widget's own default)    7.10:1 on white,  2.55 on dark
 *   amber  #FBAA34                               1.93:1 on white,  9.39 on dark
 *
 * So it is not "the teal is a bad accent". Every accent is illegible as ink on
 * one of the two schemes; the widget's own default is the one that fails in the
 * dark. Which scheme breaks depends only on where the accent sits between the
 * two surfaces, and that is a property of the colour, not a mistake in it.
 *
 * The adjustment blends toward black or white — whichever the surface is
 * further from — and returns the FIRST step that clears the floor, so the ink
 * stays as close to the brand accent as legibility allows rather than jumping
 * to a safe navy. Hue survives; some chroma does not.
 *
 * 5% steps because that is finer than the eye reads as a colour change and
 * still terminates in twenty iterations. Null when the accent is unparseable —
 * the caller leaves the token alone and the sheet's own default applies, which
 * is the same contract as `resolveAccentContrast`.
 */
export function accentInk(
  accent: string,
  surface: string,
  target = 4.5
): string | null {
  const surfaceLum = relativeLuminance(surface);
  if (surfaceLum === null || parseHex(accent) === null) return null;
  const pole = surfaceLum > 0.5 ? "#000000" : "#ffffff";
  for (let p = 1; p >= 0; p -= 0.05) {
    const candidate = mixSrgb(accent, pole, p);
    if (!candidate) return null;
    const ratio = contrastRatio(candidate, surface);
    if (ratio !== null && ratio >= target) return candidate;
  }
  return pole;
}
