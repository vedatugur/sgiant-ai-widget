/**
 * THE SURFACE MANIFEST — what is here, and what may be touched.
 *
 * An assistant driving a page needs two things: where it can go, and what it
 * can touch. The first is usually DECLARED — a hand-written list of routes —
 * and it works. The second is usually DERIVED: an element is reachable if
 * somebody happened to give it an `id` or an `aria-label`, and invisible if
 * they did not. Derived that way, the overwhelming majority of controls in a
 * real application are unreachable, by nobody's decision. What the assistant
 * can touch becomes a side effect of accessibility hygiene.
 *
 * This module is the declared half, generalised past "path = page". A modal, an
 * editor, a tab, a settings screen, a chat panel's own history view: all are
 * addressable states, and none of them are URLs.
 *
 * TWO RULES HOLD THE WHOLE THING UP.
 *
 * 1. THE MANIFEST DECLARES; THE DOM CONFIRMS. A manifest describes; the page
 *    IS. When it lists a control that is not there — a feature flag, a
 *    permission, a page changed since it was written — acting on it is acting
 *    on fiction. `verifySurface` is not an optional extra; it is the half of
 *    the design that keeps the other half honest.
 *
 * 2. A MANIFEST FROM SOMEONE ELSE IS DATA, NEVER INSTRUCTION. A customer site
 *    supplies its own, and `mutates: false` on a delete button is then a claim,
 *    not a fact. `effectiveMutates` fails CLOSED for anything not ours: an
 *    untrusted manifest can add friction, never remove it.
 *
 * Zero dependencies, no framework, and it must stay that way — this package is
 * loaded into pages its authors do not own.
 */
/** Schema version of the manifest format itself, not of any surface. */
export const MANIFEST_VERSION = "1";
/* ------------------------------------------------------------------------- *
 * Reading
 * ------------------------------------------------------------------------- */
/** Every view in the tree, depth-first, parents before children. */
export function flattenViews(manifest) {
    const out = [];
    const walk = (views) => {
        for (const v of views) {
            out.push(v);
            if (v.views?.length)
                walk(v.views);
        }
    };
    walk(manifest.views);
    return out;
}
/** True when this id describes a FAMILY of controls rather than one element. */
export function isControlFamily(id) {
    return id.includes(":");
}
/**
 * Is this id well-formed? A family may carry ONE param, and it must be last.
 *
 * Refusing the rest is not a limitation being apologised for. Two params make
 * `a-:x-:y` ambiguous against `a-b-c-d` — nothing decides where `x` ends — and
 * a middle param needs a rule about separators that a slug like
 * `google-business-profile` immediately breaks. One trailing param covers
 * every real case and needs no such rule.
 */
export function isValidControlId(id) {
    if (!id)
        return false;
    const parts = id.split(":");
    if (parts.length === 1)
        return true;
    if (parts.length > 2)
        return false;
    // Something must precede the param, and the param must not be empty: a bare
    // ":x" would match every id on the page.
    return parts[0].length > 0 && /^[A-Za-z0-9_-]+$/.test(parts[1]);
}
/** Does this concrete id belong to that family? */
export function matchesFamily(family, id) {
    if (!isControlFamily(family))
        return family === id;
    const prefix = family.slice(0, family.indexOf(":"));
    // The param takes the REST, so a dash-separated row key stays whole.
    return id.length > prefix.length && id.startsWith(prefix);
}
/** Every control in the surface, in view order. */
export function flattenControls(manifest) {
    const out = [];
    for (const v of flattenViews(manifest)) {
        for (const c of v.controls ?? [])
            out.push({ ...c, viewId: v.id });
    }
    return out;
}
/** Every piece of media on the surface, in view order. */
export function flattenMedia(manifest) {
    const out = [];
    for (const v of flattenViews(manifest))
        for (const m of v.media ?? [])
            out.push({ ...m, viewId: v.id });
    return out;
}
/** Find one control by id, wherever it sits in the tree. */
export function findControl(manifest, id) {
    const all = flattenControls(manifest);
    // A literal always wins over a family it happens to sit inside, so a row
    // that needed describing on its own still can be.
    return (all.find((c) => c.id === id) ??
        all.find((c) => isControlFamily(c.id) && matchesFamily(c.id, id)));
}
/**
 * DOES THIS NEED A CONFIRMATION? — the one question the gate should ask.
 *
 * FAILS CLOSED, twice over:
 *
 *  - a control nobody declared is treated as mutating, because the alternative
 *    is that anything the manifest forgot becomes freely clickable;
 *  - `mutates: false` from an `untrusted` manifest is IGNORED. A customer site
 *    saying its delete button is harmless is a claim about our safety model
 *    made by someone with an interest in fewer prompts. Untrusted input can
 *    add friction and never remove it.
 */
export function effectiveMutates(manifest, controlId) {
    // A concrete row id resolves through `findControl` to its family, so every
    // row inherits the one decision a person made about that control. Deciding
    // it per row is not possible and would not be wanted: "delete this row" is
    // the same act whichever row it is.
    const control = findControl(manifest, controlId);
    if (!control)
        return true;
    if (control.mutates)
        return true;
    // Declared harmless — believed only from a manifest that is ours.
    return manifest.trust === "untrusted";
}
function isVisible(el) {
    if (el.isConnected === false)
        return false;
    const rect = el.getBoundingClientRect?.();
    // No geometry available (a test root, a detached document) is NOT evidence of
    // invisibility — reporting every control hidden would make drift meaningless.
    if (!rect)
        return true;
    return rect.width > 0 || rect.height > 0;
}
function attrEscape(s) {
    return s.replace(/["\\]/g, "\\$&");
}
/**
 * Compare what the manifest claims against what the document actually has.
 *
 * This is the step that stops an assistant narrating what it cannot observe
 * from acquiring a click. A `missing` control is not a warning to
 * log and move past: it means the manifest and the page disagree, and the page
 * wins, because the page is what the user is looking at.
 */
export function verifySurface(manifest, root) {
    const drift = [];
    const declared = flattenControls(manifest);
    const literals = new Set(declared.filter((c) => !isControlFamily(c.id)).map((c) => c.id));
    const families = declared.filter((c) => isControlFamily(c.id));
    for (const c of declared) {
        // A FAMILY WITH NO ROWS IS NOT MISSING, and this is the whole reason
        // families needed their own handling. An account with no connected apps
        // renders no per-app buttons; reporting that as drift would fire on every
        // healthy empty page, and a drift report that cries wolf stops being read.
        //
        // What IS lost: a genuinely wrong pattern looks identical to an empty
        // list, and nothing here can tell them apart. That is a real gap, and it
        // is a better one than the alternative — a verifier wrong about every
        // page beats one wrong about a mistake nobody has made yet.
        if (isControlFamily(c.id))
            continue;
        const el = root.querySelector(`[data-ai-target="${attrEscape(c.id)}"]`);
        if (!el) {
            drift.push({
                kind: "missing",
                id: c.id,
                detail: `"${c.label}" is declared on this surface but is not in the page.`,
            });
            continue;
        }
        if (!isVisible(el)) {
            drift.push({
                kind: "hidden",
                id: c.id,
                detail: `"${c.label}" is present but not visible.`,
            });
        }
    }
    for (const el of Array.from(root.querySelectorAll("[data-ai-target]"))) {
        const id = el.getAttribute("data-ai-target");
        if (!id || literals.has(id))
            continue;
        // An id belonging to a declared family is declared. Without this, every
        // row on a page would report as undeclared.
        if (families.some((f) => matchesFamily(f.id, id)))
            continue;
        drift.push({
            kind: "undeclared",
            id,
            detail: `"${id}" is in the page but not declared in the manifest.`,
        });
    }
    return drift;
}
export function canAct(manifest, controlId, root) {
    // A FAMILY NAME IS NOT AN ELEMENT. "app-activate-:slug" describes a shape;
    // nothing in the page carries it. Acting on it would mean picking a row for
    // the user, which is the one thing a per-row control must not do silently.
    if (isControlFamily(controlId)) {
        return {
            ok: false,
            needsConfirm: true,
            reason: `"${controlId}" names a family of controls, not one of them — say which row you mean and use that control's own id.`,
        };
    }
    const control = findControl(manifest, controlId);
    if (!control) {
        return {
            ok: false,
            needsConfirm: true,
            reason: `"${controlId}" is not declared on the ${manifest.surface} surface.`,
        };
    }
    const el = root.querySelector(`[data-ai-target="${attrEscape(controlId)}"]`);
    if (!el) {
        // Said out loud rather than guessed past: the manifest is stale, or this
        // person cannot see this control. Both are worth telling the user.
        return {
            ok: false,
            needsConfirm: true,
            reason: `"${control.label}" is described on this page but is not actually here — the page may have changed, or it may not be available to you.`,
        };
    }
    if (!isVisible(el)) {
        return {
            ok: false,
            needsConfirm: true,
            reason: `"${control.label}" is on the page but not visible right now.`,
        };
    }
    return { ok: true, needsConfirm: effectiveMutates(manifest, controlId) };
}
//# sourceMappingURL=manifest.js.map