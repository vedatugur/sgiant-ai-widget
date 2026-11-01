# sgiant-ai-widget

A framework-agnostic, embeddable **AI chat widget**. One call mounts a floating
bubble and a streaming chat panel into any page.

No React. No framework. Vanilla DOM, themeable through CSS custom properties,
and one runtime dependency.

```bash
npm install sgiant-ai-widget
```

**Live examples**, all plain HTML with no bundler and no build step:

- **[Quick start →](https://vedatugur.github.io/sgiant-ai-widget/)** — a
  `<script src>` tag and one call.
- **[Beyond streaming text →](https://vedatugur.github.io/sgiant-ai-widget/capabilities.html)**
  — live activity steps, the assistant asking the human to decide, a
  confirm-gated write, suggestion chips, a form the model designed, a card with
  its own actions, and a renderer you register yourself. Every demo runs a real
  turn and shows the JSON that produced it.
- **[The chrome →](https://vedatugur.github.io/sgiant-ai-widget/ui.html)** —
  launcher states (`resting`, `unread`, `working`, `offline`, `parked`) driven
  live, what the user can do to the panel, and an animated robot avatar that is
  one inline SVG with its own `prefers-reduced-motion` guard.
- **[Advanced mode →](https://vedatugur.github.io/sgiant-ai-widget/advanced.html)**
  — the assistant highlighting, filling and clicking inside a real app in an
  iframe, driven over
  [`sgiant-ai-agent-bridge`](https://www.npmjs.com/package/sgiant-ai-agent-bridge).
  Selectors never cross the wire; only ids the page opted in with
  `data-ai-target`.
- **[Real charts →](https://vedatugur.github.io/sgiant-ai-widget/charts.html)**
  — animated bars, an animated line with a comparison overlay, and a donut,
  drawn with no chart library at all.
- **[Theming →](https://vedatugur.github.io/sgiant-ai-widget/theming.html)** —
  launcher geometry as custom properties, and an inline SVG brand mark.

## Two ways in

### As a module (React, Next, Vue, Svelte, plain ESM)

```ts
import { createAiChatWidget } from "sgiant-ai-widget";

const chat = createAiChatWidget({
  endpoint: "https://api.example.com/chat",
  title: "Aria",
  greeting: "Hi! Ask me anything.",
  accent: "#6d28d9",
});
chat.open();
```

### As a `<script>` tag, no build step

```html
<script src="https://unpkg.com/sgiant-ai-widget/dist/sgiant-ai-widget.global.js"></script>
<script>
  SgiantAiWidget.createAiChatWidget({ endpoint: "/chat" });
</script>
```

The global build bundles its one dependency, so it is a single file. If your
page already uses a bundler, prefer the module build — it shares that dependency
instead of carrying a second copy.

## Charts, if you have no chart library

The widget draws a stat tile for a `kpi` and a table for anything else. That is
deliberate: a host with real chart components should mount those through
`renderDataWidget`, and a core carrying a second implementation would charge
every consumer for one they do not use.

For surfaces with neither — a WordPress admin page, a plain embed — there is an
**opt-in** renderer:

```ts
import { createChartFallback } from "sgiant-ai-widget/charts";
createAiChatWidget({ renderChartFallback: createChartFallback() });
```

```html
<!-- or with no build step at all: a separate 3.8 kB bundle -->
<script src="https://unpkg.com/sgiant-ai-widget/dist/sgiant-ai-widget-charts.global.js"></script>
<script>
  SgiantAiWidget.createAiChatWidget({
    renderChartFallback: SgiantAiWidgetCharts.createChartFallback(),
  });
</script>
```

It draws `time_series`, `breakdown` and `donut`, reading your `--aiw-*` tokens
so a chart follows the theme, and it plots the column your spec **names** in
`metrics` / `dimension` rather than guessing at one — so the same frame renders
the same numbers here and in a full dashboard renderer. It **throws** for `kpi`, `table`, `pivot_grid`,
`heatmap`, `scatter` and `content` — which the widget catches and renders with
its built-in instead. A bad heatmap made of rectangles is worse than a readable
table of the same numbers.

It is a floor, not a charting library. Nothing in the main entry point
references it, so it costs zero bytes unless you ask for it.

## The backend

One POST endpoint that streams newline-delimited JSON. Four frame types matter:

| frame | meaning |
| --- | --- |
| `{"type":"text","d":"…"}` | append this text |
| `{"threadId":"…"}` | name the conversation |
| `{"type":"done"}` | the turn is over |
| `{"type":"error","message":"…"}` | the turn failed |
| `{"type":"error","code":"…","message":"…"}` | the turn failed, and `message` is a sentence you wrote for the reader: it is shown by itself. Add `"retry":false` to offer no "Try again" |

The full contract, including a dependency-free reference server short enough to
read in one go, is in **[BACKEND.md](./BACKEND.md)**.

## The box a person writes in

A text area on a row of its own, as wide as the window, which grows with
what is typed: one line when empty, up to five, then it scrolls inside (fewer
when the window is short, as with a phone's keyboard up: the box takes about
a third of the window's height at most). The model picker, the attach button
and Send sit on the row under it.

Enter sends. Shift+Enter is a new line. Enter in the middle of composing a
letter with an input method sends nothing. A picture pasted into the box is
an attachment, where the host takes attachments.

Nothing here is an option: there is one layout at every width.

## Attachments

Set `uploadEndpoint` and the composer grows a paperclip. Leave it unset and
there is no attach button at all — an attach control on a surface with nowhere
to put a file fails *after* the user has chosen one, which is the worst moment
to say no.

```js
createAiChatWidget({
  endpoint: "/accounts/acc_1/ai/chat",
  uploadEndpoint: "/accounts/acc_1/assets/media", // POST multipart
});
```

`getUploadEndpoint()` is the dynamic form, read at call time, for a host whose
account can change without remounting — the same shape as `getToken`.

Each file is a `multipart/form-data` POST carrying `file`, `session=1`, and
`threadId` when there is one; your endpoint answers with a media id, and the
chat turn then carries ids rather than bytes. `session=1` is the whole
difference between a chat attachment and an upload to the asset library: a file
dropped into a conversation belongs to that conversation, reachable from its
history by id and never filed alongside deliberate library uploads.

| limit | value | why |
| --- | --- | --- |
| files per turn | 6 | Extras are dropped, not refused — the turn still sends. |
| image / document | 25 MB | Read inline by the model, so this bounds a prompt. |
| video / audio | 100 MB | Referenced by id, never inline. A 30-second 1080p phone video is already past the document cap, so a shared cap would refuse the everyday case for being ordinary. |

An oversize file gets its own error chip naming the file and the cap, and the
rest of the same selection still uploads — one bad file does not lose the batch.

See `examples/uploads.html`.

## When there is no token to give

`getToken` is asked before every send. Sometimes the honest answer is that
there is no token and nothing has gone wrong: this person has not connected
their account yet, or has no access to this one. Say so by rejecting with
something that has a `userMessage`, and optionally one button:

```js
createAiChatWidget({
  endpoint: "/chat",
  getToken: async () => {
    const res = await fetch("/my-site/token");
    if (res.status === 409)
      // A plain object is enough; so is an Error with these set on it.
      throw {
        userMessage: t("connectToUse"),          // shown as it is
        action: {
          label: t("connect"),
          // Called inside the click, so a window opened here is not blocked.
          // Resolve true once a token can be had; false if they backed out.
          onClick: () => openConnectWindow(),
        },
      };
    if (!res.ok) throw new Error(`token ${res.status}`); // a real failure
    return (await res.json()).token;
  },
});
```

The window shows the sentence plainly, with the button under it. It is not the
error card: there is no "hit a snag" headline, no "Try again", and the launcher
is not marked offline. The question is not sent. It stays on screen as the
person's own, and when `onClick` resolves `true` the widget asks `getToken`
again and sends it, once; they do not retype it. Only `true` counts: resolve
anything else, or reject, and the notice stays with its button working again.
While `onClick` is running the button is disabled and nothing is sent.

There is one notice at a time. If the second ask is refused too (connected, but
no access), that sentence replaces the first. Leave `action` out and only the
sentence shows.

One question is held, the latest. If the person asks a second question while
the notice is up, that one replaces the first as the held question; the first
stays on screen as theirs and is not sent when they connect.

The words are yours, in the page's language; the widget adds none. The button
is not offered to the assistant as a control it can press.

Reject with anything that has no `userMessage` and it is a failure, shown as
one, exactly as before. A notice belongs to a send: a refused token during a
file upload shows nothing, as a failed upload always has. A widget older than
1.20.0 does not know this shape and shows its ordinary error card for it.

## Theming

The entire stylesheet reads from `--aiw-*` CSS custom properties set on the
widget's roots. `accent` / `gradient` are the shorthand; the `theme` option
overrides any token — or theme from plain CSS by targeting the roots, which
works because the defaults are declared inside `:where()` and therefore carry
zero specificity. Any rule you write beats them, with no `!important` needed.

**Launcher geometry is tokenised too**: `--aiw-launcher-size`, `-offset`,
`-offset-sm` (below 480px), `-icon`, `-pill-height`, `-pill-icon`,
`-parked-size`, `-parked-icon`, `-dot`, `-dot-sm`. The `-sm` pair is
deliberately independent, so a larger desktop launcher does not force a larger
one on a phone. See [examples/theming.html](./examples/theming.html).

```ts
createAiChatWidget({
  // …
  accent: "#6d28d9",
  theme: {
    // dark mode
    surface: "#16161e",
    "surface-2": "#22222c",
    bg: "#101016",
    text: "#e7e7ec",
    "text-2": "#b6b6c2",
    muted: "#8a8a96",
    border: "#2b2b36",
    "border-strong": "#3a3a48",
    "border-soft": "#22222c",
  },
});
```

Tokens: `accent`, `accent-contrast`, `gradient`, `surface`, `surface-2`, `bg`,
`text`, `text-2`, `muted`, `border`, `border-strong`, `border-soft`.

## Custom renderers (extension point)

The assistant can emit `[[<tag>:{json}]]` directives; built-ins cover
`widget` (stat/kpis/list/table), `preview` (sandboxed HTML), `navigate`,
`action`, `chips`, and `form`. Register your own tags to render anything else —
the widget strips the directive, mounts a host element in the log, and hands
you the parsed JSON:

```ts
const chat = createAiChatWidget({
  // …
  renderers: {
    calendar: (host, spec) => {
      host.textContent = renderMyCalendar(spec); // validate spec yourself
      return () => cleanup(); // optional disposer (message cleared)
    },
  },
});
// or later:
chat.registerRenderer("map", (host, spec) => drawMap(host, spec));
```

Built-in tags are reserved (a plugin can't hijack the confirm-gated
`action`/`form` security model). A throwing renderer removes its host card
instead of breaking the message.

## Letting people choose the model

Pass `models` and a small pill appears in the composer, next to Send. The chosen
option's `id` is sent as `model` with every message.

```js
createAiChatWidget({
  endpoint: "/api/chat",
  models: [
    { id: "claude-haiku-4-5-20251001", label: "Haiku 4.5",  hint: "Fastest, lightest", cost: "1×" },
    { id: "claude-sonnet-5-5",         label: "Sonnet 5.5", hint: "Fast and capable",  cost: "2×" },
    { id: "claude-opus-5-5",           label: "Opus 5.5",   hint: "Most capable",      cost: "4×" },
  ],
  defaultModel: "claude-sonnet-5-5",
  onModelChange: (id) => { /* optional */ },
});
```

The widget knows nothing about models. Which ones exist, which company serves
each and what they cost belongs to your server; the options are plain data, and
`id` is opaque. Give options a `group` (the vendor, say) and they are listed
under it, so offering a second vendor's models is a longer list rather than a
widget change.

The choice is remembered per `storageNamespace` and layout scope, and checked
against `models` on every mount: a model you stop offering is never sent again,
the person gets `defaultModel` instead. Omit `models` and there is no pill and
no `model` field. See `examples/models.html`.

If your list of models failed to load and you would rather open the chat than
hold it back, pass `modelsUnavailable: true` instead of `models`. The pill is
drawn where it would be, chooses nothing, and says why to a mouse, a keyboard,
a screen reader and a tap (the `modelPickerUnavailable` label). No `model`
field is sent, so the turn runs on your server's default.

The reason is also shown without being asked for: its box opens by itself when
the window opens in that state, and stays until the person presses elsewhere,
presses Escape or starts typing. After that it does not open by itself again
in that tab; pressing the pill brings it back.

## In the page's language

`labels` carries the words; `locale` carries how a figure is written.

```ts
createAiChatWidget({
  // …
  locale: i18n.language, // a BCP 47 tag: "tr", "en-GB"
  labels: widgetLabelOverrides({ t, i18n }), // only the labels you word differently
});
```

The numbers and times the widget writes itself follow `locale`: credits left, a
turn's counts, "3 hours ago" in the conversation list. Omit it and they follow
the browser, which is another language whenever someone reads a Turkish page in
an English browser: "24,000" for 24.000, and "8/1/2026" for 1 August. A tag the
engine refuses falls back to the browser's instead of throwing.

The widget carries its own words in English and Turkish. For every label you
do not pass in `labels`, it uses its own for the page's language: Turkish when
`locale` is a Turkish tag, or, when you pass no `locale`, when the page's own
`<html lang>` is. So a host that passes neither gets a Turkish window on a
Turkish page and an English one everywhere else. For any other language, pass
`labels`; a label you leave out is shown in English.

`widgetLabelOverrides({ t, i18n })` turns your translator into that bag: it
holds the `chatWidget.<key>` labels your file holds in the page's language, and
nothing else, so every label you do not word differently stays the window's
own. For a translator that is not i18next, pass `{ t, exists }`, where
`exists(key)` says whether the current language's file holds the key.
`widgetLabelOverrides(t)` alone still works, but it cannot tell a key the
page's language lacks from one it holds when the translator falls back
(i18next's `fallbackLng: "en"`): it hands that key's English to a Turkish page.

A label that says `{name}` is given the window's own name (`title`), so a
sentence about what the assistant does names your assistant.

Six words are options of their own, older than the label list: `voteUpLabel`,
`voteDownLabel`, `editLabel`, `regenerateLabel`, `cancelLabel`, `saveLabel`.
They are chosen the same way: yours, else the window's own for the page's
language. `subtitle`, the small line under the name, has no default: pass one
or nothing is drawn there.

## Charts without React

In-app hosts wire `renderDataWidget` (real `@sgiant/ui` charts). A standalone
embed has no React, so `render_chart` frames degrade to a stat/table — unless
you plug `renderChartFallback(host, spec, rows, comparisonRows)` with any
lightweight chart lib.

## Transport

POSTs `{ accountId, threadId, content }` (plus `model` when the host passes
`models`; see [BACKEND.md](./BACKEND.md)) and reads a streamed body, tolerating
both shapes the platform emits:

- SSE — `data: {"type":"assistant_delta","text":"…"}`
- NDJSON — `{"d":"…"}`

plus `{type:"thread",threadId}`, `{type:"error",message}`, `{type:"done"}`.

## Security

The widget holds no long-lived secret. In-app surfaces pass a Clerk session
token; external sites pass no token at all — they identify themselves with a
**public site key** in the POST body (`extraBody: { siteKey }`), which the
backend verifies against the paired site and rate-limits per site on top of
the per-IP ceiling. An unknown or inactive key is a 403, never a silent fall
back to anonymous. The backend's OBO scoping is the real ceiling; this is
presentation only.

This section said until 2026-09-22 that external sites use "a short-lived
embed token" and that the endpoint minting it "is the next backend step".
There is no such endpoint and there never was: the site-key design shipped
instead (sgiant-platform#339), and the `sgiant-connect` WordPress plugin has
been emitting `extraBody: { siteKey: … }` since.

## External embedding

The single-file IIFE build ships: `npm run build:global` writes
`dist/sgiant-ai-widget.global.js`, exposed as the `./global` export and as
`window.SgiantAiWidget` (see "As a `<script>` tag" above) — NOT
`window.SgiantChat`, which never existed. A third-party page needs no token:
pass its public site key and the endpoint does the rest — see *Security*.

```html
<script src="https://unpkg.com/sgiant-ai-widget/dist/sgiant-ai-widget.global.js"></script>
<script>
  SgiantAiWidget.createAiChatWidget({
    endpoint: "https://api.example.com/public/ai/chat",
    extraBody: { siteKey: "…" },
  });
</script>
```

### A site that can turn its assistant off

`createAiChatWidget` draws its launcher the moment it is called. On a
visitor's page that is not always wanted: the script may sit in a cached copy
of the page after the site's owner turned the assistant off, and a button
that appears and then goes away is worse than none.

`createSiteChat` asks first. It reads the site's public settings and puts
nothing in the page (no launcher, no frame, no stylesheet) unless the answer
says, with a real `true`, that this site's assistant answers visitors now.

```html
<script defer src="https://unpkg.com/sgiant-ai-widget/dist/sgiant-ai-widget.global.js"></script>
<script>
  addEventListener("DOMContentLoaded", function () {
    SgiantAiWidget.createSiteChat({
      endpoint: "https://api.example.com/public/ai/chat",
      settingsUrl: "https://api.example.com/public/ai/site-settings",
      siteKey: "…",
      // locale: "tr", // the page's language, if its <html lang> is not right
    });
  });
</script>
```

It resolves to the window's handle, or to `null` when nothing was drawn. It
never rejects. Called twice for one site key on one page (a plugin that
prints it, and the same code pasted into a theme), it answers both with the
same window: one read, one launcher.

**The read.** One `GET` to `settingsUrl` with `?siteKey=…`, no cookies and no
headers of its own, so a server on another origin needs only
`access-control-allow-origin`. It is given 4 seconds for the whole answer
(`timeoutMs` to shorten it; a longer one is brought down to 4), is made once per page view, and is never
repeated.

**The answer.** A `200` whose body is a JSON object:

| Field | | When it is missing or wrong |
|---|---|---|
| `answersVisitors` | `true` to draw the window | **nothing is drawn** |
| `name` | the window's title, up to 80 characters | "Assistant" / "Asistan" |
| `greeting` | the first thing the assistant says, up to 500 | the window's own |
| `language` | `"tr"` or `"en"`: the window's own words | follows the page |
| `color` | `#rrggbb`, the accent | the window's own |
| `suggestions` | up to 4 questions of up to 80 characters, as buttons | none |

Only `answersVisitors` decides whether there is a window. Anything but the
boolean `true` is no: `false`, the text `"true"`, `1`, a missing field (a
server that does not know the field yet), any status other than `200`, a body
that is not an object, no answer in time, a failed request. The other five
are how the window looks, and a wrong one falls back to the default: a colour
that is not a colour is not a reason to take a site's assistant away.

**Language.** The window has its own words in English and Turkish. It uses
the site's `language` when it has one, else `locale`, else the page's
`<html lang>`, else English. A page in another language gets the English
words; what language the assistant answers in is the server's business.

**When the site goes away under an open window.** A browser may still
believe an earlier yes for as long as the server lets it keep the answer. If
the server then refuses a visitor's question with a `403` or a `404`, the
window says one sentence of its own (the `siteUnavailable` label), with no
"Try again", and the visitor's question stays where they wrote it. Nothing
from a refused request's body is ever shown. The window is gone at the next
page view, when the read says no.

**What stays in a visitor's browser.** Two lists, and a test fails if either
grows.

| For as long as the browser keeps it | Only while the tab is open |
|---|---|
| that the window was opened before | the conversation (the last 40 messages, up to 200,000 characters) and its id |
| the sound setting, once the visitor changes it | the text typed and not yet sent |
| | whether the window was left open |
| | where the window was placed |

So a visitor's conversation follows them from page to page, comes back after
a reload, and is gone when they close the tab; a page opened in a new tab
starts a new one. Nothing a visitor wrote goes into the storage a browser
keeps. No cookie is set, and no identifier of the visitor is kept or sent.

The header's button is named "Clear this conversation" on a visitor's page
(the `clearChat` label). It removes the conversation, its id and the unsent
text from the tab and shows the greeting again.

What is kept is removed, and never shown, when the server says this site's
assistant does not answer visitors; when the site's key has changed; when it
is not exactly what this window writes; and when it is more than twelve hours
old. It is left alone when nobody answered the read (a failed request, no
answer in time): one bad connection erases nothing. Where a browser refuses
storage, nothing is kept and the chat works one page at a time.

## Flagging a conversation

Pass `onFlag` to put a flag control in the header: clicking it asks for a
reason and calls back with the reason plus the live thread id. Wire it to a
flags API (`POST /admin/ai/conversations/:kind/:threadId/flag` for staff
surfaces, `POST /public/ai/threads/:threadId/flag` for the visitor widget).
Omit it and the control does not render.

## In-app actions

The assistant can end a reply with `[[navigate:{"path":"/team"}]]` or
`[[action:{"name":"…"}]]`; the window draws a button, and pressing it calls
your `onWidgetAction(name, data)`. `createHostActions` builds that function:

```js
import { createAiChatWidget, createHostActions } from "sgiant-ai-widget";

createAiChatWidget({
  // …
  onWidgetAction: createHostActions({
    navigate: (path) => router.push(path),
    // Only these pages can be opened: anything else is refused out loud.
    pages: [{ path: "/team" }, { path: "/settings" }],
    // Your own named actions.
    handlers: { "open-orders": () => (router.push("/orders"), "Opened orders") },
  }),
  // Actions that only open a view run without a confirm when auto-navigate
  // is on. Never list one that spends or changes anything.
  navigationActions: ["open-orders"],
});
```

The window runs `navigate` and the on-page controls (highlight, scroll-to,
focus-field, fill, click) itself. Every other name must be in `handlers`, or
the button says it could not do it.

## The surface manifest (`sgiant-ai-widget/manifest`)

The window's own half of the manifest contract: its manifest, the ids it
stamps, a check of both against the live panel, and `hostTargetsOnly` to keep
its controls apart from your page's in a scan. Separate on purpose: a host that
never verifies a manifest pays nothing for it. The generator and verifier for
YOUR page (`generateManifest`, `verifySurface`, `canAct`, `hashManifest`) are
`sgiant-ai-agent-bridge/manifest`'s; import them from there.

## Upgrading to 2.0

- The window no longer has built-in named actions. `open-dashboards`,
  `open-dashboard-builder`, `open-billing`, `open-assets` and `show-assets`
  were one product's pages; pass your own through `handlers`. The
  `standardActions`, `showAssets` and `accountId` options of
  `createHostActions` are gone; `resolvePath` (where a path really lands, for
  "already there") replaces `accountId`.
- `isNavigationAction(name)` is true only for `navigate`; name your own with
  the window's `navigationActions`.
- The main entry carries the API above and nothing else. `scanAiTargets` and
  the other agent-bridge functions come from `sgiant-ai-agent-bridge`.
  `resolveWidgetLabels` (use `widgetLabelOverrides`), `subscribeLiveSync`,
  `readApplyRefusal`, `parseJsonDirective`, the UI-spec helpers, the manifest
  names on the main entry (they are in `./manifest`), `PREFIX`,
  `readSiteSettings`, `forgetSiteChats`, and the `fullscreenLabel` /
  `exitFullscreenLabel` options are removed.

## About the `#123` references in the source

The comments cite issue numbers from the private tracker this widget was built
in, where it lived inside a monorepo until 2026-09-02. They are kept because the
reasoning around them is worth more than the tidiness of removing it — a comment
explaining *why* a wire value must not change is useful even when you cannot
open the ticket it cites.

Nothing behind those numbers is needed to use, read, or modify this package.

## Licence

MIT © Vedat Aydın Uğur
