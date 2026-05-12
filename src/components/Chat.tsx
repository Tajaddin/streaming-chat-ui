import { useState } from "react";
import { useStreamingChat } from "../hooks/useStreamingChat";
import { ChatMessage } from "../lib/chatState";
import { renderMarkdown } from "../lib/markdown";
import { tokenize } from "../lib/citations";

interface CitationLinkProps {
  label: string;
  msg: ChatMessage;
}

function CitationLink({ label, msg }: CitationLinkProps) {
  const c = msg.citations.find((x) => x.label === label);
  if (!c) return <sup className="cite cite-missing">[{label}]</sup>;
  return (
    <a
      className="cite"
      href={c.href ?? "#"}
      target={c.href ? "_blank" : undefined}
      rel="noreferrer"
      title={c.snippet ?? c.id}
    >
      <sup>[{label}]</sup>
    </a>
  );
}

function MessageBody({ msg }: { msg: ChatMessage }) {
  const tokens = tokenize(msg.content);
  return (
    <>
      {tokens.map((tk, i) =>
        tk.kind === "text" ? (
          <span
            key={i}
            // we trust renderMarkdown's escaping (no HTML pass-through)
            dangerouslySetInnerHTML={{ __html: renderMarkdown(tk.text) }}
          />
        ) : (
          <CitationLink key={i} label={tk.label} msg={msg} />
        ),
      )}
    </>
  );
}

interface ChatProps {
  endpoint?: string;
}

export function Chat({ endpoint = "/api/chat" }: ChatProps) {
  const chat = useStreamingChat({ endpoint });
  const [input, setInput] = useState("");
  const streaming = chat.state.streamingId !== null;

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const v = input.trim();
    if (!v) return;
    setInput("");
    void chat.send(v);
  }

  return (
    <div className="chat">
      <div className="chat-log">
        {chat.state.messages.map((m) => (
          <div key={m.id} className={`chat-msg chat-msg-${m.role}`}>
            <div className="chat-role">{m.role}</div>
            {m.draft !== undefined ? (
              <div className="chat-edit">
                <textarea
                  value={m.draft}
                  onChange={(e) => chat.editChange(m.id, e.target.value)}
                  rows={Math.min(8, Math.max(2, m.draft.split("\n").length))}
                />
                <button onClick={() => chat.editCommit(m.id)}>save</button>
                <button onClick={() => chat.editCancel(m.id)}>cancel</button>
              </div>
            ) : (
              <div className="chat-body">
                <MessageBody msg={m} />
                {m.status === "streaming" && <span className="cursor">▍</span>}
                {m.status === "error" && (
                  <span className="err"> [error: {m.errorMessage}]</span>
                )}
                {m.status === "aborted" && <span className="aborted"> [aborted]</span>}
              </div>
            )}
            {m.role === "user" && m.draft === undefined && (
              <div className="chat-actions">
                <button onClick={() => chat.editStart(m.id)}>edit</button>
                <button onClick={() => chat.regenerate(m.id)} disabled={streaming}>
                  regenerate
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
      <form className="chat-input" onSubmit={onSubmit}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={streaming ? "streaming..." : "ask anything"}
          disabled={streaming}
        />
        {streaming ? (
          <button type="button" onClick={() => chat.abort()}>
            stop
          </button>
        ) : (
          <button type="submit" disabled={!input.trim()}>
            send
          </button>
        )}
      </form>
    </div>
  );
}
