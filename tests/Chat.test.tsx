import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Chat } from "../src/components/Chat";

function sseResponse(stream: string): Response {
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(stream));
      controller.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Chat citations", () => {
  it("links only http(s) citations", async () => {
    const stream =
      "event: token\ndata: see [^1] and [^2]\n\n" +
      'event: citation\ndata: {"label":"1","id":"evil","href":"javascript:alert(1)"}\n\n' +
      'event: citation\ndata: {"label":"2","id":"doc","href":"https://example.com/doc"}\n\n' +
      "event: done\ndata: \n\n";
    vi.stubGlobal("fetch", vi.fn(async () => sseResponse(stream)));

    const { container } = render(<Chat endpoint="/api" />);
    fireEvent.change(screen.getByPlaceholderText("ask anything"), {
      target: { value: "q" },
    });
    fireEvent.submit(container.querySelector("form")!);

    await waitFor(() => expect(screen.getByText("[2]")).toBeInTheDocument());
    const links = Array.from(container.querySelectorAll("a"));
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["https://example.com/doc"]);
    expect(screen.getByText("[1]").closest("a")).toBeNull();
    expect(screen.getByText("[1]").closest("[title]")).toHaveAttribute("title", "evil");
  });
});
