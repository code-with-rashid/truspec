import { SCHEMA_VERSION } from "../format/schema";
import type { TruSpecAssertion, TruSpecAuth, TruSpecBody, TruSpecMethod, TruSpecRequest } from "../format/types";
import { normalizeMethod, portedScript } from "./types";

interface Block {
  name: string;
  sub?: string;
  body: string;
}

const HTTP_VERBS = new Set(["get", "post", "put", "patch", "delete", "head", "options"]);

/** Split a `.bru` document into top-level brace blocks (brace-depth aware). */
export function extractBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  let i = 0;
  const n = text.length;
  while (i < n) {
    while (i < n && /\s/.test(text[i] ?? "")) i++;
    if (i >= n) break;
    const headerStart = i;
    while (i < n && text[i] !== "{") i++;
    if (i >= n) break;
    const header = text.slice(headerStart, i).trim();
    let depth = 0;
    const bodyStart = i + 1;
    for (; i < n; i++) {
      const c = text[i];
      if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        if (depth === 0) break;
      }
    }
    const body = text.slice(bodyStart, i);
    i++; // consume closing brace
    const colon = header.indexOf(":");
    blocks.push(
      colon === -1
        ? { name: header.trim(), body }
        : { name: header.slice(0, colon).trim(), sub: header.slice(colon + 1).trim(), body },
    );
  }
  return blocks;
}

/**
 * The `key: value` lines of a block, in order and **keeping duplicates**.
 *
 * An assert block routinely constrains the same thing twice — `res.status: gte 200` and
 * `res.status: lt 300`, or two checks on one body path. Collapsing them into a map kept only the
 * last, so the import quietly halved what the request checked.
 */
function kvPairs(body: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const line of body.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("//") || t.startsWith("~")) continue;
    const idx = t.indexOf(":");
    if (idx === -1) continue;
    out.push([t.slice(0, idx).trim(), t.slice(idx + 1).trim()]);
  }
  return out;
}

/** The same lines as a map, for blocks where a repeated key is a conflict rather than a second check. */
function kvLines(body: string): Map<string, string> {
  return new Map(kvPairs(body));
}

function coerce(value: string): string | number | boolean | null {
  const v = value.trim().replace(/^['"]|['"]$/g, "");
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  if (v === "true") return true;
  if (v === "false") return false;
  // `res.body.id: neq null` means the JSON null, not the four-character string; importing it as
  // the string produced an assertion that passes against a body whose field really is null.
  if (v === "null") return null;
  return v;
}

/**
 * Bruno's `res.body.<path>` operators that TruSpec expresses directly on a `jsonpath` assertion.
 *
 * Every one of these left unconverted is a check the collection had and the import silently
 * doesn't — the request still runs, and passes, having stopped testing what it tested in Bruno.
 */
const JSONPATH_OPS: Record<string, (v: string) => Record<string, unknown>> = {
  eq: (v) => ({ equals: coerce(v) }),
  neq: (v) => ({ notEquals: coerce(v) }),
  gt: (v) => ({ gt: Number(coerce(v)) }),
  gte: (v) => ({ gte: Number(coerce(v)) }),
  lt: (v) => ({ lt: Number(coerce(v)) }),
  lte: (v) => ({ lte: Number(coerce(v)) }),
  contains: (v) => ({ contains: String(coerce(v)) }),
  matches: (v) => ({ matches: v.trim() }),
  length: (v) => ({ length: Number(coerce(v)) }),
};

/** Operators that take no right-hand side. */
const JSONPATH_UNARY: Record<string, Record<string, unknown>> = {
  isDefined: { exists: true },
  isUndefined: { exists: false },
  isNull: { equals: null },
  isEmpty: { empty: true },
  isNotEmpty: { empty: false },
  isTruthy: { exists: true },
  isString: { valueType: "string" },
  isNumber: { valueType: "number" },
  isBoolean: { valueType: "boolean" },
  isArray: { valueType: "array" },
};

function convertAssert(body: string, warnings: string[]): TruSpecAssertion[] {
  const out: TruSpecAssertion[] = [];
  for (const [lhs, expr] of kvPairs(body)) {
    const [rawOp, ...rest] = expr.split(/\s+/);
    const value = rest.join(" ");
    const op = rawOp ?? "";
    if (lhs === "res.status") {
      const num = Number(coerce(value));
      if (op === "eq") out.push({ type: "status", equals: num });
      else if (op === "gte") out.push({ type: "status", gte: num });
      else if (op === "lt") out.push({ type: "status", lt: num });
      else warnings.push(`assert "${lhs} ${op}" not converted`);
    } else if (lhs === "res.responseTime") {
      // TruSpec has an exact equivalent; leaving it out drops a latency check the author wrote.
      if (op === "lt" || op === "lte") out.push({ type: "duration", ltMs: Number(coerce(value)) });
      else warnings.push(`assert "${lhs} ${op}" not converted`);
    } else if (lhs.startsWith("res.body")) {
      const path = `$${lhs.slice("res.body".length)}`;
      const unary = JSONPATH_UNARY[op];
      const binary = JSONPATH_OPS[op];
      if (unary) out.push({ type: "jsonpath", path, ...unary } as TruSpecAssertion);
      else if (binary) out.push({ type: "jsonpath", path, ...binary(value) } as TruSpecAssertion);
      else warnings.push(`assert "${lhs} ${op}" not converted`);
    } else if (lhs.startsWith("res.headers[")) {
      const header = lhs.slice("res.headers[".length).replace(/\]$/, "").replace(/^['"]|['"]$/g, "");
      if (op === "eq") out.push({ type: "header", name: header, equals: String(coerce(value)) });
      else if (op === "contains") out.push({ type: "header", name: header, contains: String(coerce(value)) });
      else if (op === "isDefined") out.push({ type: "header", name: header, exists: true });
      else warnings.push(`assert "${lhs} ${op}" not converted`);
    } else {
      warnings.push(`assert "${lhs}" not converted`);
    }
  }
  return out;
}

function convertBruAuth(sub: string | undefined, body: string, warnings: string[]): TruSpecAuth | undefined {
  const kv = kvLines(body);
  switch (sub) {
    case "bearer":
      return { type: "bearer", token: kv.get("token") ?? "" };
    case "basic":
      return { type: "basic", username: kv.get("username") ?? "", password: kv.get("password") ?? "" };
    case "apikey":
      return {
        type: "apikey",
        name: kv.get("key") ?? "",
        value: kv.get("value") ?? "",
        in: kv.get("placement") === "queryparams" ? "query" : "header",
      };
    default:
      warnings.push(`auth "${sub ?? "?"}" not supported; left unset`);
      return undefined;
  }
}

/**
 * Bruno's `vars:post-response` block, which is its `capture:` — `token: res.body.access_token`
 * saves a value from the response for later requests.
 *
 * It was dropped outright, which is the worst thing an importer can drop: the chain is the reason
 * the collection has more than one request in it. The login still ran, the token was no longer
 * saved, and every request after it interpolated an undefined `{{token}}`.
 */
function convertPostResponseVars(
  body: string,
  name: string,
  warnings: string[],
): Record<string, string | { header: string } | { status: true }> {
  const out: Record<string, string | { header: string } | { status: true }> = {};
  for (const [varName, expr] of kvLines(body)) {
    const source = expr.trim();
    const bodyPath = /^res\.(?:body|getBody\(\))((?:\.[A-Za-z_$][\w$]*|\[\d+\]|\["[^"]+"\])*)$/.exec(source);
    if (bodyPath) {
      out[varName] = `$${bodyPath[1] ?? ""}`;
      continue;
    }
    const header = /^res\.headers\[['"]([^'"]+)['"]\]$/.exec(source);
    if (header?.[1]) {
      out[varName] = { header: header[1] };
      continue;
    }
    if (source === "res.status" || source === "res.getStatus()") {
      out[varName] = { status: true };
      continue;
    }
    // An expression rather than a path (`res.body.items.length`, a ternary). Saying so is the
    // point: a silently missing capture looks like a working import until the next request 401s.
    warnings.push(`"${name}": post-response var "${varName}" is an expression (${source}) — not imported`);
  }
  return out;
}

/** Parse one `.bru` request file into a TruSpec request, with conversion warnings. */
export function bruToRequest(text: string): { request?: TruSpecRequest; warnings: string[] } {
  const warnings: string[] = [];
  const blocks = extractBlocks(text);

  let name = "Request";
  let method = "GET";
  let url: string | undefined;
  let headers: Record<string, string> | undefined;
  let query: Record<string, string> | undefined;
  let auth: TruSpecAuth | undefined;
  let body: TruSpecBody | undefined;
  let gqlQuery: string | undefined;
  let gqlVars: Record<string, unknown> | undefined;
  let assertions: TruSpecAssertion[] = [];
  let scriptPre: string | undefined;
  let scriptPost: string | undefined;
  let capture: Record<string, string | { header: string } | { status: true }> = {};

  for (const block of blocks) {
    if (block.name === "meta") {
      const kv = kvLines(block.body);
      if (kv.get("name")) name = kv.get("name") as string;
    } else if (HTTP_VERBS.has(block.name)) {
      method = normalizeMethod(block.name, name, warnings);
      const kv = kvLines(block.body);
      url = kv.get("url");
    } else if (block.name === "headers") {
      headers = Object.fromEntries(kvLines(block.body));
    } else if (block.name === "query" || (block.name === "params" && block.sub === "query")) {
      query = Object.fromEntries(kvLines(block.body));
    } else if (block.name === "auth") {
      auth = convertBruAuth(block.sub, block.body, warnings);
    } else if (block.name === "body") {
      const raw = block.body.trim();
      if (block.sub === "json") {
        try {
          body = { type: "json", content: JSON.parse(raw) };
        } catch {
          warnings.push(`"${name}": JSON body contains template vars; imported as text`);
          body = { type: "text", content: raw };
        }
      } else if (block.sub === "text" || block.sub === undefined) {
        body = { type: "text", content: raw };
      } else if (block.sub === "graphql") {
        gqlQuery = raw;
      } else if (block.sub === "graphql:vars") {
        try {
          const v: unknown = JSON.parse(raw);
          if (v && typeof v === "object") gqlVars = v as Record<string, unknown>;
        } catch {
          // ignore unparseable graphql variables
        }
      } else {
        warnings.push(`"${name}": body type "${block.sub}" not supported`);
      }
    } else if (block.name === "assert") {
      assertions = convertAssert(block.body, warnings);
    } else if (block.name === "vars" && block.sub === "post-response") {
      capture = convertPostResponseVars(block.body, name, warnings);
    } else if (block.name === "vars" && block.sub === "pre-request") {
      // These are computed before the request; TruSpec's equivalent is a pre-request script, and
      // the expressions do not port mechanically. Naming them beats dropping them.
      const names = [...kvLines(block.body).keys()];
      if (names.length > 0) {
        warnings.push(`"${name}": pre-request vars (${names.join(", ")}) not imported — use script.pre`);
      }
    } else if (block.name === "tests") {
      // Bruno's tests are chai `expect` calls, which have no declarative equivalent. The assert
      // block above is what converts; a dropped tests block has to be visible, not silent.
      if (block.body.trim()) {
        warnings.push(`"${name}": tests block not imported — express the checks as assertions`);
      }
    } else if (block.name === "script") {
      // Bruno's bru/req API differs from TruSpec's tr — preserve the source commented, to port.
      if (block.body.trim()) {
        if (block.sub === "pre-request") {
          scriptPre = portedScript(block.body, "Bruno");
          warnings.push(`"${name}": Bruno pre-request script imported as comments — port to the tr API`);
        } else if (block.sub === "post-response") {
          scriptPost = portedScript(block.body, "Bruno");
          warnings.push(`"${name}": Bruno post-response script imported as comments — port to the tr API`);
        }
      }
    }
  }

  if (gqlQuery !== undefined) {
    body = gqlVars
      ? { type: "graphql", query: gqlQuery, variables: gqlVars }
      : { type: "graphql", query: gqlQuery };
  }

  if (!url) {
    warnings.push(`Skipped "${name}": no URL`);
    return { warnings };
  }

  // Bruno shows the query string and the `query` block as one thing kept in sync, so importing
  // both produced `?expand=profile&expand=profile` — which plenty of APIs read as a two-element
  // array, or reject. The structured block is the one to keep.
  const finalUrl = query && Object.keys(query).length > 0 ? url.split("?")[0] ?? url : url;

  const request: TruSpecRequest = {
    tspec: SCHEMA_VERSION,
    name,
    method: method as TruSpecMethod,
    url: finalUrl,
    assertions,
  };
  if (headers && Object.keys(headers).length > 0) request.headers = headers;
  if (query && Object.keys(query).length > 0) request.query = query;
  if (Object.keys(capture).length > 0) request.capture = capture;
  if (auth) request.auth = auth;
  if (body) request.body = body;
  if (scriptPre || scriptPost) {
    request.script = { ...(scriptPre ? { pre: scriptPre } : {}), ...(scriptPost ? { post: scriptPost } : {}) };
  }
  return { request, warnings };
}
