import { parse } from "../format";
import { SCHEMA_VERSION } from "../format/schema";
import type { TruSpecAuth, TruSpecBody, TruSpecMethod, TruSpecRequest } from "../format/types";
import { safeDecodeURIComponent } from "../util/uri";
import type { ImportedFile, ImportResult } from "./types";
import { slug } from "./types";

interface Token {
  value: string;
  /** Whether the token came from a quoted run — `curl` inside a header value must not split commands. */
  quoted: boolean;
}

/**
 * Tokenize a shell command line the way a POSIX shell would for the subset curl commands use:
 * single quotes (literal), double quotes (with backslash escapes), `$'…'` ANSI-C quoting, bare
 * backslash escapes, and `\<newline>` continuations.
 *
 * This is deliberately not a shell: it does no expansion, no globbing, and no command
 * substitution. A `$(…)` or `${…}` stays verbatim, which is what a human pasting a curl command
 * wants to see land in the request.
 */
export function tokenizeShell(input: string): Token[] {
  const tokens: Token[] = [];
  let cur = "";
  let started = false;
  let quoted = false;

  const push = (): void => {
    if (started) tokens.push({ value: cur, quoted });
    cur = "";
    started = false;
    quoted = false;
  };

  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (c === "\\" && input[i + 1] === "\n") {
      i += 1; // line continuation: the newline disappears entirely
      continue;
    }
    if (c === "\\" && i + 1 < input.length) {
      cur += input[i + 1];
      started = true;
      i += 1;
      continue;
    }
    if (c === "'") {
      const end = input.indexOf("'", i + 1);
      const stop = end === -1 ? input.length : end;
      cur += input.slice(i + 1, stop);
      started = true;
      quoted = true;
      i = stop;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      for (; j < input.length && input[j] !== '"'; j++) {
        if (input[j] === "\\" && j + 1 < input.length) {
          cur += unescapeDoubleQuoted(input[j + 1] ?? "");
          j += 1;
        } else {
          cur += input[j];
        }
      }
      started = true;
      quoted = true;
      i = j;
      continue;
    }
    if (c === "$" && input[i + 1] === "'") {
      const { text, next } = readAnsiC(input, i + 2);
      cur += text;
      started = true;
      quoted = true;
      i = next;
      continue;
    }
    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      push();
      continue;
    }
    cur += c;
    started = true;
  }
  push();
  return tokens;
}

function unescapeDoubleQuoted(c: string): string {
  // Inside double quotes a shell only treats these as escapes; every other backslash is literal.
  if (c === '"' || c === "\\" || c === "$" || c === "`") return c;
  if (c === "\n") return "";
  return `\\${c}`;
}

function readAnsiC(input: string, start: number): { text: string; next: number } {
  const map: Record<string, string> = { n: "\n", t: "\t", r: "\r", "0": "\0", "\\": "\\", "'": "'", '"': '"' };
  let text = "";
  let i = start;
  for (; i < input.length && input[i] !== "'"; i++) {
    if (input[i] === "\\" && i + 1 < input.length) {
      const c = input[i + 1] ?? "";
      text += map[c] ?? c;
      i += 1;
    } else {
      text += input[i];
    }
  }
  return { text, next: i };
}

/** Flags that take a value we care about, in their long form. */
const VALUE_FLAGS: Record<string, string> = {
  "-X": "request",
  "--request": "request",
  "-H": "header",
  "--header": "header",
  "-d": "data",
  "--data": "data",
  "--data-raw": "data-raw",
  "--data-ascii": "data",
  "--data-binary": "data",
  "--data-urlencode": "data-urlencode",
  "-F": "form",
  "--form": "form",
  "-u": "user",
  "--user": "user",
  "-A": "user-agent",
  "--user-agent": "user-agent",
  "-e": "referer",
  "--referer": "referer",
  "-b": "cookie",
  "--cookie": "cookie",
  "--url": "url",
  "--json": "json",
  "-o": "ignore-value",
  "--output": "ignore-value",
  "-w": "ignore-value",
  "--write-out": "ignore-value",
  "-m": "ignore-value",
  "--max-time": "ignore-value",
  "--connect-timeout": "ignore-value",
  "-x": "proxy",
  "--proxy": "proxy",
  "-A;": "ignore-value",
};

/** Boolean flags: recognized so they're never mistaken for the URL. */
const BOOL_FLAGS = new Set([
  "-L", "--location", "-k", "--insecure", "-s", "--silent", "-S", "--show-error",
  "-v", "--verbose", "-i", "--include", "-f", "--fail", "--compressed", "-g", "--globoff",
  "-#", "--progress-bar", "-N", "--no-buffer", "--no-keepalive", "-4", "-6", "-Z",
]);

interface ParsedCurl {
  method?: string;
  url?: string;
  headers: Array<[string, string]>;
  data: string[];
  urlencoded: Array<[string, string]>;
  form: string[];
  user?: string;
  head?: boolean;
  getWithData?: boolean;
  jsonFlag?: boolean;
  proxy?: string;
  insecure?: boolean;
}

function parseOne(tokens: Token[], warnings: string[]): ParsedCurl {
  const out: ParsedCurl = { headers: [], data: [], urlencoded: [], form: [] };
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]?.value ?? "";
    if (t === "curl") continue;
    if (t === "-I" || t === "--head") {
      out.head = true;
      continue;
    }
    if (t === "-G" || t === "--get") {
      out.getWithData = true;
      continue;
    }
    if (t === "-k" || t === "--insecure") {
      out.insecure = true;
      continue;
    }
    if (BOOL_FLAGS.has(t)) continue;

    const kind = VALUE_FLAGS[t];
    if (kind) {
      const value = tokens[++i]?.value ?? "";
      applyFlag(out, kind, value, warnings);
      continue;
    }
    // Combined short flags with an attached value: -XPOST, -HAccept:…, -d'{"a":1}'.
    const combined = t.match(/^-([XHdFubAe])(.+)$/);
    if (combined) {
      applyFlag(out, VALUE_FLAGS[`-${combined[1]}`] ?? "", combined[2] ?? "", warnings);
      continue;
    }
    if (t.startsWith("-")) {
      // An unknown flag that takes a value would otherwise swallow the URL; skip only the flag.
      warnings.push(`Ignored unsupported curl flag: ${t}`);
      continue;
    }
    if (!out.url) out.url = t;
  }
  return out;
}

function applyFlag(out: ParsedCurl, kind: string, value: string, warnings: string[]): void {
  switch (kind) {
    case "request":
      out.method = value.toUpperCase();
      break;
    case "header": {
      const idx = value.indexOf(":");
      if (idx === -1) break;
      out.headers.push([value.slice(0, idx).trim(), value.slice(idx + 1).trim()]);
      break;
    }
    case "data":
    case "data-raw":
      out.data.push(value);
      break;
    case "data-urlencode": {
      const idx = value.indexOf("=");
      if (idx === -1) out.urlencoded.push(["", value]);
      else out.urlencoded.push([value.slice(0, idx), value.slice(idx + 1)]);
      break;
    }
    case "json":
      out.jsonFlag = true;
      out.data.push(value);
      break;
    case "form":
      out.form.push(value);
      break;
    case "user":
      out.user = value;
      break;
    case "user-agent":
      out.headers.push(["User-Agent", value]);
      break;
    case "referer":
      out.headers.push(["Referer", value]);
      break;
    case "cookie":
      out.headers.push(["Cookie", value]);
      break;
    case "url":
      out.url = value;
      break;
    case "proxy":
      out.proxy = value;
      warnings.push(`Proxy (${value}) is not part of the request file; set it in your environment instead`);
      break;
    case "ignore-value":
      break;
    default:
      break;
  }
}

/** Split a token stream into one command per `curl` invocation (`… && curl …`, or one per line). */
function splitCommands(tokens: Token[]): Token[][] {
  const commands: Token[][] = [];
  let cur: Token[] = [];
  for (const t of tokens) {
    if (!t.quoted && (t.value === ";" || t.value === "&&" || t.value === "|" || t.value === "||")) {
      if (cur.length > 0) commands.push(cur);
      cur = [];
      continue;
    }
    if (!t.quoted && t.value === "curl" && cur.length > 0) {
      commands.push(cur);
      cur = [t];
      continue;
    }
    cur.push(t);
  }
  if (cur.length > 0) commands.push(cur);
  return commands.filter((c) => c.some((t) => t.value === "curl" || t.value.startsWith("http")));
}

function headerValue(headers: Array<[string, string]>, name: string): string | undefined {
  const lower = name.toLowerCase();
  return headers.find(([k]) => k.toLowerCase() === lower)?.[1];
}

/** Lift an `Authorization` header into a structured `auth` block; leaves anything exotic alone. */
function extractAuth(p: ParsedCurl, headers: Record<string, string>): TruSpecAuth | undefined {
  if (p.user) {
    const idx = p.user.indexOf(":");
    const username = idx === -1 ? p.user : p.user.slice(0, idx);
    const password = idx === -1 ? "" : p.user.slice(idx + 1);
    return { type: "basic", username, password };
  }
  const authKey = Object.keys(headers).find((k) => k.toLowerCase() === "authorization");
  if (!authKey) return undefined;
  const value = headers[authKey] ?? "";
  const bearer = /^Bearer\s+(.+)$/i.exec(value);
  if (bearer?.[1]) {
    delete headers[authKey];
    return { type: "bearer", token: bearer[1] };
  }
  const basic = /^Basic\s+([A-Za-z0-9+/=]+)$/i.exec(value);
  if (basic?.[1]) {
    try {
      const decoded = Buffer.from(basic[1], "base64").toString("utf8");
      const idx = decoded.indexOf(":");
      if (idx !== -1) {
        delete headers[authKey];
        return { type: "basic", username: decoded.slice(0, idx), password: decoded.slice(idx + 1) };
      }
    } catch {
      // Not decodable — keep the raw header rather than losing it.
    }
  }
  return undefined;
}

function buildBody(
  p: ParsedCurl,
  headers: Record<string, string>,
  warnings: string[],
): TruSpecBody | undefined {
  if (p.form.length > 0) {
    // `-F name=@path` uploads a file; `-F name=value` is a plain part. `;type=` sets its media type.
    const fields: Record<string, unknown> = {};
    for (const f of p.form) {
      const idx = f.indexOf("=");
      if (idx === -1) continue;
      const name = f.slice(0, idx);
      let rest = f.slice(idx + 1);
      let contentType: string | undefined;
      let filename: string | undefined;
      // Trailing `;type=…` / `;filename=…` modifiers, which curl parses off the value.
      for (;;) {
        const m = /;(type|filename)=([^;]*)$/.exec(rest);
        if (!m) break;
        if (m[1] === "type") contentType = m[2];
        else filename = m[2];
        rest = rest.slice(0, m.index);
      }
      if (rest.startsWith("@") || rest.startsWith("<")) {
        fields[name] = {
          file: rest.slice(1),
          ...(filename ? { filename } : {}),
          ...(contentType ? { contentType } : {}),
        };
      } else if (contentType || filename) {
        fields[name] = { text: rest, ...(filename ? { filename } : {}), ...(contentType ? { contentType } : {}) };
      } else {
        fields[name] = rest;
      }
    }
    return { type: "multipart", fields } as TruSpecBody;
  }
  // `-G` turns every data flag into query params, so there is no body at all.
  if (p.getWithData) return undefined;
  if (p.urlencoded.length > 0) {
    const content: Record<string, string> = {};
    for (const [k, v] of p.urlencoded) if (k) content[k] = v;
    return { type: "form", content };
  }
  if (p.data.length === 0) return undefined;

  const raw = p.data.join("&");
  const contentType = (headerValue(Object.entries(headers), "content-type") ?? "").toLowerCase();
  if (contentType.includes("x-www-form-urlencoded")) {
    const content: Record<string, string> = {};
    for (const [k, v] of new URLSearchParams(raw)) content[k] = v;
    return { type: "form", content };
  }
  if (p.jsonFlag || contentType.includes("json") || looksLikeJson(raw)) {
    try {
      return { type: "json", content: JSON.parse(raw) };
    } catch {
      warnings.push("Body looked like JSON but did not parse; imported as text");
    }
  }
  return { type: "text", content: raw };
}

function looksLikeJson(text: string): boolean {
  const t = text.trimStart();
  return t.startsWith("{") || t.startsWith("[");
}

/** Derive a readable request name from the URL's last meaningful path segment. */
function nameFromUrl(method: string, url: string): string {
  let path = url;
  try {
    path = new URL(url).pathname;
  } catch {
    path = url.split("?")[0] ?? url;
  }
  const segments = path.split("/").filter(Boolean);
  const tail = segments.slice(-2).join(" ") || "request";
  return `${method} ${tail}`.trim();
}

function splitQuery(raw: string): { url: string; query?: Record<string, string> } {
  const idx = raw.indexOf("?");
  if (idx === -1) return { url: raw };
  const query: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(raw.slice(idx + 1))) query[k] = safeDecodeURIComponent(v);
  return { url: raw.slice(0, idx), ...(Object.keys(query).length > 0 ? { query } : {}) };
}

const VALID_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);

/** Convert one already-tokenized curl command into a request. */
function curlToRequest(tokens: Token[], warnings: string[]): TruSpecRequest | undefined {
  const p = parseOne(tokens, warnings);
  if (!p.url) {
    warnings.push("Skipped a curl command with no URL");
    return undefined;
  }
  if (p.insecure) {
    warnings.push("curl -k (skip TLS verification) has no equivalent in a request file and was dropped");
  }

  const headers: Record<string, string> = {};
  for (const [k, v] of p.headers) headers[k] = v;
  const auth = extractAuth(p, headers);
  const body = buildBody(p, headers, warnings);

  let method = p.method ?? (p.head ? "HEAD" : body ? "POST" : "GET");
  if (!VALID_METHODS.has(method)) {
    warnings.push(`Method ${method} is not supported; using GET`);
    method = "GET";
  }

  let { url, query } = splitQuery(p.url);
  // `-G` moves --data / --data-urlencode into the query string rather than the body.
  if (p.getWithData) {
    const extra: Record<string, string> = { ...(query ?? {}) };
    for (const [k, v] of p.urlencoded) if (k) extra[k] = v;
    for (const chunk of p.data) {
      for (const [k, v] of new URLSearchParams(chunk)) extra[k] = v;
    }
    query = Object.keys(extra).length > 0 ? extra : undefined;
  }

  // A JSON/form body's content type is implied by `body.type`; keeping the header too would
  // duplicate it in every generated request and go stale if the body type is later changed.
  if (body && (body.type === "json" || body.type === "form")) {
    for (const k of Object.keys(headers)) {
      if (k.toLowerCase() === "content-type") delete headers[k];
    }
  }

  const request: TruSpecRequest = {
    tspec: SCHEMA_VERSION,
    name: nameFromUrl(method, url),
    method: method as TruSpecMethod,
    url,
    ...(Object.keys(headers).length > 0 ? { headers } : {}),
    ...(query ? { query } : {}),
    ...(body ? { body } : {}),
    ...(auth ? { auth } : {}),
    assertions: [{ type: "status", lt: 400 }],
  };
  return request;
}

export interface CurlImportOptions {
  /** Base name for the generated file(s); defaults to a slug of the request name. */
  name?: string;
}

/**
 * Convert one or more `curl` command lines into TruSpec request files.
 *
 * "Copy as cURL" from browser devtools is how most people move a real request into an API client —
 * Postman, Insomnia and Bruno all accept a pasted curl command. This is the same entry point.
 */
export function importCurl(text: string, opts: CurlImportOptions = {}): ImportResult {
  const warnings: string[] = [];
  const commands = splitCommands(tokenizeShell(text));
  if (commands.length === 0) {
    return { files: [], warnings: ["No curl command found"], stats: { requests: 0, folders: 0 } };
  }

  const files: ImportedFile[] = [];
  const used = new Set<string>();
  for (const cmd of commands) {
    const request = curlToRequest(cmd, warnings);
    if (!request) continue;
    let base = opts.name ? slug(opts.name) : slug(request.name);
    // Two commands hitting the same path would otherwise overwrite each other on write.
    if (used.has(base)) {
      let n = 2;
      while (used.has(`${base}-${n}`)) n += 1;
      base = `${base}-${n}`;
    }
    used.add(base);
    files.push({ path: `${base}.tspec.yaml`, content: parse.request.serialize(request) });
  }

  return { files, warnings, stats: { requests: files.length, folders: 0 } };
}
