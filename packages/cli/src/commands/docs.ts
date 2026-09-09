import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { CODEGEN_TARGETS } from "@truspec/core/codegen";
import { collectionDocs } from "@truspec/core/docs";
import { type CommandDeps, emit, resolveDeps } from "./deps";

const USAGE =
  "Usage: truspec docs [<dir>] [--out <file>] [--title <text>] [--lang <target>|none] [--base-level <n>]\n";

/** `truspec docs [dir]` — render a collection as committable Markdown. */
export async function docsCommand(argv: string[], deps: Partial<CommandDeps> = {}): Promise<number> {
  const d = resolveDeps(deps);
  const options = {
    out: { type: "string", short: "o" },
    title: { type: "string" },
    lang: { type: "string", short: "l" },
    "base-level": { type: "string" },
  } as const;

  let values: { out?: string; title?: string; lang?: string; "base-level"?: string };
  let positionals: string[];
  try {
    const parsed = parseArgs({ args: argv, allowPositionals: true, options });
    values = parsed.values;
    positionals = parsed.positionals;
  } catch (e) {
    d.stderr(`${(e as Error).message}\n${USAGE}`);
    return 2;
  }

  const lang = values.lang ?? "curl";
  if (lang !== "none" && !CODEGEN_TARGETS.some((t) => t.id === lang)) {
    d.stderr(`Unknown --lang "${lang}". Run \`truspec codegen --list\`, or pass "none".\n`);
    return 2;
  }

  const target = positionals[0] ?? ".";
  const abs = resolve(d.cwd, target);
  if (!existsSync(abs)) {
    d.stderr(`Path not found: ${target}\n`);
    return 1;
  }

  const level = Number(values["base-level"] ?? 1);
  if (!Number.isInteger(level) || level < 1 || level > 5) {
    d.stderr("--base-level must be an integer from 1 to 5.\n");
    return 2;
  }

  const result = collectionDocs(abs, {
    lang,
    baseLevel: level,
    ...(values.title ? { title: values.title } : {}),
  });
  if (result.count === 0 && result.errors.length === 0) {
    d.stderr(`No .tspec.yaml requests found under "${target}".\n`);
    return 1;
  }
  emit(d, result.markdown, values.out);
  for (const e of result.errors) d.stderr(`warning: could not read ${e.path}: ${e.error}\n`);
  // Unreadable files are a warning, not a failure: the document is still useful, and `lint` is
  // the command whose job it is to fail on a broken file.
  return 0;
}
