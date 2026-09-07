import test from "node:test";
import assert from "node:assert/strict";
import { confirmSentence } from "../dist/ui-render.js";

/**
 * THE CONFIRM CARD IS THE SECURITY BOUNDARY.
 *
 * A person approves this SENTENCE, not a tool call. So the sentence has to be
 * true and legible — and until #356 it was neither. A purge that permanently
 * deletes a connection's entire ingest history asked:
 *
 *     Click admin-gbp-purge-a1b2c3 for you?
 *
 * That names no consequence and is not even English. Someone reading it has
 * been shown a slug and asked to take responsibility for it. Meanwhile the
 * sentence describing exactly what it does was already written down, in a
 * manifest nothing read.
 */

const CLICK = { name: "click", data: { target: "admin-gbp-purge-a1b2c3" } };

test("with no description it degrades to the old wording, and claims nothing", () => {
  // A host that describes nothing must keep working. It just must not imply
  // that anyone vouched for the control.
  assert.equal(
    confirmSentence(CLICK as never),
    "Click admin-gbp-purge-a1b2c3 for you?"
  );
});

test("a destructive control says what is lost, before the button is pressed", () => {
  const s = confirmSentence(CLICK as never, {
    label: "Purge this connection's data",
    purpose:
      "PERMANENTLY DELETES everything ingested from that connection. Not a disconnect — the history goes.",
    mutates: true,
    severity: "destructive",
  });
  assert.match(s, /“Purge this connection's data”/, "name it, do not slug it");
  assert.match(s, /deletes something and cannot be undone/);
  assert.match(s, /PERMANENTLY DELETES/, "the emphasis is deliberate — keep it");
  assert.doesNotMatch(s, /a1b2c3/, "the slug is not what a person approves");
});

test("an undeclared control admits that nobody has described it", () => {
  // The alternative asks for approval while quietly implying review.
  const s = confirmSentence(CLICK as never, { undeclared: true, mutates: true });
  assert.match(s, /Nobody has described this control/);
  assert.match(s, /cannot tell you what it does/);
});

test("a harmless control is still confirmed — friction is never REMOVED", () => {
  // `mutates: false` must not skip the card. Clicking something on a person's
  // behalf is itself an act, and a manifest describes a page rather than
  // granting permission to use it. The description may make this louder and may
  // never make it silent.
  const s = confirmSentence(
    { name: "click", data: { target: "assets-search" } } as never,
    { label: "Search assets", purpose: "Filters what is shown.", mutates: false }
  );
  assert.match(s, /Click “Search assets” for you\?/);
  assert.ok(s.length > 0, "there is still a question to answer");
});

test("a reversible change explains itself without crying wolf", () => {
  const s = confirmSentence(
    { name: "click", data: { target: "assets-trash-selection" } } as never,
    {
      label: "Move the selection to trash",
      purpose: "Moves the selected files to the trash, where they can be restored.",
      mutates: true,
      severity: "reversible",
    }
  );
  assert.match(s, /where they can be restored/);
  assert.doesNotMatch(
    s,
    /cannot be (undone|taken back)/,
    "reserving those phrases for the other two is what keeps them meaning something"
  );
});

test("fill quotes the value, and truncates a long one", () => {
  const short = confirmSentence(
    { name: "fill", data: { target: "asset-edit-alt", value: "A cat" } } as never,
    { label: "Alt text", mutates: true, severity: "reversible" }
  );
  assert.match(short, /Type “A cat” into “Alt text”\?/);

  const long = confirmSentence(
    {
      name: "fill",
      data: { target: "x", value: "y".repeat(120) },
    } as never
  );
  assert.ok(long.length < 120, "a wall of text is not a question anyone reads");
  assert.match(long, /…/);
});

test("the sentence reads as one sentence, not two glued together", () => {
  // `purpose` starts with a capital because it is written as prose elsewhere.
  // Joining it raw produces "…undone — Removes the account", mid-sentence.
  const s = confirmSentence(CLICK as never, {
    label: "Delete",
    purpose: "Removes the account and everything in it.",
    mutates: true,
    severity: "destructive",
  });
  assert.match(s, /undone — removes the account/);
});

test("IRREVERSIBLE gets its own sentence, which is why the word exists", () => {
  // Nothing is removed here — a notification is sent, a link is opened. So
  // "this deletes something" would be false, and saying nothing would hide the
  // property that decides how carefully to treat it: it has left, and we
  // cannot call it back.
  const s = confirmSentence(
    { name: "click", data: { target: "admin-notification-send" } } as never,
    {
      label: "Send the notification",
      purpose: "Delivers it to real people. It CANNOT be unsent.",
      mutates: true,
      severity: "irreversible",
    }
  );
  assert.match(s, /cannot be taken back/);
  assert.doesNotMatch(
    s,
    /deletes something/,
    "nothing is deleted, and a warning that says otherwise is simply false"
  );
  assert.match(s, /CANNOT be unsent/, "the purpose's own emphasis survives");
});

test("the three severities produce three different warnings", () => {
  // A vocabulary whose words render the same sentence is a vocabulary with one
  // word and two synonyms.
  const spec = { name: "click", data: { target: "x" } } as never;
  const said = (severity: string) =>
    confirmSentence(spec, {
      label: "Do it",
      purpose: "Something happens.",
      mutates: true,
      severity: severity as never,
    });
  const all = ["reversible", "irreversible", "destructive"].map(said);
  assert.equal(new Set(all).size, 3, all.join(" | "));
});
