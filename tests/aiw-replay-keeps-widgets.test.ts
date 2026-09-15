import test from "node:test";
import assert from "node:assert/strict";
// Imported from the BUILD, not the source: src/ uses extensionless imports
// that node's ESM resolver cannot follow, which is why the sibling tests
// read source text. `npm test` builds first, so dist is current.
import { stripDirectivesForReplay } from "../dist/specs.js";
import { widgetSrc } from "./aiw-source.ts";

/**
 * A TABLE THE ASSISTANT DREW IS STILL THERE AFTER THE THREAD RELOADS (#395).
 *
 * Reported as "the table appears and disappears immediately, leaving a heading
 * with a ▦ in front of it". Both halves of that sentence were literal:
 *
 *   - it DID appear: the live turn parses `[[widget:{…}]]` and draws it
 *   - it disappeared because `send()` reloads the thread after every turn for
 *     canonical ids, and the replay path flattened the directive to the inert
 *     note `▦ <title>`
 *
 * This was the same bug for the third time. `[[navigate]]` was flattened until
 * #111 ("the model DID emit it, the restore path is what killed it"), composed
 * `[[ui]]` cards until the note beside them, and `[[widget]]` outlived both.
 *
 * Re-drawing is safe here with room to spare: a widget spec CARRIES its own
 * `columns`/`rows`, so replay draws from the spec and reads nothing. There is
 * not even a button on it to click, which was the concern that had to be
 * argued for the composed cards.
 */

const TABLE_TURN =
  "İşte hesaplar:\n\n" +
  '[[widget:{"kind":"table","title":"Platformdaki Hesaplar",' +
  '"columns":["Hesap","Durum"],' +
  '"rows":[["Luna Kaş","active"],["Mavilim Otel","active"]]}]]\n\n' +
  "Başka bir şey ister misiniz?";

test("a widget directive survives replay as a spec, not as a note", () => {
  const out = stripDirectivesForReplay(TABLE_TURN);

  assert.equal(
    out.widgets.length,
    1,
    "the replay path must hand the widget back to be re-drawn"
  );
  assert.equal(out.widgets[0].title, "Platformdaki Hesaplar");
  assert.deepEqual(
    out.widgets[0].rows,
    [
      ["Luna Kaş", "active"],
      ["Mavilim Otel", "active"],
    ],
    "the rows travel inside the spec — this is why re-drawing needs no fetch"
  );
});

test("and the ▦ placeholder that replaced it is gone", () => {
  const out = stripDirectivesForReplay(TABLE_TURN);
  assert.ok(
    !out.notes.some((n) => n.includes("▦")),
    `the table was replaced by an inert note: ${JSON.stringify(out.notes)}`
  );
});

test("the prose around it is still cleaned of the raw directive", () => {
  const out = stripDirectivesForReplay(TABLE_TURN);
  assert.ok(
    !out.clean.includes("[[widget"),
    "raw directive text must never reach the reader"
  );
  assert.match(out.clean, /İşte hesaplar/);
  assert.match(out.clean, /Başka bir şey ister misiniz/);
});

/**
 * The parse alone is not the fix — something has to DRAW what it hands back.
 * `uis` was returned and rendered in the same change; a `widgets` array that
 * nothing reads would look correct here and still show an empty gap on screen.
 */
test("the replay renderer actually draws the widgets it is handed", () => {
  assert.match(
    widgetSrc,
    /for \(const w of widgets\) renderWidget\(w\)/,
    "stripDirectivesForReplay returns widgets but the replay path ignores them"
  );
});
