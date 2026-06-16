import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parse } from "../format";
import { SCHEMA_VERSION } from "../format/schema";
import type { TruSpecEnvironment, TruSpecFolderConfig } from "../format/types";
import type { Vars } from "../runner";
import { findUp } from "./discover";

/** Merge a root→leaf chain of folder configs; deeper entries win. */
export function mergeFolderConfigs(chain: TruSpecFolderConfig[]): TruSpecFolderConfig {
  const merged: TruSpecFolderConfig = { tspec: SCHEMA_VERSION };
  for (const f of chain) {
    if (f.name !== undefined) merged.name = f.name;
    if (f.baseUrl !== undefined) merged.baseUrl = f.baseUrl;
    if (f.auth !== undefined) merged.auth = f.auth;
    if (f.headers) merged.headers = { ...(merged.headers ?? {}), ...f.headers };
  }
  return merged;
}

/** Collect `folder.tspec.yaml` from `rootDir` down to `leafDir`, then merge. */
export function loadFolderChain(leafDir: string, rootDir: string): TruSpecFolderConfig {
  const root = resolve(rootDir);
  const dirs: string[] = [];
  let dir = resolve(leafDir);
  for (;;) {
    dirs.unshift(dir);
    if (dir === root) break;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  const chain: TruSpecFolderConfig[] = [];
  for (const d of dirs) {
    const p = join(d, "folder.tspec.yaml");
    if (existsSync(p)) chain.push(parse.folderConfig.parse(readFileSync(p, "utf8")));
  }
  return mergeFolderConfigs(chain);
}

/** Find and parse `environments/<name>.env.yaml`, searching upward from `searchFrom`. */
export function loadEnvironment(searchFrom: string, name: string): TruSpecEnvironment | undefined {
  const dir = findUp(resolve(searchFrom), (d) => existsSync(join(d, "environments", `${name}.env.yaml`)));
  if (!dir) return undefined;
  return parse.environment.parse(readFileSync(join(dir, "environments", `${name}.env.yaml`), "utf8"));
}

export interface BuiltVars {
  vars: Vars;
  missingSecrets: string[];
}

/** Build the variable map from an environment, resolving declared secrets from process env. */
export function buildVars(
  env: TruSpecEnvironment | undefined,
  processEnv: NodeJS.ProcessEnv = process.env,
): BuiltVars {
  const vars: Vars = {};
  const missingSecrets: string[] = [];
  if (env) {
    for (const [k, v] of Object.entries(env.variables)) vars[k] = v;
    for (const name of env.secrets) {
      const val = processEnv[name];
      if (val === undefined) missingSecrets.push(name);
      else vars[name] = val;
    }
  }
  return { vars, missingSecrets };
}
