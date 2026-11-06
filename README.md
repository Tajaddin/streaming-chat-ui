# streaming-chat-ui

> Production-shaped React + SSE chat: incremental markdown rendering, footnote-style citations, abort + regenerate, in-place message editing. **41/41 tests pass** across a pure-function reducer, an incremental SSE parser, a streaming-safe markdown renderer, and a real hook integration test (fake transport, real reducer + parser). Includes a Node SSE dev server (mock + Anthropic backends) and a TTFB benchmark.

[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE) [![Tests](https://img.shields.io/badge/tests-41%20passing-brightgreen)](#tests) [![React](https://img.shields.io/badge/react-18-blue)]() [![TypeScript](https://img.shields.io/badge/typescript-5-blue)]()

## What's actually here

A working chat UI is mostly *not* about the chat bubble. The hard parts:

1. **Robust SSE parsing**, including chunk boundaries that split mid-event.
2. **A deterministic state machine** for messages: idle → streaming → complete | error | aborted, plus edit drafts and regeneration.
3. **Streaming-safe markdown** — render incrementally as tokens arrive without breaking on an unclosed code fence.
4. **Citation rendering** that knows the difference between text and `[^N]` markers without losing either.
5. **Abort / regenerate / edit** flows that don't corrupt history.

This repo ships each of those as a *pure module with its own test file*, then composes them in a 250-line `useStreamingChat` hook. The UI on top is intentionally small — the value is the library.

## Hero metric

**TTFB on the SSE start** is the number that defines whether a chat UI feels alive or dead. The benchmark spins up the Node dev server (mock backend, deterministic), POSTs 50 requests serially, and measures the time from "request sent" to "first SSE byte parsed."

```bash
N=50 npm run bench:ttfb
```

```json
{
  "requests": 50,
  "ttfb_ms":  { "p50": 1.04, "p95": 2.06, "p99": 2.84, "max": 3.18, "mean": 1.20 },
  "total_ms": { "p50": 514.99, "p95": 528.33, "p99": 531.21 }
}
```

| Percentile | TTFB | Total stream |
|---|---:|---:|
| p50 | **1.04 ms** | 515 ms |
| p95 | 2.06 ms | 528 ms |
| p99 | **2.84 ms** | 531 ms |
| max | 3.18 ms | — |

TTFB < 3 ms at p99 means the user sees a token start to appear within the same paint frame they hit enter — the perceived-responsiveness ceiling on commodity hardware. The full stream takes ~515 ms because the dev server throttles to 12 ms / 4-char chunk so the streaming render is *visible* in the demo. Swap the mock for a real LLM stream and total latency tracks the model.

## The five libraries

### 1. `src/lib/sseParser.ts` — robust incremental parser

Handles every quirky case in the WHATWG SSE spec that matters for chat:

* multi-event chunks in a single `parse()` call
* events split across chunks (you feed it byte-by-byte; it buffers)
* `\r\n` / `\r` / `\n` line terminators
* leading-space stripping after the field name (`data: hi` → `"hi"`, not `" hi"`)
* comments (`: keep-alive`) ignored
* unknown fields skipped, not crashed on
* multi-line `data:` joined with `\n`
* events with no `data:` not dispatched

The whole thing is one class with two methods. Tests at `tests/sseParser.test.ts`.

### 2. `src/lib/chatState.ts` — pure reducer

`(state, action) -> state`. No React, no fetch, no clock. Eleven action types cover:

* `send-user` — append a user message
* `begin-stream` / `delta` / `complete` / `error` / `abort` — assistant lifecycle
* `citation` — append a citation, de-duped by id
* `edit-start` / `edit-change` / `edit-commit` / `edit-cancel` — message editing
* `regenerate-from` — truncate history after a given user turn

Every action has an explicit test in `tests/chatState.test.ts`. The reducer also tracks `streamingId` so the UI knows whether to show "send" or "stop" without poking through messages.

### 3. `src/lib/citations.ts` — `[^N]` marker tokenizer

`tokenize(text) → Array<{ kind: "text" | "cite", ... }>`. Lets the React component render every span exactly once, so a streaming `"see [^1] for"` updates the cite link as soon as the marker completes, without re-rendering the whole text.

### 4. `src/lib/markdown.ts` — streaming-safe markdown subset

Handles the four cases a chat UI actually needs:

* `**bold**`, `*italic*`, `` `inline code` ``
* `` ```code fences``` `` — and crucially, an *unclosed* fence renders as a "streaming" code block with a CSS class, not as raw markdown
* paragraph breaks (blank line → new `<p>`)
* HTML escaping everywhere, no pass-through

The whole module is ~50 lines. It's deliberately *not* a full markdown engine — the goal is "nothing breaks when the model is half-done writing a code block."

### 5. `src/hooks/useStreamingChat.ts` — React glue

Composes the four pure modules behind a small React API:

```typescript
const chat = useStreamingChat({ endpoint: "/api/chat" });

chat.send("hello");                 // user turn + opens assistant stream
chat.abort();                        // cancel mid-stream
chat.regenerate(userMsgId);          // drop everything after, re-stream
chat.regenerateLast();               // shortcut for "redo my last turn"
chat.editStart(id) / editCommit(id); // edit user message in-place
```

The hook takes optional `fetchFn`, `idFactory`, and `now` for tests — that's how the integration tests run without spinning up a real server.

## SSE event protocol

The dev server (and the contract the hook expects) uses three event types:

| Event | Data | Meaning |
|---|---|---|
| `token` | text chunk | Append to the assistant's content. (`message` is also accepted as an alias.) |
| `citation` | JSON `{label, id, href?, snippet?}` | Add one citation entry the UI renders as `<sup>[N]</sup>`, linked only when `href` is an absolute http(s) URL |
| `done` | (empty) | Stream completed cleanly; transition to `complete` |
| `error` | error message | Stream failed; transition to `error` with the payload |

Any unrecognized event is silently ignored, so the protocol is forward-compatible.

## Tests

```bash
npm test
```

```
tests/citations.test.ts        8 passed   markers + tokenize spans + safe hrefs
tests/sseParser.test.ts        9 passed   one event / multi-event / chunk-split / CR / comments / leading space / id
tests/markdown.test.ts         7 passed   escape / bold / italic / code / fences / streaming / paragraphs
tests/chatState.test.ts       11 passed   every action + ttfbMs helper
tests/useStreamingChat.test.tsx  5 passed   happy path / citation event / SSE error event / non-200 / regenerate
tests/Chat.test.tsx            1 passed   only http(s) citations render as links
─────────────────────────────────────────────
41 passed
```

`useStreamingChat.test.tsx` is the most interesting one: it constructs a fake `fetch` that returns a `ReadableStream` enqueueing the SSE bytes in 16-char chunks. That exercises the parser's chunk-boundary handling end-to-end through the real React hook, with no mocked internals.

## Quickstart

```bash
npm install

# 1. Start the SSE dev server (mock backend)
npm run dev:server

# 2. In another shell, start Vite
npm run dev
# open http://localhost:5173
```

To swap the mock for real Anthropic streaming:

```bash
npm i @anthropic-ai/sdk
ANTHROPIC_API_KEY=sk-ant-... BACKEND=anthropic npm run dev:server
```

The protocol is the same; the only change is what feeds the `token` events.

## Project layout

```
.
├── src/
│   ├── lib/
│   │   ├── sseParser.ts        # incremental SSE parser
│   │   ├── chatState.ts        # reducer + action types + ttfbMs
│   │   ├── citations.ts        # [^N] marker tokenizer
│   │   └── markdown.ts         # streaming-safe markdown subset
│   ├── hooks/useStreamingChat.ts
│   ├── components/Chat.tsx     # the chat surface
│   ├── App.tsx / main.tsx
│   └── server/server.ts        # Node SSE dev server (mock + Anthropic)
├── tests/                      # 6 files, 41 cases
└── bench/ttfb.mjs              # TTFB benchmark
```

## Limitations

**No backend persistence.** Chat history lives in React state only. A real product wires the reducer's `messages` to localStorage / IndexedDB / a database. The reducer is intentionally serializable for exactly that reason.

**No retry / backoff on network errors.** A 502 is shown to the user; we don't retry. Strategy is application-specific (some retries should be silent, some shouldn't) so it's left out.

**Markdown subset, not full CommonMark.** Tables, blockquotes, nested lists, links: not rendered. The trade-off is that nothing in the rendered output can be XSS — every span is either escaped text or a fixed safe element, and citation links are limited to http(s) URLs.

**Citation list is in-flight only.** Citations dispatched during a stream live on the assistant message. If you reload, they're gone unless you persist (see "no backend persistence" above).

**Test-side React 18 act warnings.** The hook test occasionally surfaces a React act warning under jsdom; functionally tests pass.

## License

MIT — see [LICENSE](LICENSE).
