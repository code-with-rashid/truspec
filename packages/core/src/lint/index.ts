import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { parse } from "../format";
import type { TruSpecRequest } from "../format/types";
import { jsonpath } from "../runner/jsonpath";
import { loadDotenv } from "../workspace/context";
import { discoverRequests } from "../workspace/discover";
import { findWorkspaceRoot } from "../workspace/run";
import { walkDirSafe } from "../workspace/walk";
import {
  credentialLiterals,
  isInsecureUrl,
  type LintFinding,
  looksLikeSecret,
  referencedVars,
  type Severity,
} from "./rules";

export type { LintFinding, Severity } from "./rules";
export { looksLikeSecret, referencedVars } from "./rules";

export interface LintOptions {
  /** Extra variable names to treat as declared (OS env, CI-injected `--var`). */
  knownVars?: string[];
  processEnv?: NodeJS.ProcessEnv;
  /** Rule ids to skip entirely. */
  disable?: string[];
}

export interface LintReport {
  dir: string;
  files: number;
  findings: LintFinding[];
  errors: number;
  warnings: number;
  /** True when nothing at `error` severity was found. */
  ok: boolean;
}

/** Every rule this linter can emit, with a one-line explanation. Used by `--list-rules` and docs. */
export const LINT_RULES: Array<{ id: string; severity: Severity; description: string }> = [
  { id: "parse", severity: "error", description: "The file does not parse against the TruSpec schema." },
  { id: "inline-secret", severity: "error", description: "A literal that looks like a real credential is committed in the file." },
  { id: "bad-jsonpath", severity: "error", description: "A capture or assertion uses a JSONPath the engine cannot parse." },
  { id: "no-assertions", severity: "warning", description: "The request asserts nothing, so a run can never fail on it." },
  { id: "duplicate-name", severity: "warning", description: "Two requests share a name, making reports ambiguous." },
  { id: "undeclared-var", severity: "warning", description: "A {{var}} is neither declared in an environment nor captured by an earlier request." },
  { id: "absolute-url", severity: "warning", description: "An absolute URL under a folder that declares a baseUrl, so switching environments has no effect." },
  { id: "insecure-url", severity: "warning", description: "A plaintext http:// URL to a host that is not the local machine." },
];

/**
 * Static checks over a collection — everything that can be known without sending a request.
 *
 * `run` tells you whether an API behaves; this tells you whether the *collection* is sound. That
 * matters most for the two authors TruSpec cares about: an agent generating files (which needs
 * machine-readable rule ids, not prose) and a reviewer reading a diff (who wants a committed
 * credential caught before it merges, not after).
 */
export function lintWorkspace(dir: string, opts: LintOptions = {}): LintReport {
  const disabled = new Set(opts.disable ?? []);
  const findings: LintFinding[] = [];
  const add = (path: string, severity: Severity, rule: string, message: string): void => {
    if (!disabled.has(rule)) findings.push({ path, severity, rule, message });
  };

  const files = discoverRequests(dir);
  const declared = declaredVarNames(dir, opts);
  const parsed: Array<{ path: string; req: TruSpecRequest }> = [];

  for (const file of files) {
    const path = relative(dir, file);
    let req: TruSpecRequest;
    try {
      req = parse.request.parse(readFileSync(file, "utf8"));
    } catch (e) {
      add(path, "error", "parse", (e as Error).message);
      continue;
    }
    parsed.push({ path, req });

    if (req.assertions.length === 0) {
      add(path, "warning", "no-assertions", "No assertions — this request can never fail a run.");
    }
    for (const { where, value } of credentialLiterals(req)) {
      const what = looksLikeSecret(value);
      if (what) {
        add(
          path,
          "error",
          "inline-secret",
          `${where} looks like ${what}. Reference it as {{name}} and declare it under an environment's \`secrets\`.`,
        );
      }
    }
    for (const [name, source] of Object.entries(req.capture ?? {})) {
      const expr = typeof source === "string" ? source : "jsonpath" in source ? source.jsonpath : undefined;
      if (expr === undefined) continue;
      try {
        jsonpath({}, expr);
      } catch (e) {
        add(path, "error", "bad-jsonpath", `capture.${name}: ${(e as Error).message}`);
      }
    }
    for (const a of req.assertions) {
      if (a.type !== "jsonpath") continue;
      try {
        jsonpath({}, a.path);
      } catch (e) {
        add(path, "error", "bad-jsonpath", `assertion on "${a.path}": ${(e as Error).message}`);
      }
    }
    if (isInsecureUrl(req.url)) {
      add(path, "warning", "insecure-url", `${req.url} is plaintext http:// to a remote host.`);
    }
    if (/^https?:\/\//i.test(req.url) && folderBaseUrl(dir, path)) {
      add(
        path,
        "warning",
        "absolute-url",
        "Absolute URL under a folder that sets baseUrl — switching environments will not change where this request goes.",
      );
    }
  }

  // Cross-file rules: a name collision or an undeclared variable is only visible with everything
  // in hand, and a variable counts as declared if any *earlier* request captures it.
  const byName = new Map<string, string[]>();
  for (const { path, req } of parsed) {
    const list = byName.get(req.name);
    if (list) list.push(path);
    else byName.set(req.name, [path]);
  }
  for (const [name, paths] of byName) {
    if (paths.length < 2) continue;
    for (const path of paths) {
      add(path, "warning", "duplicate-name", `Name "${name}" is also used by ${paths.filter((p) => p !== path).join(", ")}.`);
    }
  }

  const ordered = [...parsed].sort(
    (a, b) => (a.req.order ?? 0) - (b.req.order ?? 0) || a.path.localeCompare(b.path),
  );
  const available = new Set(declared);
  for (const { path, req } of ordered) {
    // A pre-request script computes variables *this* request then interpolates, so its names are
    // available before the check, not after it.
    for (const name of scriptSetNames(req)) available.add(name);
    for (const name of referencedVars(req)) {
      if (!available.has(name)) {
        add(path, "warning", "undeclared-var", `{{${name}}} is not declared in any environment, .env, or captured by an earlier request.`);
      }
    }
    // Captures are only available to *later* requests, so they are added after the check.
    for (const name of Object.keys(req.capture ?? {})) available.add(name);
  }

  const errors = findings.filter((f) => f.severity === "error").length;
  return {
    dir,
    files: files.length,
    findings,
    errors,
    warnings: findings.length - errors,
    ok: errors === 0,
  };
}

/** `tr.set("name", …)` calls in a pre-request script — the names it makes available. */
function scriptSetNames(req: TruSpecRequest): string[] {
  const pre = req.script?.pre;
  if (!pre) return [];
  return [...pre.matchAll(/tr\.set\(\s*["'`]([\w.-]+)["'`]/g)].map((m) => m[1] as string);
}

/**
 * Names available before any request runs: every environment's variables + secrets, plus `.env`.
 *
 * Environments are collected the way the runner finds them — from the workspace root **above** the
 * lint target (so linting one subfolder still sees the project's environments) — and also from any
 * `environments/` nested **below** it, so linting a directory that contains several collections
 * (`examples/`, a monorepo's `apis/`) doesn't report every variable as undeclared.
 */
function declaredVarNames(dir: string, opts: LintOptions): Set<string> {
  const names = new Set<string>(opts.knownVars ?? []);
  const root = findWorkspaceRoot(dir);
  const envFiles: string[] = [];
  for (const envDir of new Set([join(root, "environments"), join(dir, "environments")])) {
    if (!existsSync(envDir)) continue;
    for (const entry of readdirSync(envDir)) {
      if (entry.endsWith(".env.yaml")) envFiles.push(join(envDir, entry));
    }
  }
  walkDirSafe(dir, (full, name) => {
    if (name.endsWith(".env.yaml") && basename(dirname(full)) === "environments") envFiles.push(full);
  });
  for (const file of new Set(envFiles)) {
    try {
      const env = parse.environment.parse(readFileSync(file, "utf8"));
      for (const k of Object.keys(env.variables)) names.add(k);
      for (const s of env.secrets) names.add(s);
    } catch {
      // A malformed environment file is reported by `truspec run`; here it just contributes
      // no names, which at worst produces an undeclared-var warning that points at the cause.
    }
  }
  for (const k of Object.keys(loadDotenv(root))) names.add(k);
  if (root !== dir) for (const k of Object.keys(loadDotenv(dir))) names.add(k);
  for (const k of Object.keys(opts.processEnv ?? {})) names.add(k);
  return names;
}

/** Does any folder config on the path from `dir` down to the request's folder set a baseUrl? */
function folderBaseUrl(dir: string, relPath: string): boolean {
  const segments = relPath.split(/[\\/]/).slice(0, -1);
  let current = dir;
  for (let i = 0; i <= segments.length; i++) {
    const config = join(current, "folder.tspec.yaml");
    if (existsSync(config)) {
      try {
        if (parse.folderConfig.parse(readFileSync(config, "utf8")).baseUrl) return true;
      } catch {
        // Reported by the parse rule on its own file.
      }
    }
    const next = segments[i];
    if (next === undefined) break;
    current = join(current, next);
  }
  return false;
}
