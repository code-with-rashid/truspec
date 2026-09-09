import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parse } from "../format";
import type { TruSpecFolderConfig, TruSpecRequest } from "../format/types";
import type { Vars } from "../runner";
import { buildVars, loadDotenv, loadEnvironment, loadFolderChain } from "./context";
import { findWorkspaceRoot } from "./run";

export interface PrepareOptions {
  env?: string;
  cwd?: string;
  processEnv?: NodeJS.ProcessEnv;
  /** Extra variables applied over the environment's. */
  vars?: Vars;
}

export interface PreparedRequest {
  req: TruSpecRequest;
  /** Merged folder chain (base URL, inherited headers/auth) for the request's directory. */
  folder: TruSpecFolderConfig;
  vars: Vars;
  /** Workspace root the folder chain and environments were resolved from. */
  root: string;
  /** Declared secrets with no value in the environment — snippets will show them unresolved. */
  missingSecrets: string[];
}

/**
 * Load one request file together with everything the runner would apply to it: the merged folder
 * chain and the environment's variables (including `.env`/OS secrets).
 *
 * Non-run consumers — code generation, previews, docs — need exactly this context to show a
 * request the way it will actually be sent, without duplicating `runPath`'s resolution rules.
 */
export function prepareRequest(file: string, opts: PrepareOptions = {}): PreparedRequest {
  const cwd = opts.cwd ?? process.cwd();
  const abs = resolve(cwd, file);
  if (!existsSync(abs)) throw new Error(`Path not found: ${file}`);

  const req = parse.request.parse(readFileSync(abs, "utf8"));
  const root = findWorkspaceRoot(dirname(abs));
  const folder = loadFolderChain(dirname(abs), root);

  const env = opts.env ? loadEnvironment(root, opts.env) : undefined;
  if (opts.env && !env) {
    throw new Error(
      `Environment "${opts.env}" not found (looked for environments/${opts.env}.env.yaml)`,
    );
  }
  const processEnv = { ...loadDotenv(root), ...(opts.processEnv ?? process.env) };
  const built = buildVars(env, processEnv);

  return {
    req,
    folder,
    vars: { ...built.vars, ...opts.vars },
    root,
    missingSecrets: built.missingSecrets,
  };
}
