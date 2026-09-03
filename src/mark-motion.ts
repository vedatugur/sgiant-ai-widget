/**
 * Pointer physics for the mark, wherever it is drawn.
 *
 * WHY IT LIVES IN THE WIDGET AND NOT IN A HOST PAGE. It began as a few lines on
 * the examples page, which meant the mark in the demo followed the cursor while
 * the identical mark in the chat header and the launcher sat still — one
 * character behaving three ways on one screen, and every host would have had to
 * re-implement it to get the first one.
 *
 * IT MOVES WHAT IT FINDS. A host's `avatarSvg` is arbitrary, so this asks for
 * optional hooks by class and skips whatever is absent: `.pl` / `.pr` for eyes,
 * `.ping` and `.glint` for parallax layers. A mark with none of them still gets
 * the tilt, which is the part that needs no cooperation.
 */

export interface MarkMotionOptions {
  /** Off entirely when false. */
  enabled?: boolean;
  /** Degrees of tilt at full deflection. */
  tilt?: number;
}

interface Spring {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

/** A spring, not an ease: it arrives with a little overshoot and settles.
 *  An ease only ever decays, which never reads as physical. */
function advance(s: Spring, tx: number, ty: number): Spring {
  const K = 0.14;
  const D = 0.76;
  s.vx = (s.vx + (tx - s.x) * K) * D;
  s.vy = (s.vy + (ty - s.y) * K) * D;
  s.x += s.vx;
  s.y += s.vy;
  return s;
}

export interface MarkMotionHandle {
  /** Look at a point instead of the pointer (the composer, while typing). */
  attend(point: { x: number; y: number } | null): void;
  destroy(): void;
}

export function startMarkMotion(
  root: () => HTMLElement[],
  opts: MarkMotionOptions = {}
): MarkMotionHandle {
  const inert: MarkMotionHandle = { attend: () => {}, destroy: () => {} };
  if (opts.enabled === false || typeof window === "undefined") return inert;
  // A mark that follows the pointer is motion nobody asked for, and a coarse
  // pointer has no hover to follow in the first place.
  const still = window.matchMedia("(prefers-reduced-motion: reduce)");
  const fine = window.matchMedia("(hover: hover) and (pointer: fine)");
  if (still.matches || !fine.matches) return inert;

  const TILT = opts.tilt ?? 10;
  const springs = new WeakMap<Element, Spring>();
  let px = 0;
  let py = 0;
  let held: { x: number; y: number } | null = null;
  let raf = 0;

  function paint(svg: SVGElement, host: HTMLElement): boolean {
    const r = host.getBoundingClientRect();
    if (!r.width) return false;
    const aim = held ?? { x: px, y: py };
    const tx = Math.max(-1, Math.min(1, (aim.x - (r.left + r.width / 2)) / (r.width * 1.6)));
    const ty = Math.max(-1, Math.min(1, (aim.y - (r.top + r.height / 2)) / (r.height * 1.6)));
    let s = springs.get(svg);
    if (!s) springs.set(svg, (s = { x: 0, y: 0, vx: 0, vy: 0 }));
    advance(s, tx, ty);
    svg.style.transform =
      `perspective(420px) rotateY(${(s.x * TILT).toFixed(2)}deg) ` +
      `rotateX(${(-s.y * (TILT * 0.78)).toFixed(2)}deg)`;
    const shift = (sel: string, k: number): void => {
      svg.querySelectorAll<SVGElement>(sel).forEach((n) => {
        n.style.transform =
          `translate(${(s!.x * k).toFixed(2)}px,${(s!.y * k * 0.6).toFixed(2)}px)`;
      });
    };
    // DEPTH BY RATE. Everything here moves in the same direction; what makes it
    // read as solid rather than as a stack of stickers is that each layer moves
    // by a DIFFERENT amount. Negative on the back, because a face further from
    // the viewer swings the opposite way as the object turns — that opposition
    // is the whole of the effect. A mark without these classes still tilts.
    // The spread is SMALL on purpose. At -2.2 against 3.6 the layers pulled far
     // enough apart that the mark came unglued — the side wall slid out from
     // behind the face and read as a shadow following it around. Depth is a hint,
     // not a distance: a few tenths of a pixel between neighbours is enough for
     // the eye, and more is just two pictures moving.
    // TWO KINDS OF LAYER, and conflating them was the bug.
    //
    // GEOMETRY moves WITH the turn, at a rate set by its distance from the
    // viewer: the back wall swings against it (it is behind), the face barely
    // moves, the visor and antenna move more.
    shift(".deep", -0.7);
    shift(".face", 0.2);
    shift(".fore", 0.9);
    shift(".ping", 1.6);
    // LIGHT moves AGAINST it. A highlight belongs to the lamp, not the object,
    // so turning the object slides the highlight across its surface the other
    // way. These were travelling WITH the turn, which paints them onto the
    // shape — and a highlight painted onto a shape is exactly what a sticker is.
    shift(".lit", -1.4);
    shift(".glint", -1.8);
    // Eyes travel furthest, clamped in viewBox units so it holds at any rendered
    // size — a pupil that leaves its socket stops being an eye. The near eye
    // travels further: two eyes converging on a point do not move equally, and
    // matching them is a large part of why drawn eyes look glassy.
    const ex = Math.max(-1.5, Math.min(1.5, s.x * 2.6));
    const ey = Math.max(-1.1, Math.min(1.1, s.y * 2));
    const pl = svg.querySelector(".pl");
    const pr = svg.querySelector(".pr");
    if (pl) pl.setAttribute("transform", `translate(${(ex * (s.x < 0 ? 1.12 : 0.9)).toFixed(3)},${ey.toFixed(3)})`);
    if (pr) pr.setAttribute("transform", `translate(${(ex * (s.x > 0 ? 1.12 : 0.9)).toFixed(3)},${ey.toFixed(3)})`);
    return (
      Math.abs(s.vx) + Math.abs(s.vy) > 0.0004 ||
      Math.abs(tx - s.x) + Math.abs(ty - s.y) > 0.002
    );
  }

  function frame(): void {
    let busy = false;
    // Re-queried EVERY frame: the launcher and the header avatar are created,
    // destroyed and re-rendered under us, so a list captured once goes stale.
    for (const host of root()) {
      const svg = host.querySelector("svg");
      if (svg) busy = paint(svg as SVGElement, host) || busy;
    }
    raf = busy ? requestAnimationFrame(frame) : 0;
  }

  function kick(): void {
    if (!raf) raf = requestAnimationFrame(frame);
  }
  function onMove(e: MouseEvent): void {
    px = e.clientX;
    py = e.clientY;
    // PAINT NOW, then let the spring settle over frames. requestAnimationFrame
    // is throttled or paused in more situations than one expects — a background
    // tab, a hidden pane, a browser saving power — and a mark that only ever
    // moved inside a frame callback simply froze in all of them while the
    // pointer sailed past. One synchronous paint costs nothing and means the
    // mark is never stale, whatever the frame clock is doing.
    for (const host of root()) {
      const svg = host.querySelector("svg");
      if (svg) paint(svg as SVGElement, host);
    }
    kick();
  }
  window.addEventListener("mousemove", onMove, { passive: true });

  return {
    attend(point) {
      held = point;
      kick();
    },
    destroy() {
      window.removeEventListener("mousemove", onMove);
      if (raf) cancelAnimationFrame(raf);
    },
  };
}
