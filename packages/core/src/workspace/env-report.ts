import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "../format";
import { loadDotenv } from "./context";
import { findWorkspaceRoot } from "./run";

export interface EnvSecretStatus {
  name: string;
  /** Whether a value is available from the OS environment or the project `.env`. */
  resolved: boolean;
  /** Where the value came from. Never the value itself. */
  source?: "env" | "dotenv";
}

export interface EnvironmentReport {
  name: string;
  /** Workspace-relative path of the file. */
  path: string;
  variables: Record<string, string>;
  secrets: EnvSecretStatus[];
  /** Declared secrets with no value anywhere — the reason a run would fail. */
  unresolved: string[];
}

export interface EnvListReport {
  root: string;
  environments: EnvironmentReport[];
  /** Files under `environments/` that did not parse. */
  errors: Array<{ path: string; error: string }>;
}

/**
 * Describe every environment in a workspace.
 *
 * Secret **values are never returned** — only whether one resolves and from where. This report is
 * printed to terminals and pasted into issues; a tool that prints a token to help you debug a
 * missing token has caused a worse problem than the one it solved.
 */
export function listEnvironments(dir: string, processEnv: NodeJS.ProcessEnv = process.env): EnvListReport {
  const root = findWorkspaceRoot(dir);
  const envDir = join(root, "environments");
  const environments: EnvironmentReport[] = [];
  const errors: Array<{ path: string; error: string }> = [];
  if (!existsSync(envDir)) return { root, environments, errors };

  const dotenv = loadDotenv(root);
  for (const entry of readdirSync(envDir).sort()) {
    if (!entry.endsWith(".env.yaml")) continue;
    const path = `environments/${entry}`;
    try {
      const env = parse.environment.parse(readFileSync(join(envDir, entry), "utf8"));
      const secrets = env.secrets.map<EnvSecretStatus>((name) => {
        // Real environment variables win over `.env`, matching how the runner resolves them.
        if (processEnv[name] !== undefined) return { name, resolved: true, source: "env" };
        if (dotenv[name] !== undefined) return { name, resolved: true, source: "dotenv" };
        return { name, resolved: false };
      });
      environments.push({
        name: env.name,
        path,
        variables: Object.fromEntries(Object.entries(env.variables).map(([k, v]) => [k, String(v)])),
        secrets,
        unresolved: secrets.filter((s) => !s.resolved).map((s) => s.name),
      });
    } catch (e) {
      errors.push({ path, error: (e as Error).message });
    }
  }
  return { root, environments, errors };
}

export interface EnvDiff {
  a: string;
  b: string;
  /** Names declared in `a` but not `b`. */
  onlyInA: string[];
  /** Names declared in `b` but not `a`. */
  onlyInB: string[];
  /** Names in both whose values differ. Values are shown for variables, never for secrets. */
  changed: Array<{ name: string; a: string; b: string }>;
  /** Names present in both with the same value. */
  same: string[];
}

/**
 * Compare two environments by the *names* they declare, and by the values of plain variables.
 *
 * The failure this exists to catch is the boring one: staging declares a variable that production
 * does not, so the collection runs green everywhere except where it matters. A missing name is
 * therefore reported as prominently as a changed value — and secrets are compared by presence
 * alone, since their values are not in the file to begin with.
 */
export function diffEnvironments(a: EnvironmentReport, b: EnvironmentReport): EnvDiff {
  const namesOf = (e: EnvironmentReport): Set<string> =>
    new Set([...Object.keys(e.variables), ...e.secrets.map((s) => s.name)]);
  const an = namesOf(a);
  const bn = namesOf(b);

  const onlyInA = [...an].filter((n) => !bn.has(n)).sort();
  const onlyInB = [...bn].filter((n) => !an.has(n)).sort();
  const changed: EnvDiff["changed"] = [];
  const same: string[] = [];
  for (const name of [...an].filter((n) => bn.has(n)).sort()) {
    const av = a.variables[name];
    const bv = b.variables[name];
    // A name that is a plain variable on one side and a secret on the other is a real difference
    // in kind, and one worth surfacing rather than treating as "same name, moving on".
    if (av === undefined && bv === undefined) same.push(name);
    else if (av === bv) same.push(name);
    else changed.push({ name, a: av ?? "(secret)", b: bv ?? "(secret)" });
  }
  return { a: a.name, b: b.name, onlyInA, onlyInB, changed, same };
}
