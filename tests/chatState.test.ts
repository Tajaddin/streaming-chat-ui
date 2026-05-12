import { describe, expect, it } from "vitest";
import {
  ChatState,
  initialState,
  reducer,
  ttfbMs,
} from "../src/lib/chatState";

describe("chatState reducer", () => {
  it("send-user appends a complete user message", () => {
    const s = reducer(initialState, { type: "send-user", id: "u1", content: "hi" });
    expect(s.messages).toHaveLength(1);
    expect(s.messages[0]).toMatchObject({ role: "user", content: "hi", status: "complete" });
  });

  it("begin-stream + delta accumulates content and sets firstByte", () => {
    let s: ChatState = reducer(initialState, { type: "send-user", id: "u1", content: "hi" });
    s = reducer(s, { type: "begin-stream", id: "a1" });
    expect(s.streamingId).toBe("a1");
    s = reducer(s, { type: "delta", id: "a1", chunk: "hel", tsMs: 100 });
    s = reducer(s, { type: "delta", id: "a1", chunk: "lo", tsMs: 200 });
    const assistant = s.messages.find((m) => m.id === "a1")!;
    expect(assistant.content).toBe("hello");
    expect(assistant.firstByteAtMs).toBe(100); // unchanged on subsequent deltas
  });

  it("complete clears streamingId and stamps finishedAtMs", () => {
    let s = reducer(initialState, { type: "begin-stream", id: "a1" });
    s = reducer(s, { type: "complete", id: "a1", tsMs: 555 });
    expect(s.streamingId).toBeNull();
    expect(s.messages[0].status).toBe("complete");
    expect(s.messages[0].finishedAtMs).toBe(555);
  });

  it("abort transitions status to aborted", () => {
    let s = reducer(initialState, { type: "begin-stream", id: "a1" });
    s = reducer(s, { type: "delta", id: "a1", chunk: "partial", tsMs: 10 });
    s = reducer(s, { type: "abort", id: "a1", tsMs: 30 });
    expect(s.streamingId).toBeNull();
    expect(s.messages[0].status).toBe("aborted");
    expect(s.messages[0].content).toBe("partial");
  });

  it("error preserves partial content and records the message", () => {
    let s = reducer(initialState, { type: "begin-stream", id: "a1" });
    s = reducer(s, { type: "delta", id: "a1", chunk: "oops", tsMs: 5 });
    s = reducer(s, { type: "error", id: "a1", tsMs: 6, message: "boom" });
    expect(s.messages[0].errorMessage).toBe("boom");
    expect(s.messages[0].content).toBe("oops");
    expect(s.messages[0].status).toBe("error");
  });

  it("citation event de-dupes by id", () => {
    let s = reducer(initialState, { type: "begin-stream", id: "a1" });
    s = reducer(s, {
      type: "citation",
      id: "a1",
      citation: { label: "1", id: "doc-1" },
    });
    s = reducer(s, {
      type: "citation",
      id: "a1",
      citation: { label: "1", id: "doc-1" },
    });
    expect(s.messages[0].citations).toHaveLength(1);
  });

  it("edit-start / edit-change / edit-commit replace content", () => {
    let s: ChatState = reducer(initialState, {
      type: "send-user",
      id: "u1",
      content: "first",
    });
    s = reducer(s, { type: "edit-start", id: "u1" });
    expect(s.messages[0].draft).toBe("first");
    s = reducer(s, { type: "edit-change", id: "u1", draft: "second" });
    expect(s.messages[0].draft).toBe("second");
    s = reducer(s, { type: "edit-commit", id: "u1" });
    expect(s.messages[0].content).toBe("second");
    expect(s.messages[0].draft).toBeUndefined();
  });

  it("edit-cancel drops the draft without changing content", () => {
    let s = reducer(initialState, { type: "send-user", id: "u1", content: "first" });
    s = reducer(s, { type: "edit-start", id: "u1" });
    s = reducer(s, { type: "edit-change", id: "u1", draft: "second" });
    s = reducer(s, { type: "edit-cancel", id: "u1" });
    expect(s.messages[0].content).toBe("first");
    expect(s.messages[0].draft).toBeUndefined();
  });

  it("regenerate-from drops messages AFTER the given user msg", () => {
    let s: ChatState = reducer(initialState, {
      type: "send-user",
      id: "u1",
      content: "q1",
    });
    s = reducer(s, { type: "begin-stream", id: "a1" });
    s = reducer(s, { type: "delta", id: "a1", chunk: "old reply", tsMs: 1 });
    s = reducer(s, { type: "complete", id: "a1", tsMs: 2 });
    s = reducer(s, { type: "regenerate-from", id: "u1" });
    // u1 stays, a1 gone
    expect(s.messages.map((m) => m.id)).toEqual(["u1"]);
    expect(s.streamingId).toBeNull();
  });

  it("ttfbMs returns null for non-assistant or no first-byte", () => {
    const userMsg = { role: "user" as const } as any;
    expect(ttfbMs(userMsg, 0)).toBeNull();
    const unstreamed = { role: "assistant" as const } as any;
    expect(ttfbMs(unstreamed, 0)).toBeNull();
  });

  it("ttfbMs computes delta against sentAtMs", () => {
    const m = { role: "assistant", firstByteAtMs: 1500 } as any;
    expect(ttfbMs(m, 1000)).toBe(500);
  });
});
