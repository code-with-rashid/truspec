import { coverageCommand } from "./commands/coverage";
import { driftCommand } from "./commands/drift";
import { genCommand } from "./commands/gen";
import { importCommand } from "./commands/import";
import { mockCommand } from "./commands/mock";
import { runCommand } from "./commands/run";

const VERSION = "0.0.0";

const HELP = `truspec ${VERSION} — local-first, spec-synced, agent-native API client

Usage:
  truspec run <path> [--env <name>] [--json] [--output <file>] [--timeout <ms>]
  truspec drift --spec <openapi> [<dir>] [--json]
  truspec coverage --spec <openapi> [<dir>] [--min <percent>] [--json]
  truspec gen --spec <openapi> --out <dir> [--base-url-var <name>]
  truspec import <postman|bruno> <path> [--out <dir>]
  truspec mock --spec <openapi> [--port <n>]
  truspec --help
  truspec --version

Commands:
  run        Run a request file or directory; non-zero exit on assertion failure.
  drift      Diff a collection against an OpenAPI spec; non-zero exit on drift.
  coverage   Report which spec operations have a tested request (--min to gate).
  gen        Scaffold a request stub per operation from an OpenAPI spec.
  import     Convert a Postman collection or Bruno directory to .tspec.yaml files.
  mock       Serve generated responses from an OpenAPI spec (local, offline).
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
    case "gen":
      return genCommand(rest);
    case "import":
      return importCommand(rest);
    case "mock":
      return mockCommand(rest);
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
