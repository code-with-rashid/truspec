/**
 * A small, dependency-free JSONPath subset sufficient for assertions:
 *   $              root
 *   .key  ['key']  member access
 *   [n]            array index (negative counts from the end)
 *   [*]  .*        wildcard (all array elements / object values)
 *
 * Recursive descent (`..`) and filters are intentionally unsupported in v0.
 */

type Token =
  | { type: "key"; key: string }
  | { type: "index"; index: number }
  | { type: "wildcard" };

function tokenize(path: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = path.length;
  while (i < n) {
    const c = path[i];
    if (c === ".") {
      i++;
      if (path[i] === "*") {
        tokens.push({ type: "wildcard" });
        i++;
        continue;
      }
      let key = "";
      while (i < n) {
        const ch = path[i];
        if (ch !== undefined && /[\w-]/.test(ch)) {
          key += ch;
          i++;
        } else break;
      }
      if (key === "") throw new Error(`invalid path near index ${i}`);
      tokens.push({ type: "key", key });
    } else if (c === "[") {
      const end = path.indexOf("]", i);
      if (end === -1) throw new Error("unterminated '['");
      const inner = path.slice(i + 1, end).trim();
      if (inner === "*") {
        tokens.push({ type: "wildcard" });
      } else if (/^-?\d+$/.test(inner)) {
        tokens.push({ type: "index", index: Number.parseInt(inner, 10) });
      } else {
        const m = inner.match(/^['"](.*)['"]$/);
        if (!m || m[1] === undefined) throw new Error(`invalid segment [${inner}]`);
        tokens.push({ type: "key", key: m[1] });
      }
      i = end + 1;
    } else {
      throw new Error(`unexpected '${c}' at index ${i}`);
    }
  }
  return tokens;
}

/** Evaluate a JSONPath against a value, returning all matching nodes. */
export function jsonpath(root: unknown, path: string): unknown[] {
  if (!path.startsWith("$")) throw new Error(`path must start with '$': ${path}`);
  let current: unknown[] = [root];
  for (const tok of tokenize(path.slice(1))) {
    const next: unknown[] = [];
    for (const node of current) {
      if (tok.type === "key") {
        if (node && typeof node === "object" && !Array.isArray(node)) {
          const obj = node as Record<string, unknown>;
          if (Object.prototype.hasOwnProperty.call(obj, tok.key)) next.push(obj[tok.key]);
        }
      } else if (tok.type === "index") {
        if (Array.isArray(node)) {
          const idx = tok.index < 0 ? node.length + tok.index : tok.index;
          if (idx >= 0 && idx < node.length) next.push(node[idx]);
        }
      } else {
        if (Array.isArray(node)) next.push(...node);
        else if (node && typeof node === "object") next.push(...Object.values(node));
      }
    }
    current = next;
  }
  return current;
}
