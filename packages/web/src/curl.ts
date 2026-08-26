import type { RequestDetail } from "./api";

function shQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** Renders a request as a copy-pasteable `curl` command. Uses the request's own `{{var}}`
 * placeholders as authored (no server round-trip to resolve them against an environment) — the
 * same shape Bruno/Postman show when generating a snippet from the request definition itself
 * rather than from a captured network call. */
export function buildCurl(r: RequestDetail): string {
  const query: Array<[string, string]> = Object.entries(r.query ?? {}).map(([k, v]) => [k, String(v)]);
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(r.headers ?? {})) headers[k] = String(v);

  if (r.auth?.type === "bearer" && r.auth.token) {
    headers.Authorization = `Bearer ${r.auth.token}`;
  } else if (r.auth?.type === "basic") {
    headers.Authorization = `Basic ${btoa(`${r.auth.username}:${r.auth.password}`)}`;
  } else if (r.auth?.type === "apikey") {
    if (r.auth.in === "header") headers[r.auth.name] = r.auth.value;
    else query.push([r.auth.name, r.auth.value]);
  }

  const qs = query.length > 0 ? `?${query.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&")}` : "";

  const lines = [`curl -X ${r.method} ${shQuote(r.url + qs)}`];
  for (const [k, v] of Object.entries(headers)) lines.push(`-H ${shQuote(`${k}: ${v}`)}`);

  if (r.body?.type === "json") {
    lines.push(`-H ${shQuote("Content-Type: application/json")}`);
    lines.push(`-d ${shQuote(JSON.stringify(r.body.content))}`);
  } else if (r.body?.type === "text") {
    lines.push(`-d ${shQuote(r.body.content)}`);
  } else if (r.body?.type === "form") {
    for (const [k, v] of Object.entries(r.body.content)) lines.push(`--data-urlencode ${shQuote(`${k}=${v}`)}`);
  } else if (r.body?.type === "graphql") {
    lines.push(`-H ${shQuote("Content-Type: application/json")}`);
    lines.push(`-d ${shQuote(JSON.stringify({ query: r.body.query, variables: r.body.variables }))}`);
  }

  return lines.join(" \\\n  ");
}
