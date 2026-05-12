import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../src/lib/markdown";

describe("renderMarkdown", () => {
  it("escapes HTML in input", () => {
    expect(renderMarkdown("<script>x</script>")).toContain("&lt;script&gt;");
  });

  it("renders **bold**", () => {
    expect(renderMarkdown("hello **world**")).toContain("<strong>world</strong>");
  });

  it("renders *italic*", () => {
    expect(renderMarkdown("an *italic* word")).toContain("<em>italic</em>");
  });

  it("renders `inline code`", () => {
    expect(renderMarkdown("use `npm` here")).toContain("<code>npm</code>");
  });

  it("renders ```code fences```", () => {
    const html = renderMarkdown("```\nprint('x')\n```");
    expect(html).toContain('<pre class="code-block"');
    expect(html).toContain("print(&#39;x&#39;)");
  });

  it("treats unclosed code fence as streaming code block", () => {
    const html = renderMarkdown("```\nstill typing");
    expect(html).toContain('class="code-block streaming"');
  });

  it("renders paragraphs separated by a blank line", () => {
    const html = renderMarkdown("first\n\nsecond");
    const paras = html.match(/<p>/g) ?? [];
    expect(paras.length).toBe(2);
  });
});
