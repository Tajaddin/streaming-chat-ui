import { describe, expect, it } from "vitest";
import { SSEParser } from "../src/lib/sseParser";

describe("SSEParser", () => {
  it("parses one simple event", () => {
    const p = new SSEParser();
    const events = p.parse("event: token\ndata: hello\n\n");
    expect(events).toEqual([{ event: "token", data: "hello", id: undefined }]);
  });

  it("defaults event type to 'message'", () => {
    const p = new SSEParser();
    const events = p.parse("data: hi\n\n");
    expect(events).toEqual([{ event: "message", data: "hi", id: undefined }]);
  });

  it("joins multi-line data with \\n", () => {
    const p = new SSEParser();
    const events = p.parse("data: line1\ndata: line2\n\n");
    expect(events[0].data).toBe("line1\nline2");
  });

  it("handles multiple events in one chunk", () => {
    const p = new SSEParser();
    const events = p.parse("event: a\ndata: 1\n\nevent: b\ndata: 2\n\n");
    expect(events.length).toBe(2);
    expect(events[0].event).toBe("a");
    expect(events[1].event).toBe("b");
  });

  it("handles split chunk boundaries (incremental parse)", () => {
    const p = new SSEParser();
    // emit one event byte-by-byte
    const raw = "event: token\ndata: hello world\n\n";
    const out: any[] = [];
    for (const ch of raw) {
      out.push(...p.parse(ch));
    }
    expect(out).toEqual([{ event: "token", data: "hello world", id: undefined }]);
  });

  it("ignores comments (lines starting with ':')", () => {
    const p = new SSEParser();
    const events = p.parse(": keep-alive\ndata: hi\n\n");
    expect(events).toEqual([{ event: "message", data: "hi", id: undefined }]);
  });

  it("strips one leading space from values", () => {
    const p = new SSEParser();
    const events = p.parse("data:  two spaces => keeps one\n\n");
    expect(events[0].data).toBe(" two spaces => keeps one");
  });

  it("treats CRLF and bare CR as line terminators", () => {
    const p = new SSEParser();
    // mix \r\n, \r, and \n terminators within a single event
    const events = p.parse("data: a\r\ndata: b\rdata: c\n\n");
    expect(events).toHaveLength(1);
    expect(events[0].data).toBe("a\nb\nc");
  });

  it("captures id field", () => {
    const p = new SSEParser();
    const events = p.parse("id: 42\ndata: hi\n\n");
    expect(events[0].id).toBe("42");
  });
});
