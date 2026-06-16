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

function kvLines(body: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of body.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("//") || t.startsWith("~")) continue;
    const idx = t.indexOf(":");
    if (idx === -1) continue;
    map.set(t.slice(0, idx).trim(), t.slice(idx + 1).trim());
  }
  return map;
}

function coerce(value: string): string | number | boolean {
  const v = value.trim().replace(/^['"]|['"]$/g, "");
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  if (v === "true") return true;
  if (v === "false") return false;
  return v;
}

function convertAssert(body: string, warnings: string[]): TruSpecAssertion[] {
  const out: TruSpecAssertion[] = [];
  for (const [lhs, expr] of kvLines(body)) {
    const [op, ...rest] = expr.split(/\s+/);
    const value = rest.join(" ");
    if (lhs === "res.status") {
      const num = Number(coerce(value));
      if (op === "eq") out.push({ type: "status", equals: num });
      else if (op === "gte") out.push({ type: "status", gte: num });
      else if (op === "lt") out.push({ type: "status", lt: num });
      else warnings.push(`assert "${lhs} ${op}" not converted`);
    } else if (lhs.startsWith("res.body")) {
      const path = `$${lhs.slice("res.body".length)}`;
      if (op === "isDefined") out.push({ type: "jsonpath", path, exists: true });
      else if (op === "eq") out.push({ type: "jsonpath", path, equals: coerce(value) });
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

  const request: TruSpecRequest = {
    tspec: SCHEMA_VERSION,
    name,
    method: method as TruSpecMethod,
    url,
    assertions,
  };
  if (headers && Object.keys(headers).length > 0) request.headers = headers;
  if (query && Object.keys(query).length > 0) request.query = query;
  if (auth) request.auth = auth;
  if (body) request.body = body;
  if (scriptPre || scriptPost) {
    request.script = { ...(scriptPre ? { pre: scriptPre } : {}), ...(scriptPost ? { post: scriptPost } : {}) };
  }
  return { request, warnings };
}
