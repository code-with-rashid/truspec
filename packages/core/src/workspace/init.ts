import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { parse } from "../format";
import { SCHEMA_VERSION } from "../format/schema";
import { scaffoldFromSpec } from "../spec/scaffold";
import { toPosixPath } from "./paths";

export interface InitOptions {
  /**
   * OpenAPI document text. When given, requests are scaffolded from it instead of a placeholder
   * health check — and the collection is spec-linked from the first commit, so `drift`,
   * `coverage` and `contract` all work immediately.
   */
  specText?: string;
  /** Path of that spec relative to the project root, for the printed next steps. */
  specPath?: string;
  /** Subdirectory for requests, relative to the project root. Default `api`. */
  requestsDir?: string;
  /** Base URL the generated environment points at. Default `http://localhost:3000`. */
  baseUrl?: string;
  /** Environment name to create. Default `local`. */
  env?: string;
  /** Overwrite files that already exist. Off by default — `init` must be safe to re-run. */
  force?: boolean;
}

export interface InitResult {
  root: string;
  /** Project-relative paths that were written. */
  created: string[];
  /** Project-relative paths left alone because they already existed. */
  skipped: string[];
}

/**
 * Scaffold a runnable TruSpec collection in `root`.
 *
 * The point is that the result *runs* — a request, an environment it resolves against, and a
 * `.gitignore` line so the first secret anyone adds doesn't get committed. A scaffold that needs
 * three more edits before `truspec run` works is a worse first impression than no scaffold at all.
 *
 * Re-running is safe: an existing file is skipped and reported, never clobbered, unless `force`.
 */
export function initProject(root: string, opts: InitOptions = {}): InitResult {
  const requestsDir = opts.requestsDir ?? "api";
  const envName = opts.env ?? "local";
  const baseUrl = opts.baseUrl ?? "http://localhost:3000";

  const created: string[] = [];
  const skipped: string[] = [];
  const write = (relPath: string, content: string): void => {
    const abs = join(root, relPath);
    if (existsSync(abs) && !opts.force) {
      skipped.push(toPosixPath(relPath));
      return;
    }
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
    created.push(toPosixPath(relPath));
  };

  // Serialize through the schema rather than emitting hand-written YAML, so a scaffold can never
  // produce a file the parser would reject — the same rule agents are held to.
  write(
    join(requestsDir, "folder.tspec.yaml"),
    parse.folderConfig.serialize({
      tspec: SCHEMA_VERSION,
      name: "API",
      baseUrl: "{{baseUrl}}",
      headers: { Accept: "application/json" },
    }),
  );
  // Path parameters the scaffold introduces are seeded into the environment, so the very first
  // `truspec run` resolves instead of failing on `Unresolved variables: {{id}}`.
  let pathVariables: Record<string, string> = {};
  if (opts.specText) {
    const scaffold = scaffoldFromSpec(opts.specText);
    pathVariables = scaffold.pathVariables;
    for (const file of scaffold.files) write(join(requestsDir, file.path), file.content);
  } else {
    write(
      join(requestsDir, "health.tspec.yaml"),
      parse.request.serialize({
        tspec: SCHEMA_VERSION,
        name: "Health check",
        method: "GET",
        url: "/health",
        assertions: [
          { type: "status", equals: 200 },
          { type: "duration", ltMs: 2000 },
        ],
        docs: "Replace this with a real request — or run `truspec gen --spec openapi.yaml --out api`.",
      }),
    );
  }
  write(
    join("environments", `${envName}.env.yaml`),
    parse.environment.serialize({
      tspec: SCHEMA_VERSION,
      name: envName,
      variables: { baseUrl, ...pathVariables },
      // Declared but not valued: the name documents what the collection needs, and the value comes
      // from the OS env or `.env` at run time. This is the pattern the whole format is built on.
      secrets: ["token"],
    }),
  );
  write(
    ".env.example",
    [
      "# Copy to .env and fill in. Real environment variables take precedence.",
      "# Values here are never committed — .env is gitignored by `truspec init`.",
      "token=",
      "",
    ].join("\n"),
  );

  ensureGitignored(root, created, skipped);
  return { root, created, skipped };
}

/** Add `.env` to `.gitignore`, creating the file if needed, without disturbing what's there. */
function ensureGitignored(root: string, created: string[], skipped: string[]): void {
  const file = join(root, ".gitignore");
  if (!existsSync(file)) {
    writeFileSync(file, "# TruSpec: secret values live here, never in the collection.\n.env\n");
    created.push(".gitignore");
    return;
  }
  const current = readFileSync(file, "utf8");
  const ignoresEnv = current
    .split("\n")
    .map((l) => l.trim())
    .some((l) => l === ".env" || l === "/.env" || l === "*.env");
  if (ignoresEnv) {
    skipped.push(".gitignore");
    return;
  }
  const sep = current.endsWith("\n") || current === "" ? "" : "\n";
  writeFileSync(file, `${current}${sep}\n# TruSpec: secret values live here, never in the collection.\n.env\n`);
  created.push(".gitignore");
}

export interface NextStepsOptions {
  requestsDir?: string;
  envName?: string;
  /** Spec path, when the scaffold was generated from one. */
  specPath?: string;
  /** Base URL the generated environment points at, for the "start your API" hint. */
  baseUrl?: string;
  cwd?: string;
}

/**
 * The next steps to print after a scaffold — kept here so the CLI and MCP say the same thing.
 *
 * With a spec, the first step starts TruSpec's own mock, so `run` goes green immediately and
 * entirely offline. Without one, there is nothing honest to point at but the user's own API, so
 * the guidance says so plainly rather than scaffolding a request that quietly fails.
 */
export function initNextSteps(result: InitResult, opts: NextStepsOptions = {}): string[] {
  const requestsDir = opts.requestsDir ?? "api";
  const envName = opts.envName ?? "local";
  const where = toPosixPath(relative(opts.cwd ?? process.cwd(), result.root)) || ".";
  const steps = where === "." ? [] : [`cd ${where}`];
  if (opts.specPath) {
    steps.push(
      `truspec mock --spec ${opts.specPath} --port 3000 &   # local mock, fully offline`,
      `truspec run ${requestsDir} --env ${envName}          # should pass against the mock`,
      `truspec coverage --spec ${opts.specPath} ${requestsDir}`,
    );
  } else {
    steps.push(
      `# point ${envName}'s baseUrl (${opts.baseUrl ?? "http://localhost:3000"}) at your API, then:`,
      `truspec run ${requestsDir} --env ${envName}`,
      `truspec gen --spec openapi.yaml --out ${requestsDir}   # or scaffold from an OpenAPI spec`,
    );
  }
  steps.push(`truspec serve --dir ${requestsDir}                     # open the local UI`);
  return steps;
}
