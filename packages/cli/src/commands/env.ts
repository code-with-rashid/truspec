import { existsSync } from "node:fs";
import { relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  diffEnvironments,
  type EnvironmentReport,
  listEnvironments,
} from "@truspec/core/workspace";
import { type CommandDeps, emit, resolveDeps } from "./deps";
import { argError } from "../args";
import { toPosixPath } from "@truspec/core/workspace";

const USAGE =
  "Usage: truspec env [<name>] [--dir <collection>] [--json]\n       truspec env --diff <a> <b> [--strict] [--json]\n";

/** `truspec env` — list, inspect, or diff the workspace's environments. */
export async function envCommand(argv: string[], deps: Partial<CommandDeps> = {}): Promise<number> {
  const d = resolveDeps(deps);
  const options = {
    dir: { type: "string" },
    json: { type: "boolean" },
    diff: { type: "boolean" },
    strict: { type: "boolean" },
    output: { type: "string", short: "o" },
  } as const;

  let values: { dir?: string; json?: boolean; diff?: boolean; strict?: boolean; output?: string };
  let positionals: string[];
  try {
    const parsed = parseArgs({ args: argv, allowPositionals: true, options });
    values = parsed.values;
    positionals = parsed.positionals;
  } catch (e) {
    d.stderr(argError(e, "env", options, USAGE));
    return 2;
  }

  const dir = resolve(d.cwd, values.dir ?? ".");
  if (!existsSync(dir)) {
    d.stderr(`Path not found: ${values.dir ?? "."}\n`);
    return 1;
  }
  const report = listEnvironments(dir, d.processEnv);
  for (const e of report.errors) d.stderr(`warning: could not read ${e.path}: ${e.error}\n`);

  if (values.diff) {
    const [aName, bName] = positionals;
    if (!aName || !bName) {
      d.stderr(`--diff needs two environment names.\n${USAGE}`);
      return 2;
    }
    const a = report.environments.find((e) => e.name === aName);
    const b = report.environments.find((e) => e.name === bName);
    if (!a || !b) {
      d.stderr(`Environment not found: ${!a ? aName : bName}\n${known(report.environments)}`);
      return 1;
    }
    const diff = diffEnvironments(a, b);
    emit(d, values.json ? JSON.stringify(diff, null, 2) : formatDiff(diff), values.output);
    // A difference is information, not a failure — `run` is what fails when a value is missing.
    // `--strict` makes it gateable: the boring outage is staging declaring a name production does
    // not, which nothing catches until the collection runs green everywhere except where it
    // matters. Only a *missing name* fails; values are supposed to differ between environments.
    const missingNames = diff.onlyInA.length + diff.onlyInB.length;
    if (values.strict && missingNames > 0) {
      d.stderr(`${missingNames} name(s) declared in only one of ${diff.a}, ${diff.b}.\n`);
      return 1;
    }
    return 0;
  }

  const name = positionals[0];
  if (name) {
    const env = report.environments.find((e) => e.name === name);
    if (!env) {
      d.stderr(`Environment not found: ${name}\n${known(report.environments)}`);
      return 1;
    }
    emit(d, values.json ? JSON.stringify(env, null, 2) : formatOne(env), values.output);
    return 0;
  }

  if (report.environments.length === 0 && report.errors.length === 0) {
    d.stderr(`No environments found under ${toPosixPath(relative(d.cwd, report.root)) || "."}/environments.\n`);
    return 1;
  }
  emit(d, values.json ? JSON.stringify(report, null, 2) : formatList(report.environments), values.output);
  return 0;
}

const known = (envs: EnvironmentReport[]): string =>
  envs.length > 0 ? `Known: ${envs.map((e) => e.name).join(", ")}\n` : "No environments found.\n";

function formatList(envs: EnvironmentReport[]): string {
  const width = Math.max(...envs.map((e) => e.name.length), 4);
  const lines = envs.map((e) => {
    const missing = e.unresolved.length > 0 ? `  ⚠ ${e.unresolved.length} unresolved secret(s)` : "";
    return `${e.name.padEnd(width)}  ${Object.keys(e.variables).length} var(s), ${e.secrets.length} secret(s)${missing}`;
  });
  return lines.join("\n");
}

function formatOne(env: EnvironmentReport): string {
  const lines = [`${env.name}  (${env.path})`, ""];
  const varEntries = Object.entries(env.variables);
  if (varEntries.length > 0) {
    lines.push("variables");
    const width = Math.max(...varEntries.map(([k]) => k.length));
    for (const [k, v] of varEntries) lines.push(`  ${k.padEnd(width)}  ${v}`);
    lines.push("");
  }
  if (env.secrets.length > 0) {
    lines.push("secrets");
    const width = Math.max(...env.secrets.map((s) => s.name.length));
    for (const s of env.secrets) {
      // Values are deliberately absent: this output gets pasted into issues.
      const where = s.resolved ? `resolved from ${s.source === "env" ? "the environment" : ".env"}` : "NOT SET";
      lines.push(`  ${s.name.padEnd(width)}  ${where}`);
    }
    lines.push("");
  }
  if (env.unresolved.length > 0) {
    lines.push(`${env.unresolved.length} secret(s) have no value: ${env.unresolved.join(", ")}`);
  }
  return lines.join("\n");
}

function formatDiff(diff: ReturnType<typeof diffEnvironments>): string {
  const lines = [`${diff.a} → ${diff.b}`, ""];
  // Marking secrets matters because the fix differs: a missing variable is added to the file, a
  // missing secret is set in the environment that runs it.
  const kind = (n: string): string => (diff.secretNames.includes(n) ? "  (secret)" : "");
  if (diff.onlyInA.length > 0) {
    lines.push(`only in ${diff.a} (${diff.onlyInA.length}):`);
    for (const n of diff.onlyInA) lines.push(`  - ${n}${kind(n)}`);
    lines.push("");
  }
  if (diff.onlyInB.length > 0) {
    lines.push(`only in ${diff.b} (${diff.onlyInB.length}):`);
    for (const n of diff.onlyInB) lines.push(`  + ${n}${kind(n)}`);
    lines.push("");
  }
  if (diff.changed.length > 0) {
    lines.push(`different (${diff.changed.length}):`);
    for (const c of diff.changed) lines.push(`  ~ ${c.name}: ${c.a}  →  ${c.b}`);
    lines.push("");
  }
  lines.push(
    diff.onlyInA.length === 0 && diff.onlyInB.length === 0 && diff.changed.length === 0
      ? `Identical — ${diff.same.length} name(s) in both.`
      : `${diff.same.length} name(s) identical.`,
  );
  return lines.join("\n");
}
