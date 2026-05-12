// Minimal streaming-safe markdown renderer for chat.
//
// We deliberately handle a small subset that's correct under partial input:
//   - ```code blocks``` (treat unclosed fences as still-open)
//   - **bold** and *italic*
//   - `inline code`
//   - line breaks (single \n => <br>, blank line => paragraph break)
//
// We escape HTML before any markup is applied. NO links, NO HTML pass-through.
// For citations we expect `[^N]` markers which the renderer leaves alone —
// they're handled by the citation layer.

const ESC: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escape(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ESC[c]);
}

function renderInline(s: string): string {
  // inline code first so its content is left alone
  s = s.replace(/`([^`]+)`/g, (_m, body) => `<code>${escape(body)}</code>`);
  // bold
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  // italic (single * but not ** which is already consumed)
  s = s.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");
  return s;
}

export function renderMarkdown(input: string): string {
  // Split into top-level blocks. Streaming-safe: an unclosed ``` becomes a
  // "still-streaming" code block; we render it as a normal pre block.
  const out: string[] = [];
  let i = 0;
  const lines = input.split("\n");
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith("```")) {
      // collect until closing fence or EOF
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        body.push(lines[i]);
        i++;
      }
      const closed = i < lines.length;
      if (closed) i++;
      const inner = escape(body.join("\n"));
      out.push(
        `<pre class="code-block${closed ? "" : " streaming"}"><code>${inner}</code></pre>`,
      );
      continue;
    }
    if (line.trim() === "") {
      out.push("");
      i++;
      continue;
    }
    // paragraph: collect contiguous non-blank, non-fence lines
    const para: string[] = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !lines[i].startsWith("```")
    ) {
      para.push(lines[i]);
      i++;
    }
    const inner = renderInline(escape(para.join("\n"))).replace(/\n/g, "<br>");
    out.push(`<p>${inner}</p>`);
  }
  return out.filter((s) => s !== "").join("\n");
}
