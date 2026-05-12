import { Chat } from "./components/Chat";

export default function App() {
  return (
    <main style={{ maxWidth: 720, margin: "2rem auto", fontFamily: "system-ui, sans-serif" }}>
      <h1>streaming-chat-ui</h1>
      <p style={{ color: "#666" }}>
        SSE chat with citations, streaming markdown, abort, regenerate, and message editing.
      </p>
      <Chat endpoint="/api/chat" />
    </main>
  );
}
