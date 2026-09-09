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
  | { kind: "form"; fields: Record<string, string> }
  | { kind: "multipart"; parts: MultipartPart[] };

export type MultipartPart =
  | { kind: "text"; name: string; value: string; contentType?: string }
  | { kind: "file"; name: string; path: string; filename?: string; contentType?: string };

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
    url: sendableUrl(eff.url),
    headers: { ...eff.headers },
    body: structuredBody(req, opts.vars ?? {}),
  };
}

/**
 * The URL as the request will actually be sent, not as it was typed.
 *
 * A snippet's whole promise is "run this and you get the same request". The runner never had to
 * keep that promise itself — it hands the authored URL to `fetch`, which normalizes it on the way
 * out — so a URL containing a character that is illegal in one (a space, most often from a
 * `{{var}}` that expanded to a value with one) worked when run and produced a snippet that did
 * not: `curl` rejects it outright with `URL rejected: Malformed input to a URL function`, and a
 * client that does encode it may not encode it the same way.
 *
 * Left verbatim in the two cases where normalizing would be wrong rather than right: a URL still
 * carrying a `{{placeholder}}` (whose braces are themselves illegal, and which a *reader* is meant
 * to fill in), and one that is not absolute (no base to resolve it against — the same thing the
 * runner passes through).
 */
function sendableUrl(url: string): string {
  if (url.includes("{{")) return url;
  try {
    return new URL(url).toString();
  } catch {
    return url;
  }
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
    case "multipart": {
      const parts: MultipartPart[] = [];
      for (const [name, field] of Object.entries(b.fields)) {
        if (typeof field !== "object" || field === null) {
          parts.push({ kind: "text", name, value: interpolate(String(field), vars, keep).value });
        } else if ("file" in field) {
          parts.push({
            kind: "file",
            name,
            path: interpolate(field.file, vars, keep).value,
            ...(field.filename ? { filename: field.filename } : {}),
            ...(field.contentType ? { contentType: field.contentType } : {}),
          });
        } else {
          parts.push({
            kind: "text",
            name,
            value: interpolate(field.text, vars, keep).value,
            ...(field.contentType ? { contentType: field.contentType } : {}),
          });
        }
      }
      return { kind: "multipart", parts };
    }
    default:
      return undefined;
  }
}
