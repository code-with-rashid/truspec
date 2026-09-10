import { parseArgs } from "node:util";
import { CODEGEN_TARGETS, codegenTargetIds, generateCode } from "@truspec/core/codegen";
import { prepareRequest } from "@truspec/core/workspace";
import { type CommandDeps, emit, resolveDeps } from "./deps";
import { argError } from "../args";

const USAGE =
  "Usage: truspec codegen <request.tspec.yaml> [--lang <target>] [--env <name>] [--with-secrets] [--output <file>] [--list]\n";

/** `truspec codegen <file> --lang python-requests` — render a request as a snippet in another client. */
export async function codegenCommand(
  argv: string[],
  deps: Partial<CommandDeps> = {},
): Promise<number> {
  const d = resolveDeps(deps);
  const options = {
    lang: { type: "string", short: "l" },
    env: { type: "string", short: "e" },
    "with-secrets": { type: "boolean" },
    output: { type: "string", short: "o" },
    list: { type: "boolean" },
  } as const;

  let parsed: { values: Record<string, string | boolean | undefined>; positionals: string[] };
  try {
    parsed = parseArgs({ args: argv, allowPositionals: true, options }) as typeof parsed;
  } catch (e) {
    d.stderr(argError(e, "codegen", options, USAGE));
    return 2;
  }
  const { values, positionals } = parsed;

  if (values.list) {
    const width = Math.max(...CODEGEN_TARGETS.map((t) => t.id.length));
    for (const t of CODEGEN_TARGETS) d.stdout(`${t.id.padEnd(width)}  ${t.label}\n`);
    return 0;
  }

  const file = positionals[0];
  if (!file) {
    d.stderr(USAGE);
    return 2;
  }
  const lang = typeof values.lang === "string" ? values.lang : "curl";
  if (!codegenTargetIds().includes(lang)) {
    d.stderr(`Unknown --lang "${lang}". Run \`truspec codegen --list\` to see the ${CODEGEN_TARGETS.length} targets.\n`);
    return 2;
  }

  try {
    const prepared = prepareRequest(file, {
      cwd: d.cwd,
      processEnv: d.processEnv,
      ...(typeof values.env === "string" ? { env: values.env } : {}),
    });
    // A snippet's documented purpose is being shared — "for a bug report" — and `--env` used to
    // bake the resolved credential into the URL, the Authorization header and the body. Every
    // other output surface masks declared secrets; this one did not, and nothing said so. They now
    // keep their `{{placeholder}}`, exactly as they do without `--env`, unless explicitly asked for.
    const withheld = values["with-secrets"]
      ? []
      : prepared.secretNames.filter((n) => prepared.vars[n] !== undefined);
    const vars = { ...prepared.vars };
    for (const name of withheld) delete vars[name];

    const { code } = generateCode(prepared.req, lang, { folder: prepared.folder, vars });
    if (withheld.length > 0) {
      d.stderr(
        `Note: ${withheld.join(", ")} left as {{placeholder}} — declared secret(s), and a snippet is made to be shared.\n` +
          "      Pass --with-secrets to inline the real value(s).\n",
      );
    }
    emit(d, code, typeof values.output === "string" ? values.output : undefined);
    return 0;
  } catch (e) {
    d.stderr(`Error: ${(e as Error).message}\n`);
    return 1;
  }
}
