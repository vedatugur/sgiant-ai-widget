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

The full contract, including a dependency-free reference server short enough to
read in one go, is in **[BACKEND.md](./BACKEND.md)**.

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

## Charts without React

In-app hosts wire `renderDataWidget` (real `@sgiant/ui` charts). A standalone
embed has no React, so `render_chart` frames degrade to a stat/table — unless
you plug `renderChartFallback(host, spec, rows, comparisonRows)` with any
lightweight chart lib.

## Transport

POSTs `{ accountId, threadId, content }` and reads a streamed body, tolerating
both shapes the platform emits:

- SSE — `data: {"type":"assistant_delta","text":"…"}`
- NDJSON — `{"d":"…"}`

plus `{type:"thread",threadId}`, `{type:"error",message}`, `{type:"done"}`.

## Security

The widget holds no long-lived secret — the host supplies a token (Clerk session
in-app, or a short-lived **embed token** for external sites). The backend's OBO
scoping is the real ceiling; this is presentation only. The public embed-token
endpoint is the next backend step (tracked with the managed-AI build).

## External embedding

For drop-in `<script>` use on third-party sites, bundle this module to a single
IIFE/UMD file that exposes `window.SgiantChat.init(opts)` — not yet wired (needs
the embed-token endpoint first).

## About the `#123` references in the source

The comments cite issue numbers from the private tracker this widget was built
in, where it lived inside a monorepo until 2026-09-02. They are kept because the
reasoning around them is worth more than the tidiness of removing it — a comment
explaining *why* a wire value must not change is useful even when you cannot
open the ticket it cites.

Nothing behind those numbers is needed to use, read, or modify this package.

## Licence

MIT © Vedat Aydın Uğur
