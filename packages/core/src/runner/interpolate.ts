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
    const v = vars[name];
    if (v === undefined) {
      missing.push(name);
      return "";
    }
    return String(v);
  });
  return { value, missing };
}

/** Recursively interpolate every string in an object/array, collecting missing names. */
export function interpolateDeep<T>(input: T, vars: Vars): { value: T; missing: string[] } {
  const missing: string[] = [];
  const seen = new WeakSet<object>();
  const walk = (node: unknown): unknown => {
    if (typeof node === "string") {
      const r = interpolate(node, vars);
      missing.push(...r.missing);
      return r.value;
    }
    if (node && typeof node === "object") {
      if (seen.has(node)) return node; // break reference cycles (e.g. YAML self-anchors)
      seen.add(node);
      const result = Array.isArray(node)
        ? node.map(walk)
        : Object.fromEntries(Object.entries(node).map(([k, v]) => [k, walk(v)]));
      seen.delete(node);
      return result;
    }
    return node;
  };
  return { value: walk(input) as T, missing: Array.from(new Set(missing)) };
}
