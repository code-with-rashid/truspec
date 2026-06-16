import { readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

/** Recursively find request files (`*.tspec.yaml`, excluding `folder.tspec.yaml`). */
export function discoverRequests(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(d);
    } catch {
      return;
    }
    for (const name of entries.sort()) {
      if (name === "node_modules" || name === ".git") continue;
      const full = join(d, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name.endsWith(".tspec.yaml") && name !== "folder.tspec.yaml") out.push(full);
    }
  };
  walk(dir);
  return out;
}

/** Walk up from `startDir` (inclusive) returning the first directory matching `test`. */
export function findUp(startDir: string, test: (dir: string) => boolean): string | undefined {
  let dir = startDir;
  for (;;) {
    if (test(dir)) return dir;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}
