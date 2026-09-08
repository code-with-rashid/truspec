import type { TruSpecFolderConfig, TruSpecRequest } from "../format/types";
import { interpolate, interpolateDeep, type Vars } from "../runner/interpolate";
import { resolveRequest } from "../runner/resolve";

/**
 * The normalized HTTP request every code generator renders from. It keeps the body
 * *structured* (rather than the runner's serialized string) so a generator can emit the
 * idiomatic form for its language — `json=` in python-requests, a form dict in Ruby — instead
 * of a pre-stringified blob every target has to re-quote.
 */
export interface HttpShape {
  method: string;
  /** Absolute (or authored-relative) URL including the query string. */
  url: string;
  headers: Record<string, string>;
  body?: CodegenBody;
}

export type CodegenBody =
  | { kind: "json"; value: unknown }
  | { kind: "text"; text: string }
  | { kind: "form"; fields: Record<string, string> };

export interface ShapeOptions {
  folder?: TruSpecFolderConfig;
  vars?: Vars;
}

/**
 * Build the shape for a request. Unresolved `{{vars}}` are kept verbatim: a snippet is read by
 * a human, and the authored placeholder tells them what to fill in — an empty string would not.
 */
export function toHttpShape(req: TruSpecRequest, opts: ShapeOptions = {}): HttpShape {
  const eff = resolveRequest(req, { folder: opts.folder, vars: opts.vars, onMissing: "keep" });
  return {
    method: eff.method,
    url: eff.url,
    headers: { ...eff.headers },
    body: structuredBody(req, opts.vars ?? {}),
  };
}

/** Re-derive the body in structured form (the runner's `EffectiveRequest.body` is already a string). */
function structuredBody(req: TruSpecRequest, vars: Vars): CodegenBody | undefined {
  const b = req.body;
  const keep = { onMissing: "keep" } as const;
  switch (b?.type) {
    case "json":
      return { kind: "json", value: interpolateDeep(b.content, vars, keep).value };
    case "graphql": {
      const query = interpolate(b.query, vars, keep).value;
      const variables = b.variables ? interpolateDeep(b.variables, vars, keep).value : undefined;
      return { kind: "json", value: variables ? { query, variables } : { query } };
    }
    case "text":
      return { kind: "text", text: interpolate(b.content, vars, keep).value };
    case "form": {
      const fields: Record<string, string> = {};
      for (const [k, v] of Object.entries(interpolateDeep(b.content, vars, keep).value)) {
        fields[k] = String(v);
      }
      return { kind: "form", fields };
    }
    default:
      return undefined;
  }
}
