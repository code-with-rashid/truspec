import { codegenCommand } from "./commands/codegen";
import { contractCommand } from "./commands/contract";
import { coverageCommand } from "./commands/coverage";
import { driftCommand } from "./commands/drift";
import { docsCommand } from "./commands/docs";
import { envCommand } from "./commands/env";
import { genCommand } from "./commands/gen";
import { importCommand } from "./commands/import";
import { initCommand } from "./commands/init";
import { lintCommand } from "./commands/lint";
import { mockCommand } from "./commands/mock";
import { runCommand } from "./commands/run";
import { serveCommand } from "./commands/serve";
import { closest } from "./args";

declare const __TRUSPEC_VERSION__: string | undefined;
const VERSION = typeof __TRUSPEC_VERSION__ === "string" ? __TRUSPEC_VERSION__ : "0.0.0";

const HELP = `truspec ${VERSION} — local-first, spec-synced, agent-native API client

Usage:
  truspec init [<dir>] [--spec <openapi>] [--dir <requests>] [--base-url <url>] [--env <name>]
  truspec run <path> [--env <name>] [--spec <openapi>] [--var k=v] [--grep <re>] [--tag <name>]
                     [--bail] [--delay <ms>] [--watch]
                     [--data <file>] [--repeat <n>] [--json | --reporter <r>] [--output <file>] [--timeout <ms>]
  truspec drift --spec <openapi> [<dir>] [--live <baseUrl>] [--json]
  truspec coverage --spec <openapi> [<dir>] [--min <percent>] [--json]
  truspec contract --spec <openapi> [<dir>] [--env <name>] [--json]
  truspec gen --spec <openapi> --out <dir> [--base-url-var <name>]
  truspec env [<name>] [--diff <a> <b>] [--json]
  truspec docs [<dir>] [--out <file>] [--lang <target>]
  truspec lint [<dir>] [--strict] [--json] [--disable <rule>] [--list-rules]
  truspec codegen <request> [--lang <target>] [--env <name>] [--list]
  truspec import <postman|bruno|insomnia|curl|har> <path|-> [--out <dir>] [--filter <substr>]
  truspec mock --spec <openapi> [--port <n>] [--delay <ms>]
  truspec serve [--dir <collection>] [--port <n>] [--insecure] [--proxy <url>]
  truspec --help
  truspec --version

Commands:
  init       Scaffold a runnable collection: a request, an environment, and a .gitignore.
  run        Run a request file or directory; non-zero exit on assertion failure.
  drift      Diff a collection against an OpenAPI spec (+ --live API probe); non-zero exit on drift.
  coverage   Report which spec operations have a tested request (--min to gate).
  contract   Run the collection and validate each response against the spec; non-zero exit on violation.
  gen        Scaffold a request stub per operation from an OpenAPI spec.
  env        List, inspect, or diff the workspace's environments (never prints secret values).
  docs       Render a collection as committable Markdown documentation.
  lint       Static checks over a collection (inline secrets, dead assertions, undeclared vars).
  codegen    Render a request as a runnable snippet (curl, Python, Go, …); --list for targets.
  import     Convert a Postman/Bruno/Insomnia collection, curl command, or HAR export.
  mock       Serve generated responses from an OpenAPI spec (local, offline).
  serve      Open the local web UI for a collection (executes requests server-side).
`;

/** Every dispatchable command name, in the order the help text lists them. */
const COMMANDS = [
  "init",
  "run",
  "drift",
  "coverage",
  "contract",
  "gen",
  "codegen",
  "lint",
  "docs",
  "env",
  "import",
  "mock",
  "serve",
] as const;

/** Streams are injected so `main`'s own output — help, version, unknown command — is testable. */
export interface MainIo {
  stdout?: (s: string) => void;
  stderr?: (s: string) => void;
}

export async function main(argv: string[], io: MainIo = {}): Promise<number> {
  const stdout = io.stdout ?? ((s: string) => void process.stdout.write(s));
  const stderr = io.stderr ?? ((s: string) => void process.stderr.write(s));
  const [command, ...rest] = argv;

  if (!command || command === "help" || command === "--help" || command === "-h") {
    stdout(HELP);
    return 0;
  }
  if (command === "--version" || command === "-v") {
    stdout(`${VERSION}\n`);
    return 0;
  }

  switch (command) {
    case "init":
      return initCommand(rest);
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
    case "codegen":
      return codegenCommand(rest);
    case "lint":
      return lintCommand(rest);
    case "docs":
      return docsCommand(rest);
    case "env":
      return envCommand(rest);
    case "import":
      return importCommand(rest);
    case "mock":
      return mockCommand(rest);
    case "serve":
      return serveCommand(rest);
    default: {
      // The file format has suggested the key you meant since the parser learned to; a mistyped
      // command deserves the same courtesy rather than a wall of usage text to scan.
      const guess = closest(command, COMMANDS);
      const hint = guess === undefined ? "" : ` — did you mean 'truspec ${guess}'?`;
      stderr(`Unknown command: ${command}${hint}\n\n${HELP}`);
      return 2;
    }
  }
}
