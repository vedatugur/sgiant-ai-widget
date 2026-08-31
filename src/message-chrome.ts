import { el } from "./dom";
import {
  ICON_CHEV_L,
  ICON_CHEV_R,
  ICON_THUMB_DOWN,
  ICON_THUMB_UP,
} from "./icons";
import { PREFIX } from "./prefix";
import type { BranchNav } from "./replay";

/**
 * The two controls that hang off a single assistant message: the ‹n/m› branch
 * navigator and the up/down vote pair.
 *
 * Both are pure DOM builders — they read no widget state and write none. They
 * sat inside the 6,051-line closure only because that is where they were
 * written (`#320`), and they are the shape that actually moves out of it: the
 * measurement on that issue put them at two closure bindings each, against 56
 * for `send()` and 28 for the job cluster.
 *
 * THE THREAD ID IS A GETTER, AND THAT IS THE WHOLE REASON THIS IS A FACTORY.
 *
 * `buildVoteButtons` reads the thread id inside the CLICK handler, not while
 * building. In the closure that was automatic — `threadId` is a `let` the widget
 * reassigns when the server names a thread, and a vote cast later reads whatever
 * it holds then. Taking it as a plain parameter here would capture the value at
 * BUILD time, so a message rendered before the thread was named would post its
 * vote against the wrong id — or an empty one — and nothing would fail loudly:
 * the request succeeds, the vote lands on nothing, and the quality signal
 * `#299` exists to collect goes quietly missing.
 *
 * A getter keeps the read where it was. The rest of the dependencies are fixed
 * for the widget's lifetime and are captured once, which is what lets both
 * bodies move byte for byte.
 */
export function createMessageChrome(deps: {
  /** Navigate to a sibling version. Called on click, so the reference is enough. */
  switchBranch: (leaf: string) => void | Promise<void>;
  /** Read the CURRENT thread id — see the note above; do not pass a value. */
  getThreadId: () => string | undefined;
  vote?: (input: {
    threadId: string;
    messageId: string;
    value: 1 | -1 | 0;
    model?: string;
    reason?: string;
  }) => Promise<void>;
  voteUpLabel?: string;
  voteDownLabel?: string;
}) {
  const { switchBranch, getThreadId, vote, voteUpLabel, voteDownLabel } = deps;

  function buildBranchNav(branch: BranchNav): HTMLElement {
    const nav = el("div", `${PREFIX}-branchnav`);
    const prev = el("button", `${PREFIX}-branch-btn`) as HTMLButtonElement;
    prev.type = "button";
    prev.setAttribute("aria-label", "Previous version");
    prev.innerHTML = ICON_CHEV_L;
    prev.disabled = !branch.prevLeaf;
    if (branch.prevLeaf) {
      const leaf = branch.prevLeaf;
      prev.addEventListener("click", () => void switchBranch(leaf));
    }
    const count = el("span", `${PREFIX}-branch-count`);
    count.textContent = `${branch.index}/${branch.count}`;
    const next = el("button", `${PREFIX}-branch-btn`) as HTMLButtonElement;
    next.type = "button";
    next.setAttribute("aria-label", "Next version");
    next.innerHTML = ICON_CHEV_R;
    next.disabled = !branch.nextLeaf;
    if (branch.nextLeaf) {
      const leaf = branch.nextLeaf;
      next.addEventListener("click", () => void switchBranch(leaf));
    }
    nav.appendChild(prev);
    nav.appendChild(count);
    nav.appendChild(next);
    return nav;
  }

  function buildVoteButtons(messageId: string, model?: string): HTMLElement {
    const wrap = el("div", `${PREFIX}-votes`);
    let cur: 1 | -1 | 0 = 0;
    const up = el(
      "button",
      `${PREFIX}-msgact ${PREFIX}-vote`
    ) as HTMLButtonElement;
    const down = el(
      "button",
      `${PREFIX}-msgact ${PREFIX}-vote`
    ) as HTMLButtonElement;
    up.type = "button";
    down.type = "button";
    up.setAttribute("aria-label", voteUpLabel ?? "Helpful");
    down.setAttribute("aria-label", voteDownLabel ?? "Not helpful");
    up.title = voteUpLabel ?? "Helpful";
    down.title = voteDownLabel ?? "Not helpful";
    up.innerHTML = ICON_THUMB_UP;
    down.innerHTML = ICON_THUMB_DOWN;
    const paint = (): void => {
      up.classList.toggle(`${PREFIX}-vote-on`, cur === 1);
      down.classList.toggle(`${PREFIX}-vote-on`, cur === -1);
    };
    const cast = (next: 1 | -1): void => {
      if (!vote) return;
      const value = (cur === next ? 0 : next) as 1 | -1 | 0;
      const prev = cur;
      cur = value;
      paint();
      // messageId is globally unique; the current threadId scopes the vote.
      void vote({
        threadId: getThreadId() ?? "",
        messageId,
        value,
        ...(model ? { model } : {}),
      }).catch(() => {
        cur = prev;
        paint();
      });
    };
    up.addEventListener("click", () => cast(1));
    down.addEventListener("click", () => cast(-1));
    wrap.appendChild(up);
    wrap.appendChild(down);
    return wrap;
  }

  return { buildBranchNav, buildVoteButtons };
}
