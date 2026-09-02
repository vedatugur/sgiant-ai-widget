/**
 * Every SVG the widget draws: the Copilot mark, its gradient defs, and the
 * chrome icons.
 *
 * Extracted from index.ts (#320). Pure data â one import and no behaviour â
 * which is what makes it the cheapest region to move, and the reason to move
 * it first.
 *
 * It also answers something #306 asks for and #305 warned about. The mark's
 * only escape hatch is `avatarUrl`, which swaps in an `<img>`: an embedder
 * either uses our moon or supplies a BITMAP, with no way to pass a vector.
 * #305 asked that the redraw land "as something replaceable, not a second
 * constant" â and it landed as a constant, here. Making the mark themeable
 * starts by having a file to point at.
 */
import { PREFIX } from "./prefix";

// Copilot — the CRESCENT (#305). "Copilot = moonlight (tr)" is already the
// comment on the ASSISTANT design token, and this file's own avatar fallback
// was documented as "else a crescent glyph" — describing a mark nobody had
// drawn. This draws it.
//
// What it replaces: a morphing SVG blob, an feGaussianBlur+feColorMatrix goo
// filter, two orbiting metaballs with three <animate> tracks each, a float
// loop, a blink loop, an orange glow, a gradient ring and a two-layer shadow —
// EIGHT simultaneous effects to say one thing, "there is a chat here". Each was
// added for a reason and none was ever taken away, so the launcher was loud at
// rest and had nothing left to say when a reply was actually waiting.
//
// It is ONE path with no filter and no SMIL. That is not only simplicity: a CSS
// `animation:none` cannot reach a SMIL <animate>, so a reader who asked their OS
// for stillness got a permanently moving blob in the corner of every page (#308
// recorded that as unreachable from CSS; this is the fix).
//
// THE GROUND RULE, measured rather than chosen. Contrast over the brand sweep:
// white fails on every stop (teal 2.00, amber 1.93, orange 2.81) and navy
// clears all of them (8.41 / 8.73 / 5.98); on cream, teal is 1.86 and navy is
// 15.66. Navy is the only value that survives the whole sweep and cream is the
// only value that survives navy — so THE MARK AND ITS DISC ALWAYS STRADDLE
// NAVY. Light ground: navy disc, gradient mark. Ink ground: the whole object
// inverts to a cream disc with a navy mark. The gradient never makes that
// second trip, which is why there is no third variant.
export const AVATAR_DEFS = `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
<linearGradient id="${PREFIX}-av-sweep" x1="0" y1="1" x2="1" y2="0">
<stop offset="0%" stop-color="#60C7C8"/><stop offset="55%" stop-color="#FBAA34"/><stop offset="100%" stop-color="#FA712D"/>
</linearGradient></defs></svg>`;

// The mark, taken from the resolved specimen rather than re-derived: two arcs
// of the SAME radius, which is what makes a crescent read as a MOON. My first
// attempt used a shallower second arc (r19 against r15) with the tips at top
// and bottom — geometrically a crescent, but standing straight up. It read as
// 90 degrees, which is a shape and not a moon. This one is tilted, and the
// tilt is the whole difference.
export const AVATAR_SVG = `<svg viewBox="0 0 24 24" class="${PREFIX}-ayca" aria-hidden="true"><path class="${PREFIX}-av-mark" d="M20.4 14.5A8.6 8.6 0 0 1 9.5 3.6 8.6 8.6 0 1 0 20.4 14.5Z"/></svg>`;

// Small line icons for the header controls (currentColor, 18px).
export const ICON_HISTORY = `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3v5h5"/><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8"/><path d="M12 7v5l3 2"/></svg>`;
export const ICON_EXPAND = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/></svg>`;
export const ICON_COLLAPSE = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 14h6v6"/><path d="M20 10h-6V4"/><path d="M14 10l7-7"/><path d="M3 21l7-7"/></svg>`;
// Compass — the auto-navigate ("drive me there") toggle.
export const ICON_COMPASS = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><polygon points="16.2 7.8 13.4 13.4 7.8 16.2 10.6 10.6 16.2 7.8"/></svg>`;
// Advanced view: a panel split into a sidebar + main area (Copilot ⇆ live app).
export const ICON_ADVANCED = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><line x1="10" y1="4" x2="10" y2="20"/></svg>`;
export const ICON_CHEVRON_R = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>`;
// Download — export the current conversation as a .txt transcript.
export const ICON_DOWNLOAD = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;
// Flag — agent/admin oversight: flag the current conversation with a reason.
export const ICON_FLAG = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>`;
// Bell — toggle a soft chime when a reply arrives.
export const ICON_BELL = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>`;
export const ICON_BELL_OFF = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13.73 21a2 2 0 0 1-3.46 0"/><path d="M18.63 13A17.9 17.9 0 0 1 18 8"/><path d="M6.26 6.26A6 6 0 0 0 6 8c0 7-3 9-3 9h14"/><path d="M18 8a6 6 0 0 0-9.33-5"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;
// Kebab (vertical dots) — the "More" overflow menu that collects the secondary
// header controls so they no longer crowd the title bar side-by-side.
export const ICON_MORE = `<svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="12" cy="19" r="1.7"/></svg>`;
// Paperclip — the composer's attach-a-file control. A crisp line icon replaces
// the flat 📎 emoji so the button reads as part of the widget, not an OS glyph.
export const ICON_ATTACH = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21.44 11.05l-9.19 9.19a5.5 5.5 0 0 1-7.78-7.78l9.19-9.19a3.5 3.5 0 0 1 4.95 4.95l-9.2 9.19a1.5 1.5 0 0 1-2.12-2.12l8.49-8.49"/></svg>`;
// Branching controls: edit a user turn, regenerate an assistant reply, and the
// ‹n/m› sibling switcher arrows.
export const ICON_EDIT = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`;
export const ICON_REGEN = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 2v6h6"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L3 8"/></svg>`;
export const ICON_CHEV_L = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>`;
export const ICON_CHEV_R = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>`;
// Per-message quality vote (thumbs up/down) — mirrors the React panel's VoteButtons.
export const ICON_THUMB_UP = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 10v12"/><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z"/></svg>`;
export const ICON_THUMB_DOWN = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 14V2"/><path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z"/></svg>`;
