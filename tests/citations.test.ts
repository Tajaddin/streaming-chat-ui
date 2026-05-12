import { describe, expect, it } from "vitest";
import { findMarkers, tokenize } from "../src/lib/citations";

describe("citations", () => {
  it("findMarkers returns empty for plain text", () => {
    expect(findMarkers("no citations here")).toEqual([]);
  });

  it("findMarkers finds multiple markers", () => {
    const m = findMarkers("see [^1] and also [^42] for context");
    expect(m.map((x) => x.label)).toEqual(["1", "42"]);
  });

  it("tokenize alternates text and cite spans", () => {
    const tokens = tokenize("hello [^1] world [^2]");
    expect(tokens).toEqual([
      { kind: "text", text: "hello " },
      { kind: "cite", label: "1" },
      { kind: "text", text: " world " },
      { kind: "cite", label: "2" },
    ]);
  });

  it("tokenize handles citations at the start", () => {
    const tokens = tokenize("[^1] said the agent");
    expect(tokens[0]).toEqual({ kind: "cite", label: "1" });
  });

  it("tokenize returns [] for empty input", () => {
    expect(tokenize("")).toEqual([]);
  });
});
