import type { TruSpecAuth, TruSpecFolderConfig, TruSpecRequest } from "../format/types";
import { interpolate, interpolateDeep, type Vars } from "./interpolate";

/** A concrete HTTP request ready to hand to `fetch`. */
export interface EffectiveRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
  missing: string[];
}

export interface ResolveOptions {
  folder?: TruSpecFolderConfig;
  vars?: Vars;
}

function base64(input: string): string {
  return Buffer.from(input, "utf8").toString("base64");
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  const lower = name.toLowerCase();
  return Object.keys(headers).some((k) => k.toLowerCase() === lower);
}

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

/** Apply auth to headers; returns a query param to append for `apikey in: query`. */
function applyAuth(
  auth: TruSpecAuth,
  headers: Record<string, string>,
  vars: Vars,
  missing: string[],
): [string, string] | undefined {
  switch (auth.type) {
    case "bearer": {
      const t = interpolate(auth.token, vars);
      missing.push(...t.missing);
      headers.Authorization = `Bearer ${t.value}`;
      return undefined;
    }
    case "basic": {
      const u = interpolate(auth.username, vars);
      const p = interpolate(auth.password, vars);
      missing.push(...u.missing, ...p.missing);
      headers.Authorization = `Basic ${base64(`${u.value}:${p.value}`)}`;
      return undefined;
    }
    case "apikey": {
      const v = interpolate(auth.value, vars);
      missing.push(...v.missing);
      if (auth.in === "query") return [auth.name, v.value];
      headers[auth.name] = v.value;
      return undefined;
    }
    default:
      return undefined;
  }
}

/** Resolve a request against its folder config and variables into a concrete HTTP request. */
export function resolveRequest(req: TruSpecRequest, opts: ResolveOptions = {}): EffectiveRequest {
  const vars = opts.vars ?? {};
  const missing: string[] = [];

  // URL — prepend folder baseUrl when the request URL is relative.
  const urlRes = interpolate(req.url, vars);
  missing.push(...urlRes.missing);
  let url = urlRes.value;
  if (!/^https?:\/\//i.test(url) && opts.folder?.baseUrl) {
    const baseRes = interpolate(opts.folder.baseUrl, vars);
    missing.push(...baseRes.missing);
    url = joinUrl(baseRes.value, url);
  }

  // Headers — folder first, then request (request wins).
  const headers: Record<string, string> = {};
  for (const src of [opts.folder?.headers, req.headers]) {
    if (!src) continue;
    const r = interpolateDeep(src, vars);
    missing.push(...r.missing);
    for (const [k, v] of Object.entries(r.value)) headers[k] = String(v);
  }

  // Auth — request overrides folder.
  const auth = req.auth ?? opts.folder?.auth;
  const authQuery = auth ? applyAuth(auth, headers, vars, missing) : undefined;

  // Query string — request query params plus any apikey-in-query.
  const usp = new URLSearchParams();
  if (req.query) {
    const r = interpolateDeep(req.query, vars);
    missing.push(...r.missing);
    for (const [k, v] of Object.entries(r.value)) usp.append(k, String(v));
  }
  if (authQuery) usp.append(authQuery[0], authQuery[1]);
  const qs = usp.toString();
  if (qs) {
    // Insert query params *before* any `#fragment`. Appending them blindly to the end
    // pushes them into the fragment (`/p#frag?q=1`), where the WHATWG URL parser keeps
    // them in the hash and they're never sent to the server — silent data loss, and a
    // silently-dropped `apikey in: query` auth param.
    const hash = url.indexOf("#");
    const head = hash === -1 ? url : url.slice(0, hash);
    const frag = hash === -1 ? "" : url.slice(hash);
    url = head + (head.includes("?") ? "&" : "?") + qs + frag;
  }

  // Body.
  let body: string | undefined;
  if (req.body && req.body.type !== "none") {
    if (req.body.type === "json") {
      const r = interpolateDeep(req.body.content, vars);
      missing.push(...r.missing);
      body = JSON.stringify(r.value);
      if (!hasHeader(headers, "content-type")) headers["Content-Type"] = "application/json";
    } else if (req.body.type === "text") {
      const r = interpolate(req.body.content, vars);
      missing.push(...r.missing);
      body = r.value;
      if (!hasHeader(headers, "content-type")) headers["Content-Type"] = "text/plain";
    } else if (req.body.type === "form") {
      const r = interpolateDeep(req.body.content, vars);
      missing.push(...r.missing);
      const form = new URLSearchParams();
      for (const [k, v] of Object.entries(r.value)) form.append(k, String(v));
      body = form.toString();
      if (!hasHeader(headers, "content-type")) {
        headers["Content-Type"] = "application/x-www-form-urlencoded";
      }
    } else if (req.body.type === "graphql") {
      const q = interpolate(req.body.query, vars);
      missing.push(...q.missing);
      let variables: Record<string, unknown> | undefined;
      if (req.body.variables) {
        const r = interpolateDeep(req.body.variables, vars);
        missing.push(...r.missing);
        variables = r.value;
      }
      body = JSON.stringify(variables ? { query: q.value, variables } : { query: q.value });
      if (!hasHeader(headers, "content-type")) headers["Content-Type"] = "application/json";
    }
  }

  return { method: req.method, url, headers, body, missing: Array.from(new Set(missing)) };
}
