/**
 * GENERATE A DRAFT MANIFEST FROM A LIVE DOCUMENT.
 *
 * `scanAiTargets` grown up: the same walk, emitting structure instead of a flat
 * id list. It is the fastest way to get a surface described — an admin screen,
 * someone else's site, a page of your own — without writing it by hand.
 *
 * ITS OUTPUT IS A DRAFT AND SAYS SO. That is not modesty, it is the reason this
 * is safe to have at all. The scheme it replaces guessed a control's id from
 * whatever attribute happened to exist, was silently wrong for most controls,
 * and nobody noticed — because nothing ever announced that it was guessing. So:
 *
 *   - every control comes back `mutates: true, inferred: true`
 *   - the manifest is `trust: "generated"`
 *
 * MUTATES DEFAULTS TO TRUE BECAUSE THE GENERATOR CANNOT KNOW. A DOM walk cannot
 * tell "Apply filter" from "Delete everything" — both are buttons with a word
 * on them. Defaulting to false would make the assistant free to click a
 * destructive control the moment somebody ran the generator; defaulting to true
 * makes it ask, which is merely annoying. The overrides file is where a person
 * relaxes it, and a person is who should.
 *
 * Anchors are the exception: an `<a href>` navigates, and navigation is already
 * held by the path allow-list, so it is not the confirm gate's job as well.
 */
import { MANIFEST_VERSION, } from "./manifest.js";
const DEFAULT_MAX_CONTROLS = 200;
function tag(el) {
    return (el.tagName ?? "").toLowerCase();
}
function text(el) {
    return (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 60);
}
/** Human label, in the order a person would read one. */
function labelOf(el) {
    const aria = el.getAttribute("aria-label");
    if (aria && aria.trim())
        return aria.trim().replace(/\s+/g, " ").slice(0, 60);
    const t = text(el);
    if (t)
        return t;
    const placeholder = el.getAttribute("placeholder");
    if (placeholder && placeholder.trim())
        return placeholder.trim().slice(0, 60);
    const name = el.getAttribute("name");
    if (name && name.trim())
        return name.trim().slice(0, 60);
    return "";
}
function kindOf(el) {
    const t = tag(el);
    if (t === "a")
        return "link";
    if (t === "select")
        return "select";
    if (t === "textarea")
        return "textarea";
    if (t === "button")
        return "button";
    if (t === "input") {
        const type = (el.getAttribute("type") ?? "text").toLowerCase();
        if (type === "checkbox" || type === "radio")
            return "toggle";
        if (type === "submit" || type === "button")
            return "button";
        return "input";
    }
    const role = el.getAttribute("role");
    if (role === "button")
        return "button";
    if (role === "switch" || role === "checkbox")
        return "toggle";
    return "other";
}
/**
 * Anchors navigate; everything else might do anything.
 *
 * A link styled as a delete action exists, which is why the result carries
 * `inferred: true` either way — that flag is what tells a reviewer nothing here
 * was decided by a person.
 */
function inferMutates(el) {
    if (tag(el) === "a" && el.getAttribute("href"))
        return false;
    if (el.getAttribute("aria-readonly") === "true")
        return false;
    if (el.getAttribute("disabled") !== null)
        return false;
    return true;
}
function controlsIn(root, max, seen, notes) {
    const out = [];
    const els = Array.from(root.querySelectorAll("[data-ai-target]"));
    for (const el of els) {
        const id = el.getAttribute("data-ai-target");
        if (!id || seen.has(id))
            continue;
        if (out.length >= max) {
            notes.push(`Stopped at ${max} controls — this surface has more. Raise maxControls, or describe it in parts: a truncated manifest that does not say so is how the assistant ends up certain about a control it never saw.`);
            break;
        }
        seen.add(id);
        const label = labelOf(el);
        if (!label) {
            // Worth naming. An unlabelled control is one the model cannot choose
            // between, which fails the same way as not declaring it at all.
            notes.push(`"${id}" has no readable label — the assistant cannot tell it apart from any other unlabelled control.`);
        }
        out.push({
            id,
            label: label || id,
            kind: kindOf(el),
            mutates: inferMutates(el),
            inferred: true,
        });
    }
    return out;
}
/**
 * Find the media on a surface — as REFERENCES.
 *
 * The walk can see that an image is there and what the page calls it. It can
 * never see what the image depicts, and every entry is marked `inferred` so
 * nothing downstream mistakes a filename for a description.
 *
 * A missing `alt` is reported as missing rather than filled in with something
 * plausible. An invented alt is worse than none: it is wrong in the one place
 * a screen-reader user cannot check it, and it teaches the assistant that it
 * knows what the picture shows.
 */
function mediaIn(root, max, notes) {
    const out = [];
    const seen = new Set();
    const kinds = [
        ["img", "image"],
        ["video", "video"],
        ["audio", "audio"],
        ["iframe", "embed"],
    ];
    let missingAlt = 0;
    for (const [selector, kind] of kinds) {
        for (const el of Array.from(root.querySelectorAll(selector))) {
            if (out.length >= max)
                break;
            const src = el.getAttribute("src") ||
                el.getAttribute("data-src") ||
                el.getAttribute("poster") ||
                "";
            const id = el.getAttribute("data-ai-media") || src;
            // No src and no declared id is not addressable by anything, so it would
            // be an entry nobody could act on.
            if (!id || seen.has(id))
                continue;
            seen.add(id);
            const alt = el.getAttribute("alt");
            if (kind === "image" && !alt)
                missingAlt++;
            const w = Number(el.getAttribute("width"));
            const h = Number(el.getAttribute("height"));
            out.push({
                id,
                kind,
                ...(src ? { src } : {}),
                ...(alt ? { alt } : {}),
                width: Number.isFinite(w) && w > 0 ? w : null,
                height: Number.isFinite(h) && h > 0 ? h : null,
                ...(el.getAttribute("data-asset-id")
                    ? { assetId: el.getAttribute("data-asset-id") }
                    : {}),
                inferred: true,
            });
        }
    }
    if (missingAlt)
        notes.push(`${missingAlt} image(s) have no alt text. Nothing — assistant or screen reader — can tell what they show, and a generated description would be a guess presented as a fact.`);
    return out;
}
function sectionsIn(root) {
    const out = [];
    for (const el of Array.from(root.querySelectorAll("h1, h2, h3"))) {
        const t = text(el);
        if (t && !out.includes(t))
            out.push(t);
        if (out.length >= 20)
            break;
    }
    return out;
}
/**
 * Walk a document into a draft manifest.
 *
 * Dialogs become NESTED VIEWS rather than more controls on the page, because
 * "that button is in a modal which is not open" is the difference between a
 * working instruction and a baffling one — and it is invisible in a flat list.
 */
export function generateManifest(root, options) {
    const notes = [];
    const max = options.maxControls ?? DEFAULT_MAX_CONTROLS;
    const seen = new Set();
    const now = options.now ? options.now() : new Date();
    // Dialogs FIRST, so their controls belong to the dialog rather than being
    // claimed by the page that happens to contain them.
    const dialogViews = [];
    const dialogs = Array.from(root.querySelectorAll("[role=dialog], dialog"));
    for (const dlg of dialogs) {
        const id = dlg.getAttribute("data-ai-view") ||
            dlg.getAttribute("id") ||
            `dialog-${dialogViews.length + 1}`;
        dialogViews.push({
            id,
            title: dlg.getAttribute("aria-label") || text(dlg).slice(0, 40) || id,
            // No `path`: this is precisely the state today's contract cannot express.
            controls: controlsIn(dlg, max, seen, notes),
        });
    }
    const pageControls = controlsIn(root, max, seen, notes);
    if (pageControls.length === 0 && dialogViews.length === 0) {
        notes.push("No control carries data-ai-target, so this manifest describes structure only. Tag the controls the assistant should be able to use.");
    }
    const rootView = {
        id: options.path ?? options.surface,
        title: options.title ?? options.surface,
        ...(options.path ? { path: options.path } : {}),
        sections: sectionsIn(root),
        controls: pageControls,
        media: mediaIn(root, max, notes),
        ...(dialogViews.length ? { views: dialogViews } : {}),
    };
    notes.push("Generated, not decided: every control is marked mutates:true because a DOM walk cannot tell a filter tab from a delete button. Review and relax what is safe.");
    notes.push("Media entries are REFERENCES. They say an image is there and what the page calls it; they are not the picture, and nothing here can describe what one depicts.");
    return {
        manifest: {
            surface: options.surface,
            version: MANIFEST_VERSION,
            trust: "generated",
            hash: hashManifest([rootView]),
            generatedAt: now.toISOString(),
            views: [rootView],
        },
        notes,
    };
}
/**
 * A stable content hash of the described structure.
 *
 * Deliberately NOT cryptographic. This detects "the page moved on", not
 * tampering — a manifest's integrity comes from where it was fetched, not from
 * a digest travelling beside it. Zero dependencies also means no crypto import
 * that would drag this package into a Node-only build.
 */
export function hashManifest(views) {
    const parts = [];
    const walk = (vs) => {
        for (const v of vs) {
            parts.push(v.id, v.path ?? "", String(v.controls?.length ?? 0));
            for (const c of v.controls ?? [])
                parts.push(c.id, String(c.mutates));
            if (v.views?.length)
                walk(v.views);
        }
    };
    walk(views);
    const s = parts.join(" ");
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(36);
}
//# sourceMappingURL=manifest-generate.js.map