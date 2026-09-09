import type { TruSpecRequest } from "../format/types";

export type Severity = "error" | "warning";

export interface LintFinding {
  /** Workspace-relative path of the file the finding is about. */
  path: string;
  severity: Severity;
  /** Stable machine-readable rule id, for suppression and for agents. */
  rule: string;
  message: string;
}

/** Every `{{name}}` referenced anywhere in a request's templated fields. */
export function referencedVars(req: TruSpecRequest): string[] {
  const found = new Set<string>();
  const scan = (node: unknown): void => {
    if (typeof node === "string") {
      for (const m of node.matchAll(/\{\{\s*([\w.-]+)\s*\}\}/g)) found.add(m[1] as string);
      return;
    }
    if (Array.isArray(node)) {
      for (const v of node) scan(v);
      return;
    }
    if (node && typeof node === "object") {
      for (const v of Object.values(node)) scan(v);
    }
  };
  // `docs` is prose and `script` is code — a `{{…}}` in either is not an interpolation site.
  const { docs: _docs, script: _script, ...templated } = req;
  scan(templated);
  return [...found];
}

/**
 * Literals that look like a real credential rather than a placeholder.
 *
 * Deliberately narrow: a linter that cries wolf on every long string gets muted, and then it
 * catches nothing. These patterns are ones that essentially only occur in genuine secrets.
 */
const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/^ey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+$/, "a JWT"],
  [/^(sk|rk|pk)_(live|test)_[A-Za-z0-9]{16,}$/, "a Stripe-style key"],
  [/^gh[pousr]_[A-Za-z0-9]{20,}$/, "a GitHub token"],
  [/^xox[baprs]-[A-Za-z0-9-]{10,}$/, "a Slack token"],
  [/^AKIA[0-9A-Z]{16}$/, "an AWS access key id"],
  [/^AIza[0-9A-Za-z_-]{35}$/, "a Google API key"],
  [/^-{5}BEGIN [A-Z ]*PRIVATE KEY-{5}/, "a private key"],
];

/** Identify a literal that looks like a credential; returns what it looks like, or undefined. */
export function looksLikeSecret(value: string): string | undefined {
  const v = value.trim();
  if (v.length < 16) return undefined;
  if (v.includes("{{")) return undefined; // a template, not a literal
  for (const [re, what] of SECRET_PATTERNS) if (re.test(v)) return what;
  return undefined;
}

/** Where in a request a string literal was found, for a message that points at it. */
export interface Located {
  where: string;
  value: string;
}

/** Walk a request's credential-bearing fields, yielding each string literal with its location. */
export function credentialLiterals(req: TruSpecRequest): Located[] {
  const out: Located[] = [];
  const push = (where: string, value: unknown): void => {
    if (typeof value === "string") out.push({ where, value });
  };
  push("url", req.url);
  for (const [k, v] of Object.entries(req.headers ?? {})) push(`headers.${k}`, v);
  for (const [k, v] of Object.entries(req.query ?? {})) push(`query.${k}`, v);
  const auth = req.auth;
  if (auth?.type === "bearer") push("auth.token", auth.token);
  if (auth?.type === "basic") push("auth.password", auth.password);
  if (auth?.type === "apikey") push("auth.value", auth.value);
  if (auth?.type === "oauth2") {
    push("auth.clientSecret", auth.clientSecret);
    push("auth.password", auth.password);
    push("auth.refreshToken", auth.refreshToken);
  }
  if (req.body?.type === "json") {
    const scan = (node: unknown, path: string): void => {
      if (typeof node === "string") return void push(`body${path}`, node);
      if (Array.isArray(node)) return void node.forEach((v, i) => scan(v, `${path}[${i}]`));
      if (node && typeof node === "object") {
        for (const [k, v] of Object.entries(node)) scan(v, `${path}.${k}`);
      }
    };
    scan(req.body.content, "");
  }
  if (req.body?.type === "form") {
    for (const [k, v] of Object.entries(req.body.content)) push(`body.${k}`, v);
  }
  return out;
}

/** A plaintext URL to somewhere that isn't the developer's own machine. */
export function isInsecureUrl(url: string): boolean {
  if (!/^http:\/\//i.test(url)) return false;
  const host = url.slice("http://".length).split(/[/:?#]/)[0]?.toLowerCase() ?? "";
  if (host.includes("{{")) return false; // templated host — the environment decides the scheme
  return !(
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host === "0.0.0.0" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".test")
  );
}
