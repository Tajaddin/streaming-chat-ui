import { describe, expect, it } from "vitest";
import { findMarkers, safeHref, tokenize } from "../src/lib/citations";

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

  it("safeHref keeps absolute http and https URLs", () => {
    expect(safeHref("https://example.com/doc?x=1")).toBe("https://example.com/doc?x=1");
    expect(safeHref("http://example.com")).toBe("http://example.com/");
  });

  it("safeHref drops script, data and other schemes", () => {
    for (const href of [
      "javascript:alert(1)",
      " JaVaScRiPt:alert(1)",
      "java\tscript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "vbscript:msgbox(1)",
      "file:///etc/passwd",
    ]) {
      expect(safeHref(href)).toBeUndefined();
    }
  });

  it("safeHref drops relative paths and missing values", () => {
    expect(safeHref("docs/a.md")).toBeUndefined();
    expect(safeHref("")).toBeUndefined();
    expect(safeHref(undefined)).toBeUndefined();
  });
});
