import { parse } from "../format";
import { SCHEMA_VERSION } from "../format/schema";
import type { TruSpecAuth, TruSpecBody, TruSpecMethod, TruSpecRequest } from "../format/types";
import { safeDecodeURIComponent } from "../util/uri";
import { asRecord, type ImportedFile, type ImportResult, slug } from "./types";

/**
 * Headers a browser adds that describe the *browser*, not the request.
 *
 * Keeping them would bury the two or three headers that matter under thirty that don't, and
 * several are actively wrong to replay: `content-length` and `host` are recomputed by the client,
 * and `accept-encoding` would make the recorded body unreadable. A HAR import that produces
 * unreadable requests is one nobody keeps.
 */
const NOISE_HEADERS = new Set([
  "accept-encoding",
  "connection",
  "content-length",
  "host",
  "keep-alive",
  "origin",
  "pragma",
  "priority",
  "proxy-connection",
  "referer",
  "te",
  "transfer-encoding",
  "upgrade-insecure-requests",
  "user-agent",
]);

/** Browser-only header families, matched by prefix. */
const NOISE_PREFIXES = ["sec-", "sec-ch-", ":"];

function isNoise(name: string): boolean {
  const lower = name.toLowerCase();
  return NOISE_HEADERS.has(lower) || NOISE_PREFIXES.some((p) => lower.startsWith(p));
}

const VALID_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);

export interface HarImportOptions {
  /** Only import entries whose URL contains this substring (case-insensitive). */
  filter?: string;
  /** Keep browser-noise headers (`sec-*`, `user-agent`, …). Off by default. */
  keepNoiseHeaders?: boolean;
  /** Import `OPTIONS` preflights too. Off by default — they are transport, not API surface. */
  includeOptions?: boolean;
  /**
   * Import static assets too (documents, CSS, scripts, images, fonts, media). Off by default for
   * the same reason `OPTIONS` is: a devtools HAR of one page load is mostly the asset pipeline,
   * and importing it produces a collection that has to be hand-pruned before it is usable.
   */
  includeAssets?: boolean;
  /** Replace the recorded origin with `{{baseUrl}}` so the collection is environment-portable. */
  baseUrlVar?: string;
}

/**
 * Convert a HAR (HTTP Archive) export — "Save all as HAR" in browser devtools — into request files.
 *
 * A HAR is the highest-fidelity record of what an app actually did, which makes it the fastest way
 * to turn observed behavior into a regression suite. The import is deliberately opinionated:
 * browser noise is stripped, preflights are skipped, and each request asserts the status that was
 * actually recorded, so the result reads like a collection someone wrote rather than a packet dump.
 */
/**
 * Response content types that are the page, not the API.
 *
 * Judged from the HAR's recorded `response.content.mimeType`, which is the authoritative signal —
 * not the URL, because an API route ending in `.json` is not an asset and an endpoint at `/avatar`
 * may well be one. An entry with no recorded type is kept: absence of evidence is not evidence.
 */
const ASSET_MIME = /^(?:text\/(?:html|css)|(?:text|application)\/(?:x-)?javascript|image\/|font\/|audio\/|video\/|application\/(?:font-\w+|vnd\.ms-fontobject))/;

function isStaticAsset(entry: Record<string, unknown> | undefined): boolean {
  const mime = asRecord(asRecord(entry?.response)?.content)?.mimeType;
  if (typeof mime !== "string" || mime.trim() === "") return false;
  return ASSET_MIME.test(mime.trim().toLowerCase());
}

export function importHar(json: unknown, opts: HarImportOptions = {}): ImportResult {
  const warnings: string[] = [];
  const log = asRecord(asRecord(json)?.log);
  const entries = log?.entries;
  if (!Array.isArray(entries)) {
    return { files: [], warnings: ["Not a HAR file: expected log.entries"], stats: { requests: 0, folders: 0 } };
  }

  const files: ImportedFile[] = [];
  const used = new Set<string>();
  let skipped = 0;
  let assets = 0;

  for (const rawEntry of entries) {
    const entry = asRecord(rawEntry);
    const request = asRecord(entry?.request);
    if (!request || typeof request.url !== "string") continue;

    const url = request.url;
    if (!/^https?:\/\//i.test(url)) continue;
    if (opts.filter && !url.toLowerCase().includes(opts.filter.toLowerCase())) continue;

    const method = typeof request.method === "string" ? request.method.toUpperCase() : "GET";
    if (method === "OPTIONS" && !opts.includeOptions) {
      skipped += 1;
      continue;
    }
    if (!opts.includeAssets && isStaticAsset(entry)) {
      assets += 1;
      continue;
    }
    if (!VALID_METHODS.has(method)) {
      warnings.push(`Skipped ${method} ${url}: unsupported method`);
      continue;
    }

    const converted = toRequest(request, asRecord(entry?.response), method, url, opts, warnings);
    if (!converted) continue;

    let base = slug(converted.name);
    if (used.has(base)) {
      let n = 2;
      while (used.has(`${base}-${n}`)) n += 1;
      base = `${base}-${n}`;
    }
    used.add(base);
    files.push({ path: `${base}.tspec.yaml`, content: parse.request.serialize(converted) });
  }

  if (skipped > 0) {
    warnings.push(`Skipped ${skipped} OPTIONS preflight(s) — pass includeOptions to keep them`);
  }
  if (assets > 0) {
    warnings.push(
      `Skipped ${assets} static asset(s) — documents, styles, scripts, images, fonts — pass includeAssets to keep them`,
    );
  }
  if (files.length === 0 && warnings.length === 0) {
    warnings.push("No importable entries found in the HAR");
  }
  return { files, warnings, stats: { requests: files.length, folders: 0 } };
}

function toRequest(
  request: Record<string, unknown>,
  response: Record<string, unknown> | undefined,
  method: string,
  rawUrl: string,
  opts: HarImportOptions,
  warnings: string[],
): TruSpecRequest | undefined {
  const headers: Record<string, string> = {};
  if (Array.isArray(request.headers)) {
    for (const raw of request.headers) {
      const h = asRecord(raw);
      if (!h || typeof h.name !== "string") continue;
      if (!opts.keepNoiseHeaders && isNoise(h.name)) continue;
      headers[h.name] = String(h.value ?? "");
    }
  }
  const auth = extractAuth(headers);

  let url: string;
  let query: Record<string, string> | undefined;
  try {
    const parsedUrl = new URL(rawUrl);
    query = {};
    for (const [k, v] of parsedUrl.searchParams) query[k] = safeDecodeURIComponent(v);
    if (Object.keys(query).length === 0) query = undefined;
    // Replacing the origin with a variable is what makes an imported collection usable against
    // staging as well as the host it happened to be recorded from.
    const path = `${parsedUrl.pathname}${parsedUrl.hash}`;
    url = opts.baseUrlVar ? `{{${opts.baseUrlVar}}}${path}` : `${parsedUrl.origin}${path}`;
  } catch {
    url = rawUrl;
  }

  const body = toBody(asRecord(request.postData), headers, warnings);
  // Assert the status that was actually observed: a HAR is a recording, so the recorded outcome is
  // the most meaningful thing to lock in as a regression.
  const observed = typeof response?.status === "number" && response.status > 0 ? response.status : undefined;

  return {
    tspec: SCHEMA_VERSION,
    name: nameFor(method, rawUrl),
    method: method as TruSpecMethod,
    url,
    ...(Object.keys(headers).length > 0 ? { headers } : {}),
    ...(query ? { query } : {}),
    ...(body ? { body } : {}),
    ...(auth ? { auth } : {}),
    assertions: [observed !== undefined ? { type: "status", equals: observed } : { type: "status", lt: 400 }],
  };
}

function toBody(
  postData: Record<string, unknown> | undefined,
  headers: Record<string, string>,
  warnings: string[],
): TruSpecBody | undefined {
  if (!postData) return undefined;
  const mimeType = typeof postData.mimeType === "string" ? postData.mimeType.toLowerCase() : "";

  // `params` is how a HAR records a form or multipart submission field-by-field.
  if (Array.isArray(postData.params) && postData.params.length > 0) {
    const content: Record<string, string> = {};
    for (const raw of postData.params) {
      const p = asRecord(raw);
      if (!p || typeof p.name !== "string") continue;
      content[p.name] = String(p.value ?? "");
    }
    if (mimeType.includes("multipart")) {
      warnings.push("A multipart entry's file contents are not stored in a HAR; only field names and values were imported");
      return { type: "multipart", fields: content } as TruSpecBody;
    }
    dropContentType(headers);
    return { type: "form", content };
  }

  const text = typeof postData.text === "string" ? postData.text : "";
  if (!text) return undefined;

  if (mimeType.includes("x-www-form-urlencoded")) {
    const content: Record<string, string> = {};
    for (const [k, v] of new URLSearchParams(text)) content[k] = v;
    dropContentType(headers);
    return { type: "form", content };
  }
  if (mimeType.includes("json") || looksLikeJson(text)) {
    try {
      const parsed: unknown = JSON.parse(text);
      dropContentType(headers);
      return { type: "json", content: parsed };
    } catch {
      warnings.push("A body was declared as JSON but did not parse; imported as text");
    }
  }
  return { type: "text", content: text };
}

/** A typed body carries its own content type; keeping the header too would duplicate and go stale. */
function dropContentType(headers: Record<string, string>): void {
  for (const k of Object.keys(headers)) {
    if (k.toLowerCase() === "content-type") delete headers[k];
  }
}

function looksLikeJson(text: string): boolean {
  const t = text.trimStart();
  return t.startsWith("{") || t.startsWith("[");
}

/** Lift a recognizable `Authorization` header into a structured `auth` block. */
function extractAuth(headers: Record<string, string>): TruSpecAuth | undefined {
  const key = Object.keys(headers).find((k) => k.toLowerCase() === "authorization");
  if (!key) return undefined;
  const value = headers[key] ?? "";
  const bearer = /^Bearer\s+(.+)$/i.exec(value);
  if (bearer?.[1]) {
    delete headers[key];
    return { type: "bearer", token: bearer[1] };
  }
  const basic = /^Basic\s+([A-Za-z0-9+/=]+)$/i.exec(value);
  if (basic?.[1]) {
    try {
      const decoded = Buffer.from(basic[1], "base64").toString("utf8");
      const idx = decoded.indexOf(":");
      if (idx !== -1) {
        delete headers[key];
        return { type: "basic", username: decoded.slice(0, idx), password: decoded.slice(idx + 1) };
      }
    } catch {
      // Not decodable — keep the raw header rather than losing it.
    }
  }
  return undefined;
}

function nameFor(method: string, rawUrl: string): string {
  let path = rawUrl;
  try {
    path = new URL(rawUrl).pathname;
  } catch {
    path = rawUrl.split("?")[0] ?? rawUrl;
  }
  const segments = path.split("/").filter(Boolean);
  return `${method} ${segments.slice(-2).join(" ") || "root"}`.trim();
}
