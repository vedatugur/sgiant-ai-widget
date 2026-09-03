# The backend contract

What a server must do to answer this widget. Everything here was read off the
widget's own send path (`src/index.ts`) and its frame parser (`src/dom.ts`), not
written from intent — if the two ever disagree, the code is right and this file
is a bug.

The contract is deliberately small. A working backend is **one POST endpoint
that streams newline-delimited JSON**, and the minimum useful implementation is
at the bottom of this file, short enough to read in one go.

## The request

The widget POSTs to whatever you pass as `endpoint`:

```http
POST <endpoint>
content-type: application/json
authorization: Bearer <token>        # only when `token` / `getToken` is set
```

```jsonc
{
  "content": "how many bookings last week?", // the user's message
  "threadId": "…",                           // absent on the first turn
  "accountId": "",                           // "" unless the host scopes turns
  "pageContext": { … },                      // only if the host supplies one
  "attachments": ["mediaId", …],             // only if files were attached
  "parentId": "…",                           // only when editing/branching
  "regenerate": true                         // only when re-running a turn
}
```

Anything in the host's `extraBody` is merged in at the top level, so a field
your server needs but this widget has never heard of is a one-line host change,
not a fork.

Credentials follow `withCredentials`: `include` when set, `same-origin`
otherwise. The request carries an `AbortSignal` tied to the widget's lifetime —
if the user closes or the host destroys the widget mid-turn, the fetch is
aborted, and your server should treat a dropped connection as a cancelled turn.

## The response

A stream of **lines**. Each line is one JSON object. Both of these are accepted,
so use whichever your stack makes easy:

```
{"type":"text","d":"Hello"}                 ← bare NDJSON
data: {"type":"text","d":"Hello"}           ← SSE framing
```

`data: [DONE]` is tolerated and ignored, so an OpenAI-shaped SSE pipe does not
need special-casing. A line that is not valid JSON is skipped rather than
failing the turn — a stray log line in your stream will not break the chat.

### The four frames you actually need

| frame                            | meaning                                               |
| -------------------------------- | ----------------------------------------------------- |
| `{"type":"text","d":"…"}`        | append this text. `"text"` works in place of `"d"`    |
| `{"threadId":"…"}`               | name this conversation, so the next turn continues it |
| `{"type":"done"}`                | the turn is over                                      |
| `{"type":"error","message":"…"}` | the turn failed, and this is what the user is told    |

Send `threadId` on the first turn of a new conversation and the widget will send
it back on every subsequent turn. Nothing else is required.

### Everything else is optional richness

The widget understands more frames, and each one is inert if you never send it:
`usage` (token counts for the session meter), `quota` (a free-visitor
allowance), `activity` (live "running → ok" steps for a long turn), `question`
(the assistant asking the human to choose), `tool_proposal` (a confirm-gated
write), chart frames carrying `spec` + `rows`, and `meta` (which model wrote the
turn). Their exact fields are the `StreamFrame` interface in `src/dom.ts`, which
is the only place they are defined.

**Optional in the type does not mean optional in practice.** `StreamFrame` marks
every field `?`, because one interface describes a dozen frame shapes. Three of
them have fields the widget *requires* before it will render anything, and this
is the list:

| frame | required before it renders |
| --- | --- |
| `question` | `questionId` **and** `prompt` |
| `activity` | `label` **and** `status` |
| `tool_proposal` | `name`, plus a host that passes `onApplyProposal` |
| `meta` | `isStaff` **and** `modelLabel` |

This table is checked against the code by
`tests/frame-contract-documented.test.ts`, which reads the guards rather than
trusting the list — and its first run corrected this table. The `activity` row
originally said `name`, which the widget does not check at all: an activity
frame needs `label` and `status`, and one sent with only a `name` renders
nothing.

`questionId` is the one that catches people. It is echoed back with the user's
answer so your backend knows *which* question was answered, and without it the
frame is ignored. A frame that is missing one of these now logs a specific
console warning once per page — it used to be dropped in silence, which is how
this table came to exist.

Two directives have a host requirement rather than a field one, for the same
reason a confirm gate does: `[[form:…]]` and a UI card's action buttons only
render when the host passes `onWidgetAction` (or `onLead`). A form with nowhere
to submit is worse than no form.

You can ship a complete chat experience without any of them.

## A reference implementation

Node, no dependencies, no framework. It streams a canned reply one word at a
time so you can see the shape; replace the middle with your model call.

```js
import { createServer } from "node:http";

createServer(async (req, res) => {
  if (req.method !== "POST") return res.writeHead(405).end();

  const body = JSON.parse(await new Response(req).text());
  const threadId = body.threadId ?? crypto.randomUUID();

  res.writeHead(200, {
    "content-type": "application/x-ndjson",
    // Streaming dies silently behind a proxy that buffers. This is the usual
    // cause of "it works locally and hangs in production".
    "cache-control": "no-cache, no-transform",
  });
  const send = (frame) => res.write(JSON.stringify(frame) + "\n");

  // Name the thread FIRST. The widget keys its saved transcript on this, and a
  // turn that streams text before naming the thread saves under the wrong key.
  send({ threadId });

  try {
    for (const word of `You said: ${body.content}`.split(" ")) {
      send({ type: "text", d: word + " " });
      await new Promise((r) => setTimeout(r, 40));
    }
    send({ type: "done" });
  } catch (err) {
    // Say what happened. The widget renders `message` verbatim, and a turn that
    // ends without `done` or `error` leaves the composer disabled.
    send({ type: "error", message: String(err?.message ?? err) });
  }
  res.end();
}).listen(8787);
```

Point the widget at it:

```js
createAiChatWidget({ endpoint: "http://localhost:8787" });
```

## Three things that will bite you

1. **Always terminate.** A stream that ends without `done` or `error` leaves the
   widget waiting — the composer stays disabled and the user has no way back.
   Send one of the two on every path, including the ones you do not expect.
2. **Name the thread before streaming text.** The widget persists the transcript
   under the thread id; text that arrives first is saved against the previous
   key.
3. **Do not let a proxy buffer you.** Streaming is the whole interaction model
   here. `no-transform` plus disabling proxy buffering is what makes the reply
   appear a word at a time instead of all at once after ten seconds.
