export interface ImportedFile {
  /** Path relative to the output directory, e.g. "users/get-user.tspec.yaml". */
  path: string;
  content: string;
}

export interface ImportResult {
  files: ImportedFile[];
  warnings: string[];
  stats: { requests: number; folders: number };
}

export function asRecord(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
}

const VALID_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);

export function normalizeMethod(raw: unknown, name: string, warnings: string[]): string {
  const m = typeof raw === "string" ? raw.toUpperCase() : "GET";
  if (VALID_METHODS.has(m)) return m;
  warnings.push(`"${name}": method ${m} unsupported, using GET`);
  return "GET";
}

/** Turn a request name into a filename-safe slug. */
export function slug(name: string): string {
  const s = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s || "request";
}

/**
 * Preserve a foreign (Postman/Bruno) script on import by commenting it out: the original logic
 * survives inline to port, but it's a no-op so the imported request still runs. Their `pm`/`bru`/`req`
 * APIs differ from TruSpec's `tr`, so they can't be executed verbatim.
 */
export function portedScript(code: string, from: string): string {
  const commented = code
    .trim()
    .split("\n")
    .map((l) => `// ${l}`)
    .join("\n");
  return `// Ported from ${from} — rewrite using TruSpec's tr API (tr.set / tr.vars / tr.uuid / tr.hmac; see CLAUDE.md).\n${commented}\n`;
}
