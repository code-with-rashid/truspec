import { runCommand } from "./commands/run";

const VERSION = "0.0.0";

const HELP = `truspec ${VERSION} — local-first, spec-synced, agent-native API client

Usage:
  truspec run <path> [--env <name>] [--json] [--output <file>] [--timeout <ms>]
  truspec --help
  truspec --version

Commands:
  run    Run a request file or a directory of requests.
         Exits non-zero when any assertion fails (use it as a CI gate).
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
