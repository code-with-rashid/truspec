import { parse } from "../format";
import { SCHEMA_VERSION } from "../format/schema";
import type { TruSpecAuth, TruSpecBody, TruSpecMethod, TruSpecRequest } from "../format/types";
import { environmentFile } from "./environment";
import { asRecord, type ImportedFile, type ImportResult, normalizeMethod, slug } from "./types";

/**
 * Insomnia export (v4 JSON, or the v5 YAML-ish shape once parsed).
 *
 * Its `resources` array is a *flat* list with `parentId` pointers, not a tree — so folders have to
 * be reassembled by walking parents. A `_type` of `request_group` is a folder, `request` a request,
 * `workspace` the root.
 */
const MAX_DEPTH = 100;

interface Resource {
  _id: string;
  _type: string;
  parentId?: string;
  name?: string;
  raw: Record<string, unknown>;
}

export function importInsomnia(input: unknown): ImportResult {
  const root = asRecord(input);
  const resources = root?.resources;
  if (!Array.isArray(resources)) {
    throw new Error("Not an Insomnia export (missing top-level 'resources' array)");
  }

  const warnings: string[] = [];
  const files: ImportedFile[] = [];
  const stats = { requests: 0, folders: 0 };

  const byId = new Map<string, Resource>();
  for (const raw of resources) {
    const r = asRecord(raw);
    if (!r || typeof r._id !== "string" || typeof r._type !== "string") continue;
    byId.set(r._id, {
      _id: r._id,
      _type: r._type,
      parentId: typeof r.parentId === "string" ? r.parentId : undefined,
      name: typeof r.name === "string" ? r.name : undefined,
      raw: r,
    });
  }
  for (const r of byId.values()) if (r._type === "request_group") stats.folders++;

  for (const file of environmentFiles(byId, warnings)) files.push(file);

  const used = new Map<string, number>();
  for (const resource of byId.values()) {
    if (resource._type !== "request") continue;
    const request = toRequest(resource, warnings);
    if (!request) continue;

    const dir = folderPath(resource, byId, warnings);
    const base = slug(request.name);
    const key = `${dir}/${base}`;
    const n = (used.get(key) ?? 0) + 1;
    used.set(key, n);
    const filename = `${n > 1 ? `${base}-${n}` : base}.tspec.yaml`;
    stats.requests++;
    files.push({
      path: dir ? `${dir}/${filename}` : filename,
      content: parse.request.serialize(request),
    });
  }

  // A stable order keeps the written files (and any diff of them) reproducible; the export's own
  // order is an implementation detail of whatever wrote it.
  files.sort((a, b) => a.path.localeCompare(b.path));
  if (files.length === 0) warnings.push("No requests found in the Insomnia export");
  return { files, warnings, stats };
}

/**
 * Insomnia writes `{{ _.var }}` (v5) or `{{ var }}` (v4); both mean the same thing here.
 *
 * Applied to **every** templated field, not just the URL. It used to be inline in the URL handling
 * alone, so an imported request came out with a normalized `url: "{{baseUrl}}/pets"` next to an
 * untouched `token: "{{ _.token }}"` — a variable name with a `_.` prefix that nothing declares and
 * nothing will ever resolve.
 */
export function normalizeVars(text: string): string {
  return text.replace(/\{\{\s*_\.([\w.-]+)\s*\}\}/g, "{{$1}}").replace(/\{\{\s*([\w.-]+)\s*\}\}/g, "{{$1}}");
}

/**
 * One `environments/<name>.env.yaml` per Insomnia environment.
 *
 * An Insomnia sub-environment inherits from the one above it and overrides what it redeclares, so
 * each file is emitted **flattened** — a `local` that only sets `baseUrl` still carries the base's
 * `apiVersion`. That matches how TruSpec resolves an environment (one file, self-contained) and how
 * Insomnia actually behaves when that environment is selected.
 */
function environmentFiles(byId: Map<string, Resource>, warnings: string[]): ImportedFile[] {
  const out: ImportedFile[] = [];
  const taken = new Set<string>();
  for (const resource of byId.values()) {
    if (resource._type !== "environment") continue;
    // Walk up the parent chain, nearest last, so a child's own value wins.
    const chain: Resource[] = [];
    let node: Resource | undefined = resource;
    const seen = new Set<string>();
    while (node && !seen.has(node._id)) {
      seen.add(node._id);
      if (node._type === "environment") chain.unshift(node);
      node = node.parentId ? byId.get(node.parentId) : undefined;
    }
    const vars: Record<string, string> = {};
    for (const link of chain) {
      const data = asRecord(link.raw.data);
      if (!data) continue;
      for (const [k, v] of Object.entries(data)) {
        // Only scalars: an Insomnia environment can hold nested objects, which have no meaning as
        // a `{{var}}` substitution.
        if (v !== null && typeof v === "object") continue;
        vars[k] = normalizeVars(String(v));
      }
    }
    const file = environmentFile(resource.name ?? "imported", vars, warnings);
    if (!file || taken.has(file.path)) continue;
    taken.add(file.path);
    out.push(file);
  }
  return out;
}

/** Apply `f` to every string in a value, preserving its shape. */
function mapStrings<T>(value: T, f: (s: string) => string): T {
  if (typeof value === "string") return f(value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => mapStrings(v, f)) as unknown as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, mapStrings(v, f)])) as unknown as T;
  }
  return value;
}

/** Reassemble the folder path by walking `parentId` up to the workspace. */
function folderPath(resource: Resource, byId: Map<string, Resource>, warnings: string[]): string {
  const segments: string[] = [];
  const seen = new Set<string>([resource._id]);
  let parentId = resource.parentId;
  for (let depth = 0; parentId && depth <= MAX_DEPTH; depth++) {
    // A malformed export can point a group at itself or form a cycle; walking it would hang.
    if (seen.has(parentId)) break;
    seen.add(parentId);
    const parent = byId.get(parentId);
    if (!parent || parent._type !== "request_group") break;
    segments.unshift(slug(parent.name ?? "folder"));
    parentId = parent.parentId;
  }
  if (segments.length > MAX_DEPTH) {
    warnings.push(`Flattened folders nested deeper than ${MAX_DEPTH} levels`);
    return segments.slice(0, MAX_DEPTH).join("/");
  }
  return segments.join("/");
}

function toRequest(resource: Resource, warnings: string[]): TruSpecRequest | undefined {
  const r = resource.raw;
  const name = resource.name || "request";
  const rawUrl = typeof r.url === "string" ? r.url : "";
  if (!rawUrl) {
    warnings.push(`Skipped "${name}": no URL`);
    return undefined;
  }
  const url = normalizeVars(rawUrl);

  const headers: Record<string, string> = {};
  if (Array.isArray(r.headers)) {
    for (const raw of r.headers) {
      const h = asRecord(raw);
      // Insomnia keeps disabled rows in the file; importing them would send headers the user
      // explicitly turned off.
      if (!h || typeof h.name !== "string" || h.disabled === true || !h.name) continue;
      headers[h.name] = normalizeVars(String(h.value ?? ""));
    }
  }
  const query: Record<string, string> = {};
  if (Array.isArray(r.parameters)) {
    for (const raw of r.parameters) {
      const p = asRecord(raw);
      if (!p || typeof p.name !== "string" || p.disabled === true || !p.name) continue;
      query[p.name] = normalizeVars(String(p.value ?? ""));
    }
  }

  // Deeply, after conversion: auth and body each have several templated fields across several
  // shapes, and normalizing the result once is one place instead of a dozen call sites to miss.
  const auth = mapStrings(convertAuth(asRecord(r.authentication), warnings, name), normalizeVars);
  const body = mapStrings(convertBody(asRecord(r.body), headers, warnings, name), normalizeVars);

  return {
    tspec: SCHEMA_VERSION,
    name,
    method: normalizeMethod(r.method, name, warnings) as TruSpecMethod,
    url,
    ...(Object.keys(headers).length > 0 ? { headers } : {}),
    ...(Object.keys(query).length > 0 ? { query } : {}),
    ...(body ? { body } : {}),
    ...(auth ? { auth } : {}),
    ...(typeof r.description === "string" && r.description ? { docs: r.description } : {}),
    assertions: [{ type: "status", lt: 400 }],
  };
}

function convertAuth(
  auth: Record<string, unknown> | undefined,
  warnings: string[],
  name: string,
): TruSpecAuth | undefined {
  if (!auth || auth.disabled === true) return undefined;
  const type = typeof auth.type === "string" ? auth.type : "";
  switch (type) {
    case "bearer":
      return { type: "bearer", token: String(auth.token ?? "") };
    case "basic":
      return { type: "basic", username: String(auth.username ?? ""), password: String(auth.password ?? "") };
    case "apikey":
      return {
        type: "apikey",
        name: String(auth.key ?? ""),
        value: String(auth.value ?? ""),
        in: auth.addTo === "queryParams" ? "query" : "header",
      };
    case "oauth2": {
      const grant = String(auth.grantType ?? "");
      // Only the grants a machine can complete unattended have an equivalent; an authorization-code
      // flow needs a browser, so say so rather than importing a block that can never run.
      if (grant !== "client_credentials" && grant !== "password" && grant !== "refresh_token") {
        warnings.push(`"${name}": OAuth2 grant "${grant || "unspecified"}" needs a browser and was not imported`);
        return undefined;
      }
      return {
        type: "oauth2",
        grant,
        tokenUrl: String(auth.accessTokenUrl ?? ""),
        clientAuth: auth.credentialsInBody === true ? "body" : "basic",
        scheme: "Bearer",
        ...(auth.clientId ? { clientId: String(auth.clientId) } : {}),
        ...(auth.clientSecret ? { clientSecret: String(auth.clientSecret) } : {}),
        ...(auth.username ? { username: String(auth.username) } : {}),
        ...(auth.password ? { password: String(auth.password) } : {}),
        ...(auth.scope ? { scope: String(auth.scope) } : {}),
      };
    }
    case "":
    case "none":
      return undefined;
    default:
      warnings.push(`"${name}": auth type "${type}" is not supported and was left unset`);
      return undefined;
  }
}

function convertBody(
  body: Record<string, unknown> | undefined,
  headers: Record<string, string>,
  warnings: string[],
  name: string,
): TruSpecBody | undefined {
  if (!body) return undefined;
  const mimeType = typeof body.mimeType === "string" ? body.mimeType.toLowerCase() : "";

  if (mimeType.includes("form-data") || mimeType.includes("x-www-form-urlencoded")) {
    const isMultipart = mimeType.includes("form-data");
    const fields: Record<string, unknown> = {};
    for (const raw of Array.isArray(body.params) ? body.params : []) {
      const p = asRecord(raw);
      if (!p || typeof p.name !== "string" || p.disabled === true) continue;
      if (isMultipart && typeof p.fileName === "string" && p.fileName) {
        fields[p.name] = { file: p.fileName };
      } else {
        fields[p.name] = String(p.value ?? "");
      }
    }
    dropContentType(headers);
    if (isMultipart) return { type: "multipart", fields } as TruSpecBody;
    const content: Record<string, string> = {};
    for (const [k, v] of Object.entries(fields)) content[k] = typeof v === "string" ? v : "";
    return { type: "form", content };
  }

  const text = typeof body.text === "string" ? body.text : "";
  if (!text) return undefined;

  if (mimeType.includes("graphql")) {
    try {
      const parsed = JSON.parse(text) as { query?: string; variables?: Record<string, unknown> };
      if (typeof parsed.query === "string") {
        dropContentType(headers);
        return {
          type: "graphql",
          query: parsed.query,
          ...(parsed.variables ? { variables: parsed.variables } : {}),
        };
      }
    } catch {
      warnings.push(`"${name}": GraphQL body did not parse; imported as text`);
    }
  }
  if (mimeType.includes("json") || looksLikeJson(text)) {
    try {
      const content: unknown = JSON.parse(text);
      dropContentType(headers);
      return { type: "json", content };
    } catch {
      warnings.push(`"${name}": body was declared as JSON but did not parse; imported as text`);
    }
  }
  return { type: "text", content: text };
}

/** A typed body carries its own content type; keeping the header would duplicate and go stale. */
function dropContentType(headers: Record<string, string>): void {
  for (const k of Object.keys(headers)) {
    if (k.toLowerCase() === "content-type") delete headers[k];
  }
}

function looksLikeJson(text: string): boolean {
  const t = text.trimStart();
  return t.startsWith("{") || t.startsWith("[");
}
