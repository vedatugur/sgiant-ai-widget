# sgiant-ai-widget

Framework-agnostic embeddable AI chatbox. One call mounts a floating chat bubble

- streaming panel into any page — the analytics app, or an external customer
  site.

```ts
import { createAiChatWidget } from "sgiant-ai-widget";

const chat = createAiChatWidget({
  endpoint: "https://api.sgiant.io/accounts/acc_123/ai/chat",
  accountId: "acc_123",
  getToken: async () => await getClerkToken(), // or a short-lived embed token
  title: "Ask sgiant",
  greeting: "Hi! Ask me about your performance.",
  accent: "#6d28d9",
});
chat.open();
```

## Theming

The entire stylesheet reads from `--aiw-*` CSS custom properties set on the
widget's roots. `accent` / `gradient` are the shorthand; the `theme` option
overrides any token — or theme from plain CSS by targeting the roots.

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
