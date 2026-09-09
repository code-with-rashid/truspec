export type VarValue = string | number | boolean;
export type Vars = Record<string, VarValue>;

const VAR_RE = /\{\{\s*([\w.-]+)\s*\}\}/g;

export interface Interpolated {
  value: string;
  missing: string[];
}

/**
 * What to substitute for a `{{name}}` with no value.
 *
 * - `"empty"` (default) — drop it, as the runner does: an unresolved variable is a hard
 *   error there, so the substituted text never reaches the wire.
 * - `"keep"` — leave the `{{name}}` placeholder in place. Used by consumers that render a
 *   request for a human (code generation, previews) where showing the authored placeholder
 *   is more useful than showing a hole.
 */
export type MissingPolicy = "empty" | "keep";

export interface InterpolateOptions {
  onMissing?: MissingPolicy;
  /**
   * Substitute the variable's own type, not its text, when a string is *exactly* one template.
   *
   * Only for bodies that are serialized as JSON. `"{{qty}}"` with `qty` the number `2` sends `2`;
   * `"id-{{qty}}"` still sends the string `"id-2"`, because concatenation is a string operation.
   * Without this a data-driven run can only ever send strings — and the environment schema, which
   * declares variables as `string | number | boolean`, and `capture`, which stores typed JSON,
   * both say types were meant to survive.
   */
  typed?: boolean;
}

/** A string that is one template and nothing else — the only case where a type can be preserved. */
const EXACT_VAR_RE = /^\{\{\s*([\w.-]+)\s*\}\}$/;

/** Replace `{{name}}` templates in a string; report any names not found in `vars`. */
export function interpolate(input: string, vars: Vars, opts: InterpolateOptions = {}): Interpolated {
  const missing: string[] = [];
  const value = input.replace(VAR_RE, (match, name: string) => {
    // Own-property only: `{{toString}}`, `{{constructor}}`, `{{__proto__}}` etc. must
    // be treated as missing, not resolve to inherited Object.prototype members.
    const v = Object.prototype.hasOwnProperty.call(vars, name) ? vars[name] : undefined;
    if (v === undefined) {
      missing.push(name);
      return opts.onMissing === "keep" ? String(match) : "";
    }
    return String(v);
  });
  return { value, missing };
}

/**
 * Max object/array nesting `interpolateDeep` will descend. Real request bodies are
 * a handful of levels deep; a structure beyond this is pathological (or hostile
 * imported input) and would otherwise stack-overflow here — and again in the
 * downstream `JSON.stringify`. We throw *before* that, well under the engine's limit.
 */
const MAX_DEPTH = 256;

/** Recursively interpolate every string in an object/array, collecting missing names. */
export function interpolateDeep<T>(
  input: T,
  vars: Vars,
  opts: InterpolateOptions = {},
): { value: T; missing: string[] } {
  const missing: string[] = [];
  const seen = new WeakSet<object>();
  const walk = (node: unknown, depth: number): unknown => {
    if (typeof node === "string") {
      const exact = opts.typed ? EXACT_VAR_RE.exec(node) : null;
      if (exact) {
        const name = exact[1] as string;
        if (Object.prototype.hasOwnProperty.call(vars, name)) {
          const v = vars[name];
          if (v !== undefined) return v; // number/boolean keep their type; a string is unchanged
        }
        missing.push(name);
        return opts.onMissing === "keep" ? node : "";
      }
      const r = interpolate(node, vars, opts);
      missing.push(...r.missing);
      return r.value;
    }
    if (node && typeof node === "object") {
      if (depth > MAX_DEPTH) throw new Error(`structure nested too deeply (> ${MAX_DEPTH} levels)`);
      if (seen.has(node)) return node; // break reference cycles (e.g. YAML self-anchors)
      seen.add(node);
      const result = Array.isArray(node)
        ? node.map((v) => walk(v, depth + 1))
        : Object.fromEntries(Object.entries(node).map(([k, v]) => [k, walk(v, depth + 1)]));
      seen.delete(node);
      return result;
    }
    return node;
  };
  return { value: walk(input, 0) as T, missing: Array.from(new Set(missing)) };
}
