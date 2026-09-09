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

/** Apply one token to a set of nodes. Shared so an explanation walks exactly what evaluation did. */
function step(nodes: readonly unknown[], tok: Token): unknown[] {
  const next: unknown[] = [];
  for (const node of nodes) {
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
  return next;
}

/** Evaluate a JSONPath against a value, returning all matching nodes. */
export function jsonpath(root: unknown, path: string): unknown[] {
  if (!path.startsWith("$")) throw new Error(`path must start with '$': ${path}`);
  let current: unknown[] = [root];
  for (const tok of tokenize(path.slice(1))) current = step(current, tok);
  return current;
}

/** How a token reads when rebuilding the prefix of a path that did resolve. */
function renderToken(tok: Token): string {
  if (tok.type === "key") return `.${tok.key}`;
  if (tok.type === "index") return `[${tok.index}]`;
  return "[*]";
}

function typeName(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "an array";
  if (typeof v === "object") return "an object";
  return `a ${typeof v}`;
}

/** At most `limit` of an object's keys, for a "did you mean one of these" hint. */
function keyHint(obj: Record<string, unknown>, limit = 5): string {
  const keys = Object.keys(obj);
  if (keys.length === 0) return "it has no keys";
  const shown = keys.slice(0, limit).join(", ");
  return `keys: ${shown}${keys.length > limit ? `, …${keys.length - limit} more` : ""}`;
}

/**
 * Why a path selected nothing.
 *
 * "(no match)" is true and useless: it does not say whether the field is absent, its parent is
 * absent, the body was not JSON at all, or an index ran off the end of an array — so the next step
 * is always to go and read the body by hand. This walks the same steps evaluation did and reports
 * the first one that came up empty, naming what *was* there.
 *
 * Returns `undefined` when the path actually matches, or when the path does not parse.
 */
export function explainJsonPathMiss(root: unknown, path: string): string | undefined {
  if (root === undefined) return "the response body is not JSON";
  if (!path.startsWith("$")) return undefined;
  let tokens: Token[];
  try {
    tokens = tokenize(path.slice(1));
  } catch {
    return undefined;
  }
  let current: unknown[] = [root];
  let prefix = "$";
  for (const tok of tokens) {
    const next = step(current, tok);
    if (next.length === 0) return describeMiss(current, tok, prefix);
    current = next;
    prefix += renderToken(tok);
  }
  return undefined;
}

function describeMiss(nodes: readonly unknown[], tok: Token, prefix: string): string {
  // After a wildcard there can be many candidates; naming one of them would be a guess.
  if (nodes.length !== 1) {
    if (tok.type === "key") return `no element of ${prefix} has "${tok.key}"`;
    if (tok.type === "index") return `no element of ${prefix} has an item at [${tok.index}]`;
    return `every element of ${prefix} is empty`;
  }
  const node = nodes[0];
  if (tok.type === "key") {
    if (node && typeof node === "object" && !Array.isArray(node)) {
      return `${prefix} has no "${tok.key}"; ${keyHint(node as Record<string, unknown>)}`;
    }
    if (Array.isArray(node)) return `${prefix} is an array — index it with [n] or [*]`;
    return `${prefix} is ${typeName(node)}, not an object`;
  }
  if (tok.type === "index") {
    if (Array.isArray(node)) {
      return node.length === 0 ? `${prefix} is empty` : `${prefix} has ${node.length} item(s)`;
    }
    return `${prefix} is ${typeName(node)}, not an array`;
  }
  return `${prefix} is empty`;
}
