import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useStreamingChat } from "../src/hooks/useStreamingChat";

function makeFakeFetch(eventStream: string): typeof fetch {
  return async (..._args: any[]) => {
    const encoder = new TextEncoder();
    const body = new ReadableStream({
      async start(controller) {
        // Emit the stream in 16-char chunks to test incremental parse.
        for (let i = 0; i < eventStream.length; i += 16) {
          controller.enqueue(encoder.encode(eventStream.slice(i, i + 16)));
          await new Promise((r) => setTimeout(r, 1));
        }
        controller.close();
      },
    });
    return new Response(body, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    }) as any;
  };
}

describe("useStreamingChat", () => {
  it("happy path: send then receive token deltas and complete", async () => {
    const stream =
      "event: token\ndata: hello\n\n" +
      "event: token\ndata:  world\n\n" +
      "event: done\ndata: \n\n";
    let counter = 0;
    const { result } = renderHook(() =>
      useStreamingChat({
        endpoint: "/api",
        fetchFn: makeFakeFetch(stream),
        idFactory: () => `id${++counter}`,
        now: () => 1000,
      }),
    );

    await act(async () => {
      await result.current.send("hi");
    });

    await waitFor(() => {
      expect(result.current.state.streamingId).toBeNull();
    });
    const msgs = result.current.state.messages;
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe("user");
    expect(msgs[1].role).toBe("assistant");
    expect(msgs[1].content).toBe("hello world");
    expect(msgs[1].status).toBe("complete");
  });

  it("captures citation events into the citations array", async () => {
    const stream =
      "event: token\ndata: see\n\n" +
      'event: citation\ndata: {"label":"1","id":"d-1","href":"https://x"}\n\n' +
      "event: done\ndata: \n\n";
    let counter = 0;
    const { result } = renderHook(() =>
      useStreamingChat({
        endpoint: "/api",
        fetchFn: makeFakeFetch(stream),
        idFactory: () => `id${++counter}`,
      }),
    );
    await act(async () => {
      await result.current.send("q");
    });
    const assistant = result.current.state.messages.find((m) => m.role === "assistant")!;
    expect(assistant.citations).toEqual([
      { label: "1", id: "d-1", href: "https://x" },
    ]);
  });

  it("error event marks the assistant message as error with the payload", async () => {
    const stream = "event: error\ndata: model exploded\n\n";
    let counter = 0;
    const { result } = renderHook(() =>
      useStreamingChat({
        endpoint: "/api",
        fetchFn: makeFakeFetch(stream),
        idFactory: () => `id${++counter}`,
      }),
    );
    await act(async () => {
      await result.current.send("q");
    });
    const assistant = result.current.state.messages.find((m) => m.role === "assistant")!;
    expect(assistant.status).toBe("error");
    expect(assistant.errorMessage).toBe("model exploded");
  });

  it("non-200 status produces an error state", async () => {
    let counter = 0;
    const fetchFn: typeof fetch = async () =>
      new Response("oops", { status: 503 }) as any;
    const { result } = renderHook(() =>
      useStreamingChat({
        endpoint: "/api",
        fetchFn,
        idFactory: () => `id${++counter}`,
      }),
    );
    await act(async () => {
      await result.current.send("q");
    });
    const assistant = result.current.state.messages.find((m) => m.role === "assistant")!;
    expect(assistant.status).toBe("error");
    expect(assistant.errorMessage).toContain("503");
  });

  it("regenerate drops the prior assistant turn and reopens the stream", async () => {
    const stream1 = "event: token\ndata: first\n\nevent: done\ndata: \n\n";
    const stream2 = "event: token\ndata: second\n\nevent: done\ndata: \n\n";
    let calls = 0;
    const fetchFn: typeof fetch = async () => {
      const s = ++calls === 1 ? stream1 : stream2;
      return makeFakeFetch(s)("ignored");
    };
    let counter = 0;
    const { result } = renderHook(() =>
      useStreamingChat({
        endpoint: "/api",
        fetchFn,
        idFactory: () => `id${++counter}`,
      }),
    );
    await act(async () => {
      await result.current.send("q");
    });
    const userId = result.current.state.messages.find((m) => m.role === "user")!.id;
    await act(async () => {
      await result.current.regenerate(userId);
    });
    const assistants = result.current.state.messages.filter((m) => m.role === "assistant");
    expect(assistants).toHaveLength(1);
    expect(assistants[0].content).toBe("second");
  });
});
