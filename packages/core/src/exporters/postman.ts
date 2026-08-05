import { existsSync, readFileSync } from "node:fs";
import { basename, join, relative, resolve, sep } from "node:path";
import { parse } from "../format";
import type { TruSpecAuth, TruSpecBody, TruSpecRequest } from "../format/types";
import { discoverRequests } from "../workspace/discover";

export interface ExportResult {
  collection: Record<string, unknown>;
  warnings: string[];
  stats: { requests: number; folders: number };
}

function convertAuth(auth: TruSpecAuth | undefined): Record<string, unknown> | undefined {
  if (!auth) return undefined;
  switch (auth.type) {
    case "none":
      return { type: "noauth" };
    case "bearer":
      return { type: "bearer", bearer: [{ key: "token", value: auth.token, type: "string" }] };
    case "basic":
      return {
        type: "basic",
        basic: [
          { key: "username", value: auth.username, type: "string" },
          { key: "password", value: auth.password, type: "string" },
        ],
      };
    case "apikey":
      return {
        type: "apikey",
        apikey: [
          { key: "key", value: auth.name, type: "string" },
          { key: "value", value: auth.value, type: "string" },
          { key: "in", value: auth.in, type: "string" },
        ],
      };
  }
}

type KeyValue = Record<string, string | number | boolean>;

function convertHeaders(headers: KeyValue | undefined): Array<Record<string, string>> | undefined {
  if (!headers) return undefined;
  return Object.entries(headers).map(([key, value]) => ({ key, value: String(value) }));
}

function convertUrl(url: string, query: KeyValue | undefined): string {
  if (!query || Object.keys(query).length === 0) return url;
  const qs = Object.entries(query)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");
  return `${url}?${qs}`;
}

function convertBody(body: TruSpecBody | undefined): Record<string, unknown> | undefined {
  if (!body || body.type === "none") return undefined;
  switch (body.type) {
    case "json":
      return { mode: "raw", raw: JSON.stringify(body.content, null, 2), options: { raw: { language: "json" } } };
    case "text":
      return { mode: "raw", raw: body.content };
    case "form":
      return {
        mode: "urlencoded",
        urlencoded: Object.entries(body.content).map(([key, value]) => ({ key, value, type: "text" })),
      };
    case "graphql":
      return {
        mode: "graphql",
        graphql: { query: body.query, variables: body.variables ? JSON.stringify(body.variables, null, 2) : "" },
      };
  }
}

function convertScript(script: TruSpecRequest["script"]): unknown[] | undefined {
  if (!script?.pre && !script?.post) return undefined;
  const events: unknown[] = [];
  if (script.pre) {
    events.push({ listen: "prerequest", script: { type: "text/javascript", exec: script.pre.split("\n") } });
  }
  if (script.post) {
    events.push({ listen: "test", script: { type: "text/javascript", exec: script.post.split("\n") } });
  }
  return events;
}

function convertRequest(req: TruSpecRequest): Record<string, unknown> {
  const request: Record<string, unknown> = {
    method: req.method,
    header: convertHeaders(req.headers) ?? [],
    url: convertUrl(req.url, req.query),
  };
  const auth = convertAuth(req.auth);
  if (auth) request.auth = auth;
  const body = convertBody(req.body);
  if (body) request.body = body;

  const item: Record<string, unknown> = { name: req.name, request };
  const event = convertScript(req.script);
  if (event) item.event = event;
  return item;
}

interface ExportNode {
  /** `folder.tspec.yaml`'s `name`, when present — otherwise the on-disk directory name is used. */
  name?: string;
  folders: Map<string, ExportNode>;
  requests: Record<string, unknown>[];
}

/** Convert a TruSpec workspace directory into a Postman v2.1 collection object. */
export function exportPostman(dir: string, collectionName?: string): ExportResult {
  const root = resolve(dir);
  const warnings: string[] = [];
  const stats = { requests: 0, folders: 0 };
  const rootNode: ExportNode = { folders: new Map(), requests: [] };

  for (const absPath of discoverRequests(root)) {
    const relPath = relative(root, absPath).split(sep).join("/");
    const segments = relPath.split("/");
    segments.pop(); // filename, not a folder
    let node = rootNode;
    let dirAcc = root;
    for (const seg of segments) {
      dirAcc = join(dirAcc, seg);
      let child = node.folders.get(seg);
      if (!child) {
        stats.folders++;
        const configPath = join(dirAcc, "folder.tspec.yaml");
        const name = existsSync(configPath)
          ? parse.folderConfig.safeParse(readFileSync(configPath, "utf8")).data?.name
          : undefined;
        child = { name, folders: new Map(), requests: [] };
        node.folders.set(seg, child);
      }
      node = child;
    }
    const result = parse.request.safeParse(readFileSync(absPath, "utf8"));
    if (!result.ok || !result.data) {
      warnings.push(`Skipped "${relPath}": ${result.error ?? "invalid request file"}`);
      continue;
    }
    stats.requests++;
    node.requests.push(convertRequest(result.data));
  }

  const renderNode = (node: ExportNode): unknown[] => {
    const folders = [...node.folders.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([seg, child]) => ({ name: child.name ?? seg, item: renderNode(child) }));
    const requests = [...node.requests].sort((a, b) => String(a.name).localeCompare(String(b.name)));
    return [...folders, ...requests];
  };

  const rootConfigPath = join(root, "folder.tspec.yaml");
  const rootConfig = existsSync(rootConfigPath)
    ? parse.folderConfig.safeParse(readFileSync(rootConfigPath, "utf8")).data
    : undefined;

  const collection: Record<string, unknown> = {
    info: {
      name: collectionName ?? rootConfig?.name ?? basename(root),
      schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
    },
    item: renderNode(rootNode),
  };
  const rootAuth = convertAuth(rootConfig?.auth);
  if (rootAuth) collection.auth = rootAuth;

  return { collection, warnings, stats };
}
