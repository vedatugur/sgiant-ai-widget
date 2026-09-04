/**
 * The launcher settings CHROME_MARK is drawn for.
 *
 * WHY THIS IS A SEPARATE EXPORT AND NOT BAKED INTO THE MARK. `avatarSvg` is
 * artwork; these are host theme tokens. A host can take the mark and keep its
 * own launcher, which is exactly what a third party embedding this widget on
 * their own site should be able to do. So they ship together and apply
 * separately:
 *
 *   createAiChatWidget({
 *     avatarSvg: CHROME_MARK,
 *     markMotionMode: "stepped",
 *     theme: { ...CHROME_LAUNCHER },
 *   })
 *
 * NO DISC. A mark carrying its own slab and its own cast shadow does not want a
 * coloured pill behind it — the container ends up doing a job the mark is
 * already doing, and the two shapes argue. Setting bg/shadow/fg here makes the
 * mark the launcher, which is also why the icon can run to the full 56: there is
 * no edge left to sit inside of.
 *
 * THE STATE SIZES ARE NOT DECORATION. `parked-icon` and `pill-icon` are what
 * keep the mark legible when the launcher shrinks. Without them it falls back to
 * sizes tuned for the old glossy mark, and the parked launcher reads as a smudge
 * nobody can identify — a bug we shipped once and found by looking at it. What
 * has to hold across states is the RATIO, not the pixel count.
 *
 * This recipe lived only in examples/ui.html as a hand-injected <style> until
 * 2026-09-04, which is the same reason nothing used CHROME_MARK before 1.4.0:
 * the thing every host needs was sitting in a demo.
 */
export const CHROME_LAUNCHER: Record<string, string> = {
  "launcher-icon": "56px",
  "launcher-lift": "0%",
  "launcher-parked-icon": "40px",
  "launcher-pill-icon": "30px",
  "launcher-bg": "transparent",
  "launcher-shadow": "none",
  "launcher-fg": "currentColor",
};
