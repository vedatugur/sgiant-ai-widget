# @sgiant/ai-widget

Framework-agnostic embeddable AI chatbox. One call mounts a floating chat bubble

- streaming panel into any page — the analytics app, the marketing studio, or an
  external customer site.

```ts
import { createAiChatWidget } from "@sgiant/ai-widget";

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

## Transport

POSTs `{ accountId, threadId, content }` and reads a streamed body, tolerating
both shapes the platform emits:

- analytics SSE — `data: {"type":"assistant_delta","text":"…"}`
- studio NDJSON — `{"d":"…"}`

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
