import { contractCommand } from "./commands/contract";
import { coverageCommand } from "./commands/coverage";
import { driftCommand } from "./commands/drift";
import { genCommand } from "./commands/gen";
import { importCommand } from "./commands/import";
import { mockCommand } from "./commands/mock";
import { runCommand } from "./commands/run";
import { serveCommand } from "./commands/serve";

declare const __TRUSPEC_VERSION__: string | undefined;
const VERSION = typeof __TRUSPEC_VERSION__ === "string" ? __TRUSPEC_VERSION__ : "0.0.0";

const HELP = `truspec ${VERSION} — local-first, spec-synced, agent-native API client

Usage:
  truspec run <path> [--env <name>] [--spec <openapi>] [--json] [--output <file>] [--timeout <ms>]
  truspec drift --spec <openapi> [<dir>] [--live <baseUrl>] [--json]
  truspec coverage --spec <openapi> [<dir>] [--min <percent>] [--json]
  truspec contract --spec <openapi> [<dir>] [--env <name>] [--json]
  truspec gen --spec <openapi> --out <dir> [--base-url-var <name>]
  truspec import <postman|bruno> <path> [--out <dir>]
  truspec mock --spec <openapi> [--port <n>] [--delay <ms>]
  truspec serve [--dir <collection>] [--port <n>]
  truspec --help
  truspec --version

Commands:
  run        Run a request file or directory; non-zero exit on assertion failure.
  drift      Diff a collection against an OpenAPI spec (+ --live API probe); non-zero exit on drift.
  coverage   Report which spec operations have a tested request (--min to gate).
  contract   Run the collection and validate each response against the spec; non-zero exit on violation.
  gen        Scaffold a request stub per operation from an OpenAPI spec.
  import     Convert a Postman collection or Bruno directory to .tspec.yaml files.
  mock       Serve generated responses from an OpenAPI spec (local, offline).
  serve      Open the local web UI for a collection (executes requests server-side).
`;

export async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;

  if (!command || command === "help" || command === "--help" || command === "-h") {
    process.stdout.write(HELP);
    return 0;
  }
  if (command === "--version" || command === "-v") {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }

  switch (command) {
    case "run":
      return runCommand(rest);
    case "drift":
      return driftCommand(rest);
    case "coverage":
      return coverageCommand(rest);
    case "contract":
      return contractCommand(rest);
    case "gen":
      return genCommand(rest);
    case "import":
      return importCommand(rest);
    case "mock":
      return mockCommand(rest);
    case "serve":
      return serveCommand(rest);
    default:
      process.stderr.write(`Unknown command: ${command}\n\n${HELP}`);
      return 2;
  }
}

main(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((e: unknown) => {
    process.stderr.write(`Error: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  });
