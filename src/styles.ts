/**
 * The widget's stylesheet, and the one decision that decides how it is themed.
 *
 * Extracted from index.ts (#320), which was 8278 lines with 5822 of them inside
 * a single function. This is the largest region that is NOT inside that
 * closure — 730 lines that depend on exactly three things (the class prefix,
 * the motion tokens, and which side the launcher sits on) and are read by one
 * caller. Moving it is mechanical and changes no behaviour, which is the point:
 * the file it came from is the one #306 proposes publishing, and 8278 lines is
 * not something a third party can read.
 */
import { motionCssVars } from "./limits";

import { PREFIX } from "./prefix";

let stylesInjected = false;
/**
 * Does the page around us define the PLATFORM's control variables?
 *
 * When the widget is mounted inside one of our own apps, `--input` / `--ring` /
 * `--card` / … are already on `<html>` (packages/ui/src/styles/globals.css), and
 * a text field in chat should be the same object as a text field on the page
 * behind it — same border, same focus ring, same radius, flipping together when
 * the app toggles `.dark`. When the widget is embedded on a customer's site,
 * none of that exists and it must fall back to its own `--aiw-*` palette.
 *
 * The check is deliberately shape-based, not merely presence-based: `--input`
 * is a plausible name for anyone to invent, but our tokens are HSL COMPONENTS
 * ("220 9% 85%") so they can be used with an alpha. A site whose `--input` is
 * `#fff` fails the test and we leave its page alone — the failure mode of
 * guessing wrong here is an unreadable chat form on someone else's website.
 */
/**
 * The near-black the user bubble mixes the accent into.
 *
 * Exported because `index.ts` derives that bubble's foreground against the
 * RESULT of the mix, not against the accent (#307 one level down: over the teal
 * all three hosts pass, the bubble is `#4a9d9e` and the old literal `#fff` was
 * 3.18:1). Two copies of this number would put the derivation and the paint on
 * different backgrounds, which is the same bug again.
 */
export const USER_BUBBLE_INK = "#04191b";

export function hostDefinesPlatformTokens(): boolean {
  try {
    const cs = getComputedStyle(document.documentElement);
    const hslTriplet = /^-?[\d.]+\s+[\d.]+%\s+[\d.]+%$/;
    const required = [
      "--input",
      "--ring",
      "--card",
      "--foreground",
      "--muted-foreground",
      "--primary-foreground",
    ];
    if (!required.every((v) => hslTriplet.test(cs.getPropertyValue(v).trim())))
      return false;
    return cs.getPropertyValue("--radius").trim().length > 0;
  } catch {
    // No DOM/computed style (SSR, hostile sandbox) — own palette is always safe.
    return false;
  }
}

/**
 * DARK MODE: the host's own switch first, the OS only as a fallback.
 *
 * This sheet expressed dark ONLY as `@media (prefers-color-scheme:dark)`, which
 * is right for a widget dropped on a stranger's page and wrong inside our own
 * apps: they carry a light/dark/system switch of their own
 * (packages/ui/src/components/theme.tsx toggles `.dark` on the document
 * element). A user whose OS was dark and whose app was set to LIGHT got a dark
 * widget in a light app, and the reverse broke exactly as hard. Reported from
 * the product, and no gate could have caught it — nothing type-checks a media
 * query, and the widget looks correct in whichever mode the person who changed
 * it happened to be in.
 *
 * `-host-tokens` already answers "are we inside one of our apps": it is set at
 * mount by `hostDefinesPlatformTokens()`, which tests for the platform's own
 * HSL-COMPONENT control variables rather than merely for a name anyone could
 * invent. Where it is present the app owns the scheme in BOTH directions, so
 * the OS query must not apply. Where it is absent nothing else knows the answer
 * and the OS query is all there is.
 *
' * The pane's colours are NOT in here any more. It used to carry a complete
 * parallel palette in literals — #f4f5f7 / #eef0f3 / #e7e8ec / #777 light and
 * #121212 / #1a1a1a / #262626 / #9b9b9b dark — which is what #306 measured as
 * "the advanced pane does not participate in the token system at all": a themed
 * host repainted the whole widget and this pane stayed grey. Every one of those
 * eight values was the light or dark reading of a token that already existed,
 * so the pane now reads the tokens and its dark half falls out for free. Only
 * the shadow differs by scheme, because that one genuinely is not a colour
 * token.
 *
 * It also lifts the URL strip off the floor: #777 on #eef0f3 measured 3.92:1,
 * under the 4.5:1 body-text minimum. --aiw-muted is documented above as a
 * CONTRAST FLOOR and clears it on both surfaces.
 *
 * ONE source string, interpolated under two selector scopes. A hand-copied
 * palette is a palette that drifts, and this one has three separate blocks.
 */
const darkRules = (bubble: string, panel: string): string => `
${bubble},${panel}{--aiw-surface:#161616;--aiw-surface-raised:#1d1d1d;--aiw-surface-2:#2c2c2c;--aiw-bg:#101010;--aiw-text:#eee;--aiw-text-2:#ddd;--aiw-muted:#9b9b9b;--aiw-border:#2a2a2a;--aiw-border-strong:#444;--aiw-border-soft:#262626;--aiw-danger-bg:#231613;--aiw-danger-border:#5a2c1d;--aiw-danger-text:#ff9b7a;--aiw-danger-text-2:#d3a08d;--aiw-ok-bg:#122017;--aiw-ok-border:#2c4d36;--aiw-ok-text:#7fd39a}
${panel} .${PREFIX}-assistant code{background:rgba(255,255,255,.1)}
${panel} .${PREFIX}-assistant blockquote{color:#aaa;border-left-color:color-mix(in srgb,var(--aiw-accent) 53%,transparent)}
${panel} .${PREFIX}-assistant table.md-table th{color:#aaa;border-bottom-color:#2a2a2a}
${panel} .${PREFIX}-assistant table.md-table td{border-bottom-color:#222}
${panel} .${PREFIX}-assistant hr{border-top-color:#2a2a2a}
${panel} .${PREFIX}-pane-frame{box-shadow:0 1px 4px rgba(0,0,0,.4)}
${panel}.${PREFIX}-advanced .${PREFIX}-chatcol{border-right-color:#262626}
${panel}.${PREFIX}-advanced.${PREFIX}-pane-collapsed .${PREFIX}-chatcol{border-right:0}
`;

export function injectStyles(side: "left" | "right"): void {
  if (stylesInjected) return;
  stylesInjected = true;
  // WARNING, and it costs a round trip every time: this whole stylesheet is a
  // TEMPLATE LITERAL. A backtick anywhere below — including inside a CSS
  // comment, where it reads as harmless prose quoting a token name — closes the
  // JS string, and the file fails to compile with an error that points at the
  // wrong line and says only "';' expected". Do not quote identifiers with
  // backticks in these comments.
  // Computed HERE and not interpolated as calls, because the sheet below is a
  // template literal and `aiw-launcher.test.ts` refuses a backtick anywhere
  // inside it. That rule is worth keeping exactly as blunt as it is — a stray
  // backtick in a CSS comment closes the string and reports as "';' expected"
  // on the wrong line — so the calls come out rather than the guard being
  // loosened to understand `${...}` spans.
  const darkWhenHostSaysSo = darkRules(
    `.dark .${PREFIX}-bubble`,
    `.dark .${PREFIX}-panel`
  );
  const darkWhenNobodySaid = darkRules(
    `.${PREFIX}-bubble:not(.${PREFIX}-host-tokens)`,
    `.${PREFIX}-panel:not(.${PREFIX}-host-tokens)`
  );
  const css = `
/* Theme tokens — every color in this sheet reads from these. Light defaults
   here; the dark media block below only REDEFINES tokens; explicit host
   overrides (accent/gradient/theme) land INLINE on the roots and win over
   both, so a themed host is never surprised by the OS color scheme. */
/* Status surfaces (error card, failed job, flag notes) are TOKENS, not literal
 * colours. They used to be hardcoded light hexes with no dark counterpart, so
 * in dark mode a failed job painted #fdf3f3 (near-white) while its title stayed
 * var(--aiw-text) = #eee — white on white, i.e. invisible. Same class of bug
 * left the error card's rust text on its own near-black background. Anything
 * that needs a red/green surface must use these four vars so the dark override
 * below reaches it automatically.
 *
 * NOTE: this whole sheet is a JS template literal — no backticks in here.
 * --aiw-muted is a CONTRAST FLOOR, not a shade preference. It was #888,
 * which measures 3.54:1 on this sheet's own white surface — under the 4.5:1
 * body-text minimum, on the token carrying timestamps, job states and event
 * detail. #6e6e6e clears it against every surface the widget paints
 * (5.10:1 on #fff, 4.76:1 on the darkest, #f7f7f8). The dark counterpart
 * (#9b9b9b) already passes at 6.51:1 / 5.02:1 and is unchanged. Anything
' * lighter than this in light mode is a regression, not a restyle.
 *
 * --aiw-header-bg / --aiw-header-fg are the HEADER's own pair, and they exist
 * because the bar is not an accent-filled control. Its buttons read
 * --aiw-accent-contrast, which #307 correctly made DERIVED from the accent
 * ("white on the teal every host actually passes is 2.00:1"). Against the teal
 * all three of our apps pass, that derivation returns brand navy #151D2F —
 * which is the header background. Navy on navy: 1.00:1, an invisible toolbar,
 * shipped and reported from the product. A token means "readable on the
 * ACCENT"; the header is not the accent. Cream on navy is 15.66:1.
 *
 * These two deliberately do NOT flip with the colour scheme, and neither does
 * the bar. --aiw-surface does, which is how the active-icon chip came to paint
 * #161616 on #151D2F in dark mode. */
.${PREFIX}-bubble,.${PREFIX}-panel{${motionCssVars()}--aiw-accent:#6d28d9;--aiw-accent-contrast:#fff;--aiw-header-bg:#151D2F;--aiw-header-fg:#FCF7E3;--aiw-gradient:linear-gradient(135deg,var(--aiw-accent),var(--aiw-accent));--aiw-surface:#fff;--aiw-surface-raised:#fff;--aiw-surface-2:#f7f7f8;--aiw-bg:#fafafa;--aiw-text:#111;--aiw-text-2:#555;--aiw-muted:#6e6e6e;--aiw-border:#e6e6e6;--aiw-border-strong:#ddd;--aiw-border-soft:#f0f0f0;--aiw-danger-bg:#fff6f2;--aiw-danger-border:#f3c5b6;--aiw-danger-text:#b23b18;--aiw-danger-text-2:#8a5648;--aiw-ok-bg:#f2fbf5;--aiw-ok-border:#bfe3c8;--aiw-ok-text:#2f7d43}
@keyframes ${PREFIX}-spin{to{transform:rotate(360deg)}}
@keyframes ${PREFIX}-rise{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
@keyframes ${PREFIX}-blink{0%,80%,100%{opacity:.25;transform:translateY(0)}40%{opacity:1;transform:translateY(-3px)}}
@keyframes ${PREFIX}-richin{from{opacity:.15;transform:translateY(3px)}to{opacity:1;transform:none}}
.${PREFIX}-rich-in{animation:${PREFIX}-richin var(--duration-base) var(--ease-out)}
@keyframes ${PREFIX}-tokin{from{opacity:0;filter:blur(5px)}to{opacity:1;filter:blur(0)}}
.${PREFIX}-tok{animation:${PREFIX}-tokin var(--duration-base) var(--ease-out) forwards}
.${PREFIX}-activity{align-self:flex-start;display:inline-flex;align-items:center;gap:7px;max-width:92%;border:1px solid color-mix(in srgb,var(--aiw-accent) 15%,transparent);background:color-mix(in srgb,var(--aiw-accent) 5%,transparent);border-radius:10px;padding:5px 10px;font-size:12px;font-weight:500;animation:${PREFIX}-rise var(--duration-fast) var(--ease-out)}
.${PREFIX}-activity-done{opacity:.72}
.${PREFIX}-act-label{color:var(--aiw-text-2)}
.${PREFIX}-act-agent{flex:0 0 auto;font-size:10px;font-weight:700;letter-spacing:.3px;text-transform:uppercase;color:var(--aiw-accent);background:color-mix(in srgb,var(--aiw-accent) 12%,transparent);border:1px solid color-mix(in srgb,var(--aiw-accent) 24%,transparent);border-radius:6px;padding:1px 6px}
.${PREFIX}-act-model{flex:0 0 auto;font-size:9.5px;font-weight:600;letter-spacing:.2px;color:var(--aiw-muted);background:#9aa0a614;border:1px solid #9aa0a630;border-radius:6px;padding:1px 5px;font-variant-numeric:tabular-nums}
.${PREFIX}-act-spin{width:11px;height:11px;flex:0 0 auto;border-radius:50%;border:2px solid color-mix(in srgb,var(--aiw-accent) 27%,transparent);border-top-color:var(--aiw-accent);animation:${PREFIX}-spin .7s linear infinite}
.${PREFIX}-act-ok{color:#10b981;font-weight:700}
.${PREFIX}-act-x{color:#ef4444;font-weight:700}
.${PREFIX}-job{align-self:flex-start;display:flex;flex-direction:column;gap:6px;max-width:92%;min-width:min(260px,100%);border:1px solid color-mix(in srgb,var(--aiw-accent) 18%,transparent);background:color-mix(in srgb,var(--aiw-accent) 5%,transparent);border-radius:12px;padding:9px 11px;font-size:12px;animation:${PREFIX}-rise var(--duration-fast) var(--ease-out)}
.${PREFIX}-job-done{opacity:.85}
.${PREFIX}-job-failed{border-color:var(--aiw-danger-border);background:var(--aiw-danger-bg)}
.${PREFIX}-job-head{display:flex;align-items:center;gap:7px}
.${PREFIX}-job-title{font-weight:600;color:var(--aiw-text)}
.${PREFIX}-job-state{margin-left:auto;font-size:10px;font-weight:700;letter-spacing:.3px;text-transform:uppercase;color:var(--aiw-muted)}
.${PREFIX}-job-counts{color:var(--aiw-text-2);font-variant-numeric:tabular-nums}
.${PREFIX}-job-bar{height:4px;border-radius:3px;background:color-mix(in srgb,var(--aiw-accent) 14%,transparent);overflow:hidden}
/* scaleX, not width (#309). Animating width reflows on every frame; a
   transform is composited. transform-origin:left so it grows from the start of
   the track rather than its middle. */
.${PREFIX}-job-bar>i{display:block;height:100%;width:100%;transform-origin:left;background:var(--aiw-accent);transition:transform var(--duration-base) var(--ease-out)}
.${PREFIX}-job-detail{color:var(--aiw-muted);font-size:11px;word-break:break-word}
.${PREFIX}-job-mirrored{color:var(--aiw-muted);font-size:11px;font-style:italic}
.${PREFIX}-pane-widget{width:100%;height:100%;overflow:auto;background:var(--aiw-surface);border-radius:12px;padding:16px;box-sizing:border-box}
.${PREFIX}-job-flow{list-style:none;margin:6px 0 0;padding:0 0 0 2px;display:flex;flex-direction:column;gap:3px}
.${PREFIX}-job-ev{position:relative;padding-left:12px;color:var(--aiw-text-2);font-size:11px;line-height:1.35;word-break:break-word}
.${PREFIX}-job-ev::before{content:"";position:absolute;left:0;top:6px;width:5px;height:5px;border-radius:50%;background:var(--aiw-muted)}
.${PREFIX}-job-ev-decision{color:var(--aiw-text)}
.${PREFIX}-job-ev-decision::before{background:var(--aiw-accent,currentColor)}
.${PREFIX}-job-ev-problem{color:var(--aiw-danger-text)}
.${PREFIX}-job-ev-problem::before{background:currentColor}
.${PREFIX}-job-flow-all{margin-top:4px}
.${PREFIX}-job-flow-all>summary{cursor:pointer;color:var(--aiw-muted);font-size:11px;user-select:none}
.${PREFIX}-replay-note{align-self:flex-start;display:inline-flex;align-items:center;border:1px dashed var(--aiw-border-strong);border-radius:9px;padding:4px 10px;font-size:12px;color:var(--aiw-muted);background:var(--aiw-bg)}
.${PREFIX}-flag-note{align-self:center;border-style:solid;border-color:var(--aiw-danger-border);color:var(--aiw-danger-text);background:var(--aiw-danger-bg);font-weight:600}
.${PREFIX}-flag-ok{border-color:var(--aiw-ok-border);color:var(--aiw-ok-text);background:var(--aiw-ok-bg)}
.${PREFIX}-usage{align-self:flex-start;display:inline-flex;align-items:center;gap:6px;margin-top:-4px;padding:0 2px;font-size:10.5px;color:var(--aiw-muted);font-variant-numeric:tabular-nums}
.${PREFIX}-usage-pill{display:inline-flex;align-items:center;border:1px solid var(--aiw-border);border-radius:6px;padding:0 5px;line-height:16px}
.${PREFIX}-usage-sep{opacity:.5}
@keyframes ${PREFIX}-pulse{0%{box-shadow:0 0 0 0 rgba(96,199,200,.5)}70%{box-shadow:0 0 0 12px rgba(96,199,200,0)}100%{box-shadow:0 0 0 0 rgba(96,199,200,0)}}
@keyframes ${PREFIX}-float{0%,100%{transform:translateY(0)}50%{transform:translateY(-2.5px)}}
@keyframes ${PREFIX}-blink2{0%,90%,100%{transform:scaleY(1)}95%{transform:scaleY(.12)}}
/* The crescent (#305). No float loop, no drop-shadow glow: those were two of
   the eight effects the launcher stacked at rest, and a control that is loud at
   rest has nothing left to say when a reply is waiting. */
.${PREFIX}-ayca{display:block;width:100%;height:100%;overflow:visible}
/* THE INVERSION, in two rules. Light ground: navy disc, gradient mark. Ink
   ground: cream disc, navy mark. Nothing else needs to know about grounds. */
.${PREFIX}-av-mark{fill:url(#${PREFIX}-av-sweep)}
.${PREFIX}-on-ink .${PREFIX}-av-mark{fill:#151D2F}
/* THE OBJECT INVERTS, not just the mark. Inverting only the fill left a navy
   mark on a navy disc — invisible, and precisely the failure the rule exists to
   prevent: "a navy pebble on a navy section is a hole with a moon in it". Found
   by looking at it on the dark marketing hero, where the class was correct and
   the result was still nothing. */
/* The ink variant carries a heavier shadow (it has less to push against) and a
   HAIRLINE of the opposite value. The hairline is what makes a stale ground
   reading survivable: a cream disc that ends up over white is 1.06:1 and
   effectively gone, and the ground under a fixed launcher genuinely changes as
   the reader scrolls. One pixel of navy is enough to keep it an object. */
.${PREFIX}-bubble.${PREFIX}-on-ink{background:#FCF7E3;box-shadow:0 8px 24px rgba(0,0,0,.45),0 0 0 1px rgba(21,29,47,.55)}
.${PREFIX}-bubble.${PREFIX}-on-ink .${PREFIX}-bubble-label{color:#151D2F}
.${PREFIX}-bubble.${PREFIX}-on-ink .${PREFIX}-bubble-dot{box-shadow:0 0 0 2px #FCF7E3}
.${PREFIX}-eyes{transform-origin:24px 23px;animation:${PREFIX}-blink2 5.5s ease-in-out infinite}
/* The collapsed launcher is a real, recognisable FAB: a circular surface chip
   with a soft shadow and a hairline ring, the animated mascot centred inside.
   Without the chip the mascot floated as a formless gradient blob that did not
   read as "a chat" at all — the reported "I can't see any chatbox" (#88): the
   widget was mounted and working, just invisible as an affordance. */
/* Layering: the widget sits ABOVE page content and content-level overlays
   (viewers/drawers, z<=40) but BELOW the app's Radix modals (z-50) — a dialog
   the user opens must cover the chat, not hide behind it. The old max-int
   z-index put the chat over every modal. */
/* THE LAUNCHER AT REST IS STILL. It is a navy disc carrying the gradient
   crescent — the object straddles navy, per the ground rule above — with one
   shadow to lift it off the page. The gradient RING is gone with the glow and
   the float: the mark already carries the brand, and the ring was a third
   place saying the same thing. #88 ("I can't see any chatbox") is answered by
   the disc's own contrast (navy on white is 16.82:1) and, on a first visit, by
   the named pill below — a word rather than a puzzle. */
.${PREFIX}-bubble{position:fixed;bottom:18px;${side}:18px;z-index:48;width:56px;height:56px;border:none;border-radius:50%;background:#151D2F;color:#FCF7E3;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:9px;padding:0;box-shadow:0 6px 20px rgba(21,29,47,.22);transition:transform var(--duration-fast,150ms) var(--ease-out),box-shadow var(--duration-fast,150ms) var(--ease-out)}
/* 26 in 56. The mark was 34 at first and the object read flat — a disc with a
   shape stamped on it rather than a mark sitting in space. The ratio is the
   richness here, not an effect. */
.${PREFIX}-bubble .${PREFIX}-ayca{width:26px;height:26px;transition:transform var(--duration-base,300ms) var(--ease-out)}
.${PREFIX}-bubble:active{transform:translateY(0) scale(.96)}
/* The first-visit variant: a word, not a puzzle. Collapses to the pebble once
   the reader has opened it. */
.${PREFIX}-bubble-pill{width:auto;height:48px;border-radius:999px;padding:0 18px 0 14px}
.${PREFIX}-bubble-pill .${PREFIX}-ayca{width:22px;height:22px}
.${PREFIX}-bubble-pill .${PREFIX}-bubble-label{display:block}
.${PREFIX}-bubble-label{display:none;font:inherit;font-size:14.5px;font-weight:600;white-space:nowrap}
/* Only TWO of the six states move, which is what makes movement mean
   something again. */
.${PREFIX}-bubble-unread{animation:${PREFIX}-pulse var(--duration-slow,420ms) var(--ease-out) 1}
.${PREFIX}-bubble-working .${PREFIX}-ayca{animation:${PREFIX}-breathe 2.4s var(--ease-in-out) infinite}
.${PREFIX}-bubble-offline{opacity:.72}
/* A DOT, not the count badge in grey. It reuses the same element, and the
   count's geometry (18px min-width plus 5px of padding, sized for two digits)
   renders an empty string as a wide lozenge — which reads as a broken badge
   rather than a status light. */
.${PREFIX}-bubble-offline .${PREFIX}-bubble-dot{min-width:0;width:10px;height:10px;padding:0;top:4px;background:var(--aiw-muted);box-shadow:0 0 0 2px #151D2F}
.${PREFIX}-bubble-offline.${PREFIX}-on-ink .${PREFIX}-bubble-dot{box-shadow:0 0 0 2px #FCF7E3}
.${PREFIX}-bubble-parked{width:40px;height:40px;opacity:.6}
.${PREFIX}-bubble-parked .${PREFIX}-ayca{width:20px;height:20px}
/* The unread count and the offline dot — one badge element, two looks. */
.${PREFIX}-bubble-dot{position:absolute;top:2px;${side === "left" ? "right" : "left"}:2px;min-width:18px;height:18px;padding:0 5px;border-radius:999px;background:#FA712D;color:#FCF7E3;font-size:11px;font-weight:700;line-height:18px;text-align:center;box-shadow:0 0 0 2px #151D2F}
@keyframes ${PREFIX}-breathe{0%,100%{opacity:1}50%{opacity:.55}}
/* GATED. There was no hover:hover query anywhere in this widget, so on a
   touchscreen the lift-and-scale stuck after the tap. The file already carries
   a correct hover:none block for the per-message actions — the launcher was
   simply never given the same treatment. Lift only; the scale went with it,
   because a control that grows under the cursor is a third thing saying "I am
   interactive" after the shadow and the pointer. */
@media (hover: hover) and (pointer: fine){
.${PREFIX}-bubble:hover{transform:translateY(-2px);box-shadow:0 10px 26px rgba(21,29,47,.3)}
.${PREFIX}-bubble:hover .${PREFIX}-ayca{transform:rotate(-12deg)}
}
.${PREFIX}-bubble-av{position:relative;width:100%;height:100%;display:flex;align-items:center;justify-content:center}
.${PREFIX}-av-img{width:100%;height:100%;object-fit:cover;border-radius:50%}
.${PREFIX}-bubble svg{width:26px;height:26px}
.${PREFIX}-panel{position:fixed;bottom:20px;${side}:20px;z-index:48;width:368px;max-width:calc(100vw - 32px);height:540px;max-height:calc(100vh - 40px);background:var(--aiw-surface);color:var(--aiw-text);border-radius:18px;box-shadow:0 18px 52px rgba(0,0,0,.32);display:flex;flex-direction:column;overflow:hidden;font-family:system-ui,-apple-system,sans-serif;animation:${PREFIX}-rise var(--duration-fast) var(--ease-out);}
/* NAVY, with the sweep as a 2px rule under it (#305). It was the gradient bar
   itself, which is why the avatar needed an rgba(12,17,30,.55) scrim to survive
   — a scrim over a gradient is a patch, not a decision. On navy the mark
   inverts by the rule above and the scrim is unnecessary, so it is gone. */
.${PREFIX}-header{background:var(--aiw-header-bg);color:var(--aiw-header-fg);border-bottom:2px solid transparent;border-image:var(--aiw-gradient) 1;padding:12px 14px;display:flex;align-items:center;gap:10px}
/* Drag-to-reposition. touch-action:none is what makes this work on a
   touchscreen — without it the browser claims the gesture as a scroll and the
   panel never moves. user-select:none stops the title being selected mid-drag. */
/* Question card — the assistant asking the human to decide. Visually distinct
   from a proposal card: this one BLOCKS progress until answered, so it should
   read as something needing you, not as another message. */
.${PREFIX}-question{margin:8px 0;padding:12px;border-radius:12px;background:var(--aiw-surface-raised);border:1px solid var(--aiw-border);animation:${PREFIX}-rise var(--duration-fast) var(--ease-out)}
.${PREFIX}-question-critical{border-color:#d93f0b;box-shadow:0 0 0 1px rgba(217,63,11,.25)}
.${PREFIX}-question-title{font-size:14px;font-weight:600;margin-bottom:4px;color:var(--aiw-text)}
.${PREFIX}-question-ctx{font-size:12px;color:var(--aiw-muted);margin-bottom:8px;line-height:1.45}
.${PREFIX}-question-opts{display:flex;flex-direction:column;gap:6px}
.${PREFIX}-question-opt{display:flex;flex-direction:column;gap:2px;text-align:left;padding:9px 11px;border-radius:9px;border:1px solid var(--aiw-border);background:var(--aiw-surface);color:var(--aiw-text);cursor:pointer;font:inherit;transition:border-color .14s ease,background .14s ease}
.${PREFIX}-question-opt:hover{border-color:var(--aiw-accent);background:var(--aiw-surface-raised)}
.${PREFIX}-question-opt-on{border-color:var(--aiw-accent);background:var(--aiw-surface-raised)}
.${PREFIX}-question-opt-label{font-size:13px;font-weight:600}
.${PREFIX}-question-opt-desc{font-size:12px;color:var(--aiw-muted);line-height:1.4}
.${PREFIX}-question-free{display:flex;gap:6px;margin-top:2px}
.${PREFIX}-question-input{flex:1 1 auto;min-width:0;padding:9px 11px;border-radius:9px;border:1px solid var(--aiw-border);background:var(--aiw-surface);color:var(--aiw-text);font:inherit;font-size:13px}
.${PREFIX}-question-send{padding:9px 14px;border-radius:9px;border:none;background:var(--aiw-accent);color:var(--aiw-accent-contrast);font:inherit;font-size:13px;font-weight:600;cursor:pointer;margin-top:6px}
/* A multi-select confirm with nothing picked has nothing to send — it says so
   rather than looking clickable and doing nothing. */
.${PREFIX}-question-send:disabled{opacity:.5;cursor:not-allowed}
.${PREFIX}-question-err{margin-top:8px;font-size:12px;line-height:1.45;color:#d93f0b}
/* Answered: collapsed to the decision, so the transcript reads as a
   conversation rather than a dead form. */
.${PREFIX}-question-done{border-style:dashed;opacity:.75}
.${PREFIX}-question-answer{font-size:13px;color:var(--aiw-text-2)}
.${PREFIX}-question-answer::before{content:"✓ ";color:var(--aiw-accent)}
.${PREFIX}-draggable{cursor:grab;touch-action:none;user-select:none;-webkit-user-select:none}
.${PREFIX}-draggable:active{cursor:grabbing}
/* Controls inside the header keep normal behaviour — the drag handler ignores
   them, and this keeps the cursor honest about that. */
.${PREFIX}-draggable button,.${PREFIX}-draggable a{cursor:pointer;touch-action:auto}
/* Advanced view is a fixed edge-to-edge layout — dragging is disabled there
   (the pointerdown handler bails), so drop the grab affordance too. */
.${PREFIX}-advanced .${PREFIX}-draggable{cursor:default}
/* Cream disc on the navy header — the ink half of the inversion. The scrim it
   used to carry is gone; see the header rule. */
.${PREFIX}-avatar{position:relative;width:38px;height:38px;flex:0 0 auto;display:flex;align-items:center;justify-content:center;border-radius:50%;background:#FCF7E3}
.${PREFIX}-avatar .${PREFIX}-ayca{width:34px;height:34px}
.${PREFIX}-hname{display:flex;flex-direction:column;line-height:1.15;min-width:0;flex:1 1 auto}
.${PREFIX}-title{font-weight:700;font-size:15px;letter-spacing:.04em}
.${PREFIX}-sub{font-size:11px;opacity:.85}
.${PREFIX}-metachip{align-self:flex-start;margin-top:3px;font-size:9.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;padding:1px 6px;border-radius:6px;background:rgba(255,255,255,.22);color:var(--aiw-accent-contrast);white-space:nowrap;max-width:100%;overflow:hidden;text-overflow:ellipsis}
.${PREFIX}-close{background:color-mix(in srgb,var(--aiw-header-fg) 15%,transparent);border:none;color:var(--aiw-header-fg);font-size:18px;line-height:1;width:26px;height:26px;border-radius:8px;cursor:pointer;flex:0 0 auto}
.${PREFIX}-log{flex:1 1 auto;min-height:0;overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;padding:14px;display:flex;flex-direction:column;gap:10px;background:var(--aiw-bg);scrollbar-width:thin}
.${PREFIX}-log:focus-visible{outline:none}
.${PREFIX}-log::-webkit-scrollbar{width:8px}
.${PREFIX}-log::-webkit-scrollbar-thumb{background:rgba(0,0,0,.18);border-radius:8px}
@keyframes ${PREFIX}-caret{0%,55%{opacity:.85}55.01%,100%{opacity:0}}
.${PREFIX}-streaming::after{content:"";display:inline-block;width:2px;height:1.05em;margin-left:1px;border-radius:1px;background:var(--aiw-accent);vertical-align:-2px;animation:${PREFIX}-caret 1.1s steps(1) infinite}
.${PREFIX}-msg{max-width:85%;padding:9px 12px;border-radius:14px;font-size:14px;line-height:1.45;white-space:pre-wrap;word-break:break-word;animation:${PREFIX}-rise var(--duration-fast) var(--ease-out)}
.${PREFIX}-msg.${PREFIX}-user{align-self:flex-end;background:var(--aiw-user-bg,color-mix(in srgb,var(--aiw-accent) 76%,${USER_BUBBLE_INK}));color:var(--aiw-user-contrast,#fff);border-bottom-right-radius:4px}
.${PREFIX}-assistant{align-self:flex-start;background:var(--aiw-surface-raised);color:var(--aiw-text);border:1px solid var(--aiw-border);border-bottom-left-radius:4px}
.${PREFIX}-assistant p{margin:0 0 8px}.${PREFIX}-assistant>:last-child{margin-bottom:0}
.${PREFIX}-assistant h1,.${PREFIX}-assistant h2,.${PREFIX}-assistant h3,.${PREFIX}-assistant h4{margin:10px 0 6px;font-weight:700;line-height:1.25}
.${PREFIX}-assistant h1{font-size:17px}.${PREFIX}-assistant h2{font-size:16px}.${PREFIX}-assistant h3{font-size:14.5px}.${PREFIX}-assistant h4{font-size:13.5px}
.${PREFIX}-assistant ul,.${PREFIX}-assistant ol{margin:6px 0;padding-left:20px}
.${PREFIX}-assistant li{line-height:1.45;margin:2px 0}
.${PREFIX}-assistant a{color:var(--aiw-accent);text-decoration:underline;text-underline-offset:2px}
.${PREFIX}-assistant code{background:rgba(0,0,0,.06);border-radius:5px;padding:1px 5px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px}
.${PREFIX}-assistant pre.md-pre{background:#0d1117;color:#e6edf3;border-radius:10px;padding:10px 12px;overflow:auto;margin:8px 0}
.${PREFIX}-assistant pre.md-pre code{background:none;padding:0;color:inherit;font-size:12px;white-space:pre}
.${PREFIX}-assistant blockquote{margin:8px 0;padding:2px 12px;border-left:3px solid color-mix(in srgb,var(--aiw-accent) 40%,transparent);color:var(--aiw-text-2)}
.${PREFIX}-assistant hr{border:none;border-top:1px solid var(--aiw-border);margin:10px 0}
.${PREFIX}-assistant table.md-table{width:100%;border-collapse:collapse;font-size:12.5px;margin:8px 0}
.${PREFIX}-assistant table.md-table th{text-align:left;font-weight:700;color:var(--aiw-text-2);border-bottom:1px solid var(--aiw-border);padding:5px 8px}
.${PREFIX}-assistant table.md-table td{border-bottom:1px solid var(--aiw-border-soft);padding:5px 8px}
.${PREFIX}-assistant strong{font-weight:700}.${PREFIX}-assistant del{opacity:.7}
.${PREFIX}-widget-host{padding:8px}
.${PREFIX}-typing{align-self:flex-start;display:flex;gap:4px;padding:10px 12px}
.${PREFIX}-typing span{width:7px;height:7px;border-radius:50%;background:var(--aiw-accent);animation:${PREFIX}-blink 1.2s infinite}
.${PREFIX}-typing span:nth-child(2){animation-delay:.2s}
.${PREFIX}-typing span:nth-child(3){animation-delay:.4s}
.${PREFIX}-error{align-self:stretch;border:1px solid var(--aiw-danger-border);background:var(--aiw-danger-bg);border-radius:14px;padding:11px 12px;animation:${PREFIX}-rise var(--duration-fast) var(--ease-out)}
.${PREFIX}-error-text{font-size:13px;font-weight:600;color:var(--aiw-danger-text)}
.${PREFIX}-error-detail{font-size:11px;color:var(--aiw-danger-text-2);margin-top:3px;word-break:break-word}
.${PREFIX}-error-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:9px}
.${PREFIX}-error-btn{border:1px solid var(--aiw-danger-border);background:var(--aiw-surface);color:var(--aiw-danger-text);border-radius:9px;padding:6px 12px;font-size:12px;font-weight:600;cursor:pointer}
.${PREFIX}-error-retry{background:var(--aiw-accent);border-color:var(--aiw-accent);color:var(--aiw-accent-contrast)}
.${PREFIX}-error-btn:disabled{opacity:.6;cursor:default}
/* Quality prompt (#299) — the widget asking, rather than waiting to be told.
   Reads as a quiet aside, not an alert: it must never look like the error card,
   because on a slow-but-good answer nothing has gone wrong. */
.${PREFIX}-quality{align-self:stretch;border:1px solid var(--aiw-border);background:var(--aiw-surface-2);border-radius:14px;padding:11px 12px;animation:${PREFIX}-rise var(--duration-fast) var(--ease-out)}
.${PREFIX}-quality-title{font-size:12.5px;font-weight:600;color:var(--aiw-text);line-height:1.35}
.${PREFIX}-quality-row{display:flex;align-items:center;gap:8px;margin-top:9px;flex-wrap:wrap}
.${PREFIX}-quality-reason{flex:1 1 160px;min-width:0;border:1px solid var(--aiw-border);background:var(--aiw-surface);color:var(--aiw-text);border-radius:9px;padding:7px 10px;font:inherit;font-size:12.5px}
.${PREFIX}-quality-reason::placeholder{color:var(--aiw-text-3)}
.${PREFIX}-quality-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:9px}
.${PREFIX}-quality-send{border:1px solid var(--aiw-accent);background:var(--aiw-accent);color:var(--aiw-accent-contrast);border-radius:9px;padding:6px 12px;font-size:12px;font-weight:600;cursor:pointer}
.${PREFIX}-quality-send:disabled{opacity:.6;cursor:default}
.${PREFIX}-quality-dismiss{border:1px solid var(--aiw-border);background:var(--aiw-surface);color:var(--aiw-text-2);border-radius:9px;padding:6px 12px;font-size:12px;font-weight:600;cursor:pointer}
/* Answered state: the card collapses to a single line of thanks. */
.${PREFIX}-quality-done{font-size:12.5px;color:var(--aiw-text-2);font-weight:500}
.${PREFIX}-suggestions{display:flex;flex-wrap:wrap;gap:6px;padding:8px 10px 0;background:var(--aiw-surface)}
.${PREFIX}-suggestion{border:1px solid color-mix(in srgb,var(--aiw-accent) 20%,transparent);background:color-mix(in srgb,var(--aiw-accent) 5%,transparent);color:var(--aiw-accent);border-radius:999px;padding:6px 11px;font-size:12.5px;font-weight:500;line-height:1.2;cursor:pointer;transition:background .15s ease,border-color .15s ease;text-align:left}
.${PREFIX}-suggestion:hover{background:color-mix(in srgb,var(--aiw-accent) 10%,transparent);border-color:color-mix(in srgb,var(--aiw-accent) 40%,transparent)}
.${PREFIX}-form{display:flex;gap:8px;padding:10px;border-top:1px solid var(--aiw-border);background:var(--aiw-surface)}
.${PREFIX}-input{flex:1;background:var(--aiw-surface);color:var(--aiw-text);border:1px solid var(--aiw-border-strong);border-radius:11px;padding:10px 12px;font-size:14px;outline:none}
.${PREFIX}-meter{padding:7px 12px 0;background:var(--aiw-surface)}
.${PREFIX}-meter-bar{height:4px;border-radius:999px;background:var(--aiw-surface-2);overflow:hidden}
.${PREFIX}-meter-bar>span{display:block;height:100%;width:100%;transform-origin:left;border-radius:999px;background:linear-gradient(90deg,var(--aiw-accent),#FBAA34);transition:transform var(--duration-base) var(--ease-out)}
.${PREFIX}-meter-row{display:flex;justify-content:space-between;gap:8px;margin-top:3px;font-size:10.5px;color:var(--aiw-muted)}
.${PREFIX}-status{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:7px 12px;font-size:11px;background:var(--aiw-surface);border-top:1px solid var(--aiw-border-soft)}
.${PREFIX}-status-role{display:inline-flex;align-items:center;padding:2px 8px;border-radius:999px;font-weight:600;color:var(--aiw-accent);background:color-mix(in srgb,var(--aiw-accent) 10%,transparent)}
.${PREFIX}-status-credits{font-weight:600;color:var(--aiw-text-2);font-variant-numeric:tabular-nums}
.${PREFIX}-status-credits-val{display:inline-block;transition:color .2s ease}
.${PREFIX}-credits-live{color:var(--aiw-accent)}
.${PREFIX}-cta{display:flex;justify-content:center;padding:6px 0 2px}
.${PREFIX}-cta-btn{display:inline-flex;align-items:center;justify-content:center;border-radius:999px;padding:9px 18px;font-size:13px;font-weight:600;color:var(--aiw-accent-contrast);text-decoration:none;background:linear-gradient(90deg,var(--aiw-accent),#FBAA34);box-shadow:0 4px 14px color-mix(in srgb,var(--aiw-accent) 25%,transparent)}
.${PREFIX}-lead{align-self:stretch;border:1px solid var(--aiw-border);border-radius:14px;padding:11px 12px;background:var(--aiw-surface-raised);animation:${PREFIX}-rise var(--duration-fast) var(--ease-out)}
.${PREFIX}-form-title{font-size:13px;font-weight:600;margin-bottom:8px}
.${PREFIX}-lead-form{display:flex;flex-direction:column;gap:8px}
/* ── Form controls ───────────────────────────────────────────────────────
   Everything the chat can draw as an input goes through ONE token layer
   (--aiw-field-*) instead of its own hexes and radii, and that layer is
   remapped below to the platform's semantic control variables when the host
   page has them. The geometry (40px tall, 12px inline padding, 14px text, a
   recessed inner shadow, a 2px focus ring) MIRRORS packages/ui/src/components/
   input.tsx — the widget is vanilla DOM in a detached root and cannot import
   the React primitive, so the numbers are copied deliberately; that file is the
   source of truth if they ever move. */
.${PREFIX}-bubble,.${PREFIX}-panel{--aiw-field-bg:var(--aiw-surface);--aiw-field-fg:var(--aiw-text);--aiw-field-border:var(--aiw-border-strong);--aiw-field-placeholder:var(--aiw-muted);--aiw-field-ring:var(--aiw-accent);--aiw-field-ring-fg:var(--aiw-accent-contrast);--aiw-field-radius:10px}
/* Host-token mode. Added at mount only when the page really defines our
   variables, so a customer site that happens to own an --input cannot repaint
   the chat's controls. Values stay as var() references, never snapshots, so the
   app's dark-mode class keeps driving them after mount. */
.${PREFIX}-bubble.${PREFIX}-host-tokens,.${PREFIX}-panel.${PREFIX}-host-tokens{--aiw-field-bg:hsl(var(--card));--aiw-field-fg:hsl(var(--foreground));--aiw-field-border:hsl(var(--input));--aiw-field-placeholder:hsl(var(--muted-foreground));--aiw-field-ring:hsl(var(--ring));--aiw-field-ring-fg:hsl(var(--primary-foreground));--aiw-field-radius:calc(var(--radius) - 2px)}
.${PREFIX}-field{width:100%;box-sizing:border-box;min-height:40px;padding:8px 12px;font-family:inherit;font-size:14px;line-height:1.45;color:var(--aiw-field-fg);background:var(--aiw-field-bg);border:1px solid var(--aiw-field-border);border-radius:var(--aiw-field-radius);outline:none;box-shadow:inset 0 1px 2px 0 color-mix(in srgb,var(--aiw-field-fg) 5%,transparent);transition:border-color .15s ease,box-shadow .15s ease}
.${PREFIX}-field::placeholder{color:var(--aiw-field-placeholder);opacity:1}
.${PREFIX}-field:hover:not(:disabled){border-color:color-mix(in srgb,var(--aiw-field-border) 70%,var(--aiw-field-fg))}
.${PREFIX}-field:focus{border-color:var(--aiw-field-ring);box-shadow:0 0 0 2px var(--aiw-field-ring)}
.${PREFIX}-field:disabled{opacity:.5;cursor:not-allowed}
textarea.${PREFIX}-field{min-height:76px;resize:vertical}
/* The native select arrow is drawn by the OS and ignores our palette — in dark
   mode it renders a black-on-dark wedge. Draw our own instead. */
select.${PREFIX}-field{appearance:none;-webkit-appearance:none;cursor:pointer;padding-right:32px;background-image:url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%239aa0a6' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 10px center;background-size:15px}
/* Options are drawn by the OS popup, which does NOT inherit the panel — without
   this a dark-mode select opens as black text on a black list. */
.${PREFIX}-field option{background:var(--aiw-field-bg);color:var(--aiw-field-fg)}
.${PREFIX}-field-group{display:flex;flex-direction:column;gap:6px}
/* "This is the field that's holding you up." An outline rather than a border so
   it lands the same on a bare input, a checkbox row and a radio GROUP — the
   three shapes buildField can hand back. */
.${PREFIX}-field-invalid{outline:1px solid #d93f0b;outline-offset:2px;border-radius:var(--aiw-field-radius)}
.${PREFIX}-form-err,.${PREFIX}-proposal-err{font-size:12.5px;line-height:1.45;color:#d93f0b}
.${PREFIX}-field-check{display:flex;align-items:center;gap:8px;font-size:13.5px;line-height:1.4;color:var(--aiw-field-fg);cursor:pointer}
.${PREFIX}-field-check-label{min-width:0}
.${PREFIX}-check{appearance:none;-webkit-appearance:none;position:relative;flex:0 0 auto;width:16px;height:16px;margin:0;box-sizing:border-box;background:var(--aiw-field-bg);border:1px solid var(--aiw-field-border);border-radius:4px;cursor:pointer;outline:none;transition:background .15s ease,border-color .15s ease,box-shadow .15s ease}
.${PREFIX}-check[type=radio]{border-radius:50%}
.${PREFIX}-check:hover:not(:disabled){border-color:color-mix(in srgb,var(--aiw-field-border) 70%,var(--aiw-field-fg))}
.${PREFIX}-check:focus-visible{border-color:var(--aiw-field-ring);box-shadow:0 0 0 2px var(--aiw-field-ring)}
.${PREFIX}-check:checked{background:var(--aiw-field-ring);border-color:var(--aiw-field-ring)}
/* Tick + dot are drawn from borders rather than a glyph so they scale with the
   box and take the accent's contrast colour in both schemes. */
.${PREFIX}-check[type=checkbox]:checked::after{content:"";position:absolute;left:4.5px;top:1.5px;width:4px;height:8px;border:solid var(--aiw-field-ring-fg);border-width:0 2px 2px 0;transform:rotate(45deg)}
.${PREFIX}-check[type=radio]:checked::after{content:"";position:absolute;left:3.5px;top:3.5px;width:7px;height:7px;border-radius:50%;background:var(--aiw-field-ring-fg)}
.${PREFIX}-check:disabled{opacity:.5;cursor:not-allowed}
.${PREFIX}-lead-btn{border:none;background:var(--aiw-accent);color:var(--aiw-accent-contrast);border-radius:11px;padding:10px 16px;font-size:14px;font-weight:600;cursor:pointer}
.${PREFIX}-lead-btn:disabled{opacity:.6;cursor:default}
.${PREFIX}-lead-ok{font-size:13px;font-weight:600;color:var(--aiw-accent)}
.${PREFIX}-input:focus{border-color:var(--aiw-accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--aiw-accent) 13%,transparent)}
.${PREFIX}-send{border:none;background:var(--aiw-accent);color:var(--aiw-accent-contrast);border-radius:11px;padding:0 16px;font-size:14px;font-weight:600;cursor:pointer}
.${PREFIX}-send:disabled{opacity:.5;cursor:default}
.${PREFIX}-attach{flex:0 0 auto;display:flex;align-items:center;justify-content:center;border:1px solid var(--aiw-border-strong);background:var(--aiw-surface);border-radius:11px;width:38px;line-height:1;cursor:pointer;color:var(--aiw-text-2);transition:border-color .12s,color .12s,background .12s}
.${PREFIX}-attach:hover{border-color:var(--aiw-accent);color:var(--aiw-accent)}
.${PREFIX}-attach:disabled{opacity:.5;cursor:default}
.${PREFIX}-attbar{display:flex;flex-wrap:wrap;gap:6px;padding:8px 10px 0;background:var(--aiw-surface)}
.${PREFIX}-artifacts{display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:6px 10px 0;background:var(--aiw-surface)}
.${PREFIX}-artifacts-title{font-size:11px;font-weight:600;color:var(--aiw-muted)}
.${PREFIX}-artifact{display:inline-flex;align-items:center;gap:6px;max-width:200px;border:1px solid var(--aiw-border);background:var(--aiw-surface-2);border-radius:9px;padding:3px 8px;font-size:11px;color:var(--aiw-text-2);white-space:nowrap}
.${PREFIX}-artifact-name{overflow:hidden;text-overflow:ellipsis;max-width:130px}
.${PREFIX}-artifact-save{border:none;background:transparent;color:#0b6cff;font-size:11px;font-weight:600;cursor:pointer;padding:0}
.${PREFIX}-artifact-save:disabled{color:var(--aiw-muted);cursor:default}
.${PREFIX}-att{display:inline-flex;align-items:center;gap:5px;max-width:180px;border:1px solid var(--aiw-border);background:var(--aiw-surface-2);border-radius:9px;padding:3px 8px;font-size:12px;color:var(--aiw-text-2);white-space:nowrap}
.${PREFIX}-att>span{overflow:hidden;text-overflow:ellipsis}
.${PREFIX}-atts{display:flex;flex-wrap:wrap;gap:6px;max-width:92%}
.${PREFIX}-atts.${PREFIX}-user{align-self:flex-end;justify-content:flex-end}
.${PREFIX}-att-x{border:none;background:transparent;color:var(--aiw-muted);font-size:15px;line-height:1;cursor:pointer;padding:0 0 0 2px}
.${PREFIX}-att-x:hover{color:#e11}
.${PREFIX}-att-err{border-color:var(--aiw-danger-border);background:var(--aiw-danger-bg);color:var(--aiw-danger-text)}
.${PREFIX}-msgactions{display:inline-flex;align-items:center;gap:6px;margin-top:3px;color:var(--aiw-muted);opacity:.55;transition:opacity .15s ease}
.${PREFIX}-msgactions:hover,.${PREFIX}-msgactions:focus-within{opacity:1}
/* User edit sits at the message's bottom-RIGHT, hugging the bubble edge, and is
   HIDDEN until the user hovers their message (or the row/button itself) — an
   always-visible bordered pencil floating under every user turn read as a stray
   box. Its row is the immediate next sibling of the user bubble, so a hover-plus
   sibling selector reveals it; the row's own :hover/:focus-within keeps it up
   while you reach the
   button across the small gap. Higher specificity than the base .msgactions:hover
   rule so it wins the cascade. */
.${PREFIX}-msgactions.${PREFIX}-user{align-self:flex-end;justify-content:flex-end;padding-right:2px;opacity:0}
.${PREFIX}-msg.${PREFIX}-user:hover + .${PREFIX}-msgactions.${PREFIX}-user,.${PREFIX}-msgactions.${PREFIX}-user:hover,.${PREFIX}-msgactions.${PREFIX}-user:focus-within{opacity:1}
/* HOVER IS NOT A UNIVERSAL INPUT. On a touch device there is no hover state
   to enter, so opacity 0 revealed only on hover meant Edit and Copy did not
   EXIST on a phone — the widget's mobile layout is a full-screen sheet, i.e.
   the case where they matter most. hover:none is the honest test (it asks
   what the primary pointer can do, not how wide the screen is), and the
   answer there is: always visible, just quiet.
   NOTE: this whole sheet is a JS template literal, so no backticks. */
@media (hover:none){
.${PREFIX}-msgactions.${PREFIX}-user{opacity:.75}
}
.${PREFIX}-msgactions.${PREFIX}-assistant{align-self:flex-start}
.${PREFIX}-msgact{display:inline-flex;align-items:center;gap:4px;border:none;background:transparent;color:inherit;border-radius:6px;padding:2px 5px;font-size:11px;font-weight:500;cursor:pointer;line-height:1}
.${PREFIX}-msgact:hover{color:var(--aiw-accent);background:color-mix(in srgb,var(--aiw-accent) 7%,transparent)}
/* Icon-only variant (edit) — a small, quiet chip (subtle surface + border) that
   is revealed on message hover, then tints ACCENT (not a hard white-on-accent
   fill) on its own hover so it reads as an affordance, not a loud button. */
.${PREFIX}-msgact-icon{padding:5px;border-radius:8px;color:var(--aiw-muted);background:color-mix(in srgb,var(--aiw-surface) 92%,transparent);border:1px solid var(--aiw-border);transition:color .15s ease,background .15s ease,border-color .15s ease}
.${PREFIX}-msgact-icon:hover{color:var(--aiw-accent);background:color-mix(in srgb,var(--aiw-accent) 12%,transparent);border-color:color-mix(in srgb,var(--aiw-accent) 45%,transparent)}
.${PREFIX}-msgact-icon svg{width:15px;height:15px}
/* Per-message vote (thumbs) — light icon buttons; the chosen vote stays lit. */
/* ── Accessibility floor (#308) ──────────────────────────────────────────────
   ONE focus rule for all 40 buttons, on a base class every one of them carries.
   Nothing in this sheet ever REMOVED a button's ring — there is no outline:none
   on one — so this was never a keyboard trap. It is that the ring was never
   designed and never measured against a surface the host is explicitly allowed
   to repaint (the theme option), and "whatever the UA draws" is not an answer we can
   ship to a third party once the widget is public (#306).

   Two-toned so it holds on ANY ground: the accent fills the offset gap and a
   fixed dark ring sits outside it, so the pair cannot vanish into either a
   light or a dark panel. Same construction the design house prescribes for a
   brand ring that fails on one theme. */
.${PREFIX}-btn:focus-visible{outline:2px solid var(--aiw-accent);outline-offset:2px;box-shadow:0 0 0 4px #151D2F}
/* A hit area of at least 24x24 (WCAG 2.2 AA) WITHOUT changing the drawn size —
   a transparent ::before costs nothing visually, so a 20px vote button and a
   6px carousel dot stay exactly as designed.

   The GAPS below grow with them, and that is not cosmetic. WCAG's spacing
   exception only holds when a 24px circle centred on each target does not
   intersect its neighbour's, so the gap has to put the CENTRES 24px apart.
   Enlarging a hit area without doing that just makes two controls fight over
   the same pixels, which is worse than the small target was. */
.${PREFIX}-tap::before{content:"";position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:24px;height:24px}
/* 20px drawn + 4px gap = centres 24px apart. */
.${PREFIX}-votes{display:inline-flex;align-items:center;gap:4px}
/* 20x20 drawn (14px icon + 3px padding); the .-tap ::before takes the TARGET
   to 24x24. The chat-quality control (#299) being the smallest thing in the
   widget was the sharpest finding in the audit. */
.${PREFIX}-vote{position:relative;padding:3px;border-radius:6px;color:var(--aiw-muted);background:transparent}
.${PREFIX}-vote::before{content:"";position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:24px;height:24px}
.${PREFIX}-vote:hover{color:var(--aiw-accent);background:color-mix(in srgb,var(--aiw-accent) 10%,transparent)}
.${PREFIX}-vote-on{color:var(--aiw-accent)}
.${PREFIX}-vote svg{width:14px;height:14px;display:block}
.${PREFIX}-branchnav{display:inline-flex;align-items:center;gap:2px;color:inherit;font-variant-numeric:tabular-nums}
.${PREFIX}-branch-btn{display:inline-flex;align-items:center;justify-content:center;border:none;background:transparent;color:inherit;border-radius:6px;padding:2px;cursor:pointer;line-height:1}
.${PREFIX}-branch-btn:hover:not(:disabled){color:var(--aiw-accent)}
.${PREFIX}-branch-btn:disabled{opacity:.35;cursor:default}
.${PREFIX}-branch-count{font-size:11px;padding:0 2px}
.${PREFIX}-edit{display:flex;flex-direction:column;gap:6px;max-width:94%;animation:${PREFIX}-rise var(--duration-fast) var(--ease-out)}
.${PREFIX}-edit.${PREFIX}-user{align-self:stretch}
/* Edit mode keeps the USER BUBBLE look (same fill + radius), so clicking edit
   doesn't swap the message for a different-looking box — just a subtle focus
   ring, matching the inline-edit request. */
.${PREFIX}-edit-input{width:100%;background:color-mix(in srgb,var(--aiw-accent) 76%,#04191b);color:#fff;caret-color:#fff;box-sizing:border-box;border:1.5px solid transparent;border-radius:14px;padding:9px 12px;font-size:14px;line-height:1.45;font-family:inherit;resize:none;outline:none;transition:border-color .15s ease,box-shadow .15s ease}
.${PREFIX}-edit-input::placeholder{color:rgba(255,255,255,.6)}
.${PREFIX}-edit-input:focus{border-color:rgba(255,255,255,.55);box-shadow:0 0 0 3px color-mix(in srgb,var(--aiw-accent) 28%,transparent)}
.${PREFIX}-edit-actions{display:flex;justify-content:flex-end;gap:6px}
.${PREFIX}-edit-cancel{border:none;background:transparent;color:var(--aiw-muted);border-radius:999px;padding:5px 11px;font-size:12px;font-weight:600;cursor:pointer}
.${PREFIX}-edit-cancel:hover{background:var(--aiw-surface-2)}
.${PREFIX}-edit-save{border:none;background:var(--aiw-accent);color:var(--aiw-accent-contrast);border-radius:999px;padding:5px 13px;font-size:12px;font-weight:600;cursor:pointer}
.${PREFIX}-edit-save:hover{opacity:.92}
.${PREFIX}-hactions{display:flex;align-items:center;gap:4px;flex:0 0 auto}
.${PREFIX}-icon{background:color-mix(in srgb,var(--aiw-header-fg) 15%,transparent);border:none;color:var(--aiw-header-fg);width:26px;height:26px;border-radius:8px;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0}
.${PREFIX}-icon:hover{background:color-mix(in srgb,var(--aiw-header-fg) 28%,transparent)}
.${PREFIX}-icon-on{background:var(--aiw-header-fg);color:var(--aiw-header-bg)}
.${PREFIX}-icon-on:hover{background:var(--aiw-header-fg)}
.${PREFIX}-morewrap{position:relative;display:inline-flex}
.${PREFIX}-menu{position:absolute;top:calc(100% + 8px);right:0;z-index:6;display:flex;flex-direction:column;min-width:212px;padding:6px;background:var(--aiw-surface-raised);color:var(--aiw-text);border:1px solid var(--aiw-border);border-radius:12px;box-shadow:0 12px 34px rgba(15,23,42,.18);
/* A TRANSITION, not a keyframe, and anchored at the trigger (#309). It was
   an entrance KEYFRAME with no transform-origin, so it grew from its own centre
   instead of from the button that opened it — and because keyframes RESTART
   while transitions RETARGET, a fast open-close-open stuttered. It stays in the
   DOM (display was toggled), which is exactly the rapidly-retriggered case
   house law names.
   visibility rather than display because display is not animatable; it
   flips discretely at the end of the transition, which is what keeps a closed
   menu out of the tab order. */
transform-origin:top right;transform:translateY(-4px) scale(.98);opacity:0;visibility:hidden;pointer-events:none;transition:opacity var(--duration-fast) var(--ease-out),transform var(--duration-fast) var(--ease-out),visibility 0s linear var(--duration-fast)}
.${PREFIX}-menu-open{transform:none;opacity:1;visibility:visible;pointer-events:auto;transition-delay:0s}
.${PREFIX}-menu::before{content:"";position:absolute;top:-5px;right:14px;width:10px;height:10px;background:var(--aiw-surface-raised);border-left:1px solid var(--aiw-border);border-top:1px solid var(--aiw-border);transform:rotate(45deg)}
.${PREFIX}-menu-item{display:flex;align-items:center;gap:10px;width:100%;text-align:left;border:none;background:transparent;color:var(--aiw-text-2);border-radius:9px;padding:9px 10px;font-size:13px;font-weight:500;cursor:pointer;line-height:1.2}
.${PREFIX}-menu-item:hover{background:color-mix(in srgb,var(--aiw-accent) 7%,transparent);color:var(--aiw-accent)}
.${PREFIX}-menu-item:disabled{opacity:.5;cursor:default}
.${PREFIX}-menu-ico{flex:0 0 auto;display:flex;align-items:center;justify-content:center;width:18px;height:18px;color:var(--aiw-text-2)}
.${PREFIX}-menu-item:hover .${PREFIX}-menu-ico,.${PREFIX}-menu-item-on .${PREFIX}-menu-ico{color:var(--aiw-accent)}
.${PREFIX}-menu-label{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.${PREFIX}-menu-state{flex:0 0 auto;font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--aiw-muted);background:var(--aiw-surface-2);border-radius:999px;padding:2px 7px}
.${PREFIX}-menu-item-on .${PREFIX}-menu-state{color:var(--aiw-accent-contrast);background:var(--aiw-accent)}
.${PREFIX}-autonav{align-self:flex-start;display:inline-flex;align-items:center;gap:7px;border:1px solid color-mix(in srgb,var(--aiw-accent) 20%,transparent);background:color-mix(in srgb,var(--aiw-accent) 6%,transparent);color:var(--aiw-accent);border-radius:11px;padding:8px 12px;font-size:13px;font-weight:600;animation:${PREFIX}-rise var(--duration-fast) var(--ease-out)}
.${PREFIX}-expanded{width:min(760px,calc(100vw - 32px));height:calc(100vh - 40px)}
.${PREFIX}-expanded .${PREFIX}-msg{max-width:min(75%,62ch)}
/* Advanced view — chat column + drivable app pane. The chat column always wraps
   the chat (fills the panel in normal mode); the pane only shows in advanced. */
.${PREFIX}-chatcol{display:flex;flex-direction:column;flex:1 1 auto;min-height:0;min-width:0;height:100%}
.${PREFIX}-pane{display:none;flex-direction:column;min-width:0;min-height:0;background:var(--aiw-bg)}
.${PREFIX}-advbtn-on{background:rgba(255,255,255,.34)}
/* Advanced view IS the wide view (owns the screen), so the plain "wide" toggle
   is redundant here — hide it and leave advanced/exit + close. */
.${PREFIX}-advanced .${PREFIX}-expand{display:none}
/* Fullscreen toggle only makes sense in advanced view — hidden otherwise. */
.${PREFIX}-fullbtn{display:none}
.${PREFIX}-advanced .${PREFIX}-fullbtn{display:flex}
.${PREFIX}-advanced{width:calc(100vw - 40px);max-width:1240px;height:calc(100vh - 40px);flex-direction:row;align-items:stretch}
/* Fullscreen: drop the inset margins, width cap and radius so advanced view
   fills the whole viewport edge-to-edge. Two classes → wins over .advanced. */
.${PREFIX}-advanced.${PREFIX}-advanced-full{inset:0;width:100vw;height:100vh;height:100dvh;max-width:none;max-height:none;border-radius:0}
.${PREFIX}-advanced .${PREFIX}-chatcol{flex:0 0 var(--aiw-chatw,400px);min-width:320px;border-right:1px solid var(--aiw-border)}
.${PREFIX}-advanced .${PREFIX}-pane{display:flex;flex:1 1 auto}
.${PREFIX}-advanced.${PREFIX}-pane-collapsed .${PREFIX}-chatcol{flex:1 1 auto;min-width:0;max-width:none;border-right:0}
/* Draggable divider between chat + app pane. Hidden unless advanced & expanded.
   A thin bar with a wider invisible hit-area; brightens on hover/drag. */
.${PREFIX}-resizer{display:none}
.${PREFIX}-advanced .${PREFIX}-resizer{display:block;flex:0 0 6px;align-self:stretch;cursor:col-resize;background:var(--aiw-border);touch-action:none;position:relative;transition:background .15s}
.${PREFIX}-advanced .${PREFIX}-resizer::after{content:"";position:absolute;top:0;bottom:0;left:-4px;right:-4px}
.${PREFIX}-advanced .${PREFIX}-resizer:hover,.${PREFIX}-resizing .${PREFIX}-resizer{background:var(--aiw-accent,#6366f1)}
.${PREFIX}-advanced.${PREFIX}-pane-collapsed .${PREFIX}-resizer{display:none}
/* While dragging: kill text selection + let pointer events pass over the iframe
   (an iframe would otherwise swallow the drag and drop the pointer). */
.${PREFIX}-resizing{user-select:none}
.${PREFIX}-resizing .${PREFIX}-pane-frame{pointer-events:none}
/* Collapsed: the pane shrinks to a thin strip that still shows the toggle (so it
   can be re-opened), and its url + framed body hide. */
.${PREFIX}-advanced.${PREFIX}-pane-collapsed .${PREFIX}-pane{flex:0 0 40px;min-height:0}
.${PREFIX}-pane-collapsed .${PREFIX}-pane-body{display:none}
.${PREFIX}-pane-collapsed .${PREFIX}-pane-url{display:none}
.${PREFIX}-pane-collapsed .${PREFIX}-pane-bar{padding:6px 5px}
.${PREFIX}-pane-collapsed .${PREFIX}-pane-collapse{transform:rotate(180deg)}
.${PREFIX}-pane-bar{display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid var(--aiw-border);background:var(--aiw-surface-2);flex:0 0 auto}
.${PREFIX}-pane-url{font-size:11.5px;color:var(--aiw-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
/* Padded gutter around the driven app so it reads as an inset "screen". */
.${PREFIX}-pane-body{flex:1 1 auto;min-width:0;min-height:0;display:flex;padding:12px}
.${PREFIX}-pane-frame{flex:1 1 auto;width:100%;border:1px solid var(--aiw-border);border-radius:12px;background:var(--aiw-surface);min-height:0;box-shadow:0 1px 4px rgba(15,23,42,.07)}
/* Narrow: stack the app pane on top and the chat (with composer) below. */
@media (max-width:820px){
  .${PREFIX}-advanced{flex-direction:column-reverse}
  .${PREFIX}-advanced .${PREFIX}-chatcol{flex:1 1 auto;min-width:0;max-width:none;border-right:0;border-top:1px solid var(--aiw-border)}
  .${PREFIX}-advanced .${PREFIX}-pane{flex:1 1 auto;min-height:38%}
  /* Stacked layout: the horizontal divider doesn't apply. */
  .${PREFIX}-advanced .${PREFIX}-resizer{display:none}
  .${PREFIX}-pane-body{padding:8px}
}

.${PREFIX}-history{position:absolute;inset:0;background:var(--aiw-surface);display:flex;flex-direction:column;z-index:5;animation:${PREFIX}-rise var(--duration-fast) var(--ease-out)}
.${PREFIX}-history-head{display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-bottom:1px solid var(--aiw-border);font-weight:600;font-size:14px}
.${PREFIX}-history-back{border:1px solid var(--aiw-border-strong);background:var(--aiw-surface-raised);border-radius:9px;padding:5px 11px;font-size:12px;font-weight:600;cursor:pointer;color:var(--aiw-text-2)}
.${PREFIX}-history-list{flex:1 1 auto;min-height:0;overflow-y:auto;padding:8px;display:flex;flex-direction:column;gap:4px;font-size:13px;color:var(--aiw-text-2)}
.${PREFIX}-history-sep{padding:8px 4px 2px;font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--aiw-muted)}
.${PREFIX}-history-item{display:flex;align-items:center;justify-content:space-between;gap:8px;text-align:left;border:1px solid var(--aiw-border);background:var(--aiw-surface-raised);border-radius:10px;padding:10px 12px;cursor:pointer;width:100%}
.${PREFIX}-history-item:hover{border-color:var(--aiw-accent);background:color-mix(in srgb,var(--aiw-accent) 4%,transparent)}
.${PREFIX}-history-title{font-weight:600;color:var(--aiw-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.${PREFIX}-history-date{font-size:11px;color:var(--aiw-muted);flex:0 0 auto}
.${PREFIX}-history-star{font-size:15px;line-height:1;color:#cbcbcb;flex:0 0 auto;padding:0 2px;cursor:pointer}
.${PREFIX}-history-star:hover{color:#f59e0b}
.${PREFIX}-widget{align-self:stretch;border:1px solid var(--aiw-border);border-radius:14px;padding:12px;background:var(--aiw-surface-raised);animation:${PREFIX}-rise var(--duration-fast) var(--ease-out)}
.${PREFIX}-widget-title{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--aiw-muted);margin-bottom:8px}
.${PREFIX}-widget-stat{font-size:30px;font-weight:800;line-height:1.1;color:var(--aiw-text)}
.${PREFIX}-widget-cap{font-size:13px;color:var(--aiw-text-2);margin-top:2px}
.${PREFIX}-widget-delta{font-size:12px;font-weight:600;color:var(--aiw-accent);margin-top:4px}
.${PREFIX}-widget-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(90px,1fr));gap:8px}
/* Composed UI cards ([[ui:…]]) — tiles the assistant lays out itself. */
.${PREFIX}-ui{align-self:stretch;border:1px solid var(--aiw-border);border-radius:14px;padding:12px;background:var(--aiw-surface-raised);animation:${PREFIX}-rise var(--duration-fast) var(--ease-out)}
.${PREFIX}-ui-title{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--aiw-muted);margin-bottom:6px}
.${PREFIX}-ui-cap{font-size:13px;color:var(--aiw-text-2);margin-bottom:10px}
/* A strip SCROLLS rather than shrinking its tiles: squeezing eight scenes into
   a 340px panel makes every one of them too small to judge, which defeats the
   point of showing them. Snap points keep the scroll landing on whole tiles. */
.${PREFIX}-ui-strip{display:flex;gap:8px;overflow-x:auto;scroll-snap-type:x mandatory;padding-bottom:4px;-webkit-overflow-scrolling:touch}
.${PREFIX}-ui-strip>.${PREFIX}-ui-tile{flex:0 0 132px;scroll-snap-align:start}
/* Carousel: one item at a time. The track is the same tile row, translated. */
/* ONE number governs the carousel's geometry, because the controls have to be
   anchored to the MEDIA and nothing else knows how tall that is.
   Two real defects came from not having it: a 9:16 scene box computed from the
   panel width was 558px tall in a 368px panel — one empty scene taller than the
   whole visible chat, with the paging pushed off screen — and the dots, pinned
   to the card's BOTTOM, painted over the caption instead of over the picture. */
.${PREFIX}-ui-carousel{position:relative;--aiw-cmedia:min(38vh,300px)}
/* Height leads, width follows from the aspect — so a portrait scene stays
   portrait instead of being letterboxed or cropped to fit a cap. */
.${PREFIX}-ui-carousel .${PREFIX}-ui-media{height:var(--aiw-cmedia);width:auto;max-width:100%;margin:0 auto}
.${PREFIX}-ui-carousel-stage{position:relative;overflow:hidden;border-radius:10px}
.${PREFIX}-ui-carousel .${PREFIX}-ui-items{display:flex;gap:0;transition:transform .25s ease;overflow:visible}
.${PREFIX}-ui-carousel .${PREFIX}-ui-tile{flex:0 0 100%;min-width:100%}
.${PREFIX}-ui-arrow{position:absolute;top:calc(var(--aiw-cmedia) / 2 - 15px);z-index:2;display:flex;height:30px;width:30px;align-items:center;justify-content:center;border:0;border-radius:999px;background:rgba(0,0,0,.5);color:#fff;font-size:15px;line-height:1;cursor:pointer}
.${PREFIX}-ui-arrow:hover{background:rgba(0,0,0,.7)}
.${PREFIX}-ui-arrow-left{left:6px}
.${PREFIX}-ui-arrow-right{right:6px}
.${PREFIX}-ui-counter{position:absolute;right:8px;top:8px;z-index:2;padding:2px 8px;border-radius:999px;background:rgba(0,0,0,.55);color:#fff;font-size:10px;font-weight:700}
/* gap 5px -> 18px: 6px dots with 18px between them put the centres 24px apart,
   which is what the WCAG 2.2 spacing exception actually requires (#308). */
.${PREFIX}-ui-dots{position:absolute;left:0;right:0;top:calc(var(--aiw-cmedia) - 14px);bottom:auto;z-index:2;display:flex;justify-content:center;gap:18px}
/* 6x6 drawn, real <button>s. Same treatment: the dot stays 6px, the target is 24. */
.${PREFIX}-ui-dot{position:relative;height:6px;width:6px;padding:0;border:0;border-radius:999px;background:rgba(255,255,255,.55);cursor:pointer}
.${PREFIX}-ui-dot::before{content:"";position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:24px;height:24px}
/* The active dot widens to a pill. NO transition on that width (#309): house
   law allows transform and opacity, and scaleX on a 6px circle distorts the
   round cap into an ellipse — so the honest answer is to change instantly
   rather than animate the wrong property or fake it with the right one. */
.${PREFIX}-ui-dot-on{width:16px;background:#fff}
.${PREFIX}-ui-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(104px,1fr));gap:8px}
.${PREFIX}-ui-list{display:flex;flex-direction:column;gap:8px}
.${PREFIX}-ui-list>.${PREFIX}-ui-tile{display:grid;grid-template-columns:64px 1fr;gap:10px;align-items:start}
.${PREFIX}-ui-list .${PREFIX}-ui-media{grid-row:span 3}
.${PREFIX}-ui-media{position:relative;aspect-ratio:1;border-radius:10px;overflow:hidden;background:var(--aiw-surface-2);border:1px solid var(--aiw-border-soft);display:flex;align-items:center;justify-content:center}
.${PREFIX}-ui-a-portrait .${PREFIX}-ui-media{aspect-ratio:4/5}
.${PREFIX}-ui-a-story .${PREFIX}-ui-media{aspect-ratio:9/16}
.${PREFIX}-ui-a-landscape .${PREFIX}-ui-media,.${PREFIX}-ui-a-wide .${PREFIX}-ui-media{aspect-ratio:16/9}
.${PREFIX}-ui-media-el{width:100%;height:100%;object-fit:cover;display:block}
/* An audio tile has nothing to LOOK at, so the box stops pretending to be a
   picture: no forced aspect ratio, and the player sits at its natural height
   instead of being stretched to fill a square. */
.${PREFIX}-ui-media:has(> audio.${PREFIX}-ui-media-el){aspect-ratio:auto;padding:8px}
audio.${PREFIX}-ui-media-el{height:auto;object-fit:unset}
.${PREFIX}-ui-media-ph{font-size:11px;color:var(--aiw-muted);text-align:center;padding:0 6px}
.${PREFIX}-ui-badge{position:absolute;left:6px;top:6px;padding:2px 7px;border-radius:999px;font-size:10px;font-weight:700;letter-spacing:.02em;background:rgba(0,0,0,.55);color:#fff;backdrop-filter:blur(4px)}
.${PREFIX}-ui-badge-ready{background:#16794a}
.${PREFIX}-ui-badge-running{background:var(--aiw-accent);color:var(--aiw-accent-contrast)}
.${PREFIX}-ui-badge-failed{background:#a32020}
.${PREFIX}-ui-tile-title{font-size:12px;font-weight:600;color:var(--aiw-text);margin-top:6px;line-height:1.25}
.${PREFIX}-ui-tile-cap{font-size:11.5px;color:var(--aiw-text-2);margin-top:2px;line-height:1.3}
.${PREFIX}-ui-tile-actions,.${PREFIX}-ui-actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}
.${PREFIX}-ui-actions{margin-top:10px}
.${PREFIX}-ui-act{display:inline-flex;flex-wrap:wrap;align-items:center;gap:4px}
.${PREFIX}-ui-btn{padding:5px 10px;border-radius:8px;border:1px solid var(--aiw-border-strong);background:var(--aiw-bg);color:var(--aiw-text);font-size:11.5px;font-weight:600;cursor:pointer}
.${PREFIX}-ui-btn:hover{background:var(--aiw-surface-2)}
.${PREFIX}-ui-btn:disabled{opacity:.5;cursor:default}
.${PREFIX}-ui-btn-primary{background:var(--aiw-accent);color:var(--aiw-accent-contrast);border-color:transparent}
.${PREFIX}-ui-btn-danger{color:#a32020;border-color:color-mix(in srgb,#a32020 40%,transparent)}
.${PREFIX}-ui-btn-ghost{padding:5px 8px;border-radius:8px;border:1px solid transparent;background:transparent;color:var(--aiw-muted);font-size:11.5px;font-weight:600;cursor:pointer}
.${PREFIX}-ui-confirm-q{font-size:11.5px;color:var(--aiw-text-2)}
.${PREFIX}-preview{align-self:stretch;border:1px solid var(--aiw-border);border-radius:14px;overflow:hidden;background:var(--aiw-surface);animation:${PREFIX}-rise var(--duration-fast) var(--ease-out)}
.${PREFIX}-preview-bar{display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid var(--aiw-border-soft)}
.${PREFIX}-preview-dots{display:inline-flex;gap:4px}
.${PREFIX}-preview-dots i{width:9px;height:9px;border-radius:50%;background:#e2e2e2}
.${PREFIX}-preview-dots i:nth-child(1){background:#ff5f57}
.${PREFIX}-preview-dots i:nth-child(2){background:#febc2e}
.${PREFIX}-preview-dots i:nth-child(3){background:#28c840}
.${PREFIX}-preview-title{font-size:12px;font-weight:600;color:var(--aiw-muted)}
.${PREFIX}-preview-frame{display:block;width:100%;height:340px;border:0;background:var(--aiw-surface)}
.${PREFIX}-proposal-media{display:block;width:100%;max-height:200px;object-fit:cover;border-radius:12px;border:1px solid var(--aiw-border);background:var(--aiw-surface-2)}
.${PREFIX}-proposal-media-holder{position:relative}
/* NOT --aiw-accent-contrast: this badge sits on 60% black over an image, not on
   the accent, so it must stay light whatever the accent resolves to. Reading the
   accent token here would have turned it navy-on-black the moment #307 made the
   contrast derived. */
.${PREFIX}-proposal-media-badge{position:absolute;left:8px;bottom:8px;padding:2px 8px;border-radius:999px;background:rgba(0,0,0,.6);color:#FCF7E3;font-size:11px;font-weight:600}
.${PREFIX}-chips{display:flex;flex-wrap:wrap;gap:6px;margin:2px 0 10px}
.${PREFIX}-chip{padding:8px 14px;border-radius:999px;border:1px solid color-mix(in srgb,var(--aiw-accent) 35%,transparent);background:color-mix(in srgb,var(--aiw-accent) 7%,transparent);color:var(--aiw-accent);font-size:13px;font-weight:600;cursor:pointer;transition:background .12s,color .12s,border-color .12s}
.${PREFIX}-chip:hover{background:color-mix(in srgb,var(--aiw-accent) 14%,transparent)}
.${PREFIX}-chip-on,.${PREFIX}-chip-send{background:var(--aiw-accent);color:var(--aiw-accent-contrast);border-color:transparent}
.${PREFIX}-chip-send:hover{background:var(--aiw-accent)}
.${PREFIX}-chip-other{border-style:dashed;background:transparent;color:var(--aiw-muted);border-color:var(--aiw-border-strong)}
.${PREFIX}-chip:disabled{opacity:.45;cursor:default}
.${PREFIX}-kpi{border:1px solid var(--aiw-border-soft);border-radius:10px;padding:8px 10px;background:var(--aiw-bg)}
.${PREFIX}-kpi-v{font-size:18px;font-weight:700;color:var(--aiw-text)}
.${PREFIX}-kpi-l{font-size:11px;color:var(--aiw-muted);margin-top:1px}
.${PREFIX}-kpi-d{font-size:11px;font-weight:600;color:var(--aiw-accent);margin-top:2px}
.${PREFIX}-widget-table{width:100%;border-collapse:collapse;font-size:12.5px}
.${PREFIX}-widget-table th{text-align:left;font-weight:700;color:var(--aiw-text-2);border-bottom:1px solid var(--aiw-border);padding:6px 8px}
.${PREFIX}-widget-table td{border-bottom:1px solid var(--aiw-border-soft);padding:6px 8px;color:var(--aiw-text)}
.${PREFIX}-widget-list{margin:0;padding-left:18px;font-size:13.5px;color:var(--aiw-text);display:flex;flex-direction:column;gap:3px}
.${PREFIX}-nav{align-self:flex-start;animation:${PREFIX}-rise var(--duration-fast) var(--ease-out)}
.${PREFIX}-nav-btn{display:inline-flex;align-items:center;gap:8px;border:1px solid var(--aiw-accent);background:color-mix(in srgb,var(--aiw-accent) 6%,transparent);color:var(--aiw-accent);border-radius:11px;padding:9px 14px;font-size:13.5px;font-weight:600;cursor:pointer}
.${PREFIX}-nav-btn:hover{background:color-mix(in srgb,var(--aiw-accent) 11%,transparent)}
.${PREFIX}-nav-btn:disabled{opacity:.7;cursor:default}
.${PREFIX}-proposal{align-self:stretch;border:1px solid color-mix(in srgb,var(--aiw-accent) 20%,transparent);background:color-mix(in srgb,var(--aiw-accent) 4%,transparent);border-radius:14px;padding:12px;display:flex;flex-direction:column;gap:8px;animation:${PREFIX}-rise var(--duration-fast) var(--ease-out)}
.${PREFIX}-proposal-title{font-size:13px;font-weight:700}
.${PREFIX}-proposal-edit{display:flex;flex-direction:column;gap:4px}
.${PREFIX}-proposal-edit-label{font-size:11.5px;font-weight:600;color:var(--aiw-text-2)}
.${PREFIX}-proposal-summary{font-size:12.5px;color:var(--aiw-text-2);white-space:pre-wrap;line-height:1.45}
/* Storyboard plan inside a confirm card: one row per shot, so the thing the
   renders are bought from is READ rather than skimmed as a paragraph. */
/* Two lines of the prompt: enough to judge the shot, not so much that four of
   them bury the buttons under the fold. */
.${PREFIX}-proposal-ok{font-size:13px;font-weight:600;color:#10b981;display:inline-flex;align-items:center;gap:6px}
.${PREFIX}-confirm-q{font-size:13px;color:var(--aiw-text-2);margin-bottom:8px}
.${PREFIX}-confirm-row{display:flex;gap:8px}
.${PREFIX}-confirm-no{border:1px solid var(--aiw-border-strong);background:var(--aiw-surface-raised);color:var(--aiw-text-2);border-radius:11px;padding:9px 14px;font-size:13px;font-weight:600;cursor:pointer}
${darkWhenHostSaysSo}
@media (prefers-color-scheme:dark){${darkWhenNobodySaid}}

@keyframes ${PREFIX}-sheetup{from{transform:translateY(100%)}to{transform:translateY(0)}}
/* On phones the panel becomes a full-width bottom sheet (slides up from the
   bottom edge, ~90% of the dynamic viewport, rounded top, grab handle) so the
   chat is comfortably usable instead of a cramped corner card. */
/* A phone in LANDSCAPE is about 844x390 — wider than 640, so the desktop
   corner card applied and max-height:calc(100vh - 40px) clamped it to 350px
   tall. Header and composer take ~120 of that, leaving ~230px of message log
   in the exact posture where the soft keyboard also appears (#309).
   Short viewport AND coarse pointer, not short alone: a short desktop window
   is not a phone, and a full-screen sheet there would be wrong. */
@media (max-width:640px),(max-height:520px) and (pointer:coarse){
  /* z-index: the desktop 48 sits deliberately BELOW the app's Radix modals
     (z-50) so a dialog covers the chat. That rule did not anticipate page
     CHROME at the same level: the marketing site's header is
     "fixed inset-x-0 top-0 z-50", so it painted over the top 66px of the
     full-screen sheet — its logo, locale switcher and hamburger landing on
     top of the widget's own avatar and buttons (reported 2026-08-07).
     A full-screen sheet covers the viewport and IS the modal surface while
     it is open, so here — and only here — it outranks host chrome. */
  .${PREFIX}-panel{inset:0;z-index:51;width:100%;max-width:100%;height:100vh;height:100dvh;max-height:none;border-radius:0;animation:${PREFIX}-sheetup var(--duration-base) var(--ease-out);transition:none}
  .${PREFIX}-expanded{width:100%;max-width:100%;height:100vh;height:100dvh}
  .${PREFIX}-expanded .${PREFIX}-msg{max-width:86%}
  /* Give the title its own full-width row: avatar + actions share the top row,
     the name/subtitle drop to a dedicated line below so the title never gets
     squeezed by the action buttons on narrow phones. */
  .${PREFIX}-header{position:relative;padding-top:calc(14px + env(safe-area-inset-top));display:grid;grid-template-columns:auto 1fr;grid-template-areas:"avatar actions" "name name";align-items:center;gap:8px 10px;touch-action:none}
  .${PREFIX}-header::before{content:"";position:absolute;top:calc(5px + env(safe-area-inset-top));left:50%;transform:translateX(-50%);width:38px;height:4px;border-radius:4px;background:color-mix(in srgb,var(--aiw-header-fg) 55%,transparent)}
  .${PREFIX}-avatar{grid-area:avatar}
  .${PREFIX}-hactions{grid-area:actions;justify-self:end}
  .${PREFIX}-hname{grid-area:name}
  .${PREFIX}-title{font-size:16px}
  .${PREFIX}-log{padding-bottom:calc(14px + env(safe-area-inset-bottom))}
  .${PREFIX}-form{padding-bottom:calc(10px + env(safe-area-inset-bottom))}
  /* iOS auto-zooms the page when a focused field is under 16px, and the zoom
     is what then makes the sheet scroll sideways. 16px is the threshold, not
     a preference — do not lower it. text-size-adjust stops iOS inflating the
     rest of the text to compensate. */
  .${PREFIX}-input,.${PREFIX}-edit-input,.${PREFIX}-question-input,
  .${PREFIX}-lead-form input,.${PREFIX}-lead-form textarea{font-size:16px}
  .${PREFIX}-panel{-webkit-text-size-adjust:100%;text-size-adjust:100%}
  /* While the soft keyboard is up it covers the home indicator, but iOS keeps
     reporting safe-area-inset-bottom as if it were still there — leaving a
     dead band under the composer. The keyboard handler sets this flag. */
  .${PREFIX}-panel.${PREFIX}-kb .${PREFIX}-form{padding-bottom:10px}
  .${PREFIX}-panel.${PREFIX}-kb .${PREFIX}-log{padding-bottom:14px}
  .${PREFIX}-bubble{bottom:16px;${side}:16px}
  /* Expand/restore is meaningless once the sheet is full-screen — hide it. */
  .${PREFIX}-expand{display:none}
}
/* ── Reduced motion, gated at the KEYFRAME (#308) ────────────────────────────
   This used to name eleven selectors. Twenty-two were animated, four of the
   eleven carried no animation at all, and the list could only ever fall further
   behind — the shared rise keyframe alone has sixteen consumers.

   Redefining the keyframes reaches every consumer, including ones added later
   by someone who never reads this block. That is the difference between a rule
   and a list.

   NOT all the way to zero, per house law: entrances keep their fade so spatial
   continuity survives, and lose only the movement. The spinner keeps turning
   because it reports STATE — a still spinner says "stuck", which is a worse
   answer than a moving one. Purely decorative loops stop entirely.

   One thing CSS cannot reach: the launcher blob is SMIL animate elements, and
   animation:none has no authority over SMIL. #305 removes it by drawing a
   static mark; noted so the two issues do not both try. */
@media (prefers-reduced-motion:reduce){
@keyframes ${PREFIX}-rise{from{opacity:0}to{opacity:1}}
@keyframes ${PREFIX}-richin{from{opacity:0}to{opacity:1}}
@keyframes ${PREFIX}-tokin{from{opacity:0}to{opacity:1}}
@keyframes ${PREFIX}-sheetup{from{opacity:0}to{opacity:1}}
@keyframes ${PREFIX}-float{0%,100%{transform:none}}
@keyframes ${PREFIX}-pulse{0%,100%{opacity:1}}
@keyframes ${PREFIX}-blink{0%,100%{opacity:1}}
@keyframes ${PREFIX}-blink2{0%,100%{opacity:1}}
@keyframes ${PREFIX}-caret{0%,100%{opacity:1}}
/* -breathe is the launcher's working state (#305). It is a STATUS signal, like
   the spinner, so stillness would say 'idle' when a turn is running — but it is
   also a loop in the corner of every page, which the spinner is not. Slowed and
   shallowed rather than stopped: it still reads as alive, at a fraction of the
   amplitude. */
@keyframes ${PREFIX}-breathe{0%,100%{opacity:1}50%{opacity:.88}}
.${PREFIX}-log{scroll-behavior:auto}
}
`;
  const style = document.createElement("style");
  style.setAttribute("data-sgiant-aiw", "");
  style.textContent = css;
  document.head.appendChild(style);
}
