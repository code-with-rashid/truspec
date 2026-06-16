import { parse } from "../format";
import { SCHEMA_VERSION } from "../format/schema";
import type { TruSpecAuth, TruSpecBody, TruSpecMethod, TruSpecRequest } from "../format/types";
import { asRecord, type ImportedFile, type ImportResult, normalizeMethod, slug } from "./types";

function kvFromArray(arr: unknown, key: string): string | undefined {
  if (!Array.isArray(arr)) return undefined;
  for (const e of arr) {
    const er = asRecord(e);
    if (er && er.key === key) return String(er.value ?? "");
  }
  return undefined;
}

function convertAuth(raw: unknown, warnings: string[]): TruSpecAuth | undefined {
  const obj = asRecord(raw);
  if (!obj || typeof obj.type !== "string") return undefined;
  switch (obj.type) {
    case "bearer":
      return { type: "bearer", token: kvFromArray(obj.bearer, "token") ?? "" };
    case "basic":
      return {
        type: "basic",
        username: kvFromArray(obj.basic, "username") ?? "",
        password: kvFromArray(obj.basic, "password") ?? "",
      };
    case "apikey":
      return {
        type: "apikey",
        name: kvFromArray(obj.apikey, "key") ?? "",
        value: kvFromArray(obj.apikey, "value") ?? "",
        in: kvFromArray(obj.apikey, "in") === "query" ? "query" : "header",
      };
    case "noauth":
      return { type: "none" };
    default:
      warnings.push(`Auth type "${obj.type}" not supported; left unset`);
      return undefined;
  }
}

function splitQuery(raw: string): { url: string; query?: Record<string, string> } {
  const qIndex = raw.indexOf("?");
  if (qIndex === -1) return { url: raw };
  const base = raw.slice(0, qIndex);
  const query: Record<string, string> = {};
  for (const pair of raw.slice(qIndex + 1).split("&")) {
    if (!pair) continue;
    const eq = pair.indexOf("=");
    const k = eq === -1 ? pair : pair.slice(0, eq);
    const v = eq === -1 ? "" : pair.slice(eq + 1);
    if (k) query[decodeURIComponent(k)] = decodeURIComponent(v);
  }
  return { url: base, query: Object.keys(query).length > 0 ? query : undefined };
}

function convertUrl(raw: unknown): { url?: string; query?: Record<string, string> } {
  if (typeof raw === "string") return splitQuery(raw);
  const obj = asRecord(raw);
  if (!obj) return {};

  let query: Record<string, string> | undefined;
  if (Array.isArray(obj.query)) {
    const q: Record<string, string> = {};
    for (const e of obj.query) {
      const er = asRecord(e);
      if (er && !er.disabled && typeof er.key === "string") q[er.key] = String(er.value ?? "");
    }
    if (Object.keys(q).length > 0) query = q;
  }
  if (typeof obj.raw === "string") {
    const split = splitQuery(obj.raw);
    return { url: split.url, query: query ?? split.query };
  }
  return { query };
}

function convertHeaders(raw: unknown): Record<string, string> | undefined {
  if (!Array.isArray(raw)) return undefined;
  const headers: Record<string, string> = {};
  for (const e of raw) {
    const er = asRecord(e);
    if (er && !er.disabled && typeof er.key === "string") headers[er.key] = String(er.value ?? "");
  }
  return Object.keys(headers).length > 0 ? headers : undefined;
}

function convertBody(raw: unknown, warnings: string[], name: string): TruSpecBody | undefined {
  const obj = asRecord(raw);
  if (!obj || typeof obj.mode !== "string") return undefined;
  switch (obj.mode) {
    case "raw": {
      const text = typeof obj.raw === "string" ? obj.raw : "";
      const language = asRecord(asRecord(obj.options)?.raw)?.language;
      if (language === "json") {
        try {
          return { type: "json", content: JSON.parse(text) };
        } catch {
          warnings.push(`"${name}": JSON body contains template vars; imported as text`);
          return { type: "text", content: text };
        }
      }
      return { type: "text", content: text };
    }
    case "urlencoded":
    case "formdata": {
      if (obj.mode === "formdata") warnings.push(`"${name}": multipart formdata imported as form fields`);
      const arr = obj.mode === "urlencoded" ? obj.urlencoded : obj.formdata;
      const content: Record<string, string> = {};
      if (Array.isArray(arr)) {
        for (const e of arr) {
          const er = asRecord(e);
          if (er && !er.disabled && er.type !== "file" && typeof er.key === "string") {
            content[er.key] = String(er.value ?? "");
          }
        }
      }
      return { type: "form", content };
    }
    case "graphql": {
      const gql = asRecord(obj.graphql);
      const query = typeof gql?.query === "string" ? gql.query : "";
      let variables: Record<string, unknown> | undefined;
      if (typeof gql?.variables === "string") {
        try {
          const parsed: unknown = JSON.parse(gql.variables);
          if (parsed && typeof parsed === "object") variables = parsed as Record<string, unknown>;
        } catch {
          // ignore unparseable variables
        }
      } else {
        const v = asRecord(gql?.variables);
        if (v) variables = v;
      }
      return variables ? { type: "graphql", query, variables } : { type: "graphql", query };
    }
    default:
      return undefined;
  }
}

function convertRequest(item: Record<string, unknown>, warnings: string[]): TruSpecRequest | undefined {
  const name = String(item.name ?? "Request");

  // Postman shorthand: `request` may be a bare string ("GET http://…" or "http://…").
  if (typeof item.request === "string") {
    const match = item.request.trim().match(/^([A-Za-z]+)\s+(\S.*)$/);
    const url = (match?.[2] ?? item.request).trim();
    if (!url) {
      warnings.push(`Skipped "${name}": empty request`);
      return undefined;
    }
    return {
      tspec: SCHEMA_VERSION,
      name,
      method: normalizeMethod(match?.[1] ?? "GET", name, warnings) as TruSpecMethod,
      url,
      assertions: [],
    };
  }

  const req = asRecord(item.request);
  if (!req) return undefined;

  const { url, query } = convertUrl(req.url);
  if (!url) {
    warnings.push(`Skipped "${name}": no URL`);
    return undefined;
  }
  if (item.event) warnings.push(`"${name}": pre-request/test scripts not imported (no JS sandbox in v0)`);

  const out: TruSpecRequest = {
    tspec: SCHEMA_VERSION,
    name,
    method: normalizeMethod(req.method, name, warnings) as TruSpecMethod,
    url,
    assertions: [],
  };
  if (query) out.query = query;
  const headers = convertHeaders(req.header);
  if (headers) out.headers = headers;
  const auth = convertAuth(req.auth, warnings);
  if (auth) out.auth = auth;
  const body = convertBody(req.body, warnings, name);
  if (body) out.body = body;
  return out;
}

/** Convert a parsed Postman v2.1 collection into TruSpec files. */
export function importPostman(input: unknown): ImportResult {
  const root = asRecord(input);
  if (!root || !Array.isArray(root.item)) {
    throw new Error("Not a Postman v2.1 collection (missing top-level 'item' array)");
  }
  const warnings: string[] = [];
  const files: ImportedFile[] = [];
  const stats = { requests: 0, folders: 0 };

  const walk = (items: unknown[], dir: string): void => {
    const used = new Map<string, number>();
    for (const raw of items) {
      const item = asRecord(raw);
      if (!item) continue;
      if (Array.isArray(item.item)) {
        stats.folders++;
        const folder = slug(String(item.name ?? "folder"));
        walk(item.item, dir ? `${dir}/${folder}` : folder);
      } else if (item.request) {
        const converted = convertRequest(item, warnings);
        if (!converted) continue;
        stats.requests++;
        const base = slug(String(item.name ?? "request"));
        const n = (used.get(base) ?? 0) + 1;
        used.set(base, n);
        const file = n > 1 ? `${base}-${n}.tspec.yaml` : `${base}.tspec.yaml`;
        files.push({ path: dir ? `${dir}/${file}` : file, content: parse.request.serialize(converted) });
      }
    }
  };
  walk(root.item, "");

  const collectionAuth = convertAuth(root.auth, warnings);
  if (collectionAuth) {
    const info = asRecord(root.info);
    files.push({
      path: "folder.tspec.yaml",
      content: parse.folderConfig.serialize({
        tspec: SCHEMA_VERSION,
        name: String(info?.name ?? "Imported"),
        auth: collectionAuth,
      }),
    });
  }

  return { files, warnings, stats };
}
