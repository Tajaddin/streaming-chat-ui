// Incremental Server-Sent Events parser.
//
// Robust to chunk boundaries: feed any byte string via `parse`, get back zero
// or more complete events. The parser holds the leftover unfinished buffer
// between calls.
//
// Implements the relevant subset of the WHATWG SSE spec for chat-app usage:
// `event:`, `data:`, `id:` fields; comment lines (start with `:`) ignored;
// empty line dispatches the accumulated event.

export interface SSEEvent {
  /** The named event type. Default: "message". */
  event: string;
  /** The decoded data lines joined by "\n". */
  data: string;
  /** Optional last-event-id. */
  id?: string;
}

export class SSEParser {
  private buffer = "";
  private currentEvent = "message";
  private currentData: string[] = [];
  private currentId: string | undefined = undefined;

  /** Feed a chunk of decoded text, yield zero or more completed events. */
  parse(chunk: string): SSEEvent[] {
    this.buffer += chunk;
    const out: SSEEvent[] = [];

    while (true) {
      // Find the end of the next line. SSE accepts \r\n, \r, and \n.
      const idx = this._findLineEnd();
      if (idx === null) break;
      const line = this.buffer.slice(0, idx.end);
      const rawLine = line.replace(/\r\n$|\n$|\r$/, "");
      this.buffer = this.buffer.slice(idx.end);

      if (rawLine === "") {
        // empty line => dispatch
        if (this.currentData.length > 0 || this.currentId !== undefined) {
          out.push({
            event: this.currentEvent,
            data: this.currentData.join("\n"),
            id: this.currentId,
          });
        }
        this.currentEvent = "message";
        this.currentData = [];
        this.currentId = undefined;
        continue;
      }

      if (rawLine.startsWith(":")) {
        // comment, ignore
        continue;
      }

      const colon = rawLine.indexOf(":");
      const field = colon === -1 ? rawLine : rawLine.slice(0, colon);
      let value = colon === -1 ? "" : rawLine.slice(colon + 1);
      // Spec: if value starts with a single space, strip it.
      if (value.startsWith(" ")) value = value.slice(1);

      switch (field) {
        case "event":
          this.currentEvent = value;
          break;
        case "data":
          this.currentData.push(value);
          break;
        case "id":
          this.currentId = value;
          break;
        // ignore unrecognized fields (incl. "retry") per spec
      }
    }

    return out;
  }

  /** Pull any half-formed event still in the buffer (call at stream end). */
  flush(): SSEEvent[] {
    // The spec says "do not dispatch" on EOF unless a blank line was seen.
    // For chat UIs we'd rather lose a partial event than show a half-message.
    return [];
  }

  private _findLineEnd(): { end: number } | null {
    // Returns the byte index AFTER the line terminator, or null if no terminator yet.
    // Handles \n, \r, \r\n. We must wait if buffer ends in a bare \r — could be
    // half of \r\n.
    const b = this.buffer;
    for (let i = 0; i < b.length; i++) {
      const ch = b.charCodeAt(i);
      if (ch === 0x0a /* \n */) {
        return { end: i + 1 };
      }
      if (ch === 0x0d /* \r */) {
        if (i + 1 >= b.length) {
          // Could be half of \r\n — wait for more.
          return null;
        }
        if (b.charCodeAt(i + 1) === 0x0a) {
          return { end: i + 2 };
        }
        return { end: i + 1 };
      }
    }
    return null;
  }
}
