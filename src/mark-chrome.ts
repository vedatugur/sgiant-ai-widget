/**
 * CHROME — the assistant's character mark, as opposed to AVATAR_SVG, which is
 * the sgiant BRAND mark. Both are real and they are not interchangeable: the
 * crescent is the company's logo and stays the default for anyone embedding
 * this widget on their own site, and this is the face sgiant's own surfaces
 * put on the assistant.
 *
 * BRUTALIST ON PURPOSE. Flat slabs, no gradient, no specular, one accent. That
 * is why it ships with `markMotionMode: "stepped"` rather than the default
 * spring: easing a flat slab is the glossy language wearing borrowed clothes,
 * and the tilt that flatters a curved, shiny mark makes this one look like it
 * is sliding on ice. Every transition in here snaps — `steps()` is the
 * vocabulary.
 *
 * THE HOOKS ARE LOAD-BEARING. `mark-motion.ts` finds the eye by its `pl` class
 * and moves it independently of the body; without that class the mark still
 * gets the tilt but the eye stops following, which reads as a robot that has
 * stopped paying attention. Keep `pl` on the eye and `lamp` on the lamp.
 *
 * Colours are literal rather than tokenised except the eye, which is
 * `currentColor` so it takes the host's accent like every other mark.
 */
export const CHROME_MARK = `<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg" class="aiwbot">
  <style>
    /* NO EASING ANYWHERE. This mark has no specular to slide and no curve to
       turn, so every transition snaps: steps() is the vocabulary. Easing a flat
       slab is the glossy language wearing borrowed clothes. */
    .aiwbot .eye { animation: aiwbot-blink 4.4s steps(2, jump-none) infinite; }
    .aiwbot .lamp { animation: aiwbot-lamp 2.6s steps(2, jump-none) infinite; }
    @keyframes aiwbot-blink { 0%,93% { opacity: 1 } 94%,96% { opacity: .12 } 97%,100% { opacity: 1 } }
    @keyframes aiwbot-lamp { 0% { opacity: 1 } 50%,100% { opacity: .45 } }
    @media (prefers-reduced-motion: reduce) {
      .aiwbot .eye, .aiwbot .lamp { animation: none }
    }
  </style>
  <!-- Depth is STATED: one flat offset block, one straight edge. No gradient
       anywhere in this mark, and nothing simulating a light. -->
  <rect x="11" y="13" width="31" height="29" fill="#14110E" opacity=".22"/>
  <rect x="8" y="10" width="31" height="29" fill="#A8A399"/>
  <rect x="8" y="10" width="31" height="8" fill="#C2BDB2"/>
  <rect x="8" y="31" width="31" height="8" fill="#8C877E"/>
  <rect x="13" y="20" width="21" height="9" fill="#14110E"/>
  <!-- ONE eye, OFF CENTRE. The symmetry of the previous mark is what made it
       read as an icon; a single element out of line reads as attention. It
       carries the pl class so the pointer tracking finds it, and currentColor so it
       takes the widget's accent like every other mark. -->
  <rect x="17" y="22.4" width="6" height="4.2" fill="currentColor" class="eye pl"/>
  <rect x="30" y="10" width="9" height="8" fill="#D62828" class="lamp"/>
</svg>`;
