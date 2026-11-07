// Extract / render citation markers in assistant text.
//
// We use the `[^1]` footnote style. The model is asked to wrap citation
// indexes in `[^N]` and the gateway emits one structured citation event per
// `N`.  This module isolates the markup so the renderer can render the
// number as a superscript link instead of literal `[^1]`.

export interface CitationMarker {
  /** position in the text where the marker starts */
  start: number;
  /** position immediately after the marker */
  end: number;
  /** the citation index, e.g. "1" for [^1] */
  label: string;
}

const MARKER_RE = /\[\^(\d+)\]/g;

export function findMarkers(text: string): CitationMarker[] {
  const out: CitationMarker[] = [];
  let m: RegExpExecArray | null;
  MARKER_RE.lastIndex = 0;
  while ((m = MARKER_RE.exec(text))) {
    out.push({ start: m.index, end: m.index + m[0].length, label: m[1] });
  }
  return out;
}

/** Split text into alternating plain and citation tokens, in order. */
export type CitationSpan =
  | { kind: "text"; text: string }
  | { kind: "cite"; label: string };

export function tokenize(text: string): CitationSpan[] {
  const markers = findMarkers(text);
  if (markers.length === 0) return text ? [{ kind: "text", text }] : [];
  const out: CitationSpan[] = [];
  let cursor = 0;
  for (const m of markers) {
    if (m.start > cursor) out.push({ kind: "text", text: text.slice(cursor, m.start) });
    out.push({ kind: "cite", label: m.label });
    cursor = m.end;
  }
  if (cursor < text.length) out.push({ kind: "text", text: text.slice(cursor) });
  return out;
}

/** The citation URL if it is an absolute http(s) URL, otherwise undefined. */
export function safeHref(href: string | undefined): string | undefined {
  if (!href) return undefined;
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return undefined;
  }
  return url.protocol === "http:" || url.protocol === "https:" ? url.href : undefined;
}
