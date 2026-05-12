// Dev SSE server. Two modes:
//   - mock  (default): emits a canned response with deterministic citations
//   - anthropic       : uses @anthropic-ai/sdk to stream a real Haiku completion
//
// Usage:
//   npm run dev:server                  # mock
//   BACKEND=anthropic npm run dev:server # real Haiku
//
// The benchmark `bench/ttfb.mjs` POSTs to /chat repeatedly and measures
// time-to-first-byte across the SSE stream.

import express from "express";
import http from "node:http";

interface ChatBody {
  messages: Array<{ role: "user" | "assistant"; content: string }>;
}

const PORT = Number(process.env.PORT ?? 8787);
const BACKEND = process.env.BACKEND ?? "mock";

const app = express();
app.use(express.json({ limit: "1mb" }));

function writeEvent(res: http.ServerResponse, event: string, data: string) {
  res.write(`event: ${event}\n`);
  for (const line of data.split("\n")) {
    res.write(`data: ${line}\n`);
  }
  res.write("\n");
}

async function streamMock(req: express.Request, res: express.Response) {
  const body = req.body as ChatBody;
  const user = body.messages.findLast?.((m) => m.role === "user")?.content ?? "";
  const reply =
    `Hi! You said: ${JSON.stringify(user.slice(0, 80))}.\n\n` +
    "Here is some **bold** and *italic* and `code`. " +
    "And a citation [^1] inline.\n\n" +
    "```python\nprint('hello')\n```\n";

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  // Stream the body in ~4-char chunks so the UI shows real incremental render.
  for (let i = 0; i < reply.length; i += 4) {
    if (req.aborted || res.destroyed) return;
    writeEvent(res, "token", reply.slice(i, i + 4));
    await new Promise((r) => setTimeout(r, 12));
  }
  writeEvent(
    res,
    "citation",
    JSON.stringify({
      label: "1",
      id: "doc-1",
      href: "https://example.com/doc1",
      snippet: "demo snippet",
    }),
  );
  writeEvent(res, "done", "");
  res.end();
}

async function streamAnthropic(req: express.Request, res: express.Response) {
  const { default: Anthropic } = await import("@anthropic-ai/sdk").catch(() => {
    throw new Error(
      "@anthropic-ai/sdk not installed; `npm i @anthropic-ai/sdk` or use BACKEND=mock",
    );
  });
  const client = new Anthropic.Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const body = req.body as ChatBody;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  try {
    const stream = client.messages.stream({
      model: process.env.MODEL ?? "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      messages: body.messages,
    });
    for await (const event of stream) {
      if (req.aborted || res.destroyed) {
        stream.controller.abort();
        return;
      }
      if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
        writeEvent(res, "token", event.delta.text);
      }
    }
    writeEvent(res, "done", "");
    res.end();
  } catch (err: any) {
    writeEvent(res, "error", String(err?.message ?? err));
    res.end();
  }
}

app.post("/chat", (req, res) => {
  if (BACKEND === "anthropic") {
    void streamAnthropic(req, res);
  } else {
    void streamMock(req, res);
  }
});

app.get("/healthz", (_req, res) => res.json({ status: "ok", backend: BACKEND }));

app.listen(PORT, () => {
  console.log(`streaming-chat-ui dev server on http://127.0.0.1:${PORT}`);
  console.log(`  backend=${BACKEND}`);
});
