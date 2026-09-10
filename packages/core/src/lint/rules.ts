import type { TruSpecRequest } from "../format/types";

export type Severity = "error" | "warning";

export interface LintFinding {
  /** Workspace-relative path of the file the finding is about. */
  path: string;
  severity: Severity;
  /** Stable machine-readable rule id, for suppression and for agents. */
  rule: string;
  message: string;
  /**
   * 1-based line in that file, when the finding can be traced to one.
   *
   * A finding that names `headers.X-Api-Key` and no line leaves the reader scrolling — in an
   * editor, in a CI log, and worst of all in a review, where the finding and the code are in two
   * different windows. Absent when a rule is about the file as a whole.
   */
  line?: number;
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
  [/(?<![A-Za-z0-9_-])ey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+/, "a JWT"],
  [/(?<![A-Za-z0-9_-])(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{16,}/, "a Stripe-style key"],
  [/(?<![A-Za-z0-9_-])gh[pousr]_[A-Za-z0-9]{20,}/, "a GitHub token"],
  [/(?<![A-Za-z0-9_-])xox[baprs]-[A-Za-z0-9-]{10,}/, "a Slack token"],
  [/(?<![A-Za-z0-9_-])AKIA[0-9A-Z]{16}(?![0-9A-Z])/, "an AWS access key id"],
  [/(?<![A-Za-z0-9_-])AIza[0-9A-Za-z_-]{35}(?![0-9A-Za-z_-])/, "a Google API key"],
  [/-{5}BEGIN [A-Z ]*PRIVATE KEY-{5}/, "a private key"],
];

/** Identify a literal that looks like a credential; returns what it looks like, or undefined. */
export function looksLikeSecret(value: string): string | undefined {
  const v = value.trim();
  if (v.length < 16) return undefined;
  if (v.includes("{{")) return undefined; // a template, not a literal
  // Searched *within* the value, not matched against the whole of it. `Authorization: "Bearer
  // sk_live_…"` is the likeliest place a real key gets committed, and anchoring the patterns made
  // exactly that case invisible. The prefixes are distinctive enough that a substring search keeps
  // the rule as narrow as it was — the lookbehind stops a match inside a longer opaque token.
  for (const [re, what] of SECRET_PATTERNS) if (re.test(v)) return what;
  return undefined;
}

/** Where in a request a string literal was found, for a message that points at it. */
export interface Located {
  where: string;
  value: string;
}

/**
 * Field names that hold a credential when they hold anything.
 *
 * The vendor patterns above catch a Stripe key or a JWT because their *shape* is recognisable. A
 * plain 36-character hex string in a header called `X-Api-Key` has no shape at all — and is just
 * as committed. What gives it away is the name, which is the one thing an opaque token cannot
 * hide.
 */
export const CREDENTIAL_NAME =
  /(?:^|[._-])(?:api[_-]?keys?|apikey|access[_-]?tokens?|refresh[_-]?tokens?|id[_-]?token|tokens?|secrets?|client[_-]?secret|passwords?|passwd|pwd|authorization|auth[_-]?token|credentials?|private[_-]?key|session[_-]?id|sessionid|cookie|x[_-]?api[_-]?key)(?:[._-]|$)/i;

/** Values that are obviously placeholders rather than a real credential someone committed. */
const PLACEHOLDER = /^(?:<.*>|\{.*\}|x{3,}|\*{3,}|\.{3,}|(?:your|my|the)[_-].*|change[_-]?me|replace[_-]?me|example|test|dummy|fake|none|null|undefined|true|false)$/i;

/**
 * Whether a literal in a credential-named field should be reported.
 *
 * Deliberately conservative: a template is not a literal, something short is not a token, and an
 * obvious placeholder is not a leak. What is left is a value that has no business being in a file
 * that gets committed.
 */
export function isLiteralCredential(where: string, value: string): boolean {
  // `headers.X-Api-Key`, `body.auth.token`, `url?api_key` — the last segment is the field's name.
  const field = where.split(/[.[?]/).pop() ?? where;
  if (!CREDENTIAL_NAME.test(field)) return false;
  const v = value.trim();
  if (v.length < 8 || v.includes("{{")) return false;
  // `Bearer <token>` / `Basic <base64>`: the scheme is not the secret, the rest of it is.
  const bare = v.replace(/^(?:Bearer|Basic|Token|ApiKey)\s+/i, "").trim();
  if (bare.length < 8) return false;
  return !PLACEHOLDER.test(bare);
}

/** Query parameters written directly into a URL, as locations that can be linted by name. */
export function urlQueryLiterals(url: string): Located[] {
  const q = url.indexOf("?");
  if (q === -1) return [];
  const out: Located[] = [];
  for (const pair of url.slice(q + 1).split("&")) {
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    // Not decoded: a credential in a query string is linted for what is written in the file, and
    // decodeURIComponent throws on a stray `%` that a URL may perfectly well contain.
    out.push({ where: `url?${pair.slice(0, eq)}`, value: pair.slice(eq + 1) });
  }
  return out;
}

/** The auth fields that can hold a credential, shared by requests and folder configs. */
function authLiterals(auth: TruSpecRequest["auth"], push: (where: string, value: unknown) => void): void {
  if (auth?.type === "bearer") push("auth.token", auth.token);
  if (auth?.type === "basic") push("auth.password", auth.password);
  if (auth?.type === "apikey") push("auth.value", auth.value);
  if (auth?.type === "oauth2") {
    push("auth.clientSecret", auth.clientSecret);
    push("auth.password", auth.password);
    push("auth.refreshToken", auth.refreshToken);
  }
}

/**
 * Credential-bearing fields of a `folder.tspec.yaml`.
 *
 * A folder's `auth` applies to every request beneath it, which makes it the most attractive place
 * to paste a real token and the most damaging place for one to sit committed — and it was the one
 * file type the secret rule never read.
 */
export function folderCredentialLiterals(config: {
  headers?: Record<string, string | number | boolean>;
  auth?: TruSpecRequest["auth"];
}): Located[] {
  const out: Located[] = [];
  const push = (where: string, value: unknown): void => {
    if (typeof value === "string") out.push({ where, value });
  };
  for (const [k, v] of Object.entries(config.headers ?? {})) push(`headers.${k}`, v);
  authLiterals(config.auth, push);
  return out;
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
  authLiterals(req.auth, push);
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
