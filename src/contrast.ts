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
 * clear 4.5:1, which `tests/unit/aiw-accent-contrast.test.ts` asserts so the
 * next brand-colour change cannot quietly undo it.
 */
export function resolveAccentContrast(accent: string): string | null {
  const dark = contrastRatio(accent, CONTRAST_DARK);
  const light = contrastRatio(accent, CONTRAST_LIGHT);
  if (dark === null || light === null) return null;
  return dark >= light ? CONTRAST_DARK : CONTRAST_LIGHT;
}
