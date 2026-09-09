import { existsSync, readFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { parse } from "../format";
import type { TruSpecAuth, TruSpecBody, TruSpecRequest } from "../format/types";
import { discoverRequests } from "../workspace/discover";
import { toPosixPath } from "../workspace/paths";
import { assertionsToPostmanTest } from "./postman-tests";

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
    case "oauth2":
      // Postman's oauth2 block is a flat key/value list. Only the fields Postman understands are
      // emitted; anything provider-specific (`audience`, `extra`) has no home there and is
      // reported by the caller rather than silently vanishing.
      return {
        type: "oauth2",
        oauth2: [
          { key: "grant_type", value: postmanGrant(auth.grant), type: "string" },
          { key: "accessTokenUrl", value: auth.tokenUrl, type: "string" },
          ...(auth.clientId ? [{ key: "clientId", value: auth.clientId, type: "string" }] : []),
          ...(auth.clientSecret ? [{ key: "clientSecret", value: auth.clientSecret, type: "string" }] : []),
          ...(auth.scope ? [{ key: "scope", value: auth.scope, type: "string" }] : []),
          ...(auth.username ? [{ key: "username", value: auth.username, type: "string" }] : []),
          ...(auth.password ? [{ key: "password", value: auth.password, type: "string" }] : []),
          {
            key: "client_authentication",
            value: auth.clientAuth === "basic" ? "header" : "body",
            type: "string",
          },
        ],
      };
  }
}

/** Postman's own spelling of the grant types. */
function postmanGrant(grant: string): string {
  if (grant === "client_credentials") return "client_credentials";
  if (grant === "refresh_token") return "refresh_token";
  return "password_credentials";
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
    case "multipart":
      // Postman's `formdata` mode distinguishes a text field from a file by `type`, and carries the
      // file's path in `src` — the closest thing to TruSpec's `{ file }` part that Postman has.
      return {
        mode: "formdata",
        formdata: Object.entries(body.fields).map(([key, field]) => {
          if (typeof field === "object" && field !== null && "file" in field) {
            return { key, type: "file", src: field.file };
          }
          const value = typeof field === "object" && field !== null ? field.text : String(field);
          return { key, type: "text", value };
        }),
      };
  }
}

/**
 * Postman events for a request's scripts *and* its declarative assertions.
 *
 * Both land in the same `test` listener: Postman has one, and a reader expects to find everything
 * that checks the response in it. Assertions come first, so a `script.post` that sets a variable
 * from the body still runs after the response has been checked — the order TruSpec runs them in.
 */
function convertEvents(req: TruSpecRequest, warn: (message: string) => void): unknown[] | undefined {
  const events: unknown[] = [];
  if (req.script?.pre) {
    events.push({ listen: "prerequest", script: { type: "text/javascript", exec: req.script.pre.split("\n") } });
  }
  const test = [...assertionsToPostmanTest(req.assertions, req.name, warn)];
  if (req.script?.post) test.push(...req.script.post.split("\n"));
  if (test.length > 0) {
    events.push({ listen: "test", script: { type: "text/javascript", exec: test } });
  }
  return events.length > 0 ? events : undefined;
}

function convertRequest(req: TruSpecRequest, warn: (message: string) => void): Record<string, unknown> {
  const request: Record<string, unknown> = {
    method: req.method,
    header: convertHeaders(req.headers) ?? [],
    url: convertUrl(req.url, req.query),
  };
  const auth = convertAuth(req.auth);
  if (auth) request.auth = auth;
  if (req.auth?.type === "oauth2" && (req.auth.audience || req.auth.extra)) {
    // Postman's oauth2 block has no slot for these, and a credential that silently loses a
    // required parameter fails at the token endpoint with a message that blames the wrong thing.
    warn(`"${req.name}": OAuth2 audience/extra parameters have no Postman equivalent and were dropped`);
  }
  const body = convertBody(req.body);
  if (body) request.body = body;

  if (req.options) {
    warn(`"${req.name}": transport options (timeout/retries/redirects) have no Postman equivalent`);
  }
  if (req.spec) {
    // The link to an OpenAPI operation is what drift and coverage run on; Postman has nowhere to
    // put it, so it survives only in the .tspec.yaml this was exported from.
    warn(`"${req.name}": the \`spec\` link has no Postman equivalent and is not in the export`);
  }
  const item: Record<string, unknown> = { name: req.name, request };
  const event = convertEvents(req, warn);
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
    const relPath = toPosixPath(relative(root, absPath));
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
    node.requests.push(convertRequest(result.data, (m) => warnings.push(m)));
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
