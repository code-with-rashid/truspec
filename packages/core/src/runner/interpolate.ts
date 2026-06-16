export type VarValue = string | number | boolean;
export type Vars = Record<string, VarValue>;

const VAR_RE = /\{\{\s*([\w.-]+)\s*\}\}/g;

export interface Interpolated {
  value: string;
  missing: string[];
}

/** Replace `{{name}}` templates in a string; report any names not found in `vars`. */
export function interpolate(input: string, vars: Vars): Interpolated {
  const missing: string[] = [];
  const value = input.replace(VAR_RE, (_match, name: string) => {
    // Own-property only: `{{toString}}`, `{{constructor}}`, `{{__proto__}}` etc. must
    // be treated as missing, not resolve to inherited Object.prototype members.
    const v = Object.prototype.hasOwnProperty.call(vars, name) ? vars[name] : undefined;
    if (v === undefined) {
      missing.push(name);
      return "";
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
export function interpolateDeep<T>(input: T, vars: Vars): { value: T; missing: string[] } {
  const missing: string[] = [];
  const seen = new WeakSet<object>();
  const walk = (node: unknown, depth: number): unknown => {
    if (typeof node === "string") {
      const r = interpolate(node, vars);
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
