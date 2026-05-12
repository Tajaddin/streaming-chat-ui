// React hook wiring the reducer + the SSE transport.
//
// Exposes:
//   - state: ChatState
//   - send(prompt) — append a user message + open a streaming assistant message
//   - abort() — stop the current stream
//   - regenerate(fromUserMsgId) — drop everything after, then send again
//   - editStart/editChange/editCommit/editCancel
//   - regenerateLast() — convenience for the most-recent user turn
//
// The transport is injected via `endpoint`; the test suite supplies a fake.

import { useCallback, useReducer, useRef } from "react";
import { SSEParser } from "../lib/sseParser";
import {
  ChatAction,
  ChatState,
  Citation,
  initialState,
  reducer,
} from "../lib/chatState";

export interface UseStreamingChatOpts {
  endpoint: string;
  fetchFn?: typeof fetch;
  /** Test hook for deterministic ids. */
  idFactory?: () => string;
  /** Test hook for deterministic timestamps. */
  now?: () => number;
}

interface OpenStream {
  controller: AbortController;
  assistantId: string;
}

function defaultId(): string {
  // 9 chars of url-safe base36
  return Math.random().toString(36).slice(2, 11);
}

export function useStreamingChat(opts: UseStreamingChatOpts) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const streamRef = useRef<OpenStream | null>(null);
  const fetchFn = opts.fetchFn ?? fetch;
  const idFactory = opts.idFactory ?? defaultId;
  const now = opts.now ?? (() => Date.now());

  const _openStream = useCallback(
    async (messages: { role: "user" | "assistant"; content: string }[]) => {
      const assistantId = idFactory();
      const controller = new AbortController();
      streamRef.current = { controller, assistantId };
      dispatch({ type: "begin-stream", id: assistantId });

      try {
        const resp = await fetchFn(opts.endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages }),
          signal: controller.signal,
        });
        if (!resp.ok || !resp.body) {
          dispatch({
            type: "error",
            id: assistantId,
            tsMs: now(),
            message: `bad response: ${resp.status}`,
          });
          return;
        }

        const parser = new SSEParser();
        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          const events = parser.parse(decoder.decode(value, { stream: true }));
          for (const ev of events) {
            if (ev.event === "token" || ev.event === "message") {
              dispatch({
                type: "delta",
                id: assistantId,
                chunk: ev.data,
                tsMs: now(),
              });
            } else if (ev.event === "citation") {
              try {
                const c = JSON.parse(ev.data) as Citation;
                dispatch({ type: "citation", id: assistantId, citation: c });
              } catch {
                // ignore malformed citation payloads
              }
            } else if (ev.event === "done") {
              dispatch({ type: "complete", id: assistantId, tsMs: now() });
              streamRef.current = null;
              return;
            } else if (ev.event === "error") {
              dispatch({
                type: "error",
                id: assistantId,
                tsMs: now(),
                message: ev.data,
              });
              streamRef.current = null;
              return;
            }
          }
        }
        dispatch({ type: "complete", id: assistantId, tsMs: now() });
      } catch (err: any) {
        if (err?.name === "AbortError") {
          dispatch({ type: "abort", id: assistantId, tsMs: now() });
        } else {
          dispatch({
            type: "error",
            id: assistantId,
            tsMs: now(),
            message: String(err?.message ?? err),
          });
        }
      } finally {
        streamRef.current = null;
      }
    },
    [opts.endpoint, fetchFn, idFactory, now],
  );

  const send = useCallback(
    async (content: string) => {
      const userId = idFactory();
      dispatch({ type: "send-user", id: userId, content });
      const turns = [
        ...state.messages.map((m) => ({ role: m.role, content: m.content })),
        { role: "user" as const, content },
      ];
      await _openStream(turns);
    },
    [state.messages, _openStream, idFactory],
  );

  const abort = useCallback(() => {
    streamRef.current?.controller.abort();
  }, []);

  const regenerate = useCallback(
    async (lastUserMsgId: string) => {
      const idx = state.messages.findIndex((m) => m.id === lastUserMsgId);
      if (idx < 0) return;
      const userMsg = state.messages[idx];
      if (userMsg.role !== "user") return;
      dispatch({ type: "regenerate-from", id: lastUserMsgId });
      const turns = state.messages
        .slice(0, idx + 1)
        .map((m) => ({ role: m.role, content: m.content }));
      await _openStream(turns);
    },
    [state.messages, _openStream],
  );

  const regenerateLast = useCallback(async () => {
    const last = [...state.messages].reverse().find((m) => m.role === "user");
    if (last) await regenerate(last.id);
  }, [state.messages, regenerate]);

  const editStart = useCallback(
    (id: string) => dispatch({ type: "edit-start", id }),
    [],
  );
  const editChange = useCallback(
    (id: string, draft: string) => dispatch({ type: "edit-change", id, draft }),
    [],
  );
  const editCommit = useCallback(
    (id: string) => dispatch({ type: "edit-commit", id }),
    [],
  );
  const editCancel = useCallback(
    (id: string) => dispatch({ type: "edit-cancel", id }),
    [],
  );

  return {
    state,
    send,
    abort,
    regenerate,
    regenerateLast,
    editStart,
    editChange,
    editCommit,
    editCancel,
    dispatch,
  };
}
