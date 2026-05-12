// Pure-function chat state reducer.
//
// One source of truth for message lifecycle. The React hook calls this
// reducer; tests call it directly without any DOM or networking.
//
// Lifecycle (status field):
//   - idle: user is composing a new turn
//   - streaming: model is producing tokens
//   - complete: model finished cleanly
//   - error: model or transport raised
//   - aborted: user clicked stop mid-stream

export type MessageStatus =
  | "idle"
  | "streaming"
  | "complete"
  | "error"
  | "aborted";

export interface Citation {
  /** Display label e.g. "1" for [^1] markers. */
  label: string;
  /** Stable identifier the backend assigned (typically a chunk id). */
  id: string;
  /** Optional URL or document path. */
  href?: string;
  /** Optional snippet of text to show on hover. */
  snippet?: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** Pending edit buffer when the user clicks edit on this message. */
  draft?: string;
  status: MessageStatus;
  citations: Citation[];
  /** ISO timestamp of creation. */
  createdAt: string;
  /** Set on the first delta of a streaming assistant message. */
  firstByteAtMs?: number;
  /** Set when status moves to complete / aborted / error. */
  finishedAtMs?: number;
  errorMessage?: string;
}

export interface ChatState {
  messages: ChatMessage[];
  /** id of the assistant message currently being streamed, if any */
  streamingId: string | null;
}

export const initialState: ChatState = { messages: [], streamingId: null };

export type ChatAction =
  | { type: "send-user"; id: string; content: string }
  | { type: "begin-stream"; id: string }
  | { type: "delta"; id: string; chunk: string; tsMs: number }
  | { type: "citation"; id: string; citation: Citation }
  | { type: "complete"; id: string; tsMs: number }
  | { type: "error"; id: string; tsMs: number; message: string }
  | { type: "abort"; id: string; tsMs: number }
  | { type: "edit-start"; id: string }
  | { type: "edit-change"; id: string; draft: string }
  | { type: "edit-commit"; id: string }
  | { type: "edit-cancel"; id: string }
  | { type: "regenerate-from"; id: string };

function mapMsg(s: ChatState, id: string, f: (m: ChatMessage) => ChatMessage): ChatState {
  return { ...s, messages: s.messages.map((m) => (m.id === id ? f(m) : m)) };
}

export function reducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "send-user":
      return {
        ...state,
        messages: [
          ...state.messages,
          {
            id: action.id,
            role: "user",
            content: action.content,
            status: "complete",
            citations: [],
            createdAt: new Date().toISOString(),
          },
        ],
      };
    case "begin-stream": {
      const msg: ChatMessage = {
        id: action.id,
        role: "assistant",
        content: "",
        status: "streaming",
        citations: [],
        createdAt: new Date().toISOString(),
      };
      return {
        ...state,
        streamingId: action.id,
        messages: [...state.messages, msg],
      };
    }
    case "delta":
      return mapMsg(state, action.id, (m) => ({
        ...m,
        content: m.content + action.chunk,
        firstByteAtMs: m.firstByteAtMs ?? action.tsMs,
      }));
    case "citation":
      return mapMsg(state, action.id, (m) => {
        // de-dupe by id
        if (m.citations.some((c) => c.id === action.citation.id)) return m;
        return { ...m, citations: [...m.citations, action.citation] };
      });
    case "complete":
      return {
        ...state,
        streamingId: state.streamingId === action.id ? null : state.streamingId,
        messages: state.messages.map((m) =>
          m.id === action.id
            ? { ...m, status: "complete", finishedAtMs: action.tsMs }
            : m,
        ),
      };
    case "abort":
      return {
        ...state,
        streamingId: state.streamingId === action.id ? null : state.streamingId,
        messages: state.messages.map((m) =>
          m.id === action.id
            ? { ...m, status: "aborted", finishedAtMs: action.tsMs }
            : m,
        ),
      };
    case "error":
      return {
        ...state,
        streamingId: state.streamingId === action.id ? null : state.streamingId,
        messages: state.messages.map((m) =>
          m.id === action.id
            ? {
                ...m,
                status: "error",
                finishedAtMs: action.tsMs,
                errorMessage: action.message,
              }
            : m,
        ),
      };
    case "edit-start":
      return mapMsg(state, action.id, (m) => ({ ...m, draft: m.content }));
    case "edit-change":
      return mapMsg(state, action.id, (m) => ({ ...m, draft: action.draft }));
    case "edit-commit":
      return mapMsg(state, action.id, (m) => {
        if (m.draft === undefined) return m;
        return { ...m, content: m.draft, draft: undefined };
      });
    case "edit-cancel":
      return mapMsg(state, action.id, (m) => ({ ...m, draft: undefined }));
    case "regenerate-from": {
      // Drop every message AFTER (and including) the assistant turn that
      // followed `id`. Caller is expected to send a new prompt next.
      const idx = state.messages.findIndex((m) => m.id === action.id);
      if (idx < 0) return state;
      // Keep everything up to & including `id`, drop after.
      return {
        ...state,
        streamingId: null,
        messages: state.messages.slice(0, idx + 1),
      };
    }
    default:
      return state;
  }
}

/** Helper: time-to-first-byte for an assistant message, in ms (or null). */
export function ttfbMs(m: ChatMessage, sentAtMs: number): number | null {
  if (m.role !== "assistant" || m.firstByteAtMs === undefined) return null;
  return m.firstByteAtMs - sentAtMs;
}
