import { parseDocument } from "yaml";

/**
 * Resolve a dotted field path — `headers.X-Api-Key`, `auth.token`, `body.content.name` — to the
 * 1-based line it sits on in the source YAML.
 *
 * A finding that names a field and no line leaves the reader scrolling: in an editor, in a CI log,
 * and worst of all in a review, where the finding and the code are in two different windows.
 *
 * Walks the *longest resolvable prefix*, so a path the document does not literally contain still
 * points at its nearest ancestor rather than nowhere — which is both more useful and more honest
 * than guessing at an exact position.
 */
export function locator(text: string): (path: string) => number | undefined {
  let doc: ReturnType<typeof parseDocument> | undefined;
  try {
    doc = parseDocument(text, { keepSourceTokens: false });
  } catch {
    return () => undefined;
  }
  const lineAt = lineIndex(text);

  return (path: string): number | undefined => {
    if (doc === undefined || doc.errors.length > 0) return undefined;
    const segments = splitPath(path);
    let offset: number | undefined;
    for (let take = segments.length; take > 0; take--) {
      const node = doc.getIn(segments.slice(0, take), true) as { range?: [number, number, number] } | undefined;
      const start = node?.range?.[0];
      if (typeof start === "number") {
        offset = start;
        break;
      }
    }
    return offset === undefined ? undefined : lineAt(offset);
  };
}

/**
 * `headers.X-Api-Key` -> ["headers", "X-Api-Key"]; `body[0].id` -> ["body", 0, "id"].
 *
 * A `url?param` suffix (a credential written into a query string) addresses the URL itself, since
 * that is the field the file actually has.
 */
function splitPath(path: string): Array<string | number> {
  const base = path.split("?")[0] ?? path;
  const out: Array<string | number> = [];
  for (const part of base.split(".")) {
    const m = /^([^[\]]*)((?:\[\d+\])*)$/.exec(part);
    if (!m) {
      out.push(part);
      continue;
    }
    if (m[1]) out.push(m[1]);
    for (const idx of m[2]?.match(/\d+/g) ?? []) out.push(Number(idx));
  }
  return out;
}

/** A byte offset -> 1-based line lookup over the document. */
function lineIndex(text: string): (offset: number) => number {
  const starts: number[] = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") starts.push(i + 1);
  return (offset: number): number => {
    // Binary search for the last line starting at or before `offset`.
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if ((starts[mid] ?? 0) <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
}

/** The first line whose text contains `needle`, for findings that are about a value, not a field. */
export function lineContaining(text: string, needle: string): number | undefined {
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) if (lines[i]?.includes(needle)) return i + 1;
  return undefined;
}
