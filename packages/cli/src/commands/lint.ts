import { existsSync } from "node:fs";
import { relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { LINT_RULES, type LintReport, lintWorkspace } from "@truspec/core/lint";
import { type CommandDeps, emit, resolveDeps } from "./deps";

const USAGE =
  "Usage: truspec lint [<dir>] [--strict] [--json] [--disable <rule>] [--output <file>] [--list-rules]\n";

/** `truspec lint [dir]` — static checks over a collection; non-zero exit on an error. */
export async function lintCommand(argv: string[], deps: Partial<CommandDeps> = {}): Promise<number> {
  const d = resolveDeps(deps);
  const options = {
    strict: { type: "boolean" },
    json: { type: "boolean" },
    disable: { type: "string", multiple: true },
    output: { type: "string", short: "o" },
    "list-rules": { type: "boolean" },
  } as const;

  let values: {
    strict?: boolean;
    json?: boolean;
    disable?: string[];
    output?: string;
    "list-rules"?: boolean;
  };
  let positionals: string[];
  try {
    const parsed = parseArgs({ args: argv, allowPositionals: true, options });
    values = parsed.values;
    positionals = parsed.positionals;
  } catch (e) {
    d.stderr(`${(e as Error).message}\n`);
    return 2;
  }

  if (values["list-rules"]) {
    const width = Math.max(...LINT_RULES.map((r) => r.id.length));
    for (const r of LINT_RULES) {
      d.stdout(`${r.id.padEnd(width)}  ${r.severity.padEnd(7)}  ${r.description}\n`);
    }
    return 0;
  }

  const target = positionals[0] ?? ".";
  const abs = resolve(d.cwd, target);
  if (!existsSync(abs)) {
    d.stderr(`Path not found: ${target}\n${USAGE}`);
    return 1;
  }

  let report: LintReport;
  try {
    report = lintWorkspace(abs, {
      processEnv: d.processEnv,
      ...(values.disable ? { disable: values.disable } : {}),
    });
  } catch (e) {
    d.stderr(`Error: ${(e as Error).message}\n`);
    return 1;
  }

  emit(d, values.json ? JSON.stringify(report, null, 2) : formatLint(report, d.cwd), values.output);
  if (report.errors > 0) return 1;
  return values.strict && report.warnings > 0 ? 1 : 0;
}

/** Human output: grouped by file, with the rule id shown so a finding can be looked up or disabled. */
export function formatLint(report: LintReport, cwd: string): string {
  const lines: string[] = [];
  const byFile = new Map<string, LintReport["findings"]>();
  for (const f of report.findings) {
    const list = byFile.get(f.path);
    if (list) list.push(f);
    else byFile.set(f.path, [f]);
  }
  for (const [path, findings] of [...byFile].sort((a, b) => a[0].localeCompare(b[0]))) {
    lines.push(path);
    for (const f of findings) {
      lines.push(`  ${f.severity === "error" ? "✗" : "!"} ${f.severity} ${f.rule}: ${f.message}`);
    }
    lines.push("");
  }
  const where = relative(cwd, report.dir) || ".";
  lines.push(
    report.findings.length === 0
      ? `Linted ${report.files} request(s) in ${where} — no findings.`
      : `Linted ${report.files} request(s) in ${where} — ${report.errors} error(s), ${report.warnings} warning(s).`,
  );
  return lines.join("\n");
}
