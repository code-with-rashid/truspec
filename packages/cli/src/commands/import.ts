import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  importBrunoDir,
  importCurl,
  importHarFile,
  importInsomniaFile,
  importPostmanFile,
  type ImportResult,
  writeImport,
} from "@truspec/core/importers";
import { type CommandDeps, resolveDeps } from "./deps";

const SOURCES = ["postman", "bruno", "insomnia", "curl", "har"] as const;
type Source = (typeof SOURCES)[number];
const USAGE = `Usage: truspec import <${SOURCES.join("|")}> <path> [--out <dir>] [--dry-run]
       truspec import curl -            # read the curl command from stdin
`;

/** Read all of stdin as UTF-8 (for `truspec import curl -`). */
async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

/** `truspec import <postman|bruno|curl> <path> [--out <dir>]` — converts to .tspec.yaml files. */
export async function importCommand(argv: string[], deps: Partial<CommandDeps> = {}): Promise<number> {
  const d = resolveDeps(deps);
  const [source, ...rest] = argv;
  if (!SOURCES.includes(source as Source)) {
    d.stderr(USAGE);
    return 2;
  }

  const options = {
    out: { type: "string", short: "o" },
    "dry-run": { type: "boolean" },
    name: { type: "string" },
    filter: { type: "string" },
    "base-url-var": { type: "string" },
    "keep-noise-headers": { type: "boolean" },
    "include-options": { type: "boolean" },
  } as const;
  let values: {
    out?: string;
    "dry-run"?: boolean;
    name?: string;
    filter?: string;
    "base-url-var"?: string;
    "keep-noise-headers"?: boolean;
    "include-options"?: boolean;
  };
  let positionals: string[];
  try {
    const parsed = parseArgs({ args: rest, allowPositionals: true, options });
    values = parsed.values;
    positionals = parsed.positionals;
  } catch (e) {
    d.stderr(`${(e as Error).message}\n`);
    return 2;
  }

  const input = positionals[0];
  if (!input) {
    d.stderr(`Missing input path.\n${USAGE}`);
    return 2;
  }

  let result: ImportResult;
  try {
    if (source === "curl") {
      // `-` means stdin, so a pasted command pipes straight in without a temp file.
      const text = input === "-" ? await readStdin() : readCurlInput(d.cwd, input);
      result = importCurl(text, values.name ? { name: values.name } : {});
      if (result.files.length === 0) {
        for (const w of result.warnings) d.stderr(`warning: ${w}\n`);
        d.stderr("No curl command could be imported.\n");
        return 1;
      }
    } else {
      const abs = resolve(d.cwd, input);
      if (!existsSync(abs)) {
        d.stderr(`Not found: ${input}\n`);
        return 1;
      }
      result =
        source === "postman"
          ? importPostmanFile(abs)
          : source === "insomnia"
            ? importInsomniaFile(abs)
            : source === "har"
            ? importHarFile(abs, {
                ...(values.filter ? { filter: values.filter } : {}),
                ...(values["base-url-var"] ? { baseUrlVar: values["base-url-var"] } : {}),
                ...(values["keep-noise-headers"] ? { keepNoiseHeaders: true } : {}),
                ...(values["include-options"] ? { includeOptions: true } : {}),
              })
              : importBrunoDir(abs);
      if (source === "har" && result.files.length === 0) {
        for (const w of result.warnings) d.stderr(`warning: ${w}\n`);
        d.stderr("No importable entries in that HAR.\n");
        return 1;
      }
    }
  } catch (e) {
    d.stderr(`Error: ${(e as Error).message}\n`);
    return 1;
  }

  for (const w of result.warnings) d.stderr(`warning: ${w}\n`);

  if (values["dry-run"] || !values.out) {
    d.stdout(
      `${result.stats.requests} request(s), ${result.stats.folders} folder(s) — ${result.files.length} file(s):\n`,
    );
    for (const f of result.files) d.stdout(`  ${f.path}\n`);
    if (!values.out) d.stdout("\n(dry run — pass --out <dir> to write the files)\n");
    return 0;
  }

  const written = writeImport(result, resolve(d.cwd, values.out));
  d.stdout(`Wrote ${written.length} file(s) to ${values.out}\n`);
  return 0;
}

/**
 * A curl argument is either a file holding the command or — far more commonly — the command
 * itself, pasted straight from devtools. Treat it as a literal command when it is not a file
 * that exists, so `truspec import curl "curl https://…"` just works.
 */
function readCurlInput(cwd: string, input: string): string {
  const abs = resolve(cwd, input);
  if (existsSync(abs)) return readFileSync(abs, "utf8");
  return input;
}
